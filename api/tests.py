import json
import random
import threading
import unittest
import uuid
from unittest import mock
import logging
import traceback
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlencode

from django.conf import settings
from django.core.cache import cache
from django.contrib.auth import get_user_model
from django.contrib.sessions.backends.db import SessionStore
from django.contrib.sessions.models import Session
from django.db import connection, connections
from django.test import RequestFactory, SimpleTestCase, TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from django.urls import path, reverse
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.test import APIClient
from rest_framework.views import APIView

from api import urls as api_urls
from api import anonymous_case, heir_rules
from api.throttling import CaseWriteThrottle
from api.views import ApiView, SessionView
from calc import schools
from calc.models import Calculation, Person
from mawareeth.middleware import CaseWriteLockMiddleware


SESSION_URL = '/api/v1/session/'
CONTRACT = json.loads((Path(__file__).parent / 'contracts' / 'interview.json').read_text(encoding='utf-8'))


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

    def patch(self, body, client=None, raw=None):
        client = client or self.client
        if raw is not None:
            return client.generic(
                'PATCH', CASE_URL, raw, content_type='application/json', secure=True,
                headers=self.csrf(client))
        return client.patch(CASE_URL, body, format='json', secure=True, headers=self.csrf(client))

    def stored(self):
        return Session.objects.get().get_decoded()[anonymous_case.SESSION_KEY]

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
        self.assertEqual(set(case), {'id', 'started_at', 'madhab', 'deceased', 'heirs', 'heir_options'})
        self.assertIsNone(case['madhab'])
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
        for _ in range(120):
            self.assertEqual(self.post({'replace': True}).status_code, 201)

        response = self.post({'replace': True})

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(self.client.get(CASE_URL, secure=True).status_code, 200)

    def test_spoofed_forwarded_for_does_not_dodge_the_limit(self):
        # Behind Cloudflare the trusted tail is "client, cloudflare"; anything before is spoofable.
        for n in range(120):
            response = self.post({'replace': True}, forwarded=f'spoof-{n}, 203.0.113.9, 172.70.0.1')
            self.assertEqual(response.status_code, 201)

        response = self.post({'replace': True}, forwarded='spoof-new, 203.0.113.9, 172.70.0.1')

        self.assertEqual(response.status_code, 429)

    def test_different_clients_have_separate_limits(self):
        for _ in range(120):
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

    def test_choosing_a_madhab_stores_it_in_the_session_case(self):
        case = self.post().json()['case']

        for madhab in anonymous_case.MADHABS:
            with self.subTest(madhab=madhab):
                response = self.patch({'madhab': madhab})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['case'], {**case, 'madhab': madhab})
                self.assertEqual(self.client.get(CASE_URL, secure=True).json()['case']['madhab'], madhab)
        self.assertEqual(Calculation.objects.count(), 0)
        self.assertEqual(Person.objects.count(), 0)

    def test_invalid_madhab_bodies_are_json_400_and_change_nothing(self):
        self.post()
        self.patch({'madhab': 'hanafi'})
        bodies = [
            {}, {'madhab': 'Hanafi'}, {'madhab': 'zaydi'}, {'madhab': ''}, {'madhab': None},
            {'madhab': 3}, {'madhab': ['hanafi']}, {'madhab': {'a': 'hanafi'}}, ['hanafi'], 'hanafi',
            {'madhab': 'maliki', 'case_id': 5},
        ]
        for body in bodies:
            with self.subTest(body=body):
                response = self.patch(body)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response['Content-Type'], 'application/json')
                self.assertEqual(self.stored()['madhab'], 'hanafi')

    def test_malformed_json_is_a_json_400(self):
        self.post()

        response = self.patch(None, raw='{"madhab": ')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response['Content-Type'], 'application/json')

    def test_choosing_without_a_live_case_is_a_404_and_creates_no_session(self):
        response = self.patch({'madhab': 'hanafi'})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(Session.objects.count(), 0)

    def test_choosing_on_an_expired_case_is_a_404(self):
        self.post()
        Session.objects.update(expire_date=timezone.now() - timedelta(seconds=1))

        self.assertEqual(self.patch({'madhab': 'hanafi'}).status_code, 404)

    def test_choosing_with_a_case_id_but_no_live_case_is_a_404(self):
        response = self.patch({'madhab': 'hanafi', 'case_id': 'a' * 32})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(Session.objects.count(), 0)

    def test_choosing_needs_csrf(self):
        self.post()

        response = self.client.patch(CASE_URL, {'madhab': 'hanafi'}, format='json', secure=True)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertNotIn('madhab', self.stored())

    def test_choosing_shares_the_write_limit(self):
        self.post()
        for _ in range(119):
            self.assertEqual(self.patch({'madhab': 'hanafi'}).status_code, 200)

        response = self.patch({'madhab': 'maliki'})

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(self.stored()['madhab'], 'hanafi')

    def test_choosing_refreshes_the_idle_expiry(self):
        self.post()
        Session.objects.update(expire_date=timezone.now() + timedelta(hours=1))

        self.patch({'madhab': 'jafari'})

        self.assertAlmostEqual(self.remaining(), 24 * 3600, delta=60)

    def test_a_tampered_stored_madhab_reads_as_null(self):
        self.post()
        session = self.client.session
        stored = session[anonymous_case.SESSION_KEY]
        for value in ('shia', 7, ['hanafi'], {'x': 1}):
            with self.subTest(value=value):
                session[anonymous_case.SESSION_KEY] = {**stored, 'madhab': value}
                session.save()
                self.assertIsNone(self.client.get(CASE_URL, secure=True).json()['case']['madhab'])

    def test_start_over_clears_the_madhab(self):
        self.post()
        self.patch({'madhab': 'hanafi'})

        new = self.post({'replace': True}).json()['case']

        self.assertIsNone(new['madhab'])
        self.assertIsNone(self.client.get(CASE_URL, secure=True).json()['case']['madhab'])

    def test_a_stale_tab_gets_409_with_the_live_case_and_changes_nothing(self):
        old = self.post().json()['case']
        live = self.post({'replace': True}).json()['case']
        self.patch({'madhab': 'maliki'})

        response = self.patch({'madhab': 'jafari', 'case_id': old['id']})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['case'], {**live, 'madhab': 'maliki'})
        self.assertEqual(self.stored()['madhab'], 'maliki')

    def test_the_matching_case_id_is_accepted(self):
        case = self.post().json()['case']

        response = self.patch({'madhab': 'shafii', 'case_id': case['id']})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['case']['madhab'], 'shafii')

    def test_logged_in_choice_keeps_the_login_session_expiry(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(get_user_model().objects.create_user('case-user'))
        self.post(client=client)
        before = Session.objects.get().expire_date

        response = self.patch({'madhab': 'hanbali'}, client=client)

        self.assertEqual(response.status_code, 200)
        self.assertAlmostEqual((Session.objects.get().expire_date - before).total_seconds(), 0, delta=5)
        self.assertGreater(self.remaining(), 10 * 24 * 3600)

    def test_login_keeps_the_madhab(self):
        get_user_model().objects.create_user('login-user', password='pw-for-test-only')
        self.post()
        self.patch({'madhab': 'jafari'})

        self.assertTrue(self.client.login(username='login-user', password='pw-for-test-only'))

        self.assertEqual(self.client.get(CASE_URL, secure=True).json()['case']['madhab'], 'jafari')

    def test_probe_csrf_cookie_is_named_csrftoken_and_readable_by_script(self):
        cookie = self.client.get(SESSION_URL, secure=True).cookies[settings.CSRF_COOKIE_NAME]

        self.assertEqual(settings.CSRF_COOKIE_NAME, 'csrftoken')
        self.assertFalse(cookie['httponly'])

    def test_rejected_posts_do_not_use_up_the_quota(self):
        for _ in range(121):
            response = self.client.post(CASE_URL, {}, format='json', secure=True)
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response['Content-Type'], 'application/json')

        self.assertEqual(self.post().status_code, 201)

    def test_ipv6_clients_share_a_limit_per_64(self):
        for n in range(120):
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


DECEASED_URL = '/api/v1/case/deceased/'
HEIRS_URL = '/api/v1/case/heirs/'


class InterviewBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=True)

    def csrf(self, client):
        token = client.get(SESSION_URL, secure=True).cookies[settings.CSRF_COOKIE_NAME].value
        return {'X-CSRFToken': token, 'Referer': 'https://testserver/app/en/interview/'}

    def send(self, method, url, body, client=None):
        client = client or self.client
        if method == 'delete':
            # DELETE carries the case id in the query string; a body may be dropped on the way.
            query = urlencode({k: v for k, v in body.items() if v is not None}) if isinstance(body, dict) else ''
            return client.delete(
                f'{url}?{query}' if query else url, secure=True, headers=self.csrf(client))
        return getattr(client, method)(url, body, format='json', secure=True, headers=self.csrf(client))

    def start(self, client=None):
        client = client or self.client
        return self.send('post', CASE_URL, {}, client).json()['case']

    def deceased(self, case, gender='male', estate=None, **extra):
        body = {'case_id': case['id'], 'gender': gender, **extra}
        if estate is not None:
            body['estate'] = estate
        return self.send('put', DECEASED_URL, body)

    def heir(self, case, relationship='son', **extra):
        return self.send('post', HEIRS_URL, {'case_id': case['id'], 'relationship': relationship, **extra})

    def ready(self):
        case = self.start()
        self.assertEqual(self.deceased(case).status_code, 200)
        return case

    def stored(self):
        return Session.objects.get().get_decoded()[anonymous_case.SESSION_KEY]

    def live(self):
        return self.client.get(CASE_URL, secure=True).json()['case']

    def plant(self, **changes):
        """Change the stored case directly, as an older session or a tampered one would be."""
        row = Session.objects.get(session_key=self.client.cookies[settings.SESSION_COOKIE_NAME].value)
        data = row.get_decoded()
        data[anonymous_case.SESSION_KEY].update(changes)
        row.session_data = SessionStore().encode(data)
        row.save()

    def remaining(self):
        return (Session.objects.get().expire_date - timezone.now()).total_seconds()



