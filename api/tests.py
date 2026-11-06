from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.test import RequestFactory, TestCase, override_settings
from django.utils import timezone
from django.urls import path, reverse
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.test import APIClient
from rest_framework.views import APIView

from api import urls as api_urls
from api import anonymous_case
from api.throttling import CaseWriteThrottle
from api.views import ApiView, SessionView
from calc.models import Calculation, Person


SESSION_URL = '/api/v1/session/'


class GuardedView(ApiView):
    """Stands in for a future endpoint that keeps the default permissions."""

    def post(self, request):
        return Response({'saved': True})


urlpatterns = [
    path('api/v1/session/', SessionView.as_view()),
    path('guarded/', GuardedView.as_view()),
]


class SessionProbeTests(TestCase):
    def test_url_is_versioned(self):
        self.assertEqual(reverse('api:session'), SESSION_URL)

    def test_anonymous_probe_sets_csrf_cookie_without_a_session_row(self):
        response = self.client.get(SESSION_URL, secure=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(response.json(), {'authenticated': False})
        self.assertTrue(response.cookies[settings.CSRF_COOKIE_NAME].value)
        self.assertNotIn(settings.SESSION_COOKIE_NAME, response.cookies)
        self.assertEqual(Session.objects.count(), 0)

    def test_logged_in_probe_reports_authenticated(self):
        user = get_user_model().objects.create_user('probe-user', password='not-used-for-login')
        self.client.force_login(user)

        response = self.client.get(SESSION_URL, secure=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'authenticated': True})

    def test_probe_is_never_cached(self):
        response = self.client.get(SESSION_URL, secure=True)
        self.assertIn('no-store', response['Cache-Control'])

    def test_post_is_rejected_with_json_405(self):
        response = APIClient(enforce_csrf_checks=True).post(SESSION_URL, {}, format='json', secure=True)

        self.assertEqual(response.status_code, 405)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertIn('detail', response.json())


class ApiDefaultsTests(TestCase):
    def test_new_views_require_authentication_by_default(self):
        self.assertEqual(APIView.permission_classes, [IsAuthenticated])

    def test_api_speaks_only_json_over_session_authentication(self):
        self.assertEqual(
            [cls.__name__ for cls in api_settings.DEFAULT_AUTHENTICATION_CLASSES],
            ['SessionAuthentication'],
        )
        self.assertEqual([cls.__name__ for cls in api_settings.DEFAULT_RENDERER_CLASSES], ['JSONRenderer'])
        self.assertEqual([cls.__name__ for cls in api_settings.DEFAULT_PARSER_CLASSES], ['JSONParser'])


@override_settings(ROOT_URLCONF='api.tests')
class ApiAccessTests(TestCase):
    def test_anonymous_gets_json_403_not_a_login_redirect(self):
        response = APIClient().post('/guarded/', {}, format='json', secure=True)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertIn('detail', response.json())

    def test_logged_in_write_needs_the_token_the_probe_issues(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(get_user_model().objects.create_user('csrf-user'))

        rejected = client.post('/guarded/', {}, format='json', secure=True)
        self.assertEqual(rejected.status_code, 403)
        self.assertEqual(rejected['Content-Type'], 'application/json')

        token = client.get(SESSION_URL, secure=True).cookies[settings.CSRF_COOKIE_NAME].value
        accepted = client.post(
            '/guarded/', {}, format='json', secure=True,
            headers={'X-CSRFToken': token, 'Referer': 'https://testserver/app/en/'},
        )
        self.assertEqual(accepted.status_code, 200)


class ApiRoutingTests(TestCase):
    def test_unknown_paths_get_json_404_for_every_method(self):
        for method in ('get', 'post', 'delete'):
            with self.subTest(method=method):
                response = getattr(APIClient(), method)('/api/v1/nope/', secure=True)
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response['Content-Type'], 'application/json')
                self.assertIn('detail', response.json())

    def test_not_found_route_stays_last(self):
        self.assertEqual(api_urls.urlpatterns[-1].name, 'not-found')

    def test_every_route_uses_the_api_base_view(self):
        for pattern in api_urls.urlpatterns:
            with self.subTest(route=pattern.name):
                self.assertTrue(issubclass(pattern.callback.cls, ApiView))


CASE_URL = '/api/v1/case/'
FORWARDED = 'HTTP_X_FORWARDED_FOR'


class CaseTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=True)

    def csrf(self, client):
        token = client.get(SESSION_URL, secure=True).cookies[settings.CSRF_COOKIE_NAME].value
        return {'X-CSRFToken': token, 'Referer': 'https://testserver/app/en/interview/'}

    def post(self, body=None, client=None, forwarded=None):
        client = client or self.client
        extra = {FORWARDED: forwarded} if forwarded else {}
        return client.post(
            CASE_URL, body or {}, format='json', secure=True, headers=self.csrf(client), **extra)

    def remaining(self):
        return (Session.objects.get().expire_date - timezone.now()).total_seconds()

    def test_url_is_versioned(self):
        self.assertEqual(reverse('api:case'), CASE_URL)

    def test_new_visitor_gets_no_case_and_no_session(self):
        response = self.client.get(CASE_URL, secure=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'case': None})
        self.assertNotIn(settings.SESSION_COOKIE_NAME, response.cookies)
        self.assertEqual(Session.objects.count(), 0)

    def test_session_probe_body_is_unchanged(self):
        self.assertEqual(self.client.get(SESSION_URL, secure=True).json(), {'authenticated': False})

    def test_start_creates_a_case_with_a_24_hour_session(self):
        response = self.post()

        self.assertEqual(response.status_code, 201)
        case = response.json()['case']
        self.assertEqual(set(case), {'id', 'started_at'})
        self.assertAlmostEqual(self.remaining(), 24 * 3600, delta=60)
        self.assertEqual(self.client.get(CASE_URL, secure=True).json(), {'case': case})

    def test_start_writes_no_case_or_person_rows(self):
        self.post()

        self.assertEqual(Calculation.objects.count(), 0)
        self.assertEqual(Person.objects.count(), 0)

    def test_missing_csrf_is_a_json_403_with_no_state_change(self):
        response = self.client.post(CASE_URL, {}, format='json', secure=True)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(Session.objects.count(), 0)

    def test_bad_csrf_is_a_json_403(self):
        response = self.client.post(
            CASE_URL, {}, format='json', secure=True,
            headers={'X-CSRFToken': 'wrong', 'Referer': 'https://testserver/app/en/'})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(Session.objects.count(), 0)

    def test_existing_case_is_not_replaced_without_choosing_to(self):
        case = self.post().json()['case']

        again = self.post()

        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()['case'], case)
        self.assertEqual(self.client.get(CASE_URL, secure=True).json(), {'case': case})

    def test_start_over_replaces_the_case(self):
        old = self.post().json()['case']

        new = self.post({'replace': True})

        self.assertEqual(new.status_code, 201)
        self.assertNotEqual(new.json()['case']['id'], old['id'])
        self.assertEqual(self.client.get(CASE_URL, secure=True).json(), {'case': new.json()['case']})

    def test_expired_session_has_no_case(self):
        self.post()
        Session.objects.update(expire_date=timezone.now() - timedelta(seconds=1))

        self.assertEqual(self.client.get(CASE_URL, secure=True).json(), {'case': None})

    def test_write_refreshes_the_idle_expiry(self):
        self.post()
        Session.objects.update(expire_date=timezone.now() + timedelta(hours=1))

        self.post({'replace': True})

        self.assertAlmostEqual(self.remaining(), 24 * 3600, delta=60)

    def test_logged_in_user_keeps_the_login_session_expiry(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(get_user_model().objects.create_user('case-user'))
        before = Session.objects.get().expire_date

        response = self.post(client=client)

        self.assertEqual(response.status_code, 201)
        self.assertAlmostEqual((Session.objects.get().expire_date - before).total_seconds(), 0, delta=5)
        self.assertGreater(self.remaining(), 10 * 24 * 3600)

    def test_logged_in_write_still_needs_csrf(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(get_user_model().objects.create_user('case-user'))

        response = client.post(CASE_URL, {}, format='json', secure=True)

        self.assertEqual(response.status_code, 403)

    def test_login_keeps_the_case_and_restores_the_default_expiry(self):
        get_user_model().objects.create_user('login-user', password='pw-for-test-only')
        case = self.post().json()['case']
        self.assertAlmostEqual(self.remaining(), 24 * 3600, delta=60)

        self.assertTrue(self.client.login(username='login-user', password='pw-for-test-only'))

        self.assertEqual(self.client.get(CASE_URL, secure=True).json(), {'case': case})
        self.assertGreater(self.remaining(), 10 * 24 * 3600)

    def test_write_limit_returns_json_429_and_reads_still_work(self):
        for _ in range(30):
            self.assertEqual(self.post({'replace': True}).status_code, 201)

        response = self.post({'replace': True})

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(self.client.get(CASE_URL, secure=True).status_code, 200)

    def test_spoofed_forwarded_for_does_not_dodge_the_limit(self):
        # Behind Cloudflare the trusted tail is "client, cloudflare"; anything before is spoofable.
        for n in range(30):
            response = self.post({'replace': True}, forwarded=f'spoof-{n}, 203.0.113.9, 172.70.0.1')
            self.assertEqual(response.status_code, 201)

        response = self.post({'replace': True}, forwarded='spoof-new, 203.0.113.9, 172.70.0.1')

        self.assertEqual(response.status_code, 429)

    def test_different_clients_have_separate_limits(self):
        for _ in range(30):
            self.post({'replace': True}, forwarded='203.0.113.9, 172.70.0.1')

        other = self.post({'replace': True}, forwarded='203.0.113.10, 172.70.0.1')

        self.assertEqual(other.status_code, 201)

    def test_get_is_never_cached(self):
        self.assertIn('no-store', self.client.get(CASE_URL, secure=True)['Cache-Control'])

    def test_replace_must_be_the_json_true(self):
        case = self.post().json()['case']

        for value in ('false', 'true', 1, 'yes', None):
            with self.subTest(replace=value):
                response = self.post({'replace': value})
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json()['case'], case)
        self.assertEqual(self.client.get(CASE_URL, secure=True).json(), {'case': case})

    def test_non_object_body_is_not_a_server_error(self):
        case = self.post().json()['case']

        response = self.post([1, 2])

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['case'], case)

    def test_probe_csrf_cookie_is_named_csrftoken_and_readable_by_script(self):
        cookie = self.client.get(SESSION_URL, secure=True).cookies[settings.CSRF_COOKIE_NAME]

        self.assertEqual(settings.CSRF_COOKIE_NAME, 'csrftoken')
        self.assertFalse(cookie['httponly'])

    def test_rejected_posts_do_not_use_up_the_quota(self):
        for _ in range(31):
            response = self.client.post(CASE_URL, {}, format='json', secure=True)
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response['Content-Type'], 'application/json')

        self.assertEqual(self.post().status_code, 201)

    def test_ipv6_clients_share_a_limit_per_64(self):
        for n in range(30):
            self.post({'replace': True}, forwarded=f'2001:db8:1:2::{n + 1}, 172.70.0.1')

        same_prefix = self.post({'replace': True}, forwarded='2001:db8:1:2:ffff::9, 172.70.0.1')
        other_prefix = self.post({'replace': True}, forwarded='2001:db8:1:3::1, 172.70.0.1')

        self.assertEqual(same_prefix.status_code, 429)
        self.assertEqual(other_prefix.status_code, 201)

    def test_ipv4_clients_are_keyed_on_the_full_address(self):
        throttle = CaseWriteThrottle()
        for forwarded, expected in (
            ('203.0.113.9, 172.70.0.1', '203.0.113.9'),
            ('2001:db8:1:2:aaaa:bbbb:cccc:dddd, 172.70.0.1', '2001:db8:1:2::/64'),
            ('not-an-ip, 172.70.0.1', 'not-an-ip'),
        ):
            with self.subTest(forwarded=forwarded):
                request = Request(RequestFactory().post(CASE_URL, **{FORWARDED: forwarded}))
                self.assertEqual(throttle.get_ident(request), expected)

    def test_malformed_stored_case_reads_as_none(self):
        self.post()
        session = self.client.session
        for stored in ({'id': 'x'}, {'started_at': 'y'}, 'text', 5):
            with self.subTest(stored=stored):
                session[anonymous_case.SESSION_KEY] = stored
                session.save()
                self.assertEqual(self.client.get(CASE_URL, secure=True).json(), {'case': None})

    def test_login_without_a_case_keeps_the_expiry_its_flow_set(self):
        get_user_model().objects.create_user('plain-user', password='pw-for-test-only')
        session = self.client.session
        session.set_expiry(3600)
        session.save()

        self.assertTrue(self.client.login(username='plain-user', password='pw-for-test-only'))

        self.assertLess(self.remaining(), 3700)