class InterviewAnswerTests(InterviewBase):
    # Deceased

    def test_a_new_case_has_no_answers(self):
        case = self.start()

        self.assertIsNone(case['deceased'])
        self.assertEqual(case['heirs'], [])

    def test_save_deceased_with_and_without_an_estate(self):
        case = self.start()

        response = self.deceased(case, 'female', '1250000.50')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['case']['deceased'], {'gender': 'female', 'estate': '1250000.50'})
        again = self.deceased(case, 'male')
        self.assertEqual(again.json()['case']['deceased'], {'gender': 'male', 'estate': None})
        self.assertEqual(self.live()['deceased'], {'gender': 'male', 'estate': None})
        self.assertEqual(Calculation.objects.count(), 0)
        self.assertEqual(Person.objects.count(), 0)

    def test_estate_accepts_eastern_arabic_digits_and_stores_ascii(self):
        case = self.start()

        response = self.deceased(case, 'male', '١٢٣٤٫٥')

        self.assertEqual(response.json()['case']['deceased']['estate'], '1234.5')

    def test_estate_limits(self):
        case = self.start()
        for estate in ('1', '0.01', '999999999999999', '999999999999999.99', '  12  '):
            with self.subTest(estate=estate):
                self.assertEqual(self.deceased(case, estate=estate).status_code, 200)
        self.assertEqual(self.send('put', DECEASED_URL, {'case_id': case['id'], 'gender': 'male', 'estate': ''}).status_code, 200)
        self.assertIsNone(self.live()['deceased']['estate'])
        self.deceased(case, 'female', '5')
        bad = {
            '0': 'not_positive', '0.00': 'not_positive', '-5': 'invalid', '1.234': 'decimals',
            '1000000000000000': 'too_large', 'abc': 'invalid', '1e5': 'invalid', '1,000': 'invalid',
            '.5': 'invalid', '5.': 'invalid',
        }
        for estate, code in bad.items():
            with self.subTest(estate=estate):
                response = self.deceased(case, 'male', estate)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response['Content-Type'], 'application/json')
                self.assertEqual(response.json()['errors'], {'estate': code})
        for estate in (5, 1.5, True, ['5'], {'a': 1}):
            with self.subTest(estate=estate):
                response = self.send('put', DECEASED_URL, {'case_id': case['id'], 'gender': 'male', 'estate': estate})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()['errors'], {'estate': 'invalid'})
        self.assertEqual(self.live()['deceased'], {'gender': 'female', 'estate': '5'})

    def test_bad_deceased_gender_is_a_field_error_and_stores_nothing(self):
        case = self.start()
        for body, code in (
            ({}, 'required'), ({'gender': ''}, 'required'), ({'gender': 'other'}, 'invalid'),
            ({'gender': 'Male'}, 'invalid'), ({'gender': 1}, 'invalid'), ({'gender': ['male']}, 'invalid'),
        ):
            with self.subTest(body=body):
                response = self.send('put', DECEASED_URL, {'case_id': case['id'], **body})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()['errors'], {'gender': code})
        self.assertIsNone(self.live()['deceased'])

    def test_every_field_error_is_reported_together(self):
        case = self.start()

        response = self.send('put', DECEASED_URL, {'case_id': case['id'], 'estate': '0'})

        self.assertEqual(response.json()['errors'], {'gender': 'required', 'estate': 'not_positive'})

    def test_saving_the_deceased_keeps_the_heirs(self):
        case = self.ready()
        self.heir(case)

        response = self.deceased(case, 'female')

        self.assertEqual(len(response.json()['case']['heirs']), 1)

    # Heirs

    def test_add_heir_derives_the_gender_and_keeps_order(self):
        case = self.ready()

        first = self.heir(case, 'daughter', name='  Amal  ')
        second = self.heir(case, 'father')

        self.assertEqual(first.status_code, 201)
        heirs = second.json()['case']['heirs']
        self.assertEqual([h['relationship'] for h in heirs], ['daughter', 'father'])
        self.assertEqual([h['gender'] for h in heirs], ['female', 'male'])
        self.assertEqual([h['name'] for h in heirs], ['Amal', None])
        self.assertEqual(len({h['id'] for h in heirs}), 2)
        self.assertEqual(set(heirs[0]), {'id', 'relationship', 'gender', 'name'})
        self.assertEqual(self.live()['heirs'], heirs)

    def test_every_relationship_is_accepted_with_the_gender_in_the_contract(self):
        self.assertEqual(len(CONTRACT['relationships']), 22)
        for expected in CONTRACT['relationships']:
            with self.subTest(relationship=expected['id']):
                # One case each: a family holds only relatives it can have together.
                self.client = APIClient(enforce_csrf_checks=True)
                case = self.start()
                self.assertEqual(self.deceased(case, 'female' if expected['id'] == 'husband' else 'male').status_code, 200)
                response = self.heir(case, expected['id'])
                self.assertEqual(response.status_code, 201)
                heir = response.json()['case']['heirs'][0]
                self.assertEqual((heir['relationship'], heir['gender']), (expected['id'], expected['gender']))

    def test_the_relationships_match_the_shared_contract(self):
        self.assertEqual(
            anonymous_case.RELATIONSHIPS,
            {item['id']: item['gender'] for item in CONTRACT['relationships']})
        self.assertEqual(list(anonymous_case.RELATIONSHIPS), [item['id'] for item in CONTRACT['relationships']])

    def test_every_error_code_the_server_emits_is_in_the_shared_contract(self):
        case = self.ready()
        self.heir(case)
        bodies = [
            (DECEASED_URL, 'put', {}), (DECEASED_URL, 'put', {'gender': 'x', 'estate': 5}),
            *[(DECEASED_URL, 'put', {'gender': 'male', 'estate': e})
              for e in ('0', '1.234', 'x', '1' + '0' * 15, '1,234')],
            (HEIRS_URL, 'post', {}), (HEIRS_URL, 'post', {'relationship': 'x', 'name': 5}),
            (HEIRS_URL, 'post', {'relationship': 'son', 'name': 'x' * 101}),
        ]
        seen = {}
        for url, method, body in bodies:
            response = self.send(method, url, {'case_id': case['id'], **body})
            self.assertEqual(response.status_code, 400)
            for field, code in response.json()['errors'].items():
                seen.setdefault(field, set()).add(code)
        for _ in range(anonymous_case.MAX_HEIRS):
            self.heir(case)
        for field, code in self.heir(case).json()['errors'].items():
            seen.setdefault(field, set()).add(code)
        fresh = self.start()
        for field, code in self.heir(fresh).json()['errors'].items():
            seen.setdefault(field, set()).add(code)
        for field, codes in seen.items():
            self.assertLessEqual(codes, set(CONTRACT['errorCodes'][field]), field)
        self.assertGreaterEqual({'gender', 'estate', 'relationship', 'name', 'heirs', 'case'}, set(seen))

    def test_a_client_supplied_gender_or_id_is_ignored(self):
        case = self.ready()

        response = self.heir(case, 'son', gender='female', id='mine')

        heir = response.json()['case']['heirs'][0]
        self.assertEqual(heir['gender'], 'male')
        self.assertNotEqual(heir['id'], 'mine')

    def test_heir_before_deceased_is_refused(self):
        case = self.start()

        response = self.heir(case)

        self.assertEqual(response.status_code, 400)
        self.assertIn('case', response.json()['errors'])
        self.assertEqual(self.live()['heirs'], [])

    def test_bad_heir_fields_are_field_errors_and_store_nothing(self):
        case = self.ready()
        bodies = [
            ({}, {'relationship': 'required'}),
            ({'relationship': 'cousin'}, {'relationship': 'invalid'}),
            ({'relationship': 'Son'}, {'relationship': 'invalid'}),
            ({'relationship': 5}, {'relationship': 'invalid'}),
            ({'relationship': 'son', 'name': 5}, {'name': 'invalid'}),
            ({'relationship': 'son', 'name': ['a']}, {'name': 'invalid'}),
            ({'relationship': 'son', 'name': 'x' * 101}, {'name': 'too_long'}),
            ({'relationship': 'son', 'name': 'bad\x00name'}, {'name': 'invalid'}),
            ({'relationship': 'son', 'name': 'bad\nname'}, {'name': 'invalid'}),
            ({'relationship': 'son', 'name': 'bad name'}, {'name': 'invalid'}),
            ({'name': 'x' * 101}, {'relationship': 'required', 'name': 'too_long'}),
        ]
        for body, errors in bodies:
            with self.subTest(body=body):
                response = self.send('post', HEIRS_URL, {'case_id': case['id'], **body})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response['Content-Type'], 'application/json')
                self.assertEqual(response.json()['errors'], errors)
        self.assertEqual(self.live()['heirs'], [])

    def test_name_limits(self):
        case = self.ready()

        for name in ('x' * 100, '  ', '', None, 'محمد'):
            with self.subTest(name=name):
                self.assertEqual(self.heir(case, name=name).status_code, 201)
        names = [h['name'] for h in self.live()['heirs']]
        self.assertEqual(names, ['x' * 100, None, None, None, 'محمد'])

    def test_the_51st_heir_is_refused(self):
        case = self.ready()
        for _ in range(anonymous_case.MAX_HEIRS):
            self.assertEqual(self.heir(case).status_code, 201)

        response = self.heir(case)

        self.assertEqual(response.status_code, 400)
        self.assertIn('heirs', response.json()['errors'])
        self.assertEqual(len(self.live()['heirs']), 50)

    def test_edit_heir_keeps_id_and_place_and_derives_gender_again(self):
        case = self.ready()
        self.heir(case, 'son', name='A')
        heirs = self.heir(case, 'father').json()['case']['heirs']

        response = self.send(
            'put', f'{HEIRS_URL}{heirs[0]["id"]}/', {'case_id': case['id'], 'relationship': 'daughter'})

        self.assertEqual(response.status_code, 200)
        edited = response.json()['case']['heirs']
        self.assertEqual(
            edited[0], {'id': heirs[0]['id'], 'relationship': 'daughter', 'gender': 'female', 'name': None})
        self.assertEqual(edited[1], heirs[1])

    def test_bad_edit_stores_nothing(self):
        case = self.ready()
        heirs = self.heir(case, 'son', name='A').json()['case']['heirs']

        response = self.send(
            'put', f'{HEIRS_URL}{heirs[0]["id"]}/', {'case_id': case['id'], 'relationship': 'nope'})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.live()['heirs'], heirs)

    def test_remove_heir(self):
        case = self.ready()
        self.heir(case, 'son')
        heirs = self.heir(case, 'father').json()['case']['heirs']

        response = self.send('delete', f'{HEIRS_URL}{heirs[0]["id"]}/', {'case_id': case['id']})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['case']['heirs'], [heirs[1]])
        self.assertEqual(self.live()['heirs'], [heirs[1]])

    def test_unknown_heir_is_a_404_with_the_live_case(self):
        case = self.ready()
        self.heir(case)
        live = self.live()

        for method, body in (
            ('put', {'case_id': case['id'], 'relationship': 'son'}),
            ('delete', {'case_id': case['id']}),
        ):
            with self.subTest(method=method):
                response = self.send(method, f'{HEIRS_URL}missing/', body)
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response['Content-Type'], 'application/json')
                self.assertEqual(response.json()['case'], live)

    # Case checks shared by every new write

    def writes(self, case):
        heir = 'x' * 32
        return [
            ('put', DECEASED_URL, {'case_id': case['id'], 'gender': 'male'}),
            ('post', HEIRS_URL, {'case_id': case['id'], 'relationship': 'son'}),
            ('put', f'{HEIRS_URL}{heir}/', {'case_id': case['id'], 'relationship': 'son'}),
            ('delete', f'{HEIRS_URL}{heir}/', {'case_id': case['id']}),
        ]

    def test_no_live_case_is_a_404_with_null_case_and_no_session(self):
        for method, url, body in self.writes({'id': 'a' * 32}):
            with self.subTest(method=method, url=url):
                response = self.send(method, url, body)
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response['Content-Type'], 'application/json')
                self.assertIsNone(response.json()['case'])
                self.assertEqual(Session.objects.count(), 0)

    def test_an_expired_case_is_a_404(self):
        case = self.ready()
        Session.objects.update(expire_date=timezone.now() - timedelta(seconds=1))

        for method, url, body in self.writes(case):
            with self.subTest(method=method, url=url):
                response = self.send(method, url, body)
                self.assertEqual(response.status_code, 404)
                self.assertIsNone(response.json()['case'])

    def test_a_stale_tab_gets_409_with_the_live_case_and_changes_nothing(self):
        old = self.start()
        live = self.send('post', CASE_URL, {'replace': True}).json()['case']
        self.deceased(live, 'female')
        expected = self.live()

        for method, url, body in self.writes(old):
            with self.subTest(method=method, url=url):
                response = self.send(method, url, body)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json()['case'], expected)
        self.assertEqual(self.live(), expected)

    def test_missing_or_bad_case_id_and_non_object_bodies_are_400(self):
        case = self.ready()
        for method, url, body in self.writes(case):
            for bad in ({}, {'relationship': 'son', 'gender': 'male'}, {'case_id': 5}, {'case_id': ''},
                        {'case_id': None}, [1, 2], 'text'):
                if method == 'delete' and bad == {'case_id': 5}:
                    continue  # a query string has no numbers, only text
                with self.subTest(method=method, url=url, body=bad):
                    response = self.send(method, url, bad)
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(self.live()['heirs'], [])

    def test_missing_csrf_is_a_json_403_and_stores_nothing(self):
        case = self.ready()
        before = self.live()
        for method, url, body in self.writes(case):
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, body, format='json', secure=True)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(self.live(), before)

    def test_writes_refresh_the_idle_expiry(self):
        case = self.start()
        Session.objects.update(expire_date=timezone.now() + timedelta(hours=1))
        self.deceased(case)
        self.assertAlmostEqual(self.remaining(), 24 * 3600, delta=60)

        Session.objects.update(expire_date=timezone.now() + timedelta(hours=1))
        heirs = self.heir(case).json()['case']['heirs']
        self.assertAlmostEqual(self.remaining(), 24 * 3600, delta=60)

        Session.objects.update(expire_date=timezone.now() + timedelta(hours=1))
        self.send('put', f'{HEIRS_URL}{heirs[0]["id"]}/', {'case_id': case['id'], 'relationship': 'father'})
        self.assertAlmostEqual(self.remaining(), 24 * 3600, delta=60)

        Session.objects.update(expire_date=timezone.now() + timedelta(hours=1))
        self.send('delete', f'{HEIRS_URL}{heirs[0]["id"]}/', {'case_id': case['id']})
        self.assertAlmostEqual(self.remaining(), 24 * 3600, delta=60)

    def test_a_logged_in_write_keeps_the_login_expiry(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(get_user_model().objects.create_user('case-user'))
        case = self.start(client)
        before = Session.objects.get().expire_date

        response = self.send('put', DECEASED_URL, {'case_id': case['id'], 'gender': 'male'}, client)
        added = self.send('post', HEIRS_URL, {'case_id': case['id'], 'relationship': 'son'}, client)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(added.status_code, 201)
        self.assertAlmostEqual((Session.objects.get().expire_date - before).total_seconds(), 0, delta=5)
        self.assertGreater(self.remaining(), 10 * 24 * 3600)

    # Interactions with the rest of the case

    def test_changing_the_madhab_keeps_the_answers(self):
        case = self.ready()
        self.heir(case, 'son', name='A')
        before = self.live()

        response = self.send('patch', CASE_URL, {'madhab': 'jafari', 'case_id': case['id']})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['case'], {**before, 'madhab': 'jafari'})

    def test_start_over_clears_the_answers(self):
        case = self.ready()
        self.heir(case)

        new = self.send('post', CASE_URL, {'replace': True}).json()['case']

        self.assertNotEqual(new['id'], case['id'])
        self.assertIsNone(new['deceased'])
        self.assertEqual(new['heirs'], [])
        self.assertNotIn('heirs', self.stored())

    def test_login_keeps_the_answers(self):
        get_user_model().objects.create_user('login-user', password='pw-for-test-only')
        case = self.ready()
        self.heir(case, 'son', name='A')
        before = self.live()

        self.assertTrue(self.client.login(username='login-user', password='pw-for-test-only'))

        self.assertEqual(self.live(), before)

    def test_tampered_stored_answers_are_dropped_on_read(self):
        case = self.ready()
        good = self.heir(case, 'son', name='A').json()['case']['heirs'][0]
        session = self.client.session
        stored = session[anonymous_case.SESSION_KEY]
        session[anonymous_case.SESSION_KEY] = {
            **stored,
            'heirs': [
                good, good,
                {'id': 'a', 'relationship': 'cousin', 'name': None},
                {'id': 'b', 'relationship': 'son', 'name': 5},
                {'id': 'c', 'relationship': 'son', 'name': 'x' * 101},
                {'id': 5, 'relationship': 'son', 'name': None},
                'text', None,
                {'id': 'd', 'relationship': 'wife', 'gender': 'male', 'name': None},
            ],
        }
        session.save()

        heirs = self.live()['heirs']

        self.assertEqual([h['id'] for h in heirs], [good['id'], 'd'])
        self.assertEqual(heirs[1]['gender'], 'female')
        for value in ('text', 5, [], {'gender': 'x', 'estate': None}, {'gender': 'male', 'estate': '-1'},
                      {'gender': 'male', 'estate': 5}):
            with self.subTest(deceased=value):
                session[anonymous_case.SESSION_KEY] = {**stored, 'deceased': value, 'heirs': 'nope'}
                session.save()
                case_now = self.live()
                self.assertIsNone(case_now['deceased'])
                self.assertEqual(case_now['heirs'], [])

    # Throttling

    def test_the_write_limit_is_120_an_hour_across_all_writes(self):
        case = self.ready()
        for _ in range(118):
            self.deceased(case)

        response = self.deceased(case)

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(self.client.get(CASE_URL, secure=True).status_code, 200)

    def test_the_configured_rate_is_120_an_hour(self):
        self.assertEqual(api_settings.DEFAULT_THROTTLE_RATES['case_write'], '120/hour')

    def test_routes(self):
        self.assertEqual(reverse('api:case-deceased'), DECEASED_URL)
        self.assertEqual(reverse('api:case-heirs'), HEIRS_URL)
        self.assertEqual(reverse('api:case-heir', args=['abc']), f'{HEIRS_URL}abc/')


BACKSLASH = chr(92)


class RecordingHandler(logging.Handler):
    def __init__(self):
        super().__init__(level=logging.DEBUG)
        self.lines = []

    def emit(self, record):
        text = record.getMessage() + ' ' + repr(record.args)
        if record.exc_info:
            text += ' ' + ''.join(traceback.format_exception(*record.exc_info))
        self.lines.append(text)


class InterviewReviewTests(InterviewBase):
    def raw(self, method, url, body):
        return self.client.generic(
            method.upper(), url, body, content_type='application/json', secure=True,
            headers=self.csrf(self.client))

    # Start over from a stale tab

    def test_a_stale_start_over_does_not_replace_a_newer_case(self):
        old = self.start()
        live = self.send('post', CASE_URL, {'replace': True}).json()['case']
        self.deceased(live, 'female', '50')
        expected = self.live()

        response = self.send('post', CASE_URL, {'replace': True, 'case_id': old['id']})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['case'], expected)
        self.assertEqual(self.live(), expected)

    def test_start_over_with_the_live_case_id_replaces_it(self):
        case = self.ready()

        response = self.send('post', CASE_URL, {'replace': True, 'case_id': case['id']})

        self.assertEqual(response.status_code, 201)
        self.assertNotEqual(response.json()['case']['id'], case['id'])
        self.assertIsNone(response.json()['case']['deceased'])

    def test_start_over_naming_a_case_when_none_is_live_starts_a_new_one(self):
        response = self.send('post', CASE_URL, {'replace': True, 'case_id': 'a' * 32})

        self.assertEqual(response.status_code, 201)

    # Names

    def test_a_lone_surrogate_in_a_name_is_a_json_400(self):
        case = self.ready()
        heirs = self.heir(case).json()['case']['heirs']
        body = '{"case_id": "%s", "relationship": "son", "name": "a%sud800"}' % (case['id'], BACKSLASH)

        for method, url in (('post', HEIRS_URL), ('put', f'{HEIRS_URL}{heirs[0]["id"]}/')):
            with self.subTest(method=method):
                response = self.raw(method, url, body)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response['Content-Type'], 'application/json')
                self.assertEqual(response.json()['errors'], {'name': 'invalid'})
        self.assertEqual(self.live()['heirs'], heirs)

    def test_bidi_controls_are_refused_in_names(self):
        case = self.ready()
        for code in (*range(0x202A, 0x202F), *range(0x2066, 0x206A)):
            with self.subTest(code=hex(code)):
                response = self.heir(case, name='ab' + chr(code) + 'cd')
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()['errors'], {'name': 'invalid'})
        self.assertEqual(self.live()['heirs'], [])

    def test_a_name_that_shows_nothing_is_left_out_but_joiners_stay_legal_inside_one(self):
        case = self.ready()
        zwnj, zwj, nbsp, zwsp = chr(0x200C), chr(0x200D), chr(0xA0), chr(0x200B)

        for name in (zwnj, zwj + zwj, nbsp, zwsp + ' ' + zwnj):
            with self.subTest(name=repr(name)):
                self.assertEqual(self.heir(case, name=name).status_code, 201)
        self.assertEqual([h['name'] for h in self.live()['heirs']], [None] * 4)
        persian = 'می' + zwnj + 'خواهم'
        heirs = self.heir(case, name=persian).json()['case']['heirs']
        self.assertEqual(heirs[-1]['name'], persian)

    # Estate

    def test_leading_zeros_are_stripped_before_the_length_check_and_storing(self):
        case = self.start()
        table = {
            '007': '7', '00.50': '0.50', '0.50': '0.50', '0000000000000007': '7',
            '000000000000000000000012.5': '12.5', '10': '10', '0100': '100',
        }
        for estate, stored in table.items():
            with self.subTest(estate=estate):
                response = self.deceased(case, 'male', estate)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['case']['deceased']['estate'], stored)
        for estate, code in {'0000': 'not_positive', '00000000000000000.00': 'not_positive',
                             '0' + '1' + '0' * 15: 'too_large'}.items():
            with self.subTest(estate=estate):
                self.assertEqual(self.deceased(case, 'male', estate).json()['errors'], {'estate': code})

    def test_a_comma_is_a_decimal_separator_only_with_one_or_two_digits_after_it(self):
        case = self.start()
        for estate, stored in {'1250,50': '1250.50', '1,5': '1.5', '0,05': '0.05', '١٢٥٠٫٥': '1250.5'}.items():
            with self.subTest(estate=estate):
                response = self.deceased(case, 'male', estate)
                self.assertEqual(response.json()['case']['deceased']['estate'], stored)
        for estate, code in {'1,250': 'invalid', '1,2345': 'invalid', '1.250': 'decimals', '1,25,0': 'invalid',
                             '1,234.5': 'invalid', ',5': 'invalid', '5,': 'invalid', '0,00': 'not_positive'}.items():
            with self.subTest(estate=estate):
                self.assertEqual(self.deceased(case, 'male', estate).json()['errors'], {'estate': code})

    # Heirs, deletes and limits

    def test_delete_needs_the_case_id_in_the_query_string(self):
        case = self.ready()
        heirs = self.heir(case).json()['case']['heirs']
        url = f'{HEIRS_URL}{heirs[0]["id"]}/'
        headers = self.csrf(self.client)

        for query in ('', '?case_id=', '?other=1'):
            with self.subTest(query=query):
                response = self.client.delete(url + query, secure=True, headers=headers)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response['Content-Type'], 'application/json')
        body_only = self.client.delete(url, {'case_id': case['id']}, format='json', secure=True, headers=headers)
        self.assertEqual(body_only.status_code, 400, 'a body is not read')
        stale = self.client.delete(f'{url}?case_id={"b" * 32}', secure=True, headers=headers)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.live()['heirs'], heirs)
        gone = self.client.delete(f'{url}?case_id={case["id"]}', secure=True, headers=headers)
        self.assertEqual(gone.status_code, 200)

    def test_editing_an_heir_with_50_stored_succeeds(self):
        case = self.ready()
        for _ in range(anonymous_case.MAX_HEIRS):
            self.heir(case)
        heirs = self.live()['heirs']
        self.assertEqual(len(heirs), 50)

        response = self.send(
            'put', f'{HEIRS_URL}{heirs[0]["id"]}/', {'case_id': case['id'], 'relationship': 'wife', 'name': 'Huda'})

        self.assertEqual(response.status_code, 200)
        edited = response.json()['case']['heirs']
        self.assertEqual(len(edited), 50)
        self.assertEqual(edited[0]['relationship'], 'wife')

    def test_malformed_json_is_a_json_400_on_the_new_routes(self):
        case = self.ready()
        heirs = self.heir(case).json()['case']['heirs']
        for method, url in (
            ('put', DECEASED_URL), ('post', HEIRS_URL), ('put', f'{HEIRS_URL}{heirs[0]["id"]}/'),
        ):
            with self.subTest(method=method, url=url):
                response = self.raw(method, url, '{"gender": ')
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(self.live()['heirs'], heirs)

    def test_once_the_budget_is_spent_every_new_write_is_a_json_429_and_stores_nothing(self):
        case = self.ready()
        heirs = self.heir(case).json()['case']['heirs']
        for _ in range(117):
            self.assertEqual(self.deceased(case).status_code, 200)
        before = self.live()
        url = f'{HEIRS_URL}{heirs[0]["id"]}/'

        responses = {
            'post heir': self.heir(case, 'father', name='New'),
            'put heir': self.send('put', url, {'case_id': case['id'], 'relationship': 'wife'}),
            'delete heir': self.send('delete', url, {'case_id': case['id']}),
            'put deceased': self.deceased(case, 'female', '5'),
        }

        for name, response in responses.items():
            with self.subTest(name=name):
                self.assertEqual(response.status_code, 429)
                self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(self.live(), before)

    # Logs

    def test_answers_never_reach_the_logs_even_when_a_write_is_refused(self):
        secrets = ['Secret Name', '987654.32', 'Rejected Person', 'Edited Person', '13579.24']
        handler = RecordingHandler()
        names = ('', 'django.request', 'django.security')
        loggers = [logging.getLogger(name) for name in names]
        levels = [logger.level for logger in loggers]
        for logger in loggers:
            logger.addHandler(handler)
            logger.setLevel(logging.DEBUG)
        try:
            case = self.start()
            self.deceased(case, 'male', secrets[1])
            heirs = self.heir(case, 'son', name=secrets[0]).json()['case']['heirs']
            url = f'{HEIRS_URL}{heirs[0]["id"]}/'
            self.heir(case, 'cousin', name=secrets[2])
            self.send('put', DECEASED_URL, {'case_id': case['id'], 'gender': 'x', 'estate': secrets[4] + 'x'})
            self.send('put', url, {'case_id': case['id'], 'relationship': 'wife', 'name': secrets[3]})
            self.send('put', f'{HEIRS_URL}missing/', {'case_id': case['id'], 'relationship': 'son', 'name': secrets[2]})
            self.send('post', HEIRS_URL, {'case_id': 'z' * 32, 'relationship': 'son', 'name': secrets[2]})
            self.client.post(
                HEIRS_URL, {'case_id': case['id'], 'relationship': 'son', 'name': secrets[2]},
                format='json', secure=True)
            self.send('delete', url, {'case_id': case['id']})
        finally:
            for logger, level in zip(loggers, levels):
                logger.removeHandler(handler)
                logger.setLevel(level)

        logged = '\n'.join(handler.lines)
        self.assertTrue(handler.lines, 'refused writes are logged by django.request, so the capture works')
        for secret in secrets:
            self.assertNotIn(secret, logged)


PREVIEW_URL = '/api/v1/case/preview/'
PREVIEW_FIXTURES = json.loads(
    (Path(__file__).parent / 'contracts' / 'preview-fixtures.json').read_text(encoding='utf-8'))['fixtures']


class PreviewTests(InterviewBase):
    def preview(self, case_id, client=None, **extra):
        client = client or self.client
        url = f'{PREVIEW_URL}?{urlencode({"case_id": case_id})}' if case_id is not None else PREVIEW_URL
        return client.get(url, secure=True, **extra)

    def build(self, madhab, gender, estate, relationships, names=None):
        """A live case like the fixture's, through the API. Returns it with the heirs' real ids."""
        case = self.start()
        if madhab:
            self.assertEqual(self.send('patch', CASE_URL, {'case_id': case['id'], 'madhab': madhab}).status_code, 200)
        body = {'case_id': case['id'], 'gender': gender}
        if estate is not None:
            body['estate'] = estate
        self.assertEqual(self.send('put', DECEASED_URL, body).status_code, 200)
        self.put_heirs(relationships, names)
        return self.live()

    def put_heirs(self, relationships, names=None):
        """Set the heirs in the session directly: the writes refuse a family that cannot exist,
        and a preview still has to answer for one saved before they did."""
        self.plant(heirs=[
            {'id': uuid.uuid4().hex, 'relationship': relationship,
             'gender': anonymous_case.RELATIONSHIPS[relationship], 'name': names[index] if names else None}
            for index, relationship in enumerate(relationships)
        ])

    def rows(self):
        from calc.models import Calculation, Marriage, Person
        return (Calculation.objects.count(), Person.objects.count(), Marriage.objects.count())

    def test_route_is_versioned(self):
        self.assertEqual(reverse('api:case-preview'), PREVIEW_URL)

    def test_every_fixture_is_served_as_the_engine_computes_it(self):
        from decimal import Decimal
        from fractions import Fraction
        from calc.models import money
        from calc.tests import build_case
        from api.preview import HEIR_CLASSES
        for fixture in PREVIEW_FIXTURES:
            with self.subTest(fixture['title']):
                self.client = APIClient(enforce_csrf_checks=True)
                case = fixture['case']
                live = self.build(
                    case['madhab'], case['deceased']['gender'], case['deceased']['estate'],
                    [heir['relationship'] for heir in case['heirs']])
                response = self.preview(live['id'])
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response['Content-Type'], 'application/json')
                self.assertIn('no-store', response['Cache-Control'])
                real_ids = {item['id']: heir['id'] for item, heir in zip(case['heirs'], live['heirs'])}
                expected = json.loads(json.dumps(fixture['response']))
                for share in expected.get('shares', []):
                    share['heir_id'] = real_ids[share['heir_id']]
                for item in expected.get('basis', {}).get('heirs', []):
                    item['id'] = real_ids[item['id']]
                self.assertEqual(response.json(), expected)
                # And the numbers are the engine's own, run directly on a persisted case.
                if expected['status'] == 'available':
                    types = [HEIR_CLASSES[heir['relationship']] for heir in case['heirs']]
                    sex = 'M' if case['deceased']['gender'] == 'male' else 'F'
                    calc, heirs = build_case(sex, types, estate=1)
                    final = calc.compute(madhab=case['madhab'])
                    amount = case['deceased']['estate']
                    for share, heir in zip(expected['shares'], heirs):
                        fraction = final[heir.pk]
                        self.assertEqual((share['numerator'], share['denominator']),
                                         (fraction.numerator, fraction.denominator))
                        self.assertEqual(
                            share['amount'],
                            None if amount is None else f'{money(Fraction(Decimal(amount)) * fraction):.2f}')
                    calc.delete()

    def test_the_bridge_reproduces_each_fixture_directly(self):
        from api import preview
        for fixture in PREVIEW_FIXTURES:
            with self.subTest(fixture['title']):
                self.assertEqual(preview.preview(fixture['case']), fixture['response'])

    def test_the_matrix_answers(self):
        by_title = {fixture['title']: fixture['response'] for fixture in PREVIEW_FIXTURES}
        self.assertEqual(by_title['Hanbali wife and son with an estate']['shares'][0]['amount'], '1000.00')
        self.assertEqual(by_title['Hanbali wife and son without an estate']['shares'][1]['amount'], None)
        self.assertEqual(by_title['Wife alone leaves an unallocated remainder']['unallocated'],
                         {'numerator': 3, 'denominator': 4})
        self.assertEqual(by_title['Two wives and a son, rounded half up']['shares'][0]['amount'], '0.63')
        self.assertEqual(by_title['Impossible family']['reason'], 'invalid_family')
        reasons = {response.get('reason') for response in by_title.values()} - {None}
        self.assertEqual(reasons, set(CONTRACT['previewReasons']))

    def test_the_contract_lists_every_reason_the_engine_can_give(self):
        from calc import schools
        self.assertEqual(set(CONTRACT['previewReasons']), {*schools.REASONS, 'invalid_family'})

    def test_a_response_says_what_family_it_is_for_without_names(self):
        live = self.build('hanbali', 'male', '8000', ['wife', 'son'], names=['Secret Wife', 'Secret Son'])
        body = self.preview(live['id']).json()
        self.assertEqual(body['basis'], {
            'madhab': 'hanbali', 'gender': 'male', 'estate': '8000',
            'heirs': [{'id': heir['id'], 'relationship': heir['relationship']} for heir in live['heirs']],
        })
        self.assertNotIn('Secret', json.dumps(body))
        self.send('patch', CASE_URL, {'case_id': live['id'], 'madhab': 'jafari'})
        body = self.preview(live['id']).json()
        self.assertNotIn('Secret', json.dumps(body))
        self.assertEqual(body['status'], 'unavailable')
        self.assertEqual(body['basis']['madhab'], 'jafari')

    def test_a_changed_family_gives_a_different_basis(self):
        live = self.build('hanbali', 'male', '8000', ['wife'])
        first = self.preview(live['id']).json()['basis']
        self.heir(live, 'son')
        self.assertNotEqual(self.preview(live['id']).json()['basis'], first)

    def test_not_ready_until_the_case_has_a_school_a_deceased_and_an_heir(self):
        case = self.start()
        self.assertEqual(self.preview(case['id']).json(), {'status': 'not_ready'})
        self.send('patch', CASE_URL, {'case_id': case['id'], 'madhab': 'hanbali'})
        self.assertEqual(self.preview(case['id']).json(), {'status': 'not_ready'})
        self.deceased(case)
        self.assertEqual(self.preview(case['id']).json(), {'status': 'not_ready'})
        self.heir(case, 'son')
        self.assertEqual(self.preview(case['id']).json()['status'], 'available')

    def test_an_impossible_family_is_refused_for_each_rule(self):
        cases = [
            ('male', ['husband']), ('female', ['wife']), ('female', ['husband', 'husband']),
            ('male', ['father', 'father']), ('male', ['mother', 'mother']),
            ('male', ['grandfather', 'grandfather']), ('male', ['wife'] * 5),
        ]
        for gender, relationships in cases:
            with self.subTest(gender=gender, heirs=relationships):
                self.client = APIClient(enforce_csrf_checks=True)
                live = self.build('hanbali', gender, None, relationships)
                body = self.preview(live['id']).json()
                body.pop('basis')
                self.assertEqual(body, {'status': 'unavailable', 'madhab': 'hanbali', 'reason': 'invalid_family'})
        # The edge of each rule still calculates.
        for gender, relationships in [('male', ['wife'] * 4), ('female', ['husband'])]:
            with self.subTest(ok=relationships):
                self.client = APIClient(enforce_csrf_checks=True)
                live = self.build('hanbali', gender, None, relationships)
                self.assertEqual(self.preview(live['id']).json()['status'], 'available')

    def test_every_relationship_maps_to_an_engine_class_of_the_same_sex(self):
        from api.preview import HEIR_CLASSES, SEX
        from calc.tests import HEIR_SEX
        self.assertEqual(set(HEIR_CLASSES), set(anonymous_case.RELATIONSHIPS))
        # A literal table, so a wrong mapping in the code cannot also be wrong here.
        literal = {
            'father': 'Father', 'mother': 'Mother', 'husband': 'Husband', 'wife': 'Wife', 'son': 'Son',
            'daughter': 'Daughter', 'son_of_son': 'SonOfSon', 'daughter_of_son': 'DaughterOfSon',
            'grandfather': 'GrandFather', 'grandmother': 'GrandMother', 'brother': 'Brother',
            'sister': 'Sister', 'paternal_brother': 'PaternalBrother', 'paternal_sister': 'PaternalSister',
            'maternal_brother': 'MaternalBrother', 'maternal_sister': 'MaternalSister',
            'son_of_brother': 'SonOfBrother', 'son_of_paternal_brother': 'SonOfPaternalBrother',
            'uncle': 'Uncle', 'paternal_uncle': 'PaternalUncle', 'son_of_uncle': 'SonOfUncle',
            'son_of_paternal_uncle': 'SonOfPaternalUncle',
        }
        self.assertEqual(len(literal), 22)
        self.assertEqual({key: cls.__name__ for key, cls in HEIR_CLASSES.items()}, literal)
        self.assertEqual(len(set(HEIR_CLASSES.values())), len(HEIR_CLASSES))
        for relationship, cls in HEIR_CLASSES.items():
            self.assertEqual(HEIR_SEX[cls], SEX[anonymous_case.RELATIONSHIPS[relationship]], relationship)

    def test_every_relationship_previews_alone_without_a_server_error(self):
        for relationship in anonymous_case.RELATIONSHIPS:
            with self.subTest(relationship=relationship):
                self.client = APIClient(enforce_csrf_checks=True)
                gender = 'female' if relationship == 'husband' else 'male'
                live = self.build('hanbali', gender, '100', [relationship])
                self.assertEqual(self.preview(live['id']).status_code, 200)

    def test_no_rows_remain_after_any_outcome(self):
        before = self.rows()
        outcomes = [
            ('hanbali', 'male', '8000', ['wife', 'son']),
            ('jafari', 'male', None, ['son']),
            ('maliki', 'female', None, ['mother', 'daughter']),
            ('hanafi', 'male', None, ['father', 'grandmother']),
            ('hanbali', 'male', None, ['husband']),
            ('hanbali', 'male', None, []),
        ]
        seen = set()
        for args in outcomes:
            self.client = APIClient(enforce_csrf_checks=True)
            live = self.build(*args)
            body = self.preview(live['id']).json()
            seen.add(body['status'] + str(body.get('reason')))
            self.assertEqual(self.rows(), before, args)
        self.assertGreaterEqual(len(seen), 5)
        # Even an engine error that escapes leaves nothing behind.
        from calc.models import Calculation
        live = self.build('hanbali', 'male', None, ['son'])
        with mock.patch.object(Calculation, 'compute', side_effect=RuntimeError('boom')):
            self.assertEqual(self.preview(live['id']).status_code, 503)
        self.assertEqual(self.rows(), before)

    def test_the_session_and_its_expiry_are_not_touched(self):
        live = self.build('hanbali', 'male', '8000', ['wife', 'son'])
        before = Session.objects.get()
        stored, expires = before.get_decoded(), before.expire_date
        for case_id in (live['id'], 'other', None):
            self.preview(case_id)
        after = Session.objects.get()
        self.assertEqual(after.get_decoded(), stored)
        self.assertEqual(after.expire_date, expires)
        self.assertEqual(Session.objects.count(), 1)

    def test_a_visitor_without_a_case_gets_a_404_and_no_session(self):
        response = self.preview('abc')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {'detail': 'There is no current case.', 'case': None})
        self.assertEqual(Session.objects.count(), 0)

    def test_another_tabs_case_is_a_409_with_no_numbers(self):
        live = self.build('hanbali', 'male', '8000', ['wife', 'son'])
        response = self.preview('z' * 32)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['case'], live)
        self.assertNotIn('shares', response.json())

    def test_case_id_is_required(self):
        self.start()
        for value in (None, ''):
            response = self.preview(value)
            self.assertEqual(response.status_code, 400)
            self.assertIn('detail', response.json())

    def test_only_get_is_allowed(self):
        case = self.start()
        response = self.client.post(
            PREVIEW_URL, {'case_id': case['id']}, format='json', secure=True, headers=self.csrf(self.client))
        self.assertEqual(response.status_code, 405)

    def test_names_never_reach_the_engine(self):
        from calc.models import Calculation, Person
        seen = []
        real = Calculation.compute

        def spy(calc, madhab='hanbali'):
            seen.append((madhab, [(p.first_name, p.last_name, p.sex) for p in Person.objects.all()], calc.name))
            return real(calc, madhab=madhab)

        live = self.build('hanafi', 'male', '12345.67', ['wife', 'son'], names=['Secret Wife', 'Secret Son'])
        with mock.patch.object(Calculation, 'compute', autospec=True, side_effect=spy):
            self.assertEqual(self.preview(live['id']).status_code, 200)
        self.assertEqual(len(seen), 1)
        madhab, people, name = seen[0]
        self.assertEqual(madhab, 'hanafi')
        self.assertEqual(name, '')
        self.assertEqual(sorted(people), [('', '', 'F'), ('', '', 'M'), ('', '', 'M')])

    def test_names_and_amounts_never_reach_the_logs_even_when_the_engine_fails(self):
        from calc.models import Calculation
        handler = RecordingHandler()
        loggers = [logging.getLogger(name) for name in ('', 'api', 'django.request')]
        levels = [logger.level for logger in loggers]
        for logger in loggers:
            logger.addHandler(handler)
            logger.setLevel(logging.DEBUG)
        try:
            live = self.build('hanbali', 'male', '987654.32', ['son'], names=['Secret Name'])
            with mock.patch.object(Calculation, 'compute', side_effect=RuntimeError('Secret Name 987654.32')):
                response = self.preview(live['id'])
        finally:
            for logger, level in zip(loggers, levels):
                logger.removeHandler(handler)
                logger.setLevel(level)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {'detail': 'The preview is unavailable.'})
        logged = '\n'.join(handler.lines)
        self.assertIn('RuntimeError', logged)
        self.assertIn('preview.py', logged, 'the traceback frames are logged so a 503 can be debugged')
        for secret in ('Secret Name', '987654.32'):
            self.assertNotIn(secret, logged)

    def test_the_preview_limit_is_300_an_hour_and_apart_from_writes(self):
        self.assertEqual(api_settings.DEFAULT_THROTTLE_RATES['case_preview'], '300/hour')
        case = self.ready()
        for _ in range(300):
            self.assertEqual(self.preview(case['id']).status_code, 200)
        response = self.preview(case['id'])
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response['Content-Type'], 'application/json')
        # Writes and reads of the case keep their own budgets.
        self.assertEqual(self.client.get(CASE_URL, secure=True).status_code, 200)
        self.assertEqual(self.heir(case, 'son').status_code, 201)

    def test_a_second_client_is_not_throttled_with_the_first(self):
        case = self.ready()
        first, second = '203.0.113.9, 172.70.0.1', '198.51.100.7, 172.70.0.1'
        for _ in range(300):
            self.assertEqual(self.preview(case['id'], **{FORWARDED: first}).status_code, 200)
        self.assertEqual(self.preview(case['id'], **{FORWARDED: first}).status_code, 429)
        self.assertEqual(self.preview(case['id'], **{FORWARDED: second}).status_code, 200)

    def test_previews_do_not_use_up_the_write_budget(self):
        case = self.ready()
        for _ in range(50):
            self.preview(case['id'])
        for _ in range(118):
            self.assertEqual(self.deceased(case).status_code, 200)
        self.assertEqual(self.deceased(case).status_code, 429)


FIXTURES = json.loads(
    (Path(__file__).parent / 'contracts' / 'heir-options-fixtures.json').read_text(encoding='utf-8'))


class HeirRulesTests(TestCase):
    """The pure rules, held to the engine's own blocked flags."""

    @staticmethod
    def engine_blocked(madhab, gender, family, candidate):
        """Whether the engine blocks `candidate` when it joins `family` (a list of relationships).

        `get_quotes` sets the flags without distributing, so a family the radd refuses still
        answers. Set the school and clear first, as `compute` does.
        """
        from django.db import transaction
        from calc.models import Calculation as EngineCalculation, Deceased, Heir
        from api.preview import HEIR_CLASSES, SEX
        with transaction.atomic():
            try:
                calc = EngineCalculation.objects.create(name='')
                Deceased.objects.create(sex=SEX[gender], estate=1, calc=calc)
                for relationship in family:
                    HEIR_CLASSES[relationship].objects.create(
                        sex=SEX[anonymous_case.RELATIONSHIPS[relationship]], calc=calc)
                last = HEIR_CLASSES[candidate].objects.create(
                    sex=SEX[anonymous_case.RELATIONSHIPS[candidate]], calc=calc)
                calc.madhab = madhab
                calc.clear()
                calc.get_quotes()
                return Heir.objects.get(pk=last.pk).blocked
            finally:
                transaction.set_rollback(True)

    @staticmethod
    def counts(family):
        return heir_rules.counts({'relationship': name} for name in family)

    def assert_agrees(self, madhab, family, candidates, genders=('female', 'male')):
        blocked = heir_rules.blocked_relationships(madhab, self.counts(family))
        for gender in genders:
            for candidate in candidates:
                with self.subTest(madhab=madhab, gender=gender, family=family, candidate=candidate):
                    self.assertEqual(
                        candidate in blocked, self.engine_blocked(madhab, gender, family, candidate))

    def test_rules_equal_the_engine_for_every_single_heir_family_under_every_sunni_school(self):
        relationships = list(anonymous_case.RELATIONSHIPS)
        for madhab in schools.SUNNI:
            self.assert_agrees(madhab, [], relationships)
            for existing in relationships:
                self.assert_agrees(madhab, [existing], relationships)

    def test_rules_equal_the_engine_for_a_seeded_sample_of_larger_families(self):
        rng = random.Random(16_2026)
        relationships = list(anonymous_case.RELATIONSHIPS)
        for madhab in schools.SUNNI:
            for _ in range(300):
                family = [rng.choice(relationships) for _ in range(rng.randint(2, 7))]
                self.assert_agrees(
                    madhab, family, rng.sample(relationships, 4), genders=(rng.choice(('female', 'male')),))

    def test_rules_equal_the_engine_for_directed_families(self):
        relationships = list(anonymous_case.RELATIONSHIPS)
        families = [
            ['sister', 'sister'],
            ['sister', 'sister', 'paternal_brother'],
            ['sister', 'sister', 'paternal_sister'],
            ['sister', 'daughter'],
            ['sister', 'paternal_sister', 'paternal_brother'],
            ['paternal_sister', 'paternal_sister', 'daughter'],
            ['daughter', 'daughter', 'son_of_son'],
            ['daughter', 'daughter', 'daughter_of_son'],
            ['daughter', 'daughter_of_son', 'son_of_son'],
            ['son_of_son', 'daughter_of_son'],
            ['grandfather', 'sister', 'paternal_brother', 'paternal_sister'],
            ['grandfather', 'brother', 'sister'],
            ['grandfather', 'father'],
            ['mother', 'grandmother', 'maternal_sister'],
            ['brother', 'son_of_brother', 'son_of_paternal_brother', 'uncle'],
            ['paternal_brother', 'son_of_brother', 'paternal_uncle', 'son_of_uncle'],
            ['sister', 'daughter', 'son_of_paternal_brother', 'uncle', 'paternal_uncle'],
        ]
        for madhab in schools.SUNNI:
            for family in families:
                self.assert_agrees(madhab, family, relationships)

    def test_the_documented_cases(self):
        hanbali, hanafi = 'hanbali', 'hanafi'
        self.assertTrue(heir_rules.blocked_relationships(hanbali, {'father': 1}) >= {'brother', 'sister', 'grandfather'})
        self.assertNotIn('brother', heir_rules.blocked_relationships(hanbali, {'grandfather': 1}))
        self.assertIn('brother', heir_rules.blocked_relationships(hanafi, {'grandfather': 1}))
        self.assertIn('daughter_of_son', heir_rules.blocked_relationships(hanbali, {'daughter': 2}))
        self.assertNotIn(
            'daughter_of_son', heir_rules.blocked_relationships(hanbali, {'daughter': 2, 'son_of_son': 1}))
        self.assertEqual(heir_rules.blocked_relationships('jafari', {'father': 1}), set())
        self.assertEqual(heir_rules.blocked_relationships(None, {'father': 1}), set())

    def test_kinship_codes(self):
        for relationship, code in (
                ('father', 'second_father'), ('mother', 'second_mother'),
                ('husband', 'second_husband'), ('grandfather', 'second_grandfather')):
            self.assertEqual(heir_rules.kinship_code(relationship, 'female', {relationship: 1}), code)
        self.assertEqual(heir_rules.kinship_code('wife', 'male', {'wife': 4}), 'fifth_wife')
        self.assertIsNone(heir_rules.kinship_code('wife', 'male', {'wife': 3}))
        self.assertEqual(heir_rules.kinship_code('husband', 'male', {}), 'husband_of_male')
        self.assertEqual(heir_rules.kinship_code('wife', 'female', {}), 'wife_of_female')
        self.assertIsNone(heir_rules.kinship_code('son', 'male', {'son': 9}))
        self.assertTrue(heir_rules.is_impossible_family('male', {'father': 2}))
        self.assertFalse(heir_rules.is_impossible_family('male', {'wife': 4}))

    def test_gender_conflicts(self):
        self.assertEqual(heir_rules.gender_conflict('male', {'husband': 1}), 'has_husband')
        self.assertEqual(heir_rules.gender_conflict('female', {'wife': 1}), 'has_wife')
        self.assertIsNone(heir_rules.gender_conflict('female', {'husband': 1}))
        for gender in ('male', 'female'):
            self.assertEqual(heir_rules.gender_conflict(gender, {'husband': 1, 'wife': 1}), 'has_both_spouses')

    def test_every_code_is_in_the_contract(self):
        codes = CONTRACT['errorCodes']
        self.assertEqual(set(codes['relationship']), set(heir_rules.RELATIONSHIP_CODES) | {'required', 'invalid'})
        self.assertEqual(set(codes['gender']), set(heir_rules.GENDER_CODES) | {'required', 'invalid'})

    def test_the_shared_fixtures_give_the_same_options(self):
        self.assertGreaterEqual(len(FIXTURES['families']), 10)
        for family in FIXTURES['families']:
            with self.subTest(family=family['name']):
                heirs = [{'relationship': name} for name in family['heirs']]
                deceased = {'gender': family['gender'], 'estate': None}
                self.assertEqual(
                    anonymous_case.heir_options(family['madhab'], deceased, heirs), family['heir_options'])
                for relationship, code in family['heir_options']['invalid'].items():
                    self.assertNotIn(relationship, family['heir_options']['blocked'])
                    self.assertIn(code, CONTRACT['errorCodes']['relationship'])


class HeirRulesApiTests(InterviewBase):
    def setUp(self):
        super().setUp()
        self.case = self.start()
        self.send('patch', CASE_URL, {'case_id': self.case['id'], 'madhab': 'hanbali'})
        self.deceased(self.case, 'male')

    def fresh(self, gender='male', madhab='hanbali'):
        Session.objects.all().delete()
        self.client = APIClient(enforce_csrf_checks=True)
        self.case = self.start()
        self.send('patch', CASE_URL, {'case_id': self.case['id'], 'madhab': madhab})
        self.deceased(self.case, gender)

    def add(self, relationship, **extra):
        return self.heir(self.case, relationship, **extra)

    def edit(self, heir_id, relationship, **extra):
        return self.send(
            'put', f'{HEIRS_URL}{heir_id}/', {'case_id': self.case['id'], 'relationship': relationship, **extra})

    def errors(self, response):
        self.assertEqual(response.status_code, 400)
        return response.json()['errors']

    def heirs(self):
        return self.live()['heirs']

    def preview_body(self):
        return self.client.get(f'{PREVIEW_URL}?case_id={self.case["id"]}', secure=True).json()

    def test_heir_options_ride_with_every_case_and_are_never_stored(self):
        self.assertEqual(self.live()['heir_options'], {'blocked': [], 'invalid': {'husband': 'husband_of_male'}})
        self.add('father')
        options = self.live()['heir_options']
        self.assertEqual(options['invalid']['father'], 'second_father')
        self.assertIn('brother', options['blocked'])
        self.assertIn('sister', options['blocked'])
        self.assertNotIn('heir_options', self.stored())
        self.assertEqual(self.add('mother').json()['case']['heir_options'], self.live()['heir_options'])

    def test_a_blocker_labels_and_the_labelled_relatives_still_save(self):
        self.add('father')
        blocked = self.live()['heir_options']['blocked']
        self.assertTrue({'brother', 'sister'} <= set(blocked))
        for relationship in ('brother', 'sister'):
            self.assertEqual(self.add(relationship).status_code, 201)
        self.assertEqual([heir['relationship'] for heir in self.heirs()], ['father', 'brother', 'sister'])

    def test_removing_the_blocker_takes_the_label_away(self):
        father = self.add('father').json()['case']['heirs'][0]['id']
        self.assertIn('brother', self.live()['heir_options']['blocked'])
        self.send('delete', f'{HEIRS_URL}{father}/', {'case_id': self.case['id']})
        self.assertNotIn('brother', self.live()['heir_options']['blocked'])

    def test_the_family_gives_the_same_shares_in_any_order(self):
        for order in (('father', 'mother', 'brother', 'brother'), ('brother', 'brother', 'mother', 'father'),
                      ('brother', 'father', 'brother', 'mother')):
            with self.subTest(order=order):
                self.fresh()
                for relationship in order:
                    self.assertEqual(self.add(relationship).status_code, 201)
                body = self.preview_body()
                self.assertEqual(body['status'], 'available')
                mother = next(heir['id'] for heir in self.heirs() if heir['relationship'] == 'mother')
                share = next(item for item in body['shares'] if item['heir_id'] == mother)
                self.assertEqual((share['numerator'], share['denominator']), (1, 6))

    def test_the_grandfather_labels_a_brother_under_hanafi_only(self):
        self.add('grandfather')
        self.assertNotIn('brother', self.live()['heir_options']['blocked'])
        self.send('patch', CASE_URL, {'case_id': self.case['id'], 'madhab': 'hanafi'})
        self.assertIn('brother', self.live()['heir_options']['blocked'])

    def test_a_conditional_block_comes_and_goes(self):
        self.add('daughter')
        self.add('daughter')
        self.assertIn('daughter_of_son', self.live()['heir_options']['blocked'])
        self.add('son_of_son')
        self.assertNotIn('daughter_of_son', self.live()['heir_options']['blocked'])

    def test_jafari_and_no_school_label_nothing(self):
        self.add('father')
        self.send('patch', CASE_URL, {'case_id': self.case['id'], 'madhab': 'jafari'})
        self.assertEqual(self.live()['heir_options']['blocked'], [])
        self.assertEqual(self.add('brother').status_code, 201)
        self.plant(madhab=None)
        self.assertEqual(self.live()['heir_options']['blocked'], [])

    def test_a_second_of_a_single_relative_has_its_own_code(self):
        for relationship, code in (('father', 'second_father'), ('mother', 'second_mother'),
                                   ('grandfather', 'second_grandfather')):
            with self.subTest(relationship=relationship):
                self.fresh()
                self.assertEqual(self.add(relationship).status_code, 201)
                before = self.stored()
                self.assertEqual(self.errors(self.add(relationship)), {'relationship': code})
                self.assertEqual(self.stored(), before)
        self.fresh('female')
        self.add('husband')
        self.assertEqual(self.errors(self.add('husband')), {'relationship': 'second_husband'})

    def test_editing_into_a_second_of_one_is_refused_and_nothing_is_stored(self):
        for relationship, code in (('father', 'second_father'), ('mother', 'second_mother'),
                                   ('grandfather', 'second_grandfather')):
            with self.subTest(relationship=relationship):
                self.fresh()
                self.add(relationship)
                other = 'son' if anonymous_case.RELATIONSHIPS[relationship] == 'male' else 'daughter'
                heir = self.add(other).json()['case']['heirs'][1]['id']
                before = self.stored()
                self.assertEqual(self.errors(self.edit(heir, relationship)), {'relationship': code})
                self.assertEqual(self.stored(), before)

    def test_the_fifth_wife_on_add_and_on_edit(self):
        for _ in range(4):
            self.assertEqual(self.add('wife').status_code, 201)
        self.assertEqual(self.errors(self.add('wife')), {'relationship': 'fifth_wife'})
        son = self.add('son').json()['case']['heirs'][4]['id']
        before = self.stored()
        self.assertEqual(self.errors(self.edit(son, 'wife')), {'relationship': 'fifth_wife'})
        self.assertEqual(self.stored(), before)

    def test_a_spouse_that_does_not_fit_the_deceased(self):
        self.assertEqual(self.errors(self.add('husband')), {'relationship': 'husband_of_male'})
        self.deceased(self.case, 'female')
        self.assertEqual(self.errors(self.add('wife')), {'relationship': 'wife_of_female'})
        daughter = self.add('daughter').json()['case']['heirs'][0]['id']
        self.assertEqual(self.errors(self.edit(daughter, 'wife')), {'relationship': 'wife_of_female'})

    def test_editing_into_a_husband_for_a_male_deceased_or_a_second_husband(self):
        son = self.add('son').json()['case']['heirs'][0]['id']
        before = self.stored()
        self.assertEqual(self.errors(self.edit(son, 'husband')), {'relationship': 'husband_of_male'})
        self.assertEqual(self.stored(), before)
        self.fresh('female')
        self.add('husband')
        daughter = self.add('daughter').json()['case']['heirs'][1]['id']
        self.assertEqual(self.errors(self.edit(daughter, 'husband')), {'relationship': 'second_husband'})

    def test_the_invalid_spouse_flips_with_the_deceased_gender(self):
        self.assertEqual(self.live()['heir_options']['invalid'], {'husband': 'husband_of_male'})
        self.assertEqual(self.deceased(self.case, 'female').status_code, 200)
        self.assertEqual(self.live()['heir_options']['invalid'], {'wife': 'wife_of_female'})
        self.assertEqual(self.deceased(self.case, 'male').status_code, 200)
        self.assertEqual(self.live()['heir_options']['invalid'], {'husband': 'husband_of_male'})

    def test_has_wife_and_an_estate_error_come_together(self):
        self.add('wife')
        self.assertEqual(
            self.errors(self.deceased(self.case, 'female', '0')), {'gender': 'has_wife', 'estate': 'not_positive'})

    def test_the_edited_heir_is_left_out_of_its_own_check(self):
        father = self.add('father').json()['case']['heirs'][0]['id']
        self.assertEqual(self.edit(father, 'grandfather').status_code, 200)
        self.assertEqual(self.heirs()[0]['relationship'], 'grandfather')
        for _ in range(4):
            self.add('wife')
        fourth = self.heirs()[-1]['id']
        self.assertEqual(self.edit(fourth, 'wife', name='Renamed').status_code, 200)
        self.assertEqual(self.heirs()[-1]['name'], 'Renamed')

    def test_a_saved_heir_can_be_renamed_whatever_the_family_says(self):
        # An older session: two fathers and a husband for a male deceased are already saved.
        first = self.add('father').json()['case']['heirs'][0]['id']
        self.plant(heirs=[
            *self.stored()['heirs'],
            {'id': 'second', 'relationship': 'father', 'gender': 'male', 'name': None},
            {'id': 'spouse', 'relationship': 'husband', 'gender': 'male', 'name': None},
        ])
        for heir_id, relationship in ((first, 'father'), ('second', 'father'), ('spouse', 'husband')):
            self.assertEqual(self.edit(heir_id, relationship, name='Renamed').status_code, 200)

    def test_kinship_wins_over_hajb(self):
        self.add('father')
        self.add('grandfather')
        options = self.live()['heir_options']
        self.assertEqual(options['invalid']['grandfather'], 'second_grandfather')
        self.assertNotIn('grandfather', options['blocked'])
        self.assertEqual(self.errors(self.add('grandfather')), {'relationship': 'second_grandfather'})

    def test_a_gender_that_contradicts_a_saved_spouse_is_refused(self):
        self.deceased(self.case, 'female')
        self.add('husband')
        before = self.stored()
        self.assertEqual(self.errors(self.deceased(self.case, 'male', '500')), {'gender': 'has_husband'})
        self.assertEqual(self.stored(), before)
        self.fresh()
        self.add('wife')
        self.assertEqual(self.errors(self.deceased(self.case, 'female')), {'gender': 'has_wife'})

    def test_both_spouses_in_an_older_session_fit_no_gender(self):
        self.plant(heirs=[
            {'id': 'a', 'relationship': 'husband', 'gender': 'male', 'name': None},
            {'id': 'b', 'relationship': 'wife', 'gender': 'female', 'name': None},
        ])
        for gender in ('male', 'female'):
            self.assertEqual(self.errors(self.deceased(self.case, gender)), {'gender': 'has_both_spouses'})

    def test_editing_when_the_stored_deceased_is_unreadable_is_a_400(self):
        heir = self.add('son').json()['case']['heirs'][0]['id']
        self.plant(deceased={'gender': 'robot'})
        self.assertIsNone(self.live()['deceased'])
        self.assertEqual(self.errors(self.edit(heir, 'daughter')), {'case': 'deceased_required'})
        # A rename keeps passing: the relationship is unchanged.
        self.assertEqual(self.edit(heir, 'son', name='Renamed').status_code, 200)

    def test_several_issues_come_together_on_add_and_edit(self):
        self.add('father')
        self.assertEqual(
            self.errors(self.add('father', name='x' * 101)), {'relationship': 'second_father', 'name': 'too_long'})
        son = self.add('son').json()['case']['heirs'][1]['id']
        self.assertEqual(
            self.errors(self.edit(son, 'father', name='x' * 101)),
            {'relationship': 'second_father', 'name': 'too_long'})

    def test_several_issues_come_together_at_the_heir_limit(self):
        self.plant(heirs=[
            {'id': f'h{index}', 'relationship': 'son', 'gender': 'male', 'name': None}
            for index in range(anonymous_case.MAX_HEIRS - 1)
        ])
        self.assertEqual(self.add('father').status_code, 201)
        self.assertEqual(
            self.errors(self.add('father', name='x' * 101)),
            {'relationship': 'second_father', 'name': 'too_long', 'heirs': 'limit'})

    def test_gender_and_estate_errors_come_together(self):
        self.deceased(self.case, 'female')
        self.add('husband')
        self.assertEqual(
            self.errors(self.deceased(self.case, 'male', '0')), {'gender': 'has_husband', 'estate': 'not_positive'})

    def test_corrected_input_is_saved(self):
        self.add('father')
        self.assertEqual(self.add('father', name='x' * 101).status_code, 400)
        self.assertEqual(self.add('mother', name='Fine').status_code, 201)

    def test_the_server_decides_whatever_the_client_knew(self):
        # A body that never read `heir_options` is held to the kinship rules all the same.
        self.add('father')
        self.assertEqual(self.errors(self.add('father')), {'relationship': 'second_father'})
        self.assertEqual(self.add('sister').status_code, 201)

    def test_a_second_father_in_a_preview_of_an_older_session_is_still_unavailable(self):
        self.plant(heirs=[
            {'id': 'a', 'relationship': 'father', 'gender': 'male', 'name': None},
            {'id': 'b', 'relationship': 'father', 'gender': 'male', 'name': None},
        ])
        body = self.preview_body()
        self.assertEqual((body['status'], body['reason']), ('unavailable', 'invalid_family'))


class CaseWriteLockOrderTests(SimpleTestCase):
    def test_the_lock_sits_directly_before_the_session_middleware(self):
        middleware = list(settings.MIDDLEWARE)
        lock = middleware.index('mawareeth.middleware.CaseWriteLockMiddleware')
        self.assertEqual(middleware[lock + 1], 'django.contrib.sessions.middleware.SessionMiddleware')

    def test_sessions_are_database_backed(self):
        self.assertEqual(settings.SESSION_ENGINE, 'django.contrib.sessions.backends.db')


@unittest.skipUnless(connection.vendor == 'postgresql', 'Row locks need PostgreSQL.')
class CaseWriteLockTests(TransactionTestCase):
    """Overlapping writes from one browser run one after another.

    The first request is held inside the view, after it has read the case. A second
    request is then sent, and the first is released only once the second has either
    reached the view (no lock: both read the same old case and the last save wins) or
    is seen waiting on a database lock (the lock works: it runs after the first saves).
    """

    WAIT = 10

    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=True)
        self.entered = threading.Event()
        self.overtaken = threading.Event()
        self.release = threading.Event()
        self.threads = []
        self.failures = []
        # A failed test must not leave a held request behind.
        self.addCleanup(self.release.set)

    def headers(self):
        token = self.client.get(SESSION_URL, secure=True).cookies[settings.CSRF_COOKIE_NAME].value
        return {'X-CSRFToken': token, 'Referer': 'https://testserver/app/en/interview/'}

    def twin(self):
        """Another tab: a client holding the same cookies."""
        other = APIClient(enforce_csrf_checks=True)
        other.cookies = self.client.cookies
        return other

    def start(self, headers):
        response = self.client.post(CASE_URL, {}, format='json', secure=True, headers=headers)
        self.assertEqual(response.status_code, 201)
        return response.json()['case']

    def with_deceased(self, headers):
        case = self.start(headers)
        response = self.client.put(
            DECEASED_URL, {'case_id': case['id'], 'gender': 'male'}, format='json', secure=True, headers=headers)
        self.assertEqual(response.status_code, 200)
        return case

    def stored(self):
        key = self.client.cookies[settings.SESSION_COOKIE_NAME].value
        return Session.objects.get(session_key=key).get_decoded()[anonymous_case.SESSION_KEY]

    def hold_first(self):
        """Patch the case lookup so the thread named 'first' waits after reading the case."""
        real = anonymous_case._live
        test = self

        def live(request, case_id):
            case = real(request, case_id)
            if threading.current_thread().name == 'first':
                test.entered.set()
                test.release.wait(60)
            else:
                test.overtaken.set()
            return case

        real_start = anonymous_case.start

        def start(request):
            # A start over never looks the case up, so reaching it is its way of "arriving".
            test.overtaken.set()
            return real_start(request)

        return mock.patch.multiple(anonymous_case, _live=live, start=start)

    def spawn(self, name, send, results):
        def call():
            try:
                results[name] = send()
            except BaseException:
                self.failures.append(f'{name}:\n{traceback.format_exc()}')
            finally:
                connections.close_all()

        thread = threading.Thread(name=name, target=call, daemon=True)
        self.threads.append(thread)
        thread.start()
        return thread

    def finish(self):
        for thread in self.threads:
            thread.join(30)
        self.assertEqual([t.name for t in self.threads if t.is_alive()], [])
        if self.failures:
            self.fail('A request thread raised:\n' + '\n'.join(self.failures))

    def other_backend_waits_on_a_lock(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() "
                "AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'")
            return cursor.fetchone() is not None

    def run_pair(self, first, second):
        """Send first(), then second() once first is held. Returns both responses."""
        results = {}
        self.spawn('first', first, results)
        self.assertTrue(self.entered.wait(self.WAIT), 'The first request never reached the view.')
        self.spawn('second', second, results)
        pause = threading.Event()
        for _ in range(self.WAIT * 100):
            if self.overtaken.is_set() or self.other_backend_waits_on_a_lock():
                break
            pause.wait(0.01)
        else:
            self.release.set()
            self.finish()
            self.fail('The second request neither reached the view nor waited on a lock.')
        self.release.set()
        self.finish()
        self.assertEqual(set(results), {'first', 'second'})
        return results['first'], results['second']

    def test_two_overlapping_heir_adds_both_persist(self):
        headers = self.headers()
        case = self.with_deceased(headers)
        other = self.twin()

        def add(client, relationship):
            return lambda: client.post(
                HEIRS_URL, {'case_id': case['id'], 'relationship': relationship}, format='json',
                secure=True, headers=headers)

        with self.hold_first():
            first, second = self.run_pair(add(self.client, 'son'), add(other, 'daughter'))

        self.assertEqual((first.status_code, second.status_code), (201, 201))
        self.assertEqual(
            sorted(heir['relationship'] for heir in self.stored()['heirs']), ['daughter', 'son'])

    def test_heir_add_and_madhab_change_both_persist(self):
        headers = self.headers()
        case = self.with_deceased(headers)
        other = self.twin()

        with self.hold_first():
            first, second = self.run_pair(
                lambda: self.client.post(
                    HEIRS_URL, {'case_id': case['id'], 'relationship': 'son'}, format='json',
                    secure=True, headers=headers),
                lambda: other.patch(
                    CASE_URL, {'case_id': case['id'], 'madhab': 'hanafi'}, format='json',
                    secure=True, headers=headers))

        self.assertEqual((first.status_code, second.status_code), (201, 200))
        stored = self.stored()
        self.assertEqual([heir['relationship'] for heir in stored['heirs']], ['son'])
        self.assertEqual(stored['madhab'], 'hanafi')

    def test_start_over_and_old_tab_write_never_land_on_a_replaced_case(self):
        headers = self.headers()
        case = self.start(headers)
        other = self.twin()

        with self.hold_first():
            first, second = self.run_pair(
                lambda: self.client.put(
                    DECEASED_URL, {'case_id': case['id'], 'gender': 'male'}, format='json',
                    secure=True, headers=headers),
                lambda: other.post(
                    CASE_URL, {'replace': True, 'case_id': case['id']}, format='json',
                    secure=True, headers=headers))

        # The write ran first, then the start over replaced that case.
        self.assertEqual((first.status_code, second.status_code), (200, 201))
        stored = self.stored()
        self.assertEqual(stored['id'], second.json()['case']['id'])
        self.assertNotEqual(stored['id'], case['id'])
        self.assertNotIn('deceased', stored)

    def test_preview_does_not_wait_for_a_write(self):
        headers = self.headers()
        case = self.start(headers)
        other = self.twin()
        results = {}

        with self.hold_first():
            self.spawn(
                'first',
                lambda: self.client.patch(
                    CASE_URL, {'case_id': case['id'], 'madhab': 'hanafi'}, format='json',
                    secure=True, headers=headers),
                results)
            self.assertTrue(self.entered.wait(self.WAIT), 'The write never reached the view.')
            # The write is still held: the preview must answer anyway.
            preview = self.spawn(
                'preview', lambda: other.get(f'{PREVIEW_URL}?case_id={case["id"]}', secure=True), results)
            preview.join(self.WAIT)
            answered = 'preview' in results
            self.release.set()
            self.finish()

        self.assertTrue(answered, 'The preview waited for the write.')
        self.assertEqual(results['preview'].status_code, 200)
        self.assertEqual(results['first'].status_code, 200)

    def test_only_unsafe_case_requests_with_a_cookie_take_the_lock(self):
        with mock.patch.object(CaseWriteLockMiddleware, 'lock') as lock:
            # No session cookie yet: the first start has nothing to lock.
            fresh = APIClient(enforce_csrf_checks=True)
            token = fresh.get(SESSION_URL, secure=True).cookies[settings.CSRF_COOKIE_NAME].value
            headers = {'X-CSRFToken': token, 'Referer': 'https://testserver/app/en/interview/'}
            response = fresh.post(CASE_URL, {}, format='json', secure=True, headers=headers)
            self.assertEqual(response.status_code, 201)
            self.assertEqual(lock.call_count, 0)

            case = response.json()['case']
            fresh.get(CASE_URL, secure=True)
            fresh.get(f'{PREVIEW_URL}?case_id={case["id"]}', secure=True)
            self.assertEqual(lock.call_count, 0)

            fresh.patch(
                CASE_URL, {'case_id': case['id'], 'madhab': 'hanafi'}, format='json', secure=True,
                headers=headers)
            self.assertEqual(lock.call_count, 1)
            self.assertEqual(lock.call_args.args[0], fresh.cookies[settings.SESSION_COOKIE_NAME].value)

            # Not under the case API: no lock.
            fresh.post(SESSION_URL, {}, format='json', secure=True, headers=headers)
            self.assertEqual(lock.call_count, 1)

    def test_a_missing_session_and_a_refused_write_behave_as_before(self):
        headers = self.headers()
        self.client.cookies[settings.SESSION_COOKIE_NAME] = 'nosuchsession'
        response = self.client.patch(
            CASE_URL, {'case_id': 'x', 'madhab': 'hanafi'}, format='json', secure=True, headers=headers)
        self.assertEqual(response.status_code, 404)

        case = self.start(headers)
        refused = self.client.patch(
            CASE_URL, {'case_id': case['id'], 'madhab': 'nope'}, format='json', secure=True, headers=headers)
        self.assertEqual(refused.status_code, 400)
        # The lock was released: a later write goes through.
        again = self.client.patch(
            CASE_URL, {'case_id': case['id'], 'madhab': 'hanafi'}, format='json', secure=True, headers=headers)
        self.assertEqual(again.status_code, 200)

        # A stale tab is refused with the live case, and the lock is released after it too.
        fresh = self.client.post(
            CASE_URL, {'replace': True, 'case_id': case['id']}, format='json', secure=True, headers=headers)
        self.assertEqual(fresh.status_code, 201)
        stale = self.client.put(
            DECEASED_URL, {'case_id': case['id'], 'gender': 'male'}, format='json', secure=True, headers=headers)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()['case']['id'], fresh.json()['case']['id'])
        after = self.client.put(
            DECEASED_URL, {'case_id': fresh.json()['case']['id'], 'gender': 'male'}, format='json',
            secure=True, headers=headers)
        self.assertEqual(after.status_code, 200)
