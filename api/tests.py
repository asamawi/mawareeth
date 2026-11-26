import copy
import hashlib
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
from django.test import RequestFactory, SimpleTestCase, TestCase, TransactionTestCase, override_settings, tag
from django.utils import timezone
from django.urls import path, reverse
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.test import APIClient
from rest_framework.views import APIView

from api import urls as api_urls
from api.snapshots import default_name, grapheme_count
from api import anonymous_case, heir_rules
from api.models import AppendOnlyError, SavedCase, ShareAuditEvent, ShareLink
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
        if isinstance(body, dict) and 'expected_revision' not in body and Session.objects.count() == 1:
            stored = self.stored()
            if isinstance(stored, dict):
                body = {**body, 'expected_revision': anonymous_case.revision_of(stored)}
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
        self.assertEqual(
            set(case), {'id', 'revision', 'started_at', 'madhab', 'deceased', 'heirs', 'heir_options', 'deaths',
                        'persons', 'edges', 'placement', 'snapshot', 'saved'})
        self.assertIsNone(case['saved'])
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
                expected = case['revision'] + 1 + anonymous_case.MADHABS.index(madhab)
                self.assertEqual(response.json()['case'], {**case, 'madhab': madhab, 'revision': expected,
                                   'snapshot': {**case['snapshot'], 'madhab': madhab}})
                self.assertEqual(self.stored()['revision'], expected)
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
        self.assertEqual(response.json()['case'], {**live, 'madhab': 'maliki', 'revision': live['revision'] + 1,
                                                       'snapshot': {**live['snapshot'], 'madhab': 'maliki'}})
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


class InterviewHelpers:
    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=True)

    def csrf(self, client):
        token = client.get(SESSION_URL, secure=True).cookies[settings.CSRF_COOKIE_NAME].value
        return {'X-CSRFToken': token, 'Referer': 'https://testserver/app/en/interview/'}

    def current_revision(self, client):
        morsel = client.cookies.get(settings.SESSION_COOKIE_NAME)
        row = Session.objects.filter(session_key=morsel.value).first() if morsel else None
        stored = row.get_decoded().get(anonymous_case.SESSION_KEY) if row else None
        return anonymous_case.revision_of(stored) if isinstance(stored, dict) else None

    def send(self, method, url, body, client=None):
        client = client or self.client
        if isinstance(body, dict) and body.get('case_id') and 'expected_revision' not in body:
            revision = self.current_revision(client)
            if revision is not None:
                body = {**body, 'expected_revision': revision}
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


class InterviewBase(InterviewHelpers, TestCase):
    pass


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
        self.assertEqual(set(heirs[0]), {'id', 'relationship', 'gender', 'name', 'edit_options'})
        self.assertEqual(self.live()['heirs'], heirs)

    def test_every_relationship_is_accepted_with_the_gender_in_the_contract(self):
        self.assertEqual(len(CONTRACT['relationships']), 23)
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
        # Each heir also carries the add/edit form's `edit_options`, which the blur-check derives anew.
        self.assertIn('edit_options', edited[0])
        self.assertEqual(
            {key: value for key, value in edited[0].items() if key != 'edit_options'},
            {'id': heirs[0]['id'], 'relationship': 'daughter', 'gender': 'female', 'name': None})
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
        self.assertEqual(response.json()['case'], {**before, 'madhab': 'jafari', 'revision': before['revision'] + 1,
                                                       'snapshot': {**before['snapshot'], 'madhab': 'jafari'}})

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
        body = '{"case_id": "%s", "expected_revision": %d, "relationship": "son", "name": "a%sud800"}' % (
            case['id'], self.live()['revision'], BACKSLASH)

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
        gone = self.client.delete(
            f'{url}?case_id={case["id"]}&expected_revision={self.live()["revision"]}', secure=True, headers=headers)
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


def calc_sequences():
    """Where each calculation table's id sequence stands: a preview must not advance any of them."""
    found = []
    with connection.cursor() as cursor:
        for table in ('calc_calculation', 'calc_person', 'calc_marriage'):
            cursor.execute('SELECT pg_get_serial_sequence(%s, %s)', [table, 'id'])
            name = cursor.fetchone()[0]
            cursor.execute(f'SELECT last_value, is_called FROM {name}')
            found.append(cursor.fetchone())
    return found


def legacy_fields(body):
    """A preview body without the additive `presented` and `revision`: the unchanged legacy fields."""
    return {k: v for k, v in body.items() if k not in ('presented', 'revision')}


PREVIEW_FIXTURES = json.loads(
    (Path(__file__).parent / 'contracts' / 'preview-fixtures.json').read_text(encoding='utf-8'))['fixtures']


# Engine-heavy tests are TransactionTestCase: inside TestCase's per-test transaction every
# compute() and case write is a savepoint, and past 64 subtransactions PostgreSQL slows every query sharply.
class PreviewTests(InterviewHelpers, TransactionTestCase):
    def without_revision(self, body):
        """The body minus its integer `revision`; any other key, such as `presented`, is kept."""
        self.assertIs(type(body.get('revision')), int)
        return {k: v for k, v in body.items() if k != 'revision'}

    def not_ready_body(self, case_id):
        return self.without_revision(self.preview(case_id).json())

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
        return (Calculation.objects.count(), Person.objects.count(), Marriage.objects.count(), calc_sequences())

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
                if case.get('deaths'):
                    live = self.start()
                    self.plant(**{k: v for k, v in case.items() if k not in ('id', 'started_at')})
                    self.assertEqual(legacy_fields(self.preview(live['id'], headers={'Accept-Language': 'en'}).json()),
                                     fixture['response'])
                    continue
                live = self.build(
                    case['madhab'], case['deceased']['gender'], case['deceased']['estate'],
                    [heir['relationship'] for heir in case['heirs']])
                response = self.preview(live['id'], headers={'Accept-Language': 'en'})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response['Content-Type'], 'application/json')
                self.assertIn('no-store', response['Cache-Control'])
                real_ids = {item['id']: heir['id'] for item, heir in zip(case['heirs'], live['heirs'])}
                expected = json.loads(json.dumps(fixture['response']))

                def with_real_ids(node):
                    # Heir ids appear under these keys at any depth (a choose_school body nests four previews).
                    if isinstance(node, dict):
                        for key, value in node.items():
                            if key in ('heir_id', 'heir', 'id') and isinstance(value, str) and value in real_ids:
                                node[key] = real_ids[value]
                            else:
                                with_real_ids(value)
                    elif isinstance(node, list):
                        for item in node:
                            with_real_ids(item)
                with_real_ids(expected)
                self.assertEqual(legacy_fields(response.json()), expected)
                # And the numbers are the engine's own, run directly on a persisted case.
                if expected['status'] == 'available':
                    # A null school is the Hanbali body, which every school agreed with.
                    madhab = case['madhab'] or 'hanbali'
                    types = [HEIR_CLASSES[heir['relationship']] for heir in case['heirs']]
                    sex = 'M' if case['deceased']['gender'] == 'male' else 'F'
                    calc, heirs = build_case(sex, types, estate=1)
                    final = calc.legacy_compute(madhab=madhab)
                    self.assertEqual(
                        [{k: v for k, v in e.items() if k not in ('heir', 'labels')} for e in expected['proof']['heirs']],
                        [{k: v for k, v in e.items() if k != 'heir'} for e in calc.proof['heirs']])
                    self.assertEqual(
                        [{k: v for k, v in step.items() if k != 'label'} for step in expected['proof']['steps']],
                        calc.proof['steps'])
                    table = expected['table']
                    self.assertEqual(
                        [{k: v for k, v in c.items() if k != 'label'} for c in table['columns']],
                        calc.table['columns'])
                    self.assertEqual(
                        [{k: v for k, v in r.items() if k != 'heir'} for r in table['rows']],
                        [{k: v for k, v in r.items() if k != 'heir'} for r in calc.table['rows']])
                    self.assertEqual({r['heir'] for r in table['rows']}, {s['heir_id'] for s in expected['shares']})
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
        from django.utils import translation
        from api import preview
        for fixture in PREVIEW_FIXTURES:
            with self.subTest(fixture['title']), translation.override('en'):
                self.assertEqual(legacy_fields(preview.preview(fixture['case'])), fixture['response'])

    def test_presented_fixtures_are_the_bridge_output(self):
        """The web's PresentedResult fixtures are this bridge's own English output, never hand-edited."""
        from django.utils import translation
        from api import preview
        stored = json.loads((Path(__file__).parent / 'contracts' / 'preview-presented-fixtures.json')
                            .read_text(encoding='utf-8'))
        made, chosen = {}, {}
        for fixture in PREVIEW_FIXTURES:
            with translation.override('en'):
                body = preview.preview(fixture['case'])
                if body['status'] == 'choose_school':
                    # What each school's own preview presents once the visitor chooses it (the e2e flow).
                    chosen[fixture['title']] = {school: preview.preview({**fixture['case'], 'madhab': school})['presented']
                                                for school in body['schools']}
            if body['status'] != 'not_ready':
                made[fixture['title']] = body['presented']
        self.assertEqual(stored['presented'], made)
        self.assertEqual(stored['chosen'], chosen)

    def test_presented_states_follow_the_legacy_status(self):
        from decimal import Decimal
        from django.utils import translation
        from engine.contracts import parse_presented_result
        from api import preview
        states = {'available': 'answer', 'unavailable': 'refused', 'choose_school': 'selection_required'}
        seen = set()
        for fixture in PREVIEW_FIXTURES:
            with self.subTest(fixture['title']), translation.override('en'):
                body = preview.preview(fixture['case'])
                if body['status'] == 'not_ready':
                    self.assertEqual(body, {'status': 'not_ready'})
                    continue
                presented = body['presented']
                parse_presented_result(presented)
                self.assertEqual(presented['version'], 3)
                self.assertEqual(presented['state'], states[body['status']])
                seen.add(presented['state'])
                if body['status'] == 'available':
                    code = 'same_in_all_schools' if body.get('agreement') == 'all' else 'school'
                    self.assertEqual(presented['school_line']['code'], code)
                    # the legacy amount is the presented amount scaled to two decimals
                    amounts = {row['person']: row['amount'] for row in presented['rows']}
                    for share in body['shares']:
                        minor = amounts[share['heir_id']]
                        self.assertEqual(share['amount'], None if minor is None
                                         else f"{Decimal(minor['amount_minor']).scaleb(-2):.2f}")
                        self.assertTrue(minor is None or minor['currency'] == 'SAR')
                    self.assertEqual(presented['table'] is None, body['table'] is None)
                elif body['status'] == 'choose_school':
                    self.assertEqual(len(presented['comparison']['schools']), 4)
                else:
                    self.assertTrue(presented['refusals'])
        self.assertEqual(seen, {'answer', 'refused', 'selection_required'})

    def test_presented_text_follows_the_asked_language_and_the_table_is_labelled(self):
        from django.utils import translation
        from api import preview
        fixture = next(f for f in PREVIEW_FIXTURES if f['title'] == 'Husband and two sisters need awl')
        for language, caption in [('ar', '\u0627\u0644\u0633\u0647\u0627\u0645'), ('en', 'Shares'), ('fr', 'Parts')]:
            with translation.override(language):
                presented = preview.preview(fixture['case'])['presented']
            self.assertEqual(presented['locale'], language)
            self.assertEqual(presented['table']['columns'][0]['label'], caption)

    def test_table_labels_follow_the_language_and_layered_cases_have_tables(self):
        from django.utils import translation
        from api import preview
        fixture = next(f for f in PREVIEW_FIXTURES if f['title'] == 'Husband and two sisters need awl')
        with translation.override('fr'):
            labels = [c['label'] for c in preview.preview(fixture['case'])['table']['columns']]
        self.assertEqual(labels, ['Parts', 'Excès'])
        layered = next(f for f in PREVIEW_FIXTURES
                       if f['response']['status'] == 'available' and f['case'].get('deaths'))
        self.assertIsNotNone(layered['response']['table'])

    def test_the_asked_language_wins_over_a_language_cookie(self):
        from django.conf import settings
        fixture = next(f for f in PREVIEW_FIXTURES if f['title'] == 'Husband and two sisters need awl')
        case = fixture['case']
        live = self.build(case['madhab'], case['deceased']['gender'], case['deceased']['estate'],
                          [heir['relationship'] for heir in case['heirs']])
        # a cookie left by the legacy pages must not override the web page's own language
        self.client.cookies[settings.LANGUAGE_COOKIE_NAME] = 'en'
        body = self.preview(live['id'], headers={'Accept-Language': 'ar'}).json()
        self.assertEqual([c['label'] for c in body['table']['columns']], ['السهام', 'العول'])
        self.assertTrue(all(any('؀' <= ch <= 'ۿ' for ch in e['labels']['rule']) for e in body['proof']['heirs']))
        # an unsupported language falls back to the one the middleware chose
        body = self.preview(live['id'], HTTP_ACCEPT_LANGUAGE='de').json()
        self.assertEqual([c['label'] for c in body['table']['columns']], ['Shares', 'Excess'])

    def test_the_remainder_column_is_not_called_radd(self):
        live = self.build('hanbali', 'male', None, ['father', 'daughter'])
        columns = self.preview(live['id'], headers={'Accept-Language': 'ar'}).json()['table']['columns']
        self.assertEqual([c['code'] for c in columns], ['base', 'remainder'])
        self.assertEqual(columns[1]['label'], 'الباقي تعصيبًا')
        english = self.preview(live['id'], headers={'Accept-Language': 'en'}).json()['table']['columns']
        self.assertEqual(english[1]['label'], 'Remainder')

    def test_every_available_fixture_carries_its_versioned_proof(self):
        for fixture in PREVIEW_FIXTURES:
            response = fixture['response']
            with self.subTest(fixture['title']):
                if response['status'] != 'available':
                    self.assertNotIn('proof', response)
                    continue
                proof = response['proof']
                if response['madhab'] is None:
                    self.assertEqual(response['agreement'], 'all')
                if fixture['case'].get('deaths'):
                    self.assertEqual(proof['version'], 2)
                    self.assertEqual([l['heir'] for l in proof['layers']],
                                     [None] + [d['heir_id'] for d in fixture['case']['deaths']])
                    continue
                self.assertEqual(proof['version'], 1)
                self.assertEqual(proof['madhab'], response['madhab'] or 'hanbali')
                self.assertEqual({e['heir'] for e in proof['heirs']}, {s['heir_id'] for s in response['shares']})
                shares = {s['heir_id']: (s['numerator'], s['denominator']) for s in response['shares']}
                for entry in proof['heirs']:
                    self.assertEqual((entry['share']['numerator'], entry['share']['denominator']), shares[entry['heir']])
                    self.assertEqual(set(entry['labels']), {'rule', 'condition', 'blocked_by', 'verse', 'school_rule', 'option'})
                    for kind, label in entry['labels'].items():
                        self.assertEqual(label is None, entry[kind] is None, kind)

    def test_the_proof_names_each_schools_own_rule(self):
        by_title = {f['title']: f['response'] for f in PREVIEW_FIXTURES}
        self.assertEqual(by_title['Grandfather and brother under Hanafi']['proof']['school_rules'],
                         ['grandfather_blocks_siblings'])
        self.assertEqual(by_title['Grandfather and brother under Hanbali']['proof']['school_rules'],
                         ['grandfather_shares_with_siblings'])
        self.assertEqual(by_title['Maliki mushtaraka shares the third']['proof']['school_rules'], ['mushtaraka'])
        self.assertEqual(by_title['Hanafi keeps the full brother residuary']['proof']['school_rules'], ['no_mushtaraka'])
        self.assertEqual(by_title['Hanafi mother and daughter need radd']['proof']['school_rules'], ['radd'])
        self.assertEqual(by_title['Maliki mother and daughter take radd by the later scholars']['proof']['school_rules'],
                         ['radd_later_scholars'])
        steps = [s['step'] for s in by_title['Husband and two sisters need awl']['proof']['steps']]
        self.assertEqual(steps, ['base', 'awl'])

    def test_labels_follow_the_request_language(self):
        fixture = next(f for f in PREVIEW_FIXTURES if f['title'] == 'Grandfather and brother under Hanafi')
        case = fixture['case']
        live = self.build(case['madhab'], case['deceased']['gender'], case['deceased']['estate'],
                          [heir['relationship'] for heir in case['heirs']])
        english = self.preview(live['id'], headers={'Accept-Language': 'en'}).json()['proof']
        arabic = self.preview(live['id'], headers={'Accept-Language': 'ar'}).json()['proof']
        french = self.preview(live['id'], HTTP_ACCEPT_LANGUAGE='fr').json()['proof']
        for other in (arabic, french):
            self.assertEqual([(e['heir'], e['rule'], e['school_rule']) for e in other['heirs']],
                             [(e['heir'], e['rule'], e['school_rule']) for e in english['heirs']])
            self.assertEqual(other['school_rules'], english['school_rules'])
            self.assertNotEqual(other['school_rule_labels'], english['school_rule_labels'])
            for mine, theirs in zip(other['heirs'], english['heirs']):
                self.assertNotEqual(mine['labels']['rule'], theirs['labels']['rule'])
        self.assertTrue(any('؀' <= ch <= 'ۿ' for ch in arabic['school_rule_labels'][0]))
        self.assertEqual(english['school_rule_labels'],
                         ['Hanafi school: the grandfather blocks the full and paternal siblings'])

    def test_the_later_scholars_label_is_translated(self):
        fixture = next(f for f in PREVIEW_FIXTURES
                       if f['title'] == 'Maliki mother and daughter take radd by the later scholars')
        case = fixture['case']
        live = self.build(case['madhab'], case['deceased']['gender'], case['deceased']['estate'],
                          [heir['relationship'] for heir in case['heirs']])
        arabic = self.preview(live['id'], headers={'Accept-Language': 'ar'}).json()['proof']
        self.assertEqual(arabic['school_rules'], ['radd_later_scholars'])
        self.assertTrue(any('؀' <= ch <= 'ۿ' for ch in arabic['school_rule_labels'][0]))

    def test_a_refused_case_has_no_proof(self):
        for title in ('Jafari is not supported', 'Impossible family'):
            response = next(f['response'] for f in PREVIEW_FIXTURES if f['title'] == title)
            self.assertEqual(response['status'], 'unavailable')
            self.assertNotIn('proof', response)

    def test_the_matrix_answers(self):
        by_title = {fixture['title']: fixture['response'] for fixture in PREVIEW_FIXTURES}
        self.assertEqual(by_title['Hanbali wife and son with an estate']['shares'][0]['amount'], '1000.00')
        self.assertEqual(by_title['Hanbali wife and son without an estate']['shares'][1]['amount'], None)
        self.assertEqual(by_title['Wife alone leaves an unallocated remainder']['unallocated'],
                         {'numerator': 3, 'denominator': 4})
        self.assertEqual(by_title['Two wives and a son, rounded half up']['shares'][0]['amount'], '0.63')
        self.assertEqual(by_title['Impossible family']['reason'], 'invalid_family')
        reasons = {response.get('reason') for response in by_title.values()} - {None}
        self.assertEqual(reasons | {'manasikhat_unsupported'}, set(CONTRACT['previewReasons']))

    def test_the_contract_lists_every_reason_the_engine_can_give(self):
        from calc import schools
        self.assertEqual(set(CONTRACT['previewReasons']), {*schools.REASONS, *schools.LAYERED_REASONS, 'invalid_family'})

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

    def test_not_ready_until_the_case_has_a_deceased_and_an_heir(self):
        case = self.start()
        self.assertEqual(self.not_ready_body(case['id']), {'status': 'not_ready'})
        self.send('patch', CASE_URL, {'case_id': case['id'], 'madhab': 'hanbali'})
        self.assertEqual(self.not_ready_body(case['id']), {'status': 'not_ready'})
        self.deceased(case)
        self.assertEqual(self.not_ready_body(case['id']), {'status': 'not_ready'})
        self.heir(case, 'son')
        self.assertEqual(self.preview(case['id']).json()['status'], 'available')

    def test_a_case_with_no_school_is_ready_without_one(self):
        case = self.start()
        self.deceased(case)
        self.assertEqual(self.not_ready_body(case['id']), {'status': 'not_ready'})
        self.heir(case, 'son')
        body = self.preview(case['id']).json()
        self.assertEqual((body['status'], body['madhab'], body['agreement']), ('available', None, 'all'))
        self.assertIsNone(body['basis']['madhab'])

    def test_agreement_needs_every_school_to_give_the_same_fractions_and_flags(self):
        from api import preview
        live = self.build(None, 'male', '9000', ['wife', 'son', 'daughter'])
        bodies = preview.compare(self.live())
        self.assertEqual({b['status'] for b in bodies.values()}, {'available'})
        self.assertEqual(len({repr(preview._signature(b)) for b in bodies.values()}), 1)
        # One school moving a single fraction breaks the agreement.
        moved = {**bodies['hanafi'], 'shares': [{**bodies['hanafi']['shares'][0], 'denominator': 7}]
                 + bodies['hanafi']['shares'][1:]}
        self.assertNotEqual(preview._signature(moved), preview._signature(bodies['hanbali']))
        flagged = {**bodies['hanafi'], 'shares': [{**bodies['hanafi']['shares'][0], 'blocked': True}]
                   + bodies['hanafi']['shares'][1:]}
        self.assertNotEqual(preview._signature(flagged), preview._signature(bodies['hanbali']))
        self.assertEqual(live['madhab'], None)

    def test_differing_schools_ask_for_a_choice_and_name_the_rules(self):
        live = self.build(None, 'male', None, ['grandfather', 'brother'])
        body = self.preview(live['id'], headers={'Accept-Language': 'en'}).json()
        self.assertEqual(body['status'], 'choose_school')
        self.assertIsNone(body['basis']['madhab'])
        self.assertEqual(list(body['schools']), ['hanafi', 'maliki', 'shafii', 'hanbali'])
        self.assertEqual([r['code'] for r in body['rules']],
                         ['grandfather_blocks_siblings', 'grandfather_shares_with_siblings'])
        self.assertTrue(all(r['label'] for r in body['rules']))
        self.assertEqual({k: v['madhab'] for k, v in body['schools'].items()},
                         {k: k for k in body['schools']})
        arabic = self.preview(live['id'], headers={'Accept-Language': 'ar'}).json()
        self.assertTrue(any('؀' <= ch <= 'ۿ' for ch in arabic['rules'][0]['label']))
        self.assertNotIn('shares', body)

    def test_choose_school_carries_a_list_of_rules_even_when_no_rule_differs(self):
        from api import preview
        live = self.build(None, 'male', None, ['wife', 'son'])
        case = self.live()
        real = preview._single({**case, 'madhab': 'hanbali'})

        def body(school, numerator):
            share = {**real['shares'][0], 'numerator': numerator, 'denominator': 8}
            return {**real, 'madhab': school, 'shares': [share] + real['shares'][1:]}

        bodies = {'hanafi': body('hanafi', 1), 'maliki': body('maliki', 2),
                  'shafii': body('shafii', 1), 'hanbali': body('hanbali', 1)}
        for entry in bodies.values():
            entry['proof'] = {**entry['proof'], 'school_rules': []}
        with mock.patch.object(preview, 'compare', return_value=bodies):
            answer = preview.preview(case)
        self.assertEqual(answer['status'], 'choose_school')
        self.assertEqual(answer['rules'], [])
        self.assertEqual(list(answer['schools']), ['hanafi', 'maliki', 'shafii', 'hanbali'])
        self.assertIsNotNone(live)

    def test_a_refusal_from_any_school_means_the_schools_differ(self):
        fixture = next(f for f in PREVIEW_FIXTURES if f['title'] == 'Maliki Malikiyya is refused')
        case = fixture['case']
        live = self.build(None, case['deceased']['gender'], None, [h['relationship'] for h in case['heirs']])
        body = self.preview(live['id'], headers={'Accept-Language': 'en'}).json()
        self.assertEqual(body['status'], 'choose_school')
        self.assertEqual(body['schools']['maliki']['status'], 'unavailable')
        self.assertEqual(body['schools']['maliki']['reason'], 'malikiyya_disputed')
        self.assertEqual(body['schools']['hanafi']['status'], 'available')
        self.assertIn('malikiyya_disputed', [r['code'] for r in body['rules']])

    def test_a_refusal_every_school_shares_is_not_a_choice(self):
        live = self.build(None, 'male', None, ['wife'] * 5)
        body = self.preview(live['id']).json()
        self.assertEqual((body['status'], body['madhab'], body['reason']), ('unavailable', None, 'invalid_family'))

    def test_layered_cases_compare_the_final_shares_of_the_whole_chain(self):
        from api import preview
        agree = next(f for f in PREVIEW_FIXTURES if f['title'] == 'Agree layered: wife and two sons, a son dies')
        self.assertEqual(agree['response']['agreement'], 'all')
        self.assertIsNone(agree['response']['madhab'])
        self.assertEqual(agree['response']['proof']['version'], 2)
        differ = copy.deepcopy(agree['case'])
        differ['deaths'][0]['heirs'] = [
            {'id': 'r1', 'relationship': 'grandfather', 'gender': 'male', 'name': None},
            {'id': 'r2', 'relationship': 'brother', 'gender': 'male', 'name': None}]
        body = preview.preview(differ)
        self.assertEqual(body['status'], 'choose_school')
        self.assertIn('grandfather_blocks_siblings', [r['code'] for r in body['rules']])

    def test_a_school_always_wins_over_the_comparison(self):
        live = self.build('hanafi', 'male', None, ['grandfather', 'brother'])
        body = self.preview(live['id']).json()
        self.assertEqual((body['status'], body['madhab']), ('available', 'hanafi'))
        self.assertNotIn('agreement', body)
        live = self.build('hanbali', 'male', None, ['wife', 'son'])
        self.assertNotIn('agreement', self.preview(live['id']).json())

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
                self.assertEqual(body.pop('presented')['state'], 'refused')
                self.assertEqual(legacy_fields(body), {'status': 'unavailable', 'madhab': 'hanbali', 'reason': 'invalid_family'})
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
            'grandfather': 'GrandFather', 'paternal_grandmother': 'GrandMother',
            'maternal_grandmother': 'MaternalGrandMother', 'brother': 'Brother',
            'sister': 'Sister', 'paternal_brother': 'PaternalBrother', 'paternal_sister': 'PaternalSister',
            'maternal_brother': 'MaternalBrother', 'maternal_sister': 'MaternalSister',
            'son_of_brother': 'SonOfBrother', 'son_of_paternal_brother': 'SonOfPaternalBrother',
            'uncle': 'Uncle', 'paternal_uncle': 'PaternalUncle', 'son_of_uncle': 'SonOfUncle',
            'son_of_paternal_uncle': 'SonOfPaternalUncle',
        }
        self.assertEqual(len(literal), 23)
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
            ('maliki', 'female', None, ['husband', 'mother', 'grandfather', 'maternal_brother', 'maternal_brother', 'paternal_brother']),
            ('hanafi', 'male', None, ['father', 'paternal_grandmother']),
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
        live = self.build('hanbali', 'male', None, ['son'])
        with mock.patch('api.preview.evaluate_outcome', side_effect=RuntimeError('boom')):
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
        from presentation import outcome
        seen = []

        def spy(family, resolved):
            seen.append((resolved.school, [(p.name, p.gender) for p in family.persons]))
            return outcome(family, resolved)

        live = self.build('hanafi', 'male', '12345.67', ['wife', 'son'], names=['Secret Wife', 'Secret Son'])
        with mock.patch('api.preview.evaluate_outcome', side_effect=spy):
            response = self.preview(live['id'])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(seen), 1)
        school, people = seen[0]
        self.assertEqual(school, 'hanafi')
        self.assertEqual(sorted(people), [(None, 'female'), (None, 'male')])
        self.assertNotIn('Secret', response.content.decode())

    def test_names_and_amounts_never_reach_the_logs_even_when_the_engine_fails(self):
        handler = RecordingHandler()
        loggers = [logging.getLogger(name) for name in ('', 'api', 'django.request')]
        levels = [logger.level for logger in loggers]
        for logger in loggers:
            logger.addHandler(handler)
            logger.setLevel(logging.DEBUG)
        try:
            live = self.build('hanbali', 'male', '987654.32', ['son'], names=['Secret Name'])
            with mock.patch('api.preview.evaluate_outcome', side_effect=RuntimeError('Secret Name 987654.32')):
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


class HeirRulesEngine:
    """Holds the pure rules to the engine's own blocked flags."""

    @staticmethod
    def engine_blocked(madhab, gender, family, candidates):
        """Which of `candidates` the engine blocks when each joins `family` (a list of
        relationships) on its own, as {candidate: blocked}.

        The family is built once and each candidate is tried in a savepoint that is rolled
        back, so the family returns to its stored state before the next one. `get_quotes`
        sets the flags without distributing, so a family the radd refuses still answers.
        Set the school and clear first, as `compute` does.
        """
        from django.db import transaction
        from calc.models import Calculation as EngineCalculation, Deceased, Heir
        from api.preview import HEIR_CLASSES, SEX
        answers = {}
        with transaction.atomic():
            try:
                calc = EngineCalculation.objects.create(name='')
                Deceased.objects.create(sex=SEX[gender], estate=1, calc=calc)
                for relationship in family:
                    HEIR_CLASSES[relationship].objects.create(
                        sex=SEX[anonymous_case.RELATIONSHIPS[relationship]], calc=calc)
                for candidate in candidates:
                    with transaction.atomic():
                        try:
                            last = HEIR_CLASSES[candidate].objects.create(
                                sex=SEX[anonymous_case.RELATIONSHIPS[candidate]], calc=calc)
                            calc.madhab = madhab
                            calc.clear()
                            calc.get_quotes()
                            blocked = Heir.objects.get(pk=last.pk).blocked
                            answers[candidate] = blocked or (
                                candidate in ('paternal_brother', 'paternal_sister')
                                and calc.paternal_siblings_counted_out())
                        finally:
                            transaction.set_rollback(True)
            finally:
                transaction.set_rollback(True)
        return answers

    @staticmethod
    def counts(family):
        return heir_rules.counts({'relationship': name} for name in family)

    def assert_agrees(self, madhab, family, candidates, genders=('female', 'male')):
        blocked = heir_rules.blocked_relationships(madhab, self.counts(family))
        for gender in genders:
            engine = self.engine_blocked(madhab, gender, family, candidates)
            for candidate in candidates:
                with self.subTest(madhab=madhab, gender=gender, family=family, candidate=candidate):
                    self.assertEqual(candidate in blocked, engine[candidate])


@tag('slow')
class HeirRulesSingleHeirSweepTests(HeirRulesEngine, TransactionTestCase):
    """The rules equal the engine for every single-heir family."""

    def test_rules_equal_the_engine_for_every_single_heir_family_under_every_sunni_school(self):
        relationships = list(anonymous_case.RELATIONSHIPS)
        for madhab in schools.SUNNI:
            self.assert_agrees(madhab, [], relationships)
            for existing in relationships:
                self.assert_agrees(madhab, [existing], relationships)


@tag('slow', 'slow_b')
class HeirRulesSeededSweepTests(HeirRulesEngine, TransactionTestCase):
    """The rules equal the engine for a seeded sample of larger families."""

    def test_rules_equal_the_engine_for_a_seeded_sample_of_larger_families(self):
        rng = random.Random(16_2026)
        relationships = list(anonymous_case.RELATIONSHIPS)
        for madhab in schools.SUNNI:
            for _ in range(300):
                family = [rng.choice(relationships) for _ in range(rng.randint(2, 7))]
                self.assert_agrees(
                    madhab, family, rng.sample(relationships, 4), genders=(rng.choice(('female', 'male')),))


@tag('slow', 'slow_b')
class HeirRulesDirectedSweepTests(HeirRulesEngine, TransactionTestCase):
    """The rules equal the engine for directed families."""

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
            ['grandfather', 'brother'],
            ['daughter', 'grandfather', 'sister'],
            ['daughter_of_son', 'grandfather', 'sister', 'sister'],
            ['daughter', 'grandfather', 'sister', 'paternal_sister'],
            ['grandfather', 'sister'],
            ['grandfather', 'sister', 'paternal_brother'],
            ['grandfather', 'father'],
            ['mother', 'paternal_grandmother', 'maternal_sister'],
            ['mother', 'paternal_grandmother', 'maternal_grandmother'],
            ['father', 'paternal_grandmother', 'maternal_grandmother'],
            ['father', 'maternal_grandmother'],
            ['grandfather', 'paternal_grandmother', 'maternal_grandmother'],
            ['paternal_grandmother', 'son'],
            ['brother', 'son_of_brother', 'son_of_paternal_brother', 'uncle'],
            ['paternal_brother', 'son_of_brother', 'paternal_uncle', 'son_of_uncle'],
            ['sister', 'daughter', 'son_of_paternal_brother', 'uncle', 'paternal_uncle'],
        ]
        for madhab in schools.SUNNI:
            for family in families:
                self.assert_agrees(madhab, family, relationships)


class HeirRulesTests(HeirRulesEngine, TransactionTestCase):
    """The pure rules, held to the engine's own blocked flags."""

    def test_the_documented_cases(self):
        hanbali, hanafi = 'hanbali', 'hanafi'
        self.assertTrue(heir_rules.blocked_relationships(hanbali, {'father': 1}) >= {'brother', 'sister', 'grandfather'})
        self.assertNotIn('brother', heir_rules.blocked_relationships(hanbali, {'grandfather': 1}))
        self.assertIn('brother', heir_rules.blocked_relationships(hanafi, {'grandfather': 1}))
        paternal = {'paternal_brother', 'paternal_sister'}
        for madhab in ('hanbali', 'maliki', 'shafii'):
            self.assertTrue(paternal <= heir_rules.blocked_relationships(madhab, {'grandfather': 1, 'brother': 1}))
            self.assertTrue(paternal <= heir_rules.blocked_relationships(
                madhab, {'daughter': 1, 'grandfather': 1, 'sister': 1}))
            self.assertTrue(paternal <= heir_rules.blocked_relationships(
                madhab, {'daughter_of_son': 1, 'grandfather': 1, 'sister': 2}))
        ashariyya = heir_rules.blocked_relationships(hanbali, {'grandfather': 1, 'sister': 1})
        self.assertFalse(paternal & ashariyya)
        self.assertIn('daughter_of_son', heir_rules.blocked_relationships(hanbali, {'daughter': 2}))
        self.assertNotIn(
            'daughter_of_son', heir_rules.blocked_relationships(hanbali, {'daughter': 2, 'son_of_son': 1}))
        self.assertEqual(heir_rules.blocked_relationships('jafari', {'father': 1}), set())
        self.assertEqual(heir_rules.blocked_relationships(None, {'father': 1}), set())

    def test_kinship_codes(self):
        for relationship, code in (
                ('father', 'second_father'), ('mother', 'second_mother'),
                ('husband', 'second_husband'), ('grandfather', 'second_grandfather'),
                ('paternal_grandmother', 'second_paternal_grandmother'),
                ('maternal_grandmother', 'second_maternal_grandmother')):
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
        self.assertEqual(set(codes['relationship']), set(heir_rules.RELATIONSHIP_CODES) | {'required', 'invalid', 'gender_locked', 'lineage_locked'})
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


class HeirRulesApiTests(InterviewHelpers, TransactionTestCase):
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

    def test_edit_options_on_each_heir_equal_heir_options_computed_without_that_heir(self):
        for relationship in ('father', 'mother', 'son', 'daughter', 'brother'):
            self.add(relationship)
        case = self.live()
        madhab = case['madhab']
        deceased = case['deceased']
        heirs = case['heirs']
        for heir in heirs:
            others = [h for h in heirs if h['id'] != heir['id']]
            expected = anonymous_case.heir_options(madhab, deceased, others)
            self.assertEqual(heir['edit_options'], expected, heir['relationship'])
        # edit_options must not be stored in the session.
        self.assertNotIn('edit_options', self.stored()['heirs'][0])

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
                                   ('grandfather', 'second_grandfather'),
                                   ('paternal_grandmother', 'second_paternal_grandmother'),
                                   ('maternal_grandmother', 'second_maternal_grandmother')):
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
                                   ('grandfather', 'second_grandfather'),
                                   ('paternal_grandmother', 'second_paternal_grandmother'),
                                   ('maternal_grandmother', 'second_maternal_grandmother')):
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

    def test_grandmother_is_an_alias_of_the_paternal_grandmother(self):
        response = self.add('grandmother', name='Amal')
        self.assertEqual(response.status_code, 201)
        heir = response.json()['case']['heirs'][0]
        self.assertEqual((heir['relationship'], heir['gender']), ('paternal_grandmother', 'female'))
        self.assertEqual(self.stored()['heirs'][0]['relationship'], 'paternal_grandmother')
        # the alias meets the same limit as the new id, in both directions
        self.assertEqual(self.errors(self.add('grandmother')), {'relationship': 'second_paternal_grandmother'})
        self.assertEqual(self.errors(self.add('paternal_grandmother')),
                         {'relationship': 'second_paternal_grandmother'})
        self.assertEqual(self.add('maternal_grandmother').status_code, 201)
        # an edit by the alias, and a rename that keeps it
        other = self.add('son').json()['case']['heirs'][2]['id']
        self.assertEqual(self.errors(self.edit(other, 'grandmother')),
                         {'relationship': 'second_paternal_grandmother'})
        self.assertEqual(self.edit(heir['id'], 'grandmother', name='Renamed').status_code, 200)
        self.assertEqual(self.stored()['heirs'][0]['relationship'], 'paternal_grandmother')

    def test_a_stored_grandmother_is_read_labelled_and_previewed_as_the_paternal_one(self):
        self.fresh(madhab='hanafi')
        self.plant(heirs=[
            {'id': 'old', 'relationship': 'grandmother', 'gender': 'female', 'name': None},
            {'id': 'dad', 'relationship': 'father', 'gender': 'male', 'name': None},
        ])
        live = self.live()
        self.assertEqual([h['relationship'] for h in live['heirs']], ['paternal_grandmother', 'father'])
        self.assertEqual(live['heirs'][0]['gender'], 'female')
        self.assertEqual(live['heir_options']['invalid']['paternal_grandmother'], 'second_paternal_grandmother')
        self.assertNotIn('maternal_grandmother', live['heir_options']['blocked'])
        body = self.preview_body()
        self.assertEqual(body['status'], 'available')
        self.assertEqual(body['basis']['heirs'][0], {'id': 'old', 'relationship': 'paternal_grandmother'})
        shares = {share['heir_id']: (share['numerator'], share['denominator']) for share in body['shares']}
        self.assertEqual(shares, {'old': (0, 1), 'dad': (1, 1)})

    def test_the_paternal_grandmother_is_labelled_blocked_by_school(self):
        for madhab, labelled in (('hanafi', True), ('maliki', True), ('shafii', True), ('hanbali', False)):
            with self.subTest(madhab):
                self.fresh(madhab=madhab)
                self.add('father')
                blocked = self.live()['heir_options']['blocked']
                self.assertEqual('paternal_grandmother' in blocked, labelled)
                self.assertNotIn('maternal_grandmother', blocked)
        self.add('mother')
        self.assertIn('maternal_grandmother', self.live()['heir_options']['blocked'])

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
            DECEASED_URL, {'case_id': case['id'], 'gender': 'male', 'expected_revision': 1}, format='json', secure=True, headers=headers)
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

        revision = self.stored()['revision']

        def add(client, relationship, expected):
            # The second tab names the revision the first one's save will produce.
            return lambda: client.post(
                HEIRS_URL, {'case_id': case['id'], 'relationship': relationship, 'expected_revision': expected},
                format='json', secure=True, headers=headers)

        with self.hold_first():
            first, second = self.run_pair(add(self.client, 'son', revision), add(other, 'daughter', revision + 1))

        self.assertEqual((first.status_code, second.status_code), (201, 201))
        self.assertEqual(
            sorted(heir['relationship'] for heir in self.stored()['heirs']), ['daughter', 'son'])
        self.assertEqual(self.stored()['revision'], revision + 2)

    def test_heir_add_and_madhab_change_both_persist(self):
        headers = self.headers()
        case = self.with_deceased(headers)
        other = self.twin()
        revision = self.stored()['revision']

        with self.hold_first():
            first, second = self.run_pair(
                lambda: self.client.post(
                    HEIRS_URL, {'case_id': case['id'], 'relationship': 'son', 'expected_revision': revision},
                    format='json', secure=True, headers=headers),
                lambda: other.patch(
                    CASE_URL, {'case_id': case['id'], 'madhab': 'hanafi', 'expected_revision': revision + 1},
                    format='json',
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
                    DECEASED_URL, {'case_id': case['id'], 'gender': 'male', 'expected_revision': 1},
                    format='json', secure=True, headers=headers),
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
                    CASE_URL, {'case_id': case['id'], 'madhab': 'hanafi', 'expected_revision': 1},
                    format='json', secure=True, headers=headers),
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
            CASE_URL, {'case_id': case['id'], 'madhab': 'hanafi', 'expected_revision': 1}, format='json',
            secure=True, headers=headers)
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
            DECEASED_URL, {'case_id': fresh.json()['case']['id'], 'gender': 'male', 'expected_revision': 1},
            format='json',
            secure=True, headers=headers)
        self.assertEqual(after.status_code, 200)


DEATHS_URL = '/api/v1/case/deaths/'


class InterviewDeathsHelpers:
    """Shared interview-death helpers; holds no tests so subclasses do not re-run them."""
    build = PreviewTests.build
    put_heirs = PreviewTests.put_heirs
    preview = PreviewTests.preview
    rows = PreviewTests.rows
    # Exercise layered mutations through the same public API as the interview.
    def setup_family(self):
        case = self.build('hanbali', 'male', None, ['wife', 'son', 'son'], ['W', 'S1', 'S2'])
        self.case_id = case['id']
        self.w, self.s1, self.s2 = [r['id'] for r in case['heirs']]
        return case

    def mark(self, person, **extra):
        return self.send('post', DEATHS_URL, {'case_id': self.case_id, 'heir_id': person, **extra})

    def add_layer(self, layer, relationship, **extra):
        return self.send('post', HEIRS_URL, {'case_id': self.case_id, 'layer': layer,
                                           'relationship': relationship, **extra})

    def two(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1).status_code, 201)
        self.assertEqual([(r['relationship'], r['same_as']) for r in self.live()['deaths'][0]['heirs']],
                         [('mother', self.w), ('brother', self.s2)])

    def refused(self, response, errors, before):
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['errors'], errors)
        self.assertEqual(self.stored(), before)
        for field, code in errors.items():
            self.assertIn(code, CONTRACT['errorCodes'][field])



class InterviewDeathsTests(InterviewDeathsHelpers, InterviewHelpers, TransactionTestCase):
    def test_write_matrix_and_rollback(self):
        self.two()
        counts = self.rows()
        body = self.preview(self.case_id).json()
        self.assertEqual([(r['numerator'], r['denominator']) for r in body['shares']], [(13, 48), (35, 48)])
        self.assertEqual(self.rows(), counts)
        self.assertEqual(self.mark(self.w).status_code, 201)
        self.assertTrue(any(r.get('same_as') == self.s2 for r in self.live()['deaths'][1]['heirs']))
        self.assertEqual(self.add_layer(self.w, 'mother', name='M').status_code, 201)
        body = self.preview(self.case_id).json()
        self.assertEqual([(r['numerator'], r['denominator']) for r in body['shares']], [(275, 288), (13, 288)])
        self.assertEqual(body['proof']['version'], 2)
        self.assertEqual([layer['heir'] for layer in body['proof']['layers']],
                         [None] + [d['heir_id'] for d in self.live()['deaths']])
        before = self.stored()
        self.refused(self.mark(self.s2), {'death': 'limit'}, before)
        self.refused(self.mark(self.w), {'death': 'already_deceased'}, before)
        self.assertEqual(self.rows(), counts)

    def put_relationship(self, heir_id, relationship):
        return self.send('put', HEIRS_URL + heir_id + '/',
                         {'case_id': self.case_id, 'relationship': relationship})

    def assert_locked_options(self, row, gender):
        from api.anonymous_case import RELATIONSHIPS
        options = row['edit_options']
        opposite = {r for r, g in RELATIONSHIPS.items() if g != gender}
        self.assertEqual({r for r, c in options['invalid'].items() if c == 'gender_locked'}, opposite)
        self.assertFalse(opposite & set(options['blocked']))
        self.assertFalse(set(options['blocked']) & set(options['invalid']))
        for relationship in RELATIONSHIPS:
            response = self.put_relationship(row['id'], relationship)
            self.assertIn(response.status_code, (200, 400), relationship)
            errors = response.json().get('errors', {}) if response.status_code == 400 else {}
            self.assertEqual(errors.get('relationship') == 'gender_locked', relationship in opposite, relationship)

    def test_edit_options_respect_locked_gender(self):
        self.two()
        # S2 is linked into the later estate as a brother, so S2 and the alias are male-locked.
        self.assert_locked_options(next(r for r in self.live()['heirs'] if r['id'] == self.s2), 'male')
        self.assert_locked_options(
            next(r for r in self.live()['deaths'][0]['heirs'] if r.get('same_as') == self.s2), 'male')
        # W is linked as the mother (female), and S1 is the later deceased (male).
        self.assert_locked_options(next(r for r in self.live()['heirs'] if r['id'] == self.w), 'female')
        self.assert_locked_options(next(r for r in self.live()['heirs'] if r['id'] == self.s1), 'male')
        # Case-level add options are unchanged by locks.
        self.assertFalse(any(c == 'gender_locked' for c in self.live()['heir_options']['invalid'].values()))

    def test_edit_options_unlocked_unchanged(self):
        self.setup_family()
        case = self.live()
        for row in case['heirs']:
            self.assertNotIn('gender_locked', row['edit_options']['invalid'].values())
        self.assertEqual(self.put_relationship(self.s1, 'daughter').status_code, 200)

    def test_order_answers_and_conflicts(self):
        for answer, code in ((None, 'order_required'), ('unknown', 'unknown'),
                             ('simultaneous', 'simultaneous'), ('missing', 'order_conflict')):
            self.setup_family()
            self.mark(self.s1)
            sibling = self.live()['deaths'][0]['heirs'][1]['id']
            self.send('delete', HEIRS_URL + sibling + '/', {'case_id': self.case_id})
            before = self.stored()
            extra = {} if answer is None else {'first': answer}
            self.refused(self.mark(self.s2, **extra), {'death': code}, before)
        self.assertEqual(self.mark(self.s2, first=self.s2).status_code, 201)
        self.assertEqual([d['heir_id'] for d in self.live()['deaths']], [self.s2, self.s1])
        self.two()
        before = self.stored()
        self.refused(self.mark(self.w, first=self.w), {'death': 'order_conflict'}, before)

    def test_links_and_all_field_errors(self):
        self.setup_family()
        self.mark(self.s1)
        before = self.stored()
        self.refused(self.add_layer(self.s1, 'father', same_as=self.w), {'same_as': 'already_linked'}, before)
        self.refused(self.add_layer(self.s1, 'brother', same_as=self.s1), {'same_as': 'not_alive'}, before)
        self.refused(self.add_layer(self.s1, 'mother', same_as='missing', name=12),
                     {'relationship': 'second_mother', 'same_as': 'not_alive', 'name': 'invalid'}, before)
        self.add_layer(self.s1, 'mother', same_as=self.w)
        before = self.stored()
        self.refused(self.add_layer(self.s1, 'sister', same_as=self.w), {'same_as': 'already_linked'}, before)
        self.refused(self.add_layer(self.s1, 'mother', same_as=self.w),
                     {'relationship': 'second_mother', 'same_as': 'already_linked'}, before)
        self.refused(self.send('put', HEIRS_URL + self.w + '/',
                     {'case_id': self.case_id, 'relationship': 'son'}), {'relationship': 'gender_locked'}, before)
        self.refused(self.send('put', HEIRS_URL + self.s1 + '/',
                     {'case_id': self.case_id, 'relationship': 'daughter'}), {'relationship': 'gender_locked'}, before)
        self.mark(self.s2)
        before = self.stored()
        self.refused(self.add_layer(self.s2, 'brother', same_as=self.s1), {'same_as': 'not_alive'}, before)

    def test_promote_remove_and_unmark(self):
        self.two()
        self.mark(self.w)
        self.add_layer(self.w, 'son', same_as=self.s2)
        before = self.live()
        mother = before['deaths'][0]['heirs'][0]['id']
        self.assertEqual(self.send('delete', HEIRS_URL + self.w + '/', {'case_id': self.case_id}).status_code, 200)
        case = self.live()
        self.assertEqual(case['deaths'][1]['heir_id'], mother)
        self.assertEqual(case['deaths'][0]['heirs'][0]['name'], 'W')
        self.assertNotIn('same_as', case['deaths'][0]['heirs'][0])
        self.assertEqual(self.preview(self.case_id).status_code, 200)
        self.send('delete', DEATHS_URL + self.s1 + '/', {'case_id': self.case_id, 'confirm_cascade': 'true'})
        self.assertEqual(self.live()['deaths'], [])
        for row in self.live()['heirs']:
            self.assertNotIn('gender_locked', row['edit_options']['invalid'].values())
        self.two()
        self.mark(self.w)
        self.send('delete', HEIRS_URL + self.s1 + '/', {'case_id': self.case_id, 'confirm_cascade': 'true'})
        self.assertEqual(len(self.live()['deaths']), 1)
        self.assertEqual(self.live()['deaths'][0]['order'], 2)
        self.assertEqual(self.live()['deaths'][0]['heir_id'], self.w)

    def test_blocked_heir_and_per_layer_kinship(self):
        self.setup_family()
        case = self.heir(self.live(), 'brother').json()['case']
        brother = case['heirs'][-1]['id']
        self.assertEqual(self.mark(brother).status_code, 201)
        self.add_layer(brother, 'wife')
        before = self.stored()
        self.refused(self.add_layer(brother, 'husband', name=17),
                     {'relationship': 'husband_of_male', 'name': 'invalid'}, before)
        self.assertIn('husband', self.live()['deaths'][0]['heir_options']['invalid'])

    def test_refused_layers_and_tampering(self):
        self.two()
        self.send('patch', CASE_URL, {'case_id': self.case_id, 'madhab': 'jafari'})
        body = self.preview(self.case_id).json()
        self.assertEqual(body['status'], 'unavailable')
        self.assertNotIn('shares', body)
        good = self.live()['deaths']
        for deaths in ([{'heir_id': [], 'order': 2}],
                       [{'heir_id': 'missing', 'order': 2}],
                       [good[0], good[0]],
                       [{'heir_id': self.s1, 'order': 2, 'heirs': [
                           {'id': 'a', 'relationship': 'mother', 'same_as': 'b'},
                           {'id': 'b', 'relationship': 'mother', 'same_as': 'a'}]}],
                       [{'heir_id': self.s1, 'order': 2, 'heirs': None}],
                       # Two deaths claiming one order.
                       [{'heir_id': self.s1, 'order': 2, 'heirs': []},
                        {'heir_id': self.s2, 'order': 2, 'heirs': []}],
                       # A link to a row of a later layer.
                       [{'heir_id': self.s1, 'order': 2, 'heirs': [
                           {'id': 'early', 'relationship': 'mother', 'same_as': 'late'}]},
                        {'heir_id': self.s2, 'order': 3, 'heirs': [
                           {'id': 'late', 'relationship': 'mother', 'same_as': self.w}]}]):
            self.plant(deaths=deaths)
            self.assertEqual(self.preview(self.case_id).status_code, 200)
            case = self.live()
            self.assertEqual([d['order'] for d in case['deaths']],
                             list(range(2, 2 + len(case['deaths']))))
            rows = {r['id'] for r in case['heirs']}
            for death in case['deaths']:
                for row in death['heirs']:
                    if 'same_as' in row:
                        self.assertIn(row['same_as'], rows)
                rows |= {r['id'] for r in death['heirs']}

    def test_maliki_layer_refusal_rolls_everything_back(self):
        case = self.build('maliki', 'male', None, ['daughter'])
        self.case_id = case['id']
        daughter = case['heirs'][0]['id']
        self.mark(daughter)
        for relationship in ('husband', 'mother', 'grandfather', 'maternal_brother',
                             'maternal_brother', 'paternal_brother'):
            self.assertEqual(self.add_layer(daughter, relationship).status_code, 201)
        before = self.rows()
        body = self.preview(self.case_id).json()
        self.assertEqual(body['reason'], 'malikiyya_disputed')
        self.assertNotIn('shares', body)
        self.assertEqual(self.rows(), before)

    def test_unknown_or_simultaneous_first_mark_is_refused(self):
        self.setup_family()
        for code in ('unknown', 'simultaneous'):
            before = self.stored()
            self.refused(self.mark(self.s1, first=code), {'death': code}, before)

    def test_links_normalize_and_follow_a_promoted_row(self):
        self.two()
        self.assertEqual(self.mark(self.s2).status_code, 201)
        self.assertEqual(self.live()['deaths'][1]['heirs'][0]['same_as'], self.w)
        case = self.live()
        mother = case['deaths'][0]['heirs'][0]['id']
        self.send('delete', HEIRS_URL + self.w + '/', {'case_id': self.case_id})
        case = self.live()
        self.assertEqual(case['deaths'][1]['heirs'][0]['same_as'], mother)
        self.assertEqual(case['deaths'][1]['heirs'][0]['name'], 'W')
        self.assertEqual(self.preview(self.case_id).status_code, 200)
        self.two()
        self.mark(self.w)
        linked_son = self.live()['deaths'][0]['heirs'][1]['id']
        automatic_son = self.live()['deaths'][1]['heirs'][0]['id']
        self.send('delete', HEIRS_URL + automatic_son + '/', {'case_id': self.case_id})
        self.assertEqual(self.add_layer(self.w, 'son', same_as=linked_son).status_code, 201)
        self.assertEqual(self.live()['deaths'][1]['heirs'][0]['same_as'], self.s2)

    def test_person_introduced_in_a_later_layer_can_die(self):
        self.two()
        self.add_layer(self.s1, 'wife', name='New person')
        person = self.live()['deaths'][0]['heirs'][-1]['id']
        self.assertEqual(self.mark(person).status_code, 201)
        self.assertEqual(self.live()['deaths'][1]['heir_id'], person)
        self.add_layer(person, 'son')
        son = self.live()['deaths'][1]['heirs'][0]['id']
        body = self.preview(self.case_id).json()
        self.assertEqual(body['status'], 'available')
        self.assertEqual({r['heir_id']: (r['numerator'], r['denominator']) for r in body['shares']},
                         {self.w: (13, 48), self.s2: (119, 192), son: (7, 64)})
        self.send('delete', HEIRS_URL + self.s1 + '/', {'case_id': self.case_id, 'confirm_cascade': 'true'})
        self.assertEqual(self.live()['deaths'], [])

    def test_layered_engine_reason_is_preserved_without_numbers(self):
        self.two()
        before = self.rows()
        from presentation import refused_outcome
        with mock.patch('api.preview.evaluate_outcome', side_effect=lambda family, resolved: refused_outcome(
                family, resolved, schools.MANASIKHAT_UNSUPPORTED)):
            body = self.preview(self.case_id).json()
        self.assertEqual(body['reason'], 'manasikhat_unsupported')
        self.assertNotIn('shares', body)
        self.assertEqual(self.rows(), before)

    def test_unmark_promotes_a_person_introduced_in_the_removed_layer(self):
        self.two()
        self.add_layer(self.s1, 'wife', name='Surviving name')
        wife = self.live()['deaths'][0]['heirs'][-1]['id']
        self.mark(self.s2)
        self.add_layer(self.s2, 'wife', same_as=wife)
        kept = self.live()['deaths'][1]['heirs'][-1]['id']
        response = self.send('delete', DEATHS_URL + self.s1 + '/', {'case_id': self.case_id})
        self.assertEqual(response.status_code, 200)
        case = self.live()
        row = case['deaths'][0]['heirs'][-1]
        self.assertEqual(row['id'], kept)
        self.assertEqual(row['name'], 'Surviving name')
        self.assertNotIn('same_as', row)
        self.assertEqual(case['deaths'][0]['order'], 2)
        self.assertEqual(self.preview(self.case_id).json()['status'], 'available')

    def test_first_mark_validates_first(self):
        self.setup_family()
        before = self.stored()
        for first in ('missing', self.w, 1, [], {}):
            self.refused(self.mark(self.s1, first=first), {'death': 'order_conflict'}, before)
        self.assertEqual(self.mark(self.s1, first=self.s1).status_code, 201)

    def test_restored_layer_is_capped(self):
        self.setup_family()
        heirs = [{'id': f'tampered-{i}', 'relationship': 'son', 'name': ''}
                 for i in range(anonymous_case.MAX_HEIRS + 1)]
        self.plant(deaths=[{'heir_id': self.s1, 'order': 2, 'heirs': heirs}])
        restored = self.live()['deaths'][0]['heirs']
        self.assertEqual([r['id'] for r in restored], [r['id'] for r in heirs[:anonymous_case.MAX_HEIRS]])
        self.assertEqual(self.preview(self.case_id).status_code, 200)

    def test_layered_amounts_combine_linked_identities(self):
        self.two()
        self.assertEqual(self.deceased(self.live(), estate='4800').status_code, 200)
        body = self.preview(self.case_id).json()
        self.assertEqual([(r['heir_id'], r['amount']) for r in body['shares']],
                         [(self.w, '1300.00'), (self.s2, '3500.00')])

    def test_rename_linked_row_updates_every_identity_row(self):
        self.two()
        self.mark(self.s2)
        self.add_layer(self.s2, 'mother', same_as=self.w)
        linked = self.live()['deaths'][1]['heirs'][0]['id']
        response = self.send('put', HEIRS_URL + linked + '/',
                             {'case_id': self.case_id, 'relationship': 'mother', 'name': 'Renamed'})
        self.assertEqual(response.status_code, 200)
        for case in (response.json()['case'], self.live()):
            rows = case['heirs'] + [r for d in case['deaths'] for r in d['heirs']]
            identity = [r for r in rows if r['id'] == self.w or r.get('same_as') == self.w]
            self.assertEqual(len(identity), 3)
            self.assertEqual([r['name'] for r in identity], ['Renamed'] * 3)


    def link_family(self):
        """A wife and three sons; the first son dies. Returns his id, with an empty later estate."""
        case = self.build('hanbali', 'male', None, ['wife', 'son', 'son', 'son'], ['W1', 'S1', 'S2', 'S3'])
        self.case_id = case['id']
        self.w1, self.s1, self.s2, self.s3 = [r['id'] for r in case['heirs']]
        self.assertEqual(self.mark(self.s1).status_code, 201)
        for row in self.live()['deaths'][0]['heirs']:
            self.send('delete', HEIRS_URL + row['id'] + '/', {'case_id': self.case_id})
        return self.s1

    def later_rows(self):
        return self.live()['deaths'][0]['heirs']

    def put_link(self, row, **fields):
        return self.send('put', HEIRS_URL + row + '/', {'case_id': self.case_id, **fields})

    def test_update_sets_clears_and_retargets_a_link(self):
        layer = self.link_family()
        self.add_layer(layer, 'brother', name='Own name')
        row = self.later_rows()[0]['id']
        revision = self.live()['revision']
        response = self.put_link(row, relationship='brother', name='Ignored', same_as=self.s2)
        self.assertEqual(response.status_code, 200)
        case = response.json()['case']
        self.assertEqual(case['revision'], revision + 1)
        self.assertEqual(case['deaths'][0]['heirs'][0]['same_as'], self.s2)
        self.assertEqual(case['deaths'][0]['heirs'][0]['name'], 'S2')
        self.assertEqual(self.put_link(row, relationship='brother', same_as=self.s3).status_code, 200)
        self.assertEqual(self.later_rows()[0]['same_as'], self.s3)
        self.assertEqual(self.later_rows()[0]['name'], 'S3')
        cleared = self.put_link(row, relationship='brother', same_as=None)
        self.assertEqual(cleared.status_code, 200)
        cleared_row = cleared.json()['case']['deaths'][0]['heirs'][0]
        self.assertNotIn('same_as', cleared_row)
        self.assertIsNone(cleared_row['name'])

    def test_update_without_same_as_leaves_the_link_alone(self):
        layer = self.link_family()
        self.add_layer(layer, 'mother', same_as=self.w1)
        row = self.later_rows()[0]['id']
        self.assertEqual(self.put_link(row, relationship='mother', name='Renamed').status_code, 200)
        self.assertEqual(self.later_rows()[0]['same_as'], self.w1)
        self.assertEqual(self.put_link(row, relationship='mother', same_as=self.w1).status_code, 200)
        self.assertEqual(self.later_rows()[0]['same_as'], self.w1)

    def test_update_link_refusals_change_nothing(self):
        layer = self.link_family()
        self.add_layer(layer, 'mother')
        mother = self.later_rows()[0]['id']
        before = self.stored()
        self.refused(self.put_link(mother, relationship='mother', same_as=self.s2),
                     {'same_as': 'gender_mismatch'}, before)
        self.refused(self.put_link(mother, relationship='mother', same_as=layer), {'same_as': 'not_alive'}, before)
        self.refused(self.put_link(mother, relationship='mother', same_as='missing'),
                     {'same_as': 'not_alive'}, before)
        self.refused(self.put_link(mother, relationship='son', same_as=self.w1),
                     {'same_as': 'gender_mismatch'}, before)
        self.add_layer(layer, 'brother', same_as=self.s2)
        brother = self.add_layer(layer, 'brother', name='New')
        self.assertEqual(brother.status_code, 201)
        before = self.stored()
        self.refused(self.put_link(self.later_rows()[-1]['id'], relationship='brother', same_as=self.s2),
                     {'same_as': 'already_linked'}, before)

    def test_update_link_refuses_a_row_that_is_referenced(self):
        layer = self.link_family()
        self.add_layer(layer, 'brother')
        brother = self.later_rows()[0]['id']
        self.assertEqual(self.mark(brother).status_code, 201)
        before = self.stored()
        self.refused(self.put_link(brother, relationship='brother', same_as=self.s2),
                     {'same_as': 'already_linked'}, before)
        self.assertEqual(self.later_rows()[0]['link_candidates'], [])

    def test_update_link_is_not_allowed_in_the_first_estate(self):
        self.setup_family()
        before = self.stored()
        self.refused(self.put_link(self.s2, relationship='son', same_as=self.w), {'same_as': 'not_allowed'}, before)
        self.refused(self.put_link(self.s2, relationship='son', same_as=None), {'same_as': 'not_allowed'}, before)

    def test_update_link_with_a_stale_revision_changes_nothing(self):
        layer = self.link_family()
        self.add_layer(layer, 'mother')
        row = self.later_rows()[0]['id']
        before = self.stored()
        response = self.put_link(row, relationship='mother', same_as=self.w1,
                                 expected_revision=self.live()['revision'] - 1)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.stored(), before)

    def test_link_candidates_are_decided_by_the_server(self):
        layer = self.link_family()
        for row in self.live()['heirs']:
            self.assertNotIn('link_candidates', row)
        self.add_layer(layer, 'mother')
        self.add_layer(layer, 'brother')
        mother, brother = self.later_rows()
        # Gender decides: the wife for the mother, sons for the brother; the deceased son is not alive here.
        self.assertEqual(mother['link_candidates'], [self.w1])
        self.assertEqual(brother['link_candidates'], [self.s2, self.s3])
        # A represented person drops out for another row, and a row keeps its own target.
        self.put_link(brother['id'], relationship='brother', same_as=self.s2)
        self.add_layer(layer, 'brother')
        linked, other = [r for r in self.later_rows() if r['relationship'] == 'brother']
        self.assertEqual(linked['link_candidates'], [self.s2, self.s3])
        self.assertEqual(other['link_candidates'], [self.s3])

    def test_link_candidates_leave_out_a_person_who_died_before_the_estate(self):
        self.link_family()
        self.assertEqual(self.mark(self.s2, first=self.s1).status_code, 201)
        self.add_layer(self.s2, 'brother')
        row = next(d for d in self.live()['deaths'] if d['heir_id'] == self.s2)['heirs'][-1]
        self.assertNotIn(self.s2, row['link_candidates'])
        # The first son died in the earlier estate, so he is not alive at the second death.
        self.assertNotIn(self.s1, row['link_candidates'])

    def test_update_link_refuses_a_row_that_is_an_edge_end(self):
        layer = self.link_family()
        self.add_layer(layer, 'brother')
        brother = self.later_rows()[0]['id']
        self.plant(edges=[{'kind': 'spouse_of', 'from': brother, 'to': self.w1}])
        self.assertEqual(self.later_rows()[0]['link_candidates'], [])
        before = self.stored()
        self.refused(self.put_link(brother, relationship='brother', same_as=self.s2),
                     {'same_as': 'already_linked'}, before)

    def test_unlinking_a_reopened_alias_gives_it_a_valid_person_id(self):
        from api.snapshots import decode, encode_v2
        self.two()
        snapshot = anonymous_case.export_snapshot(self.stored())
        for row in snapshot['deaths'][0]['heirs']:
            row['id'] = f"{row['same_as']}~2"
        restored = self.send('post', '/api/v1/case/restore/', {'case_id': self.case_id, 'snapshot': snapshot})
        self.assertEqual(restored.status_code, 200, restored.content)
        alias = f'{self.s2}~2'
        self.assertIn(alias, [r['id'] for r in self.later_rows()])
        response = self.put_link(alias, relationship='brother', same_as=None)
        self.assertEqual(response.status_code, 200, response.content)
        unlinked = next(r for r in self.later_rows() if r['relationship'] == 'brother')
        self.assertRegex(unlinked['id'], r'^[A-Za-z0-9_-]{1,64}$')
        self.assertNotIn('same_as', unlinked)
        self.assertEqual(self.preview(self.case_id).status_code, 200)
        reopened = decode(2, encode_v2(anonymous_case.export_snapshot(self.stored())), 'x', 'y')
        ids = {r['id'] for r in reopened['heirs']} | {r['id'] for d in reopened['deaths'] for r in d['heirs']}
        self.assertIn(self.s2, ids)
        self.assertIn(unlinked['id'], ids)
        self.assertEqual(len([r for d in reopened['deaths'] for r in d['heirs'] if r.get('same_as') == self.s2]), 0)

    def test_a_link_leaves_the_exported_snapshot_format_unchanged(self):
        layer = self.link_family()
        self.add_layer(layer, 'mother')
        self.put_link(self.later_rows()[0]['id'], relationship='mother', same_as=self.w1)
        exported = anonymous_case.export_snapshot(self.stored())
        self.assertEqual(set(exported['deaths'][0]['heirs'][0]), {'id', 'relationship', 'gender', 'name', 'same_as'})


class AutomaticRelativesTests(InterviewDeathsHelpers, InterviewHelpers, TransactionTestCase):
    """The 1.7c matrix exercises the public atomic write, not engine substitutes."""

    def family(self, gender, relationships):
        case = self.build('hanbali', gender, None, relationships)
        self.case_id = case['id']
        return [row['id'] for row in case['heirs']]

    def linked(self):
        return {row['same_as']: row['relationship'] for row in self.live()['deaths'][-1]['heirs']}

    def test_child_one_wife_and_parent_matrix(self):
        w, daughter, x, sibling, father = self.family('male', ['wife', 'daughter', 'son', 'son', 'father'])
        self.assertEqual(self.mark(x).status_code, 201)
        self.assertEqual(self.linked(), {w: 'mother', daughter: 'sister', sibling: 'brother', father: 'grandfather'})
        f, m, b, son = self.family('male', ['father', 'mother', 'brother', 'son'])
        self.assertEqual(self.mark(f).status_code, 201)
        self.assertEqual(self.linked(), {m: 'wife', b: 'son', son: 'son_of_son'})

    def test_dead_before_x_is_excluded_in_both_marking_orders(self):
        for first_index in (2, 1):
            with self.subTest(first=first_index):
                w, s1, s2 = self.family('male', ['wife', 'son', 'son'])
                first, later = (s2, s1) if first_index == 2 else (s1, s2)
                self.assertEqual(self.mark(first).status_code, 201)
                self.assertEqual(self.live()['deaths'][0]['order'], 2)
                self.assertEqual(self.linked(), {w: 'mother', later: 'brother'})
                self.assertEqual(self.mark(later, first=first).status_code, 201)
                layers = {death['heir_id']: death for death in self.live()['deaths']}
                self.assertEqual({row['same_as']: row['relationship'] for row in layers[later]['heirs']},
                                 {w: 'mother'})
                self.assertEqual({row['same_as']: row['relationship'] for row in layers[first]['heirs']},
                                 {w: 'mother', later: 'brother'})

    def test_automatic_child_links_preview_matches_two_layer_shares(self):
        case = self.start()
        self.case_id = case['id']
        self.assertEqual(self.send('patch', CASE_URL, {'case_id': self.case_id, 'madhab': 'hanafi'}).status_code, 200)
        self.assertEqual(self.deceased(case, 'male').status_code, 200)
        for relationship, name in (('wife', 'W'), ('son', 'S1'), ('son', 'S2')):
            self.assertEqual(self.heir(case, relationship, name=name).status_code, 201)
        w, s1, s2 = [row['id'] for row in self.live()['heirs']]
        self.assertEqual(self.mark(s1).status_code, 201)
        self.assertEqual(self.linked(), {w: 'mother', s2: 'brother'})
        response = self.preview(self.case_id)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['status'], 'available')
        shares = {row['heir_id']: (row['numerator'], row['denominator']) for row in body['shares']}
        self.assertEqual(shares, {w: (13, 48), s2: (35, 48)})
        self.assertNotIn(s1, shares)

    def test_many_wives_questions_and_invalid_answer_are_atomic(self):
        w1, w2, x, sibling, daughter = self.family('male', ['wife', 'wife', 'son', 'son', 'daughter'])
        before = self.stored()
        response = self.mark(x)
        self.refused(response, {'relatives': 'required'}, before)
        questions = {q['id']: q for q in response.json()['questions']}
        self.assertEqual(set(questions), {w1, w2, sibling, daughter})
        self.assertEqual(set(questions[sibling]['options']), {'brother', 'paternal_brother', 'none'})
        self.refused(self.mark(x, relatives={w1: 'father'}), {'relatives': 'invalid'}, before)
        response = self.mark(x, relatives={w1: 'mother', w2: 'none', sibling: 'brother', daughter: 'paternal_sister'})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.linked(), {w1: 'mother', sibling: 'brother', daughter: 'paternal_sister'})

    def test_female_yes_and_no(self):
        for shared in ('yes', 'no'):
            husband, x, sibling = self.family('female', ['husband', 'son', 'son'])
            before = self.stored()
            response = self.mark(x)
            self.refused(response, {'relatives': 'required'}, before)
            self.assertEqual([q['kind'] for q in response.json()['questions']], ['shared_father'])
            if shared == 'yes':
                self.assertEqual(self.mark(x, shared_father='yes').status_code, 201)
                self.assertEqual(self.linked(), {husband: 'father', sibling: 'brother'})
            else:
                response = self.mark(x, shared_father='no')
                self.refused(response, {'relatives': 'required'}, before)
                self.assertEqual(self.mark(x, shared_father='no', relatives={husband: 'none', sibling: 'maternal_brother'}).status_code, 201)
                self.assertEqual(self.linked(), {sibling: 'maternal_brother'})

    def test_grandchildren_and_nephews_ask_about_unnamed_parent(self):
        for relationship in ('son_of_son', 'son_of_brother', 'son_of_uncle'):
            x, other = self.family('male', [relationship, relationship])
            before = self.stored()
            response = self.mark(x)
            self.refused(response, {'relatives': 'required'}, before)
            q = response.json()['questions'][0]
            self.assertEqual(q['person'], other)
            self.assertIn('brother', q['options'])
            self.assertEqual(self.mark(x, relatives={other: 'brother'}).status_code, 201)
            self.assertEqual(self.linked(), {other: 'brother'})

    def test_order_and_relatives_return_together(self):
        w1, w2, x, y = self.family('male', ['wife', 'wife', 'son', 'son'])
        self.assertEqual(self.mark(x, relatives={w1: 'mother', w2: 'none', y: 'none'}).status_code, 201)
        before = self.stored()
        response = self.mark(y)
        self.refused(response, {'death': 'order_required', 'relatives': 'required'}, before)
        self.assertEqual({q['person'] for q in response.json()['questions']}, {w1, w2, x})
        self.assertEqual(self.mark(y, first=x, relatives={w1: 'none', w2: 'mother', x: 'brother'}).status_code, 201)
        self.assertEqual(self.linked(), {w2: 'mother'})

    def test_impossible_derived_rows_are_skipped_and_rows_remain_editable(self):
        w1, w2, x = self.family('male', ['wife', 'wife', 'son'])
        self.assertEqual(self.mark(x, relatives={w1: 'mother', w2: 'none'}).status_code, 201)
        self.assertEqual(len(self.linked()), 1)
        row = self.live()['deaths'][0]['heirs'][0]
        response = self.send('put', HEIRS_URL + row['id'] + '/', {'case_id': self.case_id, 'relationship': 'sister'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.send('delete', HEIRS_URL + row['id'] + '/', {'case_id': self.case_id}).status_code, 200)
        self.assertEqual(self.live()['deaths'][0]['heirs'], [])

    def test_all_relationship_pairs_are_total_and_pure(self):
        from copy import deepcopy
        from api.kinship import PATHS, derive
        self.assertEqual(set(PATHS), set(anonymous_case.RELATIONSHIPS))
        for gender in ('male', 'female'):
            for xr in PATHS:
                for rr in PATHS:
                    x = {'id': 'x', 'relationship': xr, 'gender': anonymous_case.RELATIONSHIPS[xr], 'name': None}
                    r = {'id': 'r', 'relationship': rr, 'gender': anonymous_case.RELATIONSHIPS[rr], 'name': None}
                    case = {'deceased': {'gender': gender}, 'heirs': [x, r],
                            'deaths': [{'heir_id': 'x', 'order': 2, 'gender': x['gender'], 'heirs': []}]}
                    before = deepcopy(case)
                    rows, questions = derive(case, x)
                    self.assertEqual(case, before)
                    self.assertTrue(all(row['relationship'] in PATHS for row in rows))
                    self.assertTrue(all(anonymous_case.RELATIONSHIPS[row['relationship']] == r['gender'] for row in rows))
                    for q in questions:
                        self.assertIn(q['suggested'], q['options'])
                        self.assertTrue(set(q['options']) <= (set(PATHS) | {'none', 'yes', 'no'}))
                        if q['kind'] == 'relative':
                            self.assertTrue(all(value == 'none' or anonymous_case.RELATIONSHIPS[value] == r['gender'] for value in q['options']))


    def test_explicit_half_branch_cannot_be_an_unnamed_full_parent(self):
        from api.kinship import _pair
        self.assertEqual(_pair('paternal_brother', 'son_of_brother', 'male'), {'son_of_paternal_brother'})
        self.assertEqual(_pair('son_of_brother', 'paternal_brother', 'male'), {'paternal_uncle'})

    def test_automatic_links_include_later_deceased_but_exclude_earlier(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1).status_code, 201)
        # Leave the second death unordered so it can be placed before S1.
        brother = self.live()['deaths'][0]['heirs'][1]['id']
        self.send('delete', HEIRS_URL + brother + '/', {'case_id': self.case_id})
        self.assertEqual(self.mark(self.s2, first=self.s2).status_code, 201)
        earlier = self.live()['deaths'][0]
        self.assertTrue(any(row.get('same_as') == self.s1 for row in earlier['heirs']))
        self.assertFalse(any(row.get('same_as') == self.s2 for row in self.live()['deaths'][1]['heirs']))


    def test_order_can_put_the_new_death_first_with_one_combined_resend(self):
        w1, w2, x, y = self.family('male', ['wife', 'wife', 'son', 'son'])
        self.mark(x, relatives={w1: 'mother', w2: 'none', y: 'none'})
        before = self.stored()
        response = self.mark(y)
        self.refused(response, {'death': 'order_required', 'relatives': 'required'}, before)
        self.assertIn(x, {q['id'] for q in response.json()['questions']})
        response = self.mark(y, first=y, relatives={w1: 'mother', w2: 'none', x: 'brother'})
        self.assertEqual(response.status_code, 201)
        earlier = self.live()['deaths'][0]
        self.assertEqual(earlier['heir_id'], y)
        self.assertEqual({r['same_as']: r['relationship'] for r in earlier['heirs']}, {w1: 'mother', x: 'brother'})


    def test_two_mothers_answered_is_refused_and_nothing_is_stored(self):
        w1, w2, x = self.family('male', ['wife', 'wife', 'son'])
        before = self.stored()
        self.refused(self.mark(x, relatives={w1: 'mother', w2: 'mother'}), {'relatives': 'invalid'}, before)

    def test_malformed_relatives_and_shared_father_are_refused_without_storing(self):
        w1, w2, x = self.family('male', ['wife', 'wife', 'son'])
        before = self.stored()
        for extra in ({'relatives': [w1]}, {'relatives': {w1: ['mother']}}, {'relatives': {w1: 1}},
                      {'shared_father': True}, {'shared_father': 'maybe'}, {'shared_father': 1}):
            with self.subTest(extra=extra):
                self.refused(self.mark(x, **extra), {'relatives': 'invalid'}, before)

    def test_daughter_suggests_sister(self):
        from api.kinship import derive
        rows = [{'id': i, 'relationship': r, 'gender': anonymous_case.RELATIONSHIPS[r], 'name': None}
                for i, r in (('w1', 'wife'), ('w2', 'wife'), ('x', 'son'), ('d', 'daughter'))]
        case = {'deceased': {'gender': 'male'}, 'heirs': rows,
                'deaths': [{'heir_id': 'x', 'order': 2, 'gender': 'male', 'heirs': []}]}
        _, questions = derive(case, rows[2])
        suggested = {q['id']: q['suggested'] for q in questions}
        self.assertEqual(suggested, {'w1': 'mother', 'w2': 'mother', 'd': 'sister'})

    def test_layer_without_heirs_is_not_ready(self):
        s1, = self.family('male', ['son'])
        self.assertEqual(self.mark(s1).status_code, 201)
        self.assertEqual(self.live()['deaths'][0]['heirs'], [])
        response = self.preview(self.case_id)
        body = response.json()
        self.assertIs(type(body.pop('revision')), int)
        self.assertEqual(body, {'status': 'not_ready'})

    def test_same_as_gender_mismatch_in_a_later_layer(self):
        s1, s2 = self.family('male', ['son', 'son'])
        self.assertEqual(self.mark(s1).status_code, 201)
        row = self.live()['deaths'][0]['heirs'][0]
        self.assertEqual(self.send('delete', HEIRS_URL + row['id'] + '/', {'case_id': self.case_id}).status_code, 200)
        before = self.stored()
        self.refused(self.add_layer(s1, 'sister', same_as=s2), {'same_as': 'gender_mismatch'}, before)

    def test_derive_expected_value_table(self):
        from api.kinship import derive

        def run(gender, people, x, shared_father=None):
            rows = [{'id': name, 'relationship': rel, 'gender': anonymous_case.RELATIONSHIPS[rel], 'name': None}
                    for name, rel in people]
            xrow = next(r for r in rows if r['id'] == x)
            case = {'deceased': {'gender': gender}, 'heirs': rows,
                    'deaths': [{'heir_id': x, 'order': 2, 'gender': xrow['gender'], 'heirs': []}]}
            found, questions = derive(case, xrow, shared_father)
            return ({(r['relationship'], r['same_as']) for r in found},
                    {q['id']: set(q['options']) for q in questions})

        cases = [
            ('male', [('W', 'wife'), ('Da', 'daughter'), ('S1', 'son'), ('S2', 'son'), ('F', 'father')], 'S1', None,
             {('mother', 'W'), ('sister', 'Da'), ('brother', 'S2'), ('grandfather', 'F')}, {}),
            ('male', [('F', 'father'), ('M', 'mother'), ('B', 'brother'), ('S', 'son')], 'F', None,
             {('wife', 'M'), ('son', 'B'), ('son_of_son', 'S')}, {}),
            ('male', [('B1', 'brother'), ('B2', 'brother'), ('PB', 'paternal_brother'), ('MB', 'maternal_brother'),
                      ('M', 'mother'), ('F', 'father'), ('Si', 'sister'), ('N', 'son_of_brother'), ('U', 'uncle')],
             'B1', None,
             {('brother', 'B2'), ('paternal_brother', 'PB'), ('maternal_brother', 'MB'), ('mother', 'M'),
              ('father', 'F'), ('sister', 'Si'), ('uncle', 'U')}, {'N': {'son', 'son_of_brother', 'none'}}),
            ('male', [('M', 'mother'), ('F', 'father'), ('B', 'brother'), ('MB', 'maternal_brother'),
                      ('PB', 'paternal_brother'), ('S', 'son'), ('MM', 'maternal_grandmother')], 'M', None,
             {('husband', 'F'), ('son', 'B'), ('son', 'MB'), ('son_of_son', 'S'), ('mother', 'MM')}, {}),
            ('male', [('W', 'wife'), ('S', 'son'), ('Da', 'daughter'), ('F', 'father')], 'W', None,
             {('son', 'S'), ('daughter', 'Da')}, {}),
            ('male', [('U1', 'uncle'), ('U2', 'uncle'), ('C', 'son_of_uncle'), ('F', 'father'),
                      ('GF', 'grandfather')], 'U1', None,
             {('brother', 'U2'), ('brother', 'F'), ('father', 'GF')}, {'C': {'son', 'son_of_brother', 'none'}}),
            ('male', [('G1', 'son_of_son'), ('G2', 'son_of_son')], 'G1', None,
             set(), {'G2': {'brother', 'son_of_uncle', 'none'}}),
        ]
        for gender, people, x, shared, rows, questions in cases:
            with self.subTest(x=x, people=people):
                self.assertEqual(run(gender, people, x, shared), (rows, questions))
        female = [('H', 'husband'), ('S1', 'son'), ('S2', 'son')]
        frows = [{'id': n, 'relationship': r, 'gender': anonymous_case.RELATIONSHIPS[r], 'name': None}
                 for n, r in female]
        _, questions = derive({'deceased': {'gender': 'female'}, 'heirs': frows,
                               'deaths': [{'heir_id': 'S1', 'order': 2, 'gender': 'male', 'heirs': []}]}, frows[1])
        self.assertEqual([q['kind'] for q in questions], ['shared_father'])
        with self.subTest('female yes'):
            self.assertEqual(run('female', female, 'S1', 'yes'), ({('father', 'H'), ('brother', 'S2')}, {}))
        with self.subTest('female no'):
            self.assertEqual(run('female', female, 'S1', 'no'),
                             (set(), {'H': {'father', 'none'}, 'S2': {'brother', 'maternal_brother', 'none'}}))


class LayeredPreviewTableTests(TestCase):
    def test_all_layered_fixtures_have_exact_parts_and_session_ids(self):
        from fractions import Fraction
        from django.utils import translation
        from api.preview import preview
        for fixture in PREVIEW_FIXTURES:
            if not fixture['case'].get('deaths'):
                continue
            with self.subTest(fixture=fixture['title']), translation.override('en'):
                response = preview(fixture['case'])
                if response['status'] != 'available':
                    continue
                self.assertEqual(response['proof']['version'], 2)
                table = response['table']
                self.assertIsNotNone(table)
                last = table['layers'][-1]
                final = {r['heir_id']: Fraction(r['numerator'], r['denominator']) for r in response['shares']}
                for part in last['parts']:
                    self.assertIsInstance(part['heir'], str)
                    self.assertEqual(Fraction(part['value'], last['jamia']), final.get(part['heir'], 0))
                self.assertEqual(Fraction(last['unallocated'], last['jamia']), 1 - sum(final.values()))
                for layer in response['proof']['layers']:
                    self.assertEqual(layer['heir'], None if layer['order'] == 1 else next(d['heir_id'] for d in fixture['case']['deaths'] if d['order'] == layer['order']))
                    self.assertEqual(layer['deceased'], layer['heir'])
                    self.assertTrue(all(isinstance(e['heir'], str) for e in layer['proof']['heirs']))

    def test_layer_labels_follow_request_language_and_mismatch_keeps_cards(self):
        from unittest.mock import patch
        from django.utils import translation
        from api.preview import preview
        fixture = next(f for f in PREVIEW_FIXTURES if f['title'] == 'Layered two under hanafi')
        for language, caption in [('ar', '\u0627\u0644\u0633\u0647\u0627\u0645'), ('en', 'Shares'), ('fr', 'Parts')]:
            with translation.override(language):
                response = preview(fixture['case'])
                self.assertEqual(response['table']['layers'][0]['table']['columns'][0]['label'], caption)
                self.assertTrue(all(e['labels']['rule'] for l in response['proof']['layers'] for e in l['proof']['heirs']))
        with patch('engine.proof.build_layered_table', return_value=None):
            response = preview(fixture['case'])
        self.assertIsNone(response['table'])
        self.assertEqual(response['proof']['version'], 2)
        self.assertEqual(response['shares'], fixture['response']['shares'])


class SavedCaseTests(InterviewBase):
    url = '/api/v1/saved-cases/'

    def setUp(self):
        super().setUp()
        self.owner = get_user_model().objects.create_user(username='saved-owner', password='test')
        self.other = get_user_model().objects.create_user(username='saved-other', password='test')

    def complete(self):
        case = self.ready()
        self.send('patch', CASE_URL, {'case_id': case['id'], 'madhab': 'hanafi'})
        self.heir(case, name='Family name')
        return self.live()

    def save(self, case):
        return self.send('post', self.url, {'case_id': case['id']})

    def test_auth_incomplete_and_stale(self):
        case = self.start()
        self.assertEqual(self.save(case).status_code, 403)
        self.assertEqual(self.client.get(self.url, secure=True).status_code, 403)
        self.client.force_login(self.owner)
        self.assertEqual(self.save(case).status_code, 400)
        self.assertEqual(self.send('post', self.url, {'case_id': 'stale'}).status_code, 409)
        self.assertEqual(self.send('post', self.url, {}).status_code, 400)
        self.assertFalse(SavedCase.objects.exists())

    def test_a_case_with_no_school_saves_when_all_four_schools_agree(self):
        self.client.force_login(self.owner)
        case = self.ready()
        self.heir(case, 'wife')
        self.heir(case, 'son')
        response = self.save(self.live())
        self.assertEqual(response.status_code, 201)
        row = SavedCase.objects.get()
        self.assertIsNone(row.snapshot['madhab'])
        self.assertIsNone(self.client.get(self.url, secure=True).json()['cases'][0]['madhab'])
        opened = self.send('post', f'{self.url}{row.pk}/open/', {})
        self.assertIsNone(opened.json()['case']['madhab'])

    def save_named(self, case, name):
        return self.send('post', self.url, {'case_id': case['id'], 'name': name})

    def test_first_save_stores_the_trimmed_name_and_answers_with_it(self):
        self.client.force_login(self.owner)
        response = self.save_named(self.complete(), " Mother's estate ")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['name'], "Mother's estate")
        self.assertEqual(SavedCase.objects.get().name, "Mother's estate")
        self.assertEqual(self.client.get(self.url, secure=True).json()['cases'][0]['name'], "Mother's estate")

    def test_a_blank_name_becomes_the_suggestion_in_the_asked_language(self):
        self.client.force_login(self.owner)
        case = self.complete()
        response = self.client.post(self.url, {'case_id': case['id'], 'name': '   '}, format='json', secure=True,
                                    headers={**self.csrf(self.client), 'Accept-Language': 'fr'})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['name'], SavedCase.objects.get().name)
        self.assertEqual(response.json()['name'], default_name(SavedCase.objects.get().created_at, 'fr'))
        self.assertNotEqual(response.json()['name'], default_name(SavedCase.objects.get().created_at, 'en'))

    def test_arabic_with_combining_marks_at_the_limit_is_accepted(self):
        self.client.force_login(self.owner)
        name = 'مَ' * 100
        self.assertGreater(len(name), 100)
        self.assertEqual(self.save_named(self.complete(), name).status_code, 201)
        self.assertEqual(SavedCase.objects.get().name, name)

    def test_grapheme_count_matches_the_shared_fixture(self):
        from pathlib import Path
        rows = json.loads((Path(__file__).resolve().parent.parent / 'web/src/api/grapheme-names.json')
                          .read_text(encoding='utf-8'))
        for row in rows:
            with self.subTest(name=row['name'][:12]):
                self.assertEqual(grapheme_count(row['name']), row['count'])

    def test_100_family_emoji_graphemes_are_stored_whole_and_101_are_refused(self):
        self.client.force_login(self.owner)
        family = '\U0001F468\u200D\U0001F469\u200D\U0001F467'
        self.assertEqual(len(family), 5)
        case = self.complete()
        refused = self.save_named(case, family * 101)
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.json()['errors'], {'name': 'too_long'})
        self.assertFalse(SavedCase.objects.exists())
        self.assertEqual(self.save_named(case, family * 100).status_code, 201)
        self.assertEqual(SavedCase.objects.get().name, family * 100)
        self.assertEqual(self.client.get(self.url, secure=True).json()['cases'][0]['name'], family * 100)

    def test_too_long_or_non_string_names_are_refused_and_store_nothing(self):
        self.client.force_login(self.owner)
        case = self.complete()
        too_long = self.save_named(case, 'a' * 101)
        self.assertEqual(too_long.status_code, 400)
        self.assertEqual(too_long.json()['errors'], {'name': 'too_long'})
        self.assertEqual(self.save_named(case, 'مَ' * 101).json()['errors'], {'name': 'too_long'})
        for value in (5, None, ['x'], 'a\x00b'):
            refused = self.save_named(case, value)
            self.assertEqual(refused.status_code, 400)
            self.assertEqual(refused.json()['errors'], {'name': 'invalid'})
        self.assertFalse(SavedCase.objects.exists())

    def test_duplicate_names_are_allowed_and_an_existing_name_is_kept(self):
        self.client.force_login(self.owner)
        SavedCase.objects.create(owner=self.owner, snapshot={}, name='Same')
        case = self.complete()
        self.assertEqual(self.save_named(case, 'Same').status_code, 201)
        self.assertEqual(SavedCase.objects.filter(name='Same').count(), 2)
        again = self.save_named(self.live(), 'Renamed')
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json()['name'], 'Same')
        self.assertEqual(SavedCase.objects.filter(name='Renamed').count(), 0)

    def test_save_without_a_name_behaves_as_before(self):
        self.client.force_login(self.owner)
        response = self.save(self.complete())
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['name'], default_name(SavedCase.objects.get().created_at))

    def rename(self, row_id, body, client=None, language=None):
        client = client or self.client
        headers = dict(self.csrf(client))
        if language:
            headers['Accept-Language'] = language
        return client.post(f'{self.url}{row_id}/rename/', body, format='json', secure=True, headers=headers)

    def saved_row(self, name='Original'):
        self.client.force_login(self.owner)
        row_id = self.save_named(self.complete(), name).json()['id']
        return SavedCase.objects.get(pk=row_id)

    def test_rename_changes_only_name_revision_and_updated_at(self):
        from api.models import ShareLink
        row = self.saved_row()
        share_before = self.send('post', f'{self.url}{row.pk}/shares/', {}).json()
        before = (row.snapshot, row.schema_version, row.created_at, row.updated_at, row.revision)
        response = self.rename(row.pk, {'name': ' أسرة  ', 'expected_revision': row.revision})
        self.assertEqual(response.status_code, 200)
        row.refresh_from_db()
        body = response.json()
        self.assertEqual((body['id'], body['name'], body['revision']), (row.pk, 'أسرة', row.revision + 0))
        self.assertEqual(row.revision, before[4] + 1)
        self.assertEqual((row.snapshot, row.schema_version, row.created_at), before[:3])
        self.assertGreater(row.updated_at, before[3])
        self.assertEqual(ShareLink.objects.filter(saved_case=row, revoked_at__isnull=True).count(), 1)
        self.assertEqual(share_before['id'], ShareLink.objects.get(saved_case=row).pk)
        listed = self.client.get(self.url, secure=True).json()['cases']
        self.assertEqual((listed[0]['id'], listed[0]['revision'], listed[0]['name']), (row.pk, row.revision, 'أسرة'))

    def test_rename_blank_uses_the_default_name_in_the_asked_language(self):
        row = self.saved_row()
        response = self.rename(row.pk, {'name': '   ', 'expected_revision': row.revision}, language='fr')
        self.assertEqual(response.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.name, default_name(row.created_at, 'fr'))

    def test_rename_refuses_bad_names_and_revisions_without_changing_the_row(self):
        row = self.saved_row()
        cases = [({'name': 'a' * 101, 'expected_revision': 1}, {'name': 'too_long'}),
                 ({'name': 5, 'expected_revision': 1}, {'name': 'invalid'}),
                 ({'expected_revision': 1}, {'name': 'invalid'})]
        for revision in (None, 'x', True, 0, 1.0):
            cases.append(({'name': 'ok', 'expected_revision': revision}, {'expected_revision': 'invalid'}))
        cases.append(({'name': 'ok'}, {'expected_revision': 'invalid'}))
        for body, errors in cases:
            with self.subTest(body=body):
                response = self.rename(row.pk, body)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()['errors'], errors)
        row.refresh_from_db()
        self.assertEqual((row.name, row.revision), ('Original', 1))

    def test_rename_stale_revision_conflicts_and_changes_nothing(self):
        row = self.saved_row()
        SavedCase.objects.filter(pk=row.pk).update(revision=5)
        response = self.rename(row.pk, {'name': 'New', 'expected_revision': 3})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'rename_conflict')
        self.assertEqual((response.json()['revision'], response.json()['name']), (5, 'Original'))
        row.refresh_from_db()
        self.assertEqual((row.name, row.revision), ('Original', 5))

    def test_rename_is_owner_only_and_needs_login_and_csrf(self):
        row = self.saved_row()
        foreign = SavedCase.objects.create(owner=self.other, snapshot=row.snapshot, name='Theirs')
        self.assertEqual(self.rename(foreign.pk, {'name': 'x', 'expected_revision': 1}).status_code, 404)
        self.assertEqual(self.rename(999999, {'name': 'x', 'expected_revision': 1}).status_code, 404)
        foreign.refresh_from_db()
        self.assertEqual((foreign.name, foreign.revision), ('Theirs', 1))
        self.assertEqual(self.client.post(f'{self.url}{row.pk}/rename/', {'name': 'x', 'expected_revision': 1},
                                          format='json', secure=True).status_code, 403)
        self.client.logout()
        self.assertEqual(self.rename(row.pk, {'name': 'x', 'expected_revision': 1}).status_code, 403)

    def test_a_rename_moves_the_row_first_in_the_list(self):
        older = self.saved_row('Older')
        newer = SavedCase.objects.create(owner=self.owner, snapshot=older.snapshot, name='Newer')
        self.assertEqual(self.client.get(self.url, secure=True).json()['cases'][0]['id'], newer.pk)
        self.assertEqual(self.rename(older.pk, {'name': 'Older 2', 'expected_revision': 1}).status_code, 200)
        self.assertEqual(self.client.get(self.url, secure=True).json()['cases'][0]['id'], older.pk)

    def test_same_session_rename_then_save_does_not_conflict_but_another_session_does(self):
        row = self.saved_row()
        device = APIClient(enforce_csrf_checks=True)
        device.force_login(self.owner)
        opened = self.send('post', f'{self.url}{row.pk}/open/', {}, device).json()['case']
        self.assertEqual(self.rename(row.pk, {'name': 'Mine', 'expected_revision': 1}).status_code, 200)
        link = self.client.session[anonymous_case.SAVED_LINK_KEY]
        self.assertEqual(link['base_revision'], 2)
        self.assertEqual(self.save(self.live()).status_code, 200)
        row.refresh_from_db()
        self.assertEqual((row.name, row.revision), ('Mine', 3))
        stale = self.send('post', self.url, {'case_id': opened['id']}, device)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()['code'], 'saved_case_conflict')

    def test_rename_from_a_stale_working_copy_does_not_advance_its_link(self):
        row = self.saved_row()
        device = APIClient(enforce_csrf_checks=True)
        device.force_login(self.owner)
        opened = self.send('post', f'{self.url}{row.pk}/open/', {}, device).json()['case']
        # Another session saves a newer revision after the device opened the row.
        self.deceased(self.live(), estate='4321.00')
        self.assertEqual(self.save(self.live()).status_code, 200)
        row.refresh_from_db()
        newer = (row.snapshot, row.revision)
        self.assertEqual(newer[1], 2)
        listed = device.get(self.url, secure=True).json()['cases'][0]
        self.assertEqual(listed['revision'], 2)
        self.assertEqual(self.rename(row.pk, {'name': 'Renamed', 'expected_revision': 2}, client=device).status_code, 200)
        self.assertEqual(device.session[anonymous_case.SAVED_LINK_KEY]['base_revision'], 1)
        stale = self.send('post', self.url, {'case_id': opened['id']}, device)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()['code'], 'saved_case_conflict')
        row.refresh_from_db()
        self.assertEqual((row.snapshot, row.revision, row.name), (newer[0], 3, 'Renamed'))

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_rename_keeps_share_and_invite_views_unchanged(self):
        from django.core import mail
        row = self.saved_row()
        share = self.send('post', f'{self.url}{row.pk}/shares/', {}).json()
        invited = get_user_model().objects.create_user(username='saved-invited', email='invited@example.com')
        invite_id = self.send('post', f'{self.url}{row.pk}/invites/', {'email': 'invited@example.com'}).json()['id']
        token = mail.outbox[-1].body.rsplit('#', 1)[1].strip()
        recipient = APIClient(enforce_csrf_checks=True)
        recipient.force_login(invited)
        self.assertEqual(self.send('post', '/api/v1/invites/accept/', {'token': token}, recipient).status_code, 200)

        def views():
            shared = self.send('post', '/api/v1/shares/view/', {'token': share['token']}, viewer)
            received = self.send('post', f'/api/v1/received/{invite_id}/view/', {}, recipient)
            self.assertEqual((shared.status_code, received.status_code), (200, 200))
            return shared.json(), received.json()

        viewer = APIClient(enforce_csrf_checks=True)
        viewer.force_login(self.other)
        def without_times(body):
            if isinstance(body, dict):
                return {k: without_times(v) for k, v in body.items() if k not in ('updated_at', 'started_at')}
            if isinstance(body, list):
                return [without_times(v) for v in body]
            return body

        before = views()
        self.assertEqual(self.rename(row.pk, {'name': 'Another name', 'expected_revision': 1}).status_code, 200)
        after = views()
        for old, new in zip(before, after):
            # Only the change time may move; family, estate and Basis stay as they were.
            self.assertEqual(without_times(new), without_times(old))

    def test_name_suggestion_follows_the_asked_language(self):
        self.assertEqual(self.client.get(self.url + 'name-suggestion/', secure=True).status_code, 403)
        self.client.force_login(self.owner)
        english = self.client.get(self.url + 'name-suggestion/', secure=True, headers={'Accept-Language': 'en'})
        self.assertEqual(english.status_code, 200)
        self.assertTrue(english.json()['name'].startswith('Estate of the deceased, '))
        arabic = self.client.get(self.url + 'name-suggestion/', secure=True, headers={'Accept-Language': 'ar'}).json()['name']
        self.assertNotEqual(arabic, english.json()['name'])
        self.assertLessEqual(len(arabic), 100)

    def test_a_case_with_no_school_is_refused_when_the_schools_differ(self):
        self.client.force_login(self.owner)
        case = self.ready()
        self.heir(case, 'grandfather')
        self.heir(case, 'brother')
        response = self.save(self.live())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'school_required')
        self.assertFalse(SavedCase.objects.exists())
        # After the visitor chooses a school it saves as before.
        self.send('patch', CASE_URL, {'case_id': case['id'], 'madhab': 'hanafi'})
        self.assertEqual(self.save(self.live()).status_code, 201)
        self.assertEqual(SavedCase.objects.get().snapshot['madhab'], 'hanafi')

    def test_a_failing_comparison_refuses_the_save_with_a_503_and_stores_nothing(self):
        self.client.force_login(self.owner)
        case = self.ready()
        self.heir(case, 'wife')
        with mock.patch('api.views.preview.preview', side_effect=RuntimeError('SECRET CASE CONTENT')),                 self.assertLogs('api.views', level='ERROR') as logs:
            response = self.save(self.live())
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('SECRET CASE CONTENT', ''.join(logs.output))
        self.assertFalse(SavedCase.objects.exists())

    def test_a_case_with_no_deceased_or_heirs_is_still_incomplete_without_a_school(self):
        self.client.force_login(self.owner)
        case = self.ready()
        response = self.save(self.live())
        self.assertEqual((response.status_code, response.json().get('code')), (400, 'case_incomplete'))

    def test_save_updates_and_open_roundtrip_on_another_device(self):
        self.client.force_login(self.owner)
        case = self.complete()
        self.deceased(case, estate='1234.50')
        case = self.live()
        # A later death with a linked surviving identity, using the existing session format.
        father = {'id': 'father-row', 'relationship': 'father', 'gender': 'male', 'name': 'Father'}
        case['heirs'].append(father)
        death = {'heir_id': case['heirs'][0]['id'], 'order': 2, 'gender': 'male',
                 'heirs': [{'id': 'later-father', 'relationship': 'grandfather', 'gender': 'male',
                            'name': 'Father', 'same_as': father['id']}], 'heir_options': {'blocked': [], 'invalid': {}}}
        self.plant(heirs=case['heirs'], deaths=[death], shares=[1], amounts=['999'], pdf='bytes')
        case = self.live()
        response = self.save(case)
        self.assertEqual(response.status_code, 201)
        saved_id = response.json()['id']
        row = SavedCase.objects.get(pk=saved_id)
        self.assertEqual(set(row.snapshot), {'madhab', 'deceased', 'heirs', 'deaths'})
        self.assertNotIn('heir_options', json.dumps(row.snapshot))
        self.assertEqual(row.snapshot['deceased']['estate'], '1234.50')
        before = row.updated_at
        self.deceased(case, estate='5678.90')
        self.assertEqual(self.save(case).status_code, 200)
        row.refresh_from_db()
        self.assertGreater(row.updated_at, before)
        self.assertEqual(row.snapshot['deceased']['estate'], '5678.90')
        self.assertEqual(SavedCase.objects.count(), 1)
        device = APIClient(enforce_csrf_checks=True)
        device.force_login(self.owner)
        opened = self.send('post', f'{self.url}{saved_id}/open/', {}, device)
        self.assertEqual(opened.status_code, 200)
        loaded = opened.json()['case']
        self.assertEqual(device.session[anonymous_case.SAVED_LINK_KEY], {
            'case_id': loaded['id'], 'saved_id': row.pk, 'base_revision': row.revision,
            'case_revision': loaded['revision']})
        self.assertNotEqual(loaded['id'], case['id'])
        self.assertEqual(anonymous_case.export_snapshot(loaded), row.snapshot)
        locked_root = next(r for r in loaded['heirs'] if r['id'] == 'father-row')
        locked_alias = loaded['deaths'][0]['heirs'][0]
        for locked in (locked_root, locked_alias):
            self.assertEqual(locked['edit_options']['invalid']['daughter'], 'gender_locked')
        regenerated = device.get(
            f'/api/v1/case/preview/?case_id={loaded["id"]}', secure=True)
        self.assertEqual(regenerated.status_code, 200)
        self.assertEqual(regenerated.json()['status'], 'available')
        row.refresh_from_db()
        self.assertEqual(anonymous_case.export_snapshot(loaded), row.snapshot)
        self.assertEqual(self.send('post', self.url, {'case_id': loaded['id']}, device).status_code, 200)
        self.assertEqual(SavedCase.objects.count(), 1)

    def test_owner_isolation_order_and_untrusted_links(self):
        self.client.force_login(self.owner)
        case = self.complete()
        first = self.save(case).json()['id']
        foreign = SavedCase.objects.create(owner=self.other, snapshot=SavedCase.objects.get(pk=first).snapshot)
        self.assertEqual(self.send('post', f'{self.url}{foreign.pk}/open/', {}).status_code, 404)
        self.assertEqual(self.send('post', f'{self.url}999999/open/', {}).status_code, 404)
        for linked_id in (foreign.pk, 999999):
            session = self.client.session
            session[anonymous_case.SAVED_LINK_KEY] = {'case_id': case['id'], 'saved_id': linked_id}
            session.save()
            self.assertEqual(self.save(case).status_code, 201)
        rows = self.client.get(self.url, secure=True).json()['cases']
        self.assertEqual(len(rows), 3)
        self.assertNotIn(foreign.pk, [row['id'] for row in rows])
        self.assertEqual([row['updated_at'] for row in rows], sorted([row['updated_at'] for row in rows], reverse=True))
        self.assertTrue(all(row['status'] == 'draft' and row['heir_count'] == 1 for row in rows))
        self.send('post', CASE_URL, {'replace': True, 'case_id': case['id']})
        self.assertNotIn(anonymous_case.SAVED_LINK_KEY, self.client.session)
        self.client.force_login(self.other)
        self.assertEqual(len(self.client.get(self.url, secure=True).json()['cases']), 1)

    def test_empty_list_and_csrf(self):
        self.client.force_login(self.owner)
        self.assertEqual(self.client.get(self.url, secure=True).json(), {'cases': []})
        self.assertEqual(self.client.post(self.url, {}, format='json', secure=True).status_code, 403)

    def test_saved_case_writes_take_the_session_lock(self):
        from django.http import HttpResponse
        middleware = CaseWriteLockMiddleware(lambda request: HttpResponse())
        for path in (self.url, f'{self.url}42/open/'):
            request = RequestFactory().post(path)
            request.COOKIES[settings.SESSION_COOKIE_NAME] = 'session-to-lock'
            with mock.patch.object(middleware, 'lock') as lock:
                self.assertEqual(middleware(request).status_code, 200)
                lock.assert_called_once_with('session-to-lock', request)

    def test_unsupported_schema_version_is_not_listed_or_opened(self):
        self.client.force_login(self.owner)
        case = self.complete()
        row = SavedCase.objects.get(pk=self.save(case).json()['id'])
        row.schema_version = 3
        row.save()
        self.assertEqual(self.client.get(self.url, secure=True).json(), {'cases': []})
        response = self.send('post', f'{self.url}{row.pk}/open/', {})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'unsupported_version')
        self.assertEqual(self.live()['id'], case['id'])

    def test_each_required_input_and_case_bound_link(self):
        self.client.force_login(self.owner)
        case = self.complete()
        original = anonymous_case.export_snapshot(case)
        # A missing school is no longer incomplete by itself: see the null-school save tests.
        for field, empty in [('deceased', None), ('heirs', [])]:
            self.plant(**{**original, field: empty})
            self.assertEqual(self.save(case).status_code, 400)
            self.assertFalse(SavedCase.objects.exists())
        self.plant(**original)
        first = self.save(case).json()['id']
        session = self.client.session
        session[anonymous_case.SAVED_LINK_KEY] = {'case_id': 'another-case', 'saved_id': first}
        session.save()
        self.assertEqual(self.save(case).status_code, 201)
        self.assertEqual(SavedCase.objects.count(), 2)

    @override_settings(REPORT_STATUS_PROVIDER='api.tests.saved_case_test_status')
    def test_list_uses_report_status_extension(self):
        self.client.force_login(self.owner)
        case = self.complete()
        self.save(case)
        self.assertEqual(self.client.get(self.url, secure=True).json()['cases'][0]['status'], 'extension-status')


def saved_case_test_status(case):
    return 'extension-status'


class SavedCaseAutosaveTests(InterviewBase):
    url = '/api/v1/saved-cases/autosave/'
    saved_url = '/api/v1/saved-cases/'

    def setUp(self):
        super().setUp()
        self.owner = get_user_model().objects.create_user(username='auto-owner', password='test')
        self.other = get_user_model().objects.create_user(username='auto-other', password='test')
        self.client.force_login(self.owner)
        case = self.ready()
        self.send('patch', CASE_URL, {'case_id': case['id'], 'madhab': 'hanafi'})
        self.heir(case, name='Family name')
        self.saved_id = self.send('post', self.saved_url, {'case_id': self.live()['id'], 'name': 'Mine'}).json()['id']

    def autosave(self, case=None, **changes):
        case = case or self.live()
        return self.send('post', self.url, {'case_id': case['id'], 'case_revision': case['revision'], **changes})

    def test_it_covers_the_revision_and_advances_the_link(self):
        self.heir(self.live(), 'daughter')
        case = self.live()
        response = self.autosave(case)
        self.assertEqual(response.status_code, 200)
        row = SavedCase.objects.get()
        body = response.json()
        self.assertEqual((body['id'], body['revision'], body['case_revision']), (row.pk, 2, case['revision']))
        self.assertEqual(len(row.snapshot['heirs']), 2)
        link = self.client.session[anonymous_case.SAVED_LINK_KEY]
        self.assertEqual((link['base_revision'], link['case_revision']), (2, case['revision']))
        self.assertEqual(self.autosave().status_code, 200)

    def test_a_stale_revision_writes_nothing(self):
        case = self.live()
        self.heir(case, 'daughter')
        response = self.autosave(case)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {'code': 'case_revision_stale', 'detail': 'The case changed.',
                                           'case_revision': self.live()['revision']})
        row = SavedCase.objects.get()
        self.assertEqual((row.revision, len(row.snapshot['heirs'])), (1, 1))

    def test_an_unavailable_link_answers_one_404_and_creates_nothing(self):
        case = self.live()
        refusals = []
        # Another case id.
        refusals.append(self.send('post', self.url, {'case_id': 'other', 'case_revision': case['revision']}))
        # A deleted row.
        SavedCase.objects.all().delete()
        refusals.append(self.autosave(case))
        # A row of another account.
        foreign = SavedCase.objects.create(owner=self.other, snapshot={}, name='Theirs')
        session = self.client.session
        session[anonymous_case.SAVED_LINK_KEY] = {'case_id': case['id'], 'saved_id': foreign.pk, 'base_revision': 1,
                                                  'case_revision': case['revision']}
        session.save()
        refusals.append(self.autosave(case))
        # No link at all.
        session = self.client.session
        del session[anonymous_case.SAVED_LINK_KEY]
        session.save()
        refusals.append(self.autosave(case))
        for response in refusals:
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json(), {'code': 'saved_case_unavailable',
                                               'detail': 'This saved case is no longer available.'})
        foreign.refresh_from_db()
        self.assertEqual((SavedCase.objects.count(), foreign.snapshot, foreign.revision), (1, {}, 1))

    def test_a_row_conflict_gives_the_existing_body_and_writes_nothing(self):
        SavedCase.objects.filter(pk=self.saved_id).update(revision=4)
        self.heir(self.live(), 'daughter')
        response = self.autosave()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'saved_case_conflict')
        self.assertEqual(response.json()['revision'], 4)
        row = SavedCase.objects.get()
        self.assertEqual((row.revision, len(row.snapshot['heirs'])), (4, 1))

    def test_an_incomplete_case_and_a_missing_school_are_refused(self):
        case = self.live()
        for heir in case['heirs']:
            self.send('delete', f'{HEIRS_URL}{heir["id"]}/', {'case_id': case['id']})
        response = self.autosave()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'case_incomplete')
        explicit = self.send('post', self.saved_url, {'case_id': self.live()['id']})
        self.assertEqual((explicit.status_code, explicit.json()['code']), (400, 'case_incomplete'))
        self.heir(self.live(), 'son')
        self.heir(self.live(), 'daughter')
        self.plant(madhab=None)
        with mock.patch('api.views.preview.preview', return_value={'status': 'choose_school'}):
            response = self.autosave()
        self.assertEqual((response.status_code, response.json()['code']), (400, 'school_required'))
        self.assertEqual(SavedCase.objects.get().revision, 1)

    def test_it_needs_a_signed_in_user(self):
        case = self.live()
        self.client.logout()
        self.assertEqual(self.send('post', self.url, {'case_id': case['id'], 'case_revision': 1}).status_code, 403)

    def test_it_changes_neither_the_name_nor_the_basis_nor_the_case_revision(self):
        self.heir(self.live(), 'daughter')
        case = self.live()
        self.assertEqual(self.autosave(case).status_code, 200)
        row = SavedCase.objects.get()
        self.assertEqual(row.name, 'Mine')
        self.assertEqual(self.live()['revision'], case['revision'])
        self.assertEqual(self.live()['madhab'], 'hanafi')
        self.assertEqual(row.snapshot['madhab'], 'hanafi')
        # The compare Basis stays a compare Basis.
        self.plant(madhab=None)
        with mock.patch('api.views.preview.preview', return_value={'status': 'available'}):
            self.assertEqual(self.autosave().status_code, 200)
        self.assertIsNone(SavedCase.objects.get().snapshot['madhab'])
        self.assertEqual(SavedCase.objects.get().name, 'Mine')

    def test_the_share_view_reflects_the_autosaved_family(self):
        token = self.send('post', f'{self.saved_url}{self.saved_id}/shares/',
                          {'visibility': 'public', 'accept_public_warning': True}).json()['token']
        self.heir(self.live(), 'daughter')
        self.assertEqual(self.autosave().status_code, 200)
        shared = APIClient(enforce_csrf_checks=True)
        body = self.send('post', '/api/v1/shares/view/', {'token': token}, shared).json()
        self.assertEqual(len(body['case']['heirs']), 2)


class ShareTests(InterviewBase):
    saved_url = '/api/v1/saved-cases/'

    def setUp(self):
        super().setUp()
        self.owner = get_user_model().objects.create_user(username='share-owner', password='test')
        self.viewer = get_user_model().objects.create_user(username='share-viewer', password='test')
        self.client.force_login(self.owner)
        case = self.ready()
        self.send('patch', CASE_URL, {'case_id': case['id'], 'madhab': 'hanafi'})
        self.heir(case, name='Family name')
        self.case = self.live()
        self.saved_id = self.send('post', self.saved_url, {'case_id': self.case['id']}).json()['id']
        self.shares_url = f'{self.saved_url}{self.saved_id}/shares/'

    def create(self, **body):
        return self.send('post', self.shares_url, body)

    def anonymous(self):
        return APIClient(enforce_csrf_checks=True)

    def view(self, token, client=None):
        return self.send('post', '/api/v1/shares/view/', {'token': token}, client or self.anonymous())

    def public(self):
        return self.create(visibility='public', accept_public_warning=True).json()

    def test_create_stores_only_the_hash_and_defaults_to_private(self):
        response = self.create()
        self.assertEqual(response.status_code, 201)
        token = response.json()['token']
        share = ShareLink.objects.get()
        self.assertEqual(share.visibility, 'private')
        self.assertEqual(share.token_hash, hashlib.sha256(token.encode()).hexdigest())
        self.assertNotEqual(share.token_hash, token)
        self.assertLess(abs(share.expires_at - share.created_at - timedelta(days=30)), timedelta(seconds=5))
        self.assertEqual(ShareAuditEvent.objects.get().action, 'created')
        listed = self.client.get(self.shares_url, secure=True)
        self.assertEqual(listed.status_code, 200)
        self.assertNotIn(token, listed.content.decode())
        self.assertNotIn('token', listed.json()['shares'][0])

    def test_public_needs_explicit_consent_at_create_and_change(self):
        for body in ({'visibility': 'public'}, {'visibility': 'public', 'accept_public_warning': 'yes'},
                     {'visibility': 'public', 'accept_public_warning': False}):
            self.assertEqual(self.create(**body).status_code, 400)
        self.assertFalse(ShareLink.objects.exists())
        self.assertEqual(self.create(visibility='bogus').status_code, 400)
        self.assertEqual(self.public()['visibility'], 'public')
        private = self.create().json()
        url = f'/api/v1/shares/{private["id"]}/'
        self.assertEqual(self.send('patch', url, {'visibility': 'public'}).status_code, 400)
        self.assertEqual(ShareLink.objects.get(pk=private['id']).visibility, 'private')
        self.assertEqual(
            self.send('patch', url, {'visibility': 'public', 'accept_public_warning': True}).status_code, 200)
        self.assertEqual(ShareLink.objects.get(pk=private['id']).visibility, 'public')
        self.assertEqual(self.send('patch', url, {'visibility': 'private'}).json()['visibility'], 'private')
        actions = list(ShareAuditEvent.objects.filter(share_id=private['id']).order_by('pk')
                       .values_list('action', flat=True))
        self.assertEqual(actions, ['created', 'visibility_changed', 'visibility_changed'])
        listed = self.client.get(self.shares_url, secure=True).json()['shares']
        self.assertEqual({row['visibility'] for row in listed}, {'private', 'public'})

    def test_private_needs_sign_in_and_public_does_not(self):
        token = self.create().json()['token']
        denied = self.view(token)
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.json()['code'], 'sign_in_required')
        self.assertFalse(ShareAuditEvent.objects.filter(action='viewed').exists())
        client = self.anonymous()
        client.force_login(self.viewer)
        seen = self.view(token, client)
        self.assertEqual(seen.status_code, 200)
        body = seen.json()
        self.assertEqual(body['status'], 'draft')
        self.assertEqual(body['visibility'], 'private')
        self.assertEqual(body['preview']['status'], 'available')
        self.assertEqual(ShareAuditEvent.objects.get(action='viewed').actor_id, self.viewer.pk)
        anon = self.view(self.public()['token'])
        self.assertEqual(anon.status_code, 200)
        self.assertEqual(anon.json()['status'], 'draft')
        self.assertEqual(ShareAuditEvent.objects.filter(action='viewed').count(), 2)
        self.assertIsNone(ShareAuditEvent.objects.filter(action='viewed').order_by('-pk').first().actor_id)

    def test_a_shared_case_saved_with_no_school_shows_the_agreement(self):
        row = SavedCase.objects.get(pk=self.saved_id)
        row.snapshot = {**row.snapshot, 'madhab': None}
        row.save()
        body = self.view(self.public()['token']).json()
        self.assertEqual(body['case']['madhab'], None)
        self.assertNotIn('snapshot', body['case'])
        self.assertEqual(body['preview']['status'], 'available')
        self.assertIsNone(body['preview']['madhab'])
        self.assertEqual(body['preview']['agreement'], 'all')

    def test_unknown_revoked_and_expired_share_one_404(self):
        live, revoked, expired = self.public(), self.public(), self.public()
        self.assertEqual(self.send('delete', f'/api/v1/shares/{revoked["id"]}/', {}).status_code, 204)
        self.assertEqual(ShareAuditEvent.objects.filter(action='revoked').count(), 1)
        ShareLink.objects.filter(pk=expired['id']).update(expires_at=timezone.now() - timedelta(seconds=1))
        bodies = set()
        for token in ('unknown-token', revoked['token'], expired['token'], '', None):
            response = self.view(token)
            self.assertEqual(response.status_code, 404)
            bodies.add(response.content)
        self.assertEqual(len(bodies), 1)
        self.assertEqual(self.view(live['token']).status_code, 200)
        ShareLink.objects.filter(pk=live['id']).update(expires_at=timezone.now() + timedelta(seconds=30))
        self.assertEqual(self.view(live['token']).status_code, 200)
        ShareLink.objects.filter(pk=live['id']).update(expires_at=timezone.now())
        self.assertEqual(self.view(live['token']).status_code, 404)
        pdf = self.send('post', '/api/v1/shares/report/', {'token': revoked['token']}, self.anonymous())
        self.assertEqual(pdf.status_code, 404)

    def test_owner_scoping(self):
        share = self.create().json()
        other = self.anonymous()
        other.force_login(self.viewer)
        url = f'/api/v1/shares/{share["id"]}/'
        self.assertEqual(self.send('patch', url, {'visibility': 'private'}, other).status_code, 404)
        self.assertEqual(self.send('delete', url, {}, other).status_code, 404)
        self.assertEqual(self.send('post', self.shares_url, {}, other).status_code, 404)
        self.assertEqual(other.get(self.shares_url, secure=True).status_code, 404)
        self.assertIsNone(ShareLink.objects.get().revoked_at)
        self.assertEqual(self.anonymous().get(self.shares_url, secure=True).status_code, 403)

    def test_live_content_and_viewer_session_untouched(self):
        token = self.public()['token']
        first = self.view(token).json()
        self.deceased(self.case, estate='4321.00')
        self.assertEqual(self.send('post', self.saved_url, {'case_id': self.case['id']}).status_code, 200)
        second = self.view(token).json()
        self.assertEqual(second['case']['deceased']['estate'], '4321.00')
        self.assertNotEqual(first['case']['deceased'], second['case']['deceased'])
        viewer = self.anonymous()
        mine = self.send('post', CASE_URL, {}, viewer).json()['case']
        before = viewer.get(CASE_URL, secure=True).json()
        self.assertEqual(self.view(token, viewer).status_code, 200)
        self.assertEqual(viewer.get(CASE_URL, secure=True).json(), before)
        self.assertEqual(before['case']['id'], mine['id'])

    def test_share_shows_the_saved_family_until_the_owner_saves_an_edit(self):
        token = self.public()['token']
        first = self.view(token).json()
        before = first['case']
        self.heir(self.case, name='Added after saving')
        self.assertNotEqual(self.live()['heirs'], self.case['heirs'])
        unsaved = self.view(token).json()
        self.assertEqual(unsaved['case']['heirs'], before['heirs'], 'an unsaved edit is not shown')
        self.assertEqual(unsaved['preview'], first['preview'], 'nor in the recomputed preview')
        self.assertEqual(self.send('post', self.saved_url, {'case_id': self.case['id']}).status_code, 200)
        saved = self.view(token).json()
        self.assertEqual(len(saved['case']['heirs']), len(before['heirs']) + 1)
        self.assertIn('Added after saving', [heir.get('name') for heir in saved['case']['heirs']])
        self.assertNotIn('Added after saving', [heir.get('name') for heir in before['heirs']])
        self.assertNotEqual(saved['preview'], first['preview'], 'the preview is recomputed for the saved family')

    def test_shared_pdf_is_a_draft_pdf(self):
        token = self.public()['token']
        url = '/api/v1/shares/report/'
        with mock.patch('reports.views.render_pdf', return_value=b'%PDF-fake') as render:
            response = self.send('post', url, {'token': token}, self.anonymous())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertEqual(response.content, b'%PDF-fake')
        self.assertEqual(render.call_args[0][0]['id'], f'share-{ShareLink.objects.get().pk}')
        self.assertTrue(ShareAuditEvent.objects.filter(action='report_downloaded').exists())
        private = self.create().json()['token']
        self.assertEqual(self.send('post', url, {'token': private}, self.anonymous()).status_code, 403)
        with mock.patch('reports.views.render_pdf', side_effect=RuntimeError('boom')):
            failed = self.send('post', url, {'token': token}, self.anonymous())
        self.assertEqual(failed.status_code, 503)

    def test_audit_rows_survive_deletes_and_are_append_only(self):
        share = self.create().json()
        SavedCase.objects.filter(pk=self.saved_id).delete()
        self.owner.delete()
        self.assertEqual(ShareAuditEvent.objects.filter(share_id=share['id']).count(), 1)
        event = ShareAuditEvent.objects.get()
        self.assertEqual(event.visibility, 'private')
        with self.assertRaises(AppendOnlyError):
            event.delete()
        with self.assertRaises(AppendOnlyError):
            ShareAuditEvent.objects.all().delete()
        with self.assertRaises(AppendOnlyError):
            ShareAuditEvent.objects.all().update(action='x')
        self.assertEqual(ShareAuditEvent.objects.count(), 1)

    def test_audit_records_visibility_after_each_action(self):
        share = self.create().json()
        url = f'/api/v1/shares/{share["id"]}/'
        self.send('patch', url, {'visibility': 'public', 'accept_public_warning': True})
        self.send('patch', url, {'visibility': 'private'})
        rows = ShareAuditEvent.objects.filter(share_id=share['id']).order_by('pk')
        self.assertEqual([(r.action, r.visibility) for r in rows],
                         [('created', 'private'), ('visibility_changed', 'public'),
                          ('visibility_changed', 'private')])

    def test_expired_links_cannot_be_changed(self):
        share = self.create().json()
        ShareLink.objects.filter(pk=share['id']).update(expires_at=timezone.now() - timedelta(seconds=1))
        url = f'/api/v1/shares/{share["id"]}/'
        self.assertEqual(self.send('patch', url, {'visibility': 'private'}).status_code, 404)
        self.assertEqual(self.send('delete', url, {}).status_code, 404)

    def test_surrogate_token_is_the_same_404(self):
        unknown = self.view('unknown-token')
        for token in (chr(0xD800), 'a' + chr(0xDFFF) + 'b'):
            response = self.client_view_raw(token)
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.content, unknown.content)

    def client_view_raw(self, token):
        # The JSON encoder would refuse a lone surrogate, so send it as an escaped JSON string.
        client = self.anonymous()
        body = '{"token": "' + ''.join('\\u%04x' % ord(c) for c in token) + '"}'
        return client.post('/api/v1/shares/view/', body, content_type='application/json', secure=True,
                           headers=self.csrf(client))

    def test_unsupported_or_malformed_snapshots_are_the_same_404(self):
        token = self.public()['token']
        unknown = self.view('unknown-token')
        report = '/api/v1/shares/report/'
        unknown_report = self.send('post', report, {'token': 'unknown-token'}, self.anonymous())
        for changes in ({'schema_version': 3}, {'schema_version': 1, 'snapshot': ['not', 'a', 'dict']}):
            SavedCase.objects.filter(pk=self.saved_id).update(**changes)
            for response, expected in ((self.view(token), unknown),
                                       (self.send('post', report, {'token': token}, self.anonymous()), unknown_report)):
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.json(), {**expected.json(), 'code':
                    'unsupported_version' if changes['schema_version'] == 3 else 'invalid_snapshot'})

    def test_share_view_throttle_applies_to_view_and_report(self):
        self.assertEqual(api_settings.DEFAULT_THROTTLE_RATES['share_view'], '300/hour')
        for _ in range(300):
            self.assertEqual(self.view('unknown-token').status_code, 404)
        limited = self.view('unknown-token')
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited['Content-Type'], 'application/json')
        cache.clear()
        report = '/api/v1/shares/report/'
        for _ in range(30):
            self.assertEqual(self.send('post', report, {'token': 'unknown-token'}, self.anonymous()).status_code, 404)
        limited = self.send('post', report, {'token': 'unknown-token'}, self.anonymous())
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited['Content-Type'], 'application/json')

    def test_view_needs_csrf(self):
        token = self.create().json()['token']
        response = self.anonymous().post('/api/v1/shares/view/', {'token': token}, format='json', secure=True)
        self.assertEqual(response.status_code, 403)
        self.assertNotEqual(response.json().get('code'), 'sign_in_required')


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class InviteTests(InterviewBase):
    def setUp(self):
        super().setUp()
        self.owner = get_user_model().objects.create_user(username='invite-owner')
        self.recipient = get_user_model().objects.create_user(username='invite-recipient')
        self.other = get_user_model().objects.create_user(username='invite-other', email='invited@example.com')
        self.client.force_login(self.owner)
        case = self.ready()
        self.send('patch', CASE_URL, {'case_id': case['id'], 'madhab': 'hanafi'})
        self.heir(case, name='Private Family Name')
        self.saved_id = self.send('post', '/api/v1/saved-cases/', {'case_id': case['id']}).json()['id']
        self.url = f'/api/v1/saved-cases/{self.saved_id}/invites/'

    def issue(self):
        from django.core import mail
        from api.models import ShareInvite
        response = self.send('post', self.url, {'email': ' Invited@Example.com '})
        self.assertEqual(response.status_code, 201)
        token = mail.outbox[-1].body.rsplit('#', 1)[1].strip()
        return ShareInvite.objects.get(pk=response.json()['id']), token, response

    def accept(self, token, client=None):
        return self.send('post', '/api/v1/invites/accept/', {'token': token}, client or self.client)

    def view(self, id):
        return self.send('post', f'/api/v1/received/{id}/view/', {})

    def report(self, id):
        return self.send('post', f'/api/v1/received/{id}/report/', {})

    def test_hash_email_and_owner_scoping(self):
        from django.core import mail
        row, token, response = self.issue()
        self.assertEqual(row.token_hash, hashlib.sha256(token.encode()).hexdigest())
        self.assertEqual(row.email, 'invited@example.com')
        self.assertNotIn(token, response.content.decode())
        listed = self.client.get(self.url, secure=True)
        self.assertNotIn(token, listed.content.decode())
        self.assertEqual(listed.json()['invites'][0]['status'], 'pending')
        self.assertEqual(mail.outbox[-1].to, ['invited@example.com'])
        self.assertIn('/invite/#' + token, mail.outbox[-1].body)
        self.assertNotIn('Private Family Name', mail.outbox[-1].body)
        self.assertNotIn('Private Family Name', mail.outbox[-1].subject)
        self.assertEqual(ShareAuditEvent.objects.filter(subject='invite', action='created').count(), 1)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.url, secure=True).status_code, 404)
        self.assertEqual(self.send('post', self.url, {'email': 'x@example.com'}).status_code, 404)
        self.assertEqual(self.send('delete', f'/api/v1/invites/{row.pk}/', {}).status_code, 404)
        self.assertEqual(self.client.get('/api/v1/received/', secure=True).json(), {'received': []})
        self.assertEqual(self.view(row.pk).status_code, 404)
        self.assertEqual(self.report(row.pk).status_code, 404)

    def test_invalid_email_and_delivery_failure_leave_nothing(self):
        from api.models import ShareInvite
        for value in ('bad', '', None, 'x' * 255 + '@example.com'):
            self.assertEqual(self.send('post', self.url, {'email': value}).status_code, 400)
        with mock.patch('api.invites.send_mail', side_effect=RuntimeError('private transport error')):
            self.assertEqual(self.send('post', self.url, {'email': 'x@example.com'}).status_code, 503)
        with mock.patch('api.invites.send_mail', return_value=0):
            self.assertEqual(self.send('post', self.url, {'email': 'x@example.com'}).status_code, 503)
        self.assertFalse(ShareInvite.objects.exists())
        self.assertFalse(ShareAuditEvent.objects.filter(subject='invite').exists())

    def test_accept_is_account_bound_idempotent_and_preserves_session(self):
        row, token, _ = self.issue()
        anonymous = APIClient(enforce_csrf_checks=True)
        self.assertEqual(self.accept(token, anonymous).json(), {'code': 'sign_in_required'})
        self.client.force_login(self.recipient)
        recipient_case = self.ready()
        before = dict(self.client.session)
        self.assertEqual(self.accept(token).json(), {'id': row.pk})
        self.assertEqual(self.accept(token).json(), {'id': row.pk})
        row.refresh_from_db()
        self.assertEqual(row.accepted_by, self.recipient)
        self.assertEqual(ShareAuditEvent.objects.filter(subject='invite', action='accepted').count(), 1)
        viewed = self.view(row.pk)
        self.assertEqual(viewed.status_code, 200)
        self.assertEqual(viewed.json()['status'], 'draft')
        self.assertEqual(viewed.json()['case']['id'], f'invite-{row.pk}')
        self.assertEqual(viewed.json()['owner'], self.owner.username)
        with mock.patch('reports.views.render_pdf', return_value=b'%PDF draft'):
            self.assertEqual(self.report(row.pk).status_code, 200)
        self.assertEqual(dict(self.client.session), before)
        self.assertEqual(self.live()['id'], recipient_case['id'])
        self.assertEqual(ShareAuditEvent.objects.filter(subject='invite', action='viewed').count(), 1)
        self.assertEqual(ShareAuditEvent.objects.filter(subject='invite', action='report_downloaded').count(), 1)
        self.assertEqual(self.client.get('/api/v1/received/', secure=True).json()['received'][0]['id'], row.pk)
        self.client.force_login(self.other)
        denied = self.accept(token)
        unknown = self.accept('unknown')
        self.assertEqual(denied.status_code, 404)
        self.assertEqual(denied.json(), unknown.json())
        self.assertEqual(self.view(row.pk).status_code, 404)
        self.assertEqual(self.report(row.pk).status_code, 404)

    def test_a_received_case_saved_with_no_school_shows_the_agreement(self):
        row, token, _ = self.issue()
        saved = SavedCase.objects.get(pk=self.saved_id)
        saved.snapshot = {**saved.snapshot, 'madhab': None}
        saved.save()
        self.client.force_login(self.recipient)
        self.accept(token)
        body = self.view(row.pk).json()
        self.assertNotIn('snapshot', body.get('case') or {})
        self.assertEqual(body['preview']['status'], 'available')
        self.assertIsNone(body['preview']['madhab'])
        self.assertEqual(body['preview']['agreement'], 'all')

    def test_revoke_and_expiry_boundary(self):
        from api.models import ShareInvite
        row, token, _ = self.issue()
        self.client.force_login(self.recipient)
        self.accept(token)
        self.client.force_login(self.owner)
        self.assertEqual(self.send('delete', f'/api/v1/invites/{row.pk}/', {}).status_code, 204)
        self.assertEqual(ShareAuditEvent.objects.filter(subject='invite', action='revoked').count(), 1)
        self.assertEqual(self.client.get(self.url, secure=True).json()['invites'], [])
        self.client.force_login(self.recipient)
        unavailable = self.accept(token)
        self.assertEqual(unavailable.status_code, 404)
        self.assertEqual(self.view(row.pk).status_code, 404)
        self.assertEqual(self.report(row.pk).status_code, 404)
        self.assertEqual(self.client.get('/api/v1/received/', secure=True).json()['received'], [])
        self.client.force_login(self.owner)
        row, token, _ = self.issue()
        boundary = timezone.now()
        ShareInvite.objects.filter(pk=row.pk).update(expires_at=boundary)
        with mock.patch('api.invites.timezone.now', return_value=boundary):
            response = self.accept(token)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), unavailable.json())
        self.assertEqual(self.client.get(self.url, secure=True).json()['invites'][0]['status'], 'expired')

    def test_live_snapshot_preview_pdf_failures_and_throttles(self):
        from api.models import SavedCase
        row, token, _ = self.issue()
        self.client.force_login(self.recipient)
        self.accept(token)
        saved = SavedCase.objects.get(pk=self.saved_id)
        saved.snapshot['madhab'] = 'maliki'
        saved.save()
        self.assertEqual(self.view(row.pk).json()['case']['madhab'], 'maliki')
        with mock.patch('api.views.preview.preview', side_effect=ValueError()):
            self.assertEqual(self.view(row.pk).status_code, 503)
        with mock.patch('reports.views.render_pdf', side_effect=ValueError()):
            self.assertEqual(self.report(row.pk).status_code, 503)
        with mock.patch('reports.views.preview.preview', return_value={'status': 'not_ready'}):
            self.assertEqual(self.report(row.pk).status_code, 409)
        with mock.patch('api.throttling.ShareViewThrottle.allow_request', return_value=False), \
                mock.patch('api.throttling.ShareViewThrottle.wait', return_value=None):
            self.assertEqual(self.accept(token).status_code, 429)
            self.assertEqual(self.view(row.pk).status_code, 429)
            self.assertEqual(self.report(row.pk).status_code, 429)
        self.client.force_login(self.owner)
        with mock.patch('api.throttling.ShareInviteThrottle.allow_request', return_value=False), \
                mock.patch('api.throttling.ShareInviteThrottle.wait', return_value=None):
            self.assertEqual(self.send('post', self.url, {'email': 'x@example.com'}).status_code, 429)


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class AuthApiTests(TestCase):
    password = 'Strong-auth-password-937!'
    destination = '/en/results/?resume=save'

    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user('auth-user', email='auth@example.com', password=self.password)
        self.client = APIClient(enforce_csrf_checks=True, HTTP_ORIGIN='https://testserver')
        self.client.get(SESSION_URL, secure=True)

    def post(self, action, data=None, **extra):
        return self.client.post('/api/v1/auth/' + action + '/', data if data is not None else {}, format='json', secure=True,
                                HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value, **extra)

    def test_signed_in_signup_does_not_create_account(self):
        self.client.force_login(self.user)
        count = get_user_model().objects.count()
        for target, expected in ((self.destination, self.destination), ('https://evil.com/', None)):
            from django.shortcuts import resolve_url
            response = self.post('signup', {'username': 'ignored', 'next': target})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {'redirect': expected or resolve_url(settings.LOGIN_REDIRECT_URL)})
        self.assertEqual(get_user_model().objects.count(), count)
        self.assertEqual(self.client.session['_auth_user_id'], str(self.user.pk))

    def test_non_object_auth_payloads_are_rejected(self):
        for action in ('login', 'signup', 'password-reset', 'password-reset/confirm'):
            for data in ([], 'scalar', 123):
                with self.subTest(action=action, data=data):
                    response = self.post(action, data)
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(response.json(), {'error': 'invalid_payload'})

    def test_concurrent_duplicate_signup_is_localized(self):
        from django.db import IntegrityError
        from django.utils import translation
        for language in ('en', 'ar', 'fr'):
            with translation.override(language):
                expected = get_user_model()().unique_error_message(get_user_model(), ('username',)).messages
            with mock.patch('api.auth_views.UserCreationForm.save', side_effect=IntegrityError('duplicate username')):
                response = self.post('signup', {'username': 'new-user', 'email': 'new@example.com',
                                              'password1': self.password, 'password2': self.password},
                                     HTTP_ACCEPT_LANGUAGE=language)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json(), {'errors': {'username': expected}})

    def test_reset_from_delivered_email_to_login(self):
        import re
        from urllib.parse import parse_qs, urlsplit
        from django.core import mail
        self.assertEqual(self.post('password-reset', {'email': self.user.email}).status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        link = re.search(r'https://testserver/(?:ar|en|fr)/password-reset/confirm/\?[^\s]+', mail.outbox[0].body).group()
        query = parse_qs(urlsplit(link).query)
        data = {key: query[key][0] for key in ('uid', 'token')}
        response = self.client.get('/api/v1/auth/password-reset/confirm/', data, secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'valid': True})
        password = 'Email-reset-password-987!'
        response = self.post('password-reset/confirm', {**data, 'new_password1': password, 'new_password2': password})
        self.assertEqual(response.status_code, 200)
        response = self.post('login', {'username': self.user.username, 'password': password})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.session['_auth_user_id'], str(self.user.pk))

    def test_login_restores_case_and_returns_destination(self):
        case = self.client.post('/api/v1/case/', {}, format='json', secure=True,
                                HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value).json()['case']
        response = self.post('login', {'username': self.user.username, 'password': self.password, 'next': self.destination})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'redirect': self.destination})
        self.assertEqual(self.client.get('/api/v1/case/', secure=True).json()['case']['id'], case['id'])
        self.assertIn('_auth_user_id', self.client.session)
        self.assertGreater(self.client.session.get_expiry_age(), 10 * 24 * 3600)

    def test_wrong_password_is_localized(self):
        bodies = []
        for language in ('en', 'ar', 'fr'):
            response = self.post('login', {'username': self.user.username, 'password': 'bad'}, HTTP_ACCEPT_LANGUAGE=language)
            self.assertEqual(response.status_code, 400)
            bodies.append(response.json()['errors']['__all__'])
        self.assertNotEqual(bodies[0], bodies[1])
        self.assertNotEqual(bodies[0], bodies[2])

    def test_next_is_relative_only(self):
        for target in ('https://evil.com/', '//evil.com/', 'https://testserver/en/', '/\\evil.com/', 'javascript:alert(1)'):
            response = self.post('login', {'username': self.user.username, 'password': self.password, 'next': target})
            from django.shortcuts import resolve_url
            self.assertEqual(response.json()['redirect'], resolve_url(settings.LOGIN_REDIRECT_URL))

    def test_signup_errors_and_success_keep_case(self):
        self.client.post('/api/v1/case/', {}, format='json', secure=True, HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)
        original = self.client.get('/api/v1/case/', secure=True).json()['case']
        data = {'username': self.user.username, 'email': 'new@example.com', 'password1': self.password, 'password2': 'mismatch'}
        response = self.post('signup', data)
        self.assertEqual(response.status_code, 400)
        self.assertIn('username', response.json()['errors'])
        self.assertIn('password2', response.json()['errors'])
        data.update(username='new-auth-user', password2=self.password, next=self.destination)
        response = self.post('signup', data)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['redirect'], self.destination)
        self.assertIn('_auth_user_id', self.client.session)
        self.assertGreater(self.client.session.get_expiry_age(), 10 * 24 * 3600)
        self.assertEqual(self.client.get('/api/v1/case/', secure=True).json()['case']['id'], original['id'])

    def test_csrf_required_for_every_post(self):
        for action in ('login', 'signup', 'logout', 'password-reset', 'password-reset/confirm'):
            response = self.client.post('/api/v1/auth/' + action + '/', {}, format='json', secure=True)
            self.assertEqual(response.status_code, 403)

    def test_logout_ends_session(self):
        self.client.force_login(self.user)
        self.assertEqual(self.post('logout').status_code, 200)
        self.assertNotIn('_auth_user_id', self.client.session)
        self.assertFalse(self.client.get(SESSION_URL, secure=True).json()['authenticated'])

    def test_reset_is_private_and_email_uses_export_url(self):
        from django.core import mail
        expected = self.post('password-reset', {'email': 'missing@example.com'}).json()
        response = self.post('password-reset', {'email': self.user.email}, HTTP_ACCEPT_LANGUAGE='fr')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('https://testserver/fr/password-reset/confirm/?uid=', mail.outbox[0].body)
        with mock.patch('django.contrib.auth.forms.PasswordResetForm.save', side_effect=OSError('SMTP unavailable')):
            with self.assertLogs('api.auth_views', level='ERROR'):
                response = self.post('password-reset', {'email': self.user.email})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)

    def test_confirm_checks_token_validates_password_and_prevents_reuse(self):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.http import urlsafe_base64_encode
        from django.utils.encoding import force_bytes
        data = {'uid': urlsafe_base64_encode(force_bytes(self.user.pk)), 'token': default_token_generator.make_token(self.user)}
        url = '/api/v1/auth/password-reset/confirm/'
        self.assertEqual(self.client.get(url, data, secure=True).json(), {'valid': True})
        response = self.post('password-reset/confirm', {**data, 'new_password1': self.password, 'new_password2': 'wrong'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('new_password2', response.json()['errors'])
        response = self.post('password-reset/confirm', {**data, 'new_password1': 'Another-strong-password-555!', 'new_password2': 'Another-strong-password-555!'})
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Another-strong-password-555!'))
        self.assertEqual(self.client.get(url, data, secure=True).json(), {'error': 'invalid_link'})
        self.assertEqual(self.post('password-reset/confirm', data).json(), {'error': 'invalid_link'})
        self.assertEqual(self.client.get(url, {'uid': 'bad', 'token': 'bad'}, secure=True).status_code, 400)

    def test_auth_quota_is_shared_and_reads_are_free(self):
        for index in range(20):
            self.assertEqual(self.client.get('/api/v1/auth/password-reset/confirm/', secure=True).status_code, 400)
            self.assertEqual(self.post('password-reset', {'email': 'missing@example.com'}).status_code, 200)
        self.assertEqual(self.post('login', {}).status_code, 429)
        self.assertEqual(self.post('signup', {}).status_code, 429)
        self.client.force_login(self.user)
        self.assertEqual(self.post('logout').status_code, 200)
        self.assertNotIn('_auth_user_id', self.client.session)

    def test_ipv6_quota_groups_by_64(self):
        from api.throttling import AuthThrottle
        factory = RequestFactory()
        throttle = AuthThrottle()
        first = Request(factory.post('/', REMOTE_ADDR='2001:db8:1234:1::1'))
        second = Request(factory.post('/', REMOTE_ADDR='2001:db8:1234:1::2'))
        self.assertEqual(throttle.get_cache_key(first, None), throttle.get_cache_key(second, None))


class PasswordChangeApiTests(TestCase):
    password = AuthApiTests.password
    setUp = AuthApiTests.setUp
    post = AuthApiTests.post
    url = '/api/v1/auth/password-change/'
    new_password = 'Changed-secure-password-864!'

    def change(self, **overrides):
        return self.post('password-change', {'old_password': self.password,
                         'new_password1': self.new_password, 'new_password2': self.new_password, **overrides})

    def test_anonymous_and_csrf(self):
        self.assertEqual(self.client.get(self.url, secure=True).status_code, 403)
        self.assertEqual(self.change().status_code, 403)
        self.client.force_login(self.user)
        self.assertEqual(self.client.post(self.url, {}, format='json', secure=True).status_code, 403)

    def test_probe_change_session_and_credentials(self):
        other = APIClient()
        other.force_login(self.user)
        self.client.force_login(self.user)
        self.assertEqual(self.client.get(self.url, secure=True).json(), {'has_password': True})
        response = self.change()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'complete': True})
        self.assertTrue(self.client.get(SESSION_URL, secure=True).json()['authenticated'])
        self.assertFalse(other.get(SESSION_URL, secure=True).json()['authenticated'])
        self.user.refresh_from_db()
        self.assertFalse(self.user.check_password(self.password))
        self.assertTrue(self.user.check_password(self.new_password))
        self.post('logout')
        self.assertEqual(self.post('login', {'username': self.user.username, 'password': self.password}).status_code, 400)
        self.assertEqual(self.post('login', {'username': self.user.username, 'password': self.new_password}).status_code, 200)

    def test_social_only_cannot_set_password(self):
        self.user.set_unusable_password()
        self.user.save()
        original = self.user.password
        self.client.force_login(self.user)
        self.assertEqual(self.client.get(self.url, secure=True).json(), {'has_password': False})
        response = self.change()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {'error': 'no_password'})
        self.user.refresh_from_db()
        self.assertEqual(self.user.password, original)

    def test_localized_field_errors_and_validation(self):
        from django.contrib.auth.forms import PasswordChangeForm
        from django.utils import translation
        self.client.force_login(self.user)
        for language in ('ar', 'en', 'fr'):
            with translation.override(language):
                form = PasswordChangeForm(self.user, {'old_password': 'wrong', 'new_password1': self.new_password, 'new_password2': self.new_password})
                form.is_valid()
                expected = dict(form.errors)
            response = self.post('password-change', form.data, HTTP_ACCEPT_LANGUAGE=language)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json(), {'errors': expected})
        for overrides, field in [({'new_password2': 'mismatch'}, 'new_password2'),
                                 ({'new_password1': '123', 'new_password2': '123'}, 'new_password2')]:
            response = self.change(**overrides)
            self.assertEqual(response.status_code, 400)
            self.assertIn(field, response.json()['errors'])
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(self.password))

    def test_change_quota_and_free_probe(self):
        self.client.force_login(self.user)
        for _ in range(20):
            self.assertEqual(self.client.get(self.url, secure=True).status_code, 200)
            self.assertEqual(self.change(old_password='wrong').status_code, 400)
        self.assertEqual(self.change().status_code, 429)
        self.assertEqual(self.client.get(self.url, secure=True).status_code, 200)


class InterviewLineageTests(InterviewDeathsHelpers, InterviewHelpers, TestCase):
    """Story 9.1b: the Case carries persons, edges and engine-computed placement."""

    NEW = {'persons', 'edges', 'placement'}

    def relationships(self, entries, link=None):
        return [e['relationship'] for e in entries if link in (None, e['link'])]

    def test_legacy_case_adds_only_persons_edges_and_placement(self):
        case = self.build('hanbali', 'male', '100', ['wife', 'son', 'son'], ['W', 'S1', 'S2'])
        self.assertEqual(case['edges'], [])
        self.assertNotIn('died_before', case)
        self.assertEqual([(p['id'], p['status'], p['death_order']) for p in case['persons']],
                         [(r['id'], 'alive', None) for r in case['heirs']])
        self.assertEqual([p['name'] for p in case['persons']], ['W', 'S1', 'S2'])
        root = case['placement']['root']
        self.assertEqual(self.relationships(root, 'parent'), ['father', 'mother'])
        self.assertEqual(self.relationships(root, 'spouse'), ['wife'])
        self.assertEqual(self.relationships(root, 'child'), ['son', 'daughter'])
        self.assertNotIn('husband', self.relationships(root))
        for son in case['heirs'][1:]:
            # Sons shut out the sons' children under every school: labelled, not refused.
            self.assertEqual(case['placement'][son['id']],
                             [{'relationship': 'son_of_son', 'link': 'child', 'blocked': True, 'gender': 'male'},
                              {'relationship': 'daughter_of_son', 'link': 'child', 'blocked': True,
                               'gender': 'female'}])
        self.assertEqual(case['placement'][case['heirs'][0]['id']], [])
        # The stored case is as before: no derived or empty lineage keys.
        self.assertFalse((self.NEW | {'died_before'}) & set(self.stored()))
        self.assertEqual(set(anonymous_case.export_snapshot(case)), {'madhab', 'deceased', 'heirs', 'deaths'})
        from calc.adapters import family_from_session
        family, _ = family_from_session(case)
        self.assertEqual((family.edges, {p.status for p in family.persons}), ((), {'alive'}))

    def test_read_and_command_responses_carry_the_same_lineage_fields(self):
        case = self.ready()
        response = self.heir(case, 'wife')
        self.assertEqual(response.status_code, 201)
        body = response.json()['case']
        self.assertEqual({k: body[k] for k in self.NEW}, {k: self.live()[k] for k in self.NEW})
        self.assertEqual(body['persons'][0]['relationship'], 'wife')

    def test_second_father_and_wives_are_not_offered(self):
        case = self.build('hanbali', 'male', None, ['father', 'wife', 'wife', 'wife', 'wife'])
        root = case['placement']['root']
        self.assertNotIn('father', self.relationships(root))
        self.assertIn('mother', self.relationships(root))
        self.assertNotIn('wife', self.relationships(root))

    def test_blocked_candidate_is_flagged_not_dropped(self):
        case = self.build('hanbali', 'male', None, ['son', 'brother'])
        brother = case['heirs'][1]['id']
        entry = next(e for e in case['placement'][brother] if e['relationship'] == 'son_of_brother')
        self.assertTrue(entry['blocked'])
        # No school chosen: nothing is blocked, as in heir_options.
        self.plant(madhab=None)
        undecided = self.live()
        self.assertEqual(undecided['heir_options']['blocked'], [])
        self.assertFalse(any(e['blocked'] for entries in undecided['placement'].values() for e in entries))

    def test_later_estate_placement_uses_that_estates_relationships(self):
        self.setup_family()
        self.assertEqual(self.mark(self.w).status_code, 201)
        case = self.live()
        death = case['deaths'][0]
        self.assertEqual(death['order'], 2)
        # The later deceased is a woman: that estate may have a husband and no wife.
        self.assertEqual(self.relationships(death['placement']['root'], 'spouse'), ['husband'])
        self.assertEqual(self.relationships(case['placement']['root'], 'spouse'), ['wife'])
        self.assertEqual(set(death['placement']), set(case['placement']))

    def plant_lineage(self):
        case = self.build('hanbali', 'male', None, ['wife', 'son_of_son'], ['W', 'G'])
        grandson = case['heirs'][1]['id']
        self.plant(died_before=[{'id': 'omar', 'gender': 'male', 'name': 'Omar', 'relationship': 'son'}],
                   edges=[{'kind': 'parent_of', 'from': 'omar', 'to': grandson},
                          {'kind': 'spouse_of', 'from': 'root', 'to': case['heirs'][0]['id']}])
        return grandson

    def test_died_before_person_and_edges_are_read(self):
        grandson = self.plant_lineage()
        case = self.live()
        self.assertEqual([h['relationship'] for h in case['heirs']], ['wife', 'son_of_son'])
        omar = next(p for p in case['persons'] if p['id'] == 'omar')
        self.assertEqual((omar['status'], omar['relationship'], omar['name']), ('died_before_or_with', 'son', 'Omar'))
        self.assertEqual(case['persons'][-1]['id'], 'omar')
        self.assertEqual(case['edges'][0], {'kind': 'parent_of', 'from': 'omar', 'to': grandson})
        self.assertEqual(case['placement']['omar'], [
            {'relationship': 'son_of_son', 'link': 'child', 'blocked': False, 'gender': 'male'},
            {'relationship': 'daughter_of_son', 'link': 'child', 'blocked': False, 'gender': 'female'}])
        self.assertEqual(case['placement'][grandson], [])
        self.assertNotIn('omar', [h['id'] for h in case['heirs']])
        self.assertEqual(self.preview(case['id']).status_code, 200)

    def test_tampered_lineage_is_left_out(self):
        case = self.build('hanbali', 'male', None, ['wife'])
        wife = case['heirs'][0]['id']
        self.plant(died_before=[{'id': wife, 'relationship': 'son'}, {'id': 'x', 'relationship': 'nope'},
                                {'id': 'omar', 'relationship': 'father'}, {'id': 'omar', 'relationship': 'father'},
                                {'id': 'root', 'relationship': 'father'}, 7],
                   edges=[{'kind': 'parent_of', 'from': 'omar', 'to': wife},
                          {'kind': 'parent_of', 'from': 'omar', 'to': wife},
                          {'kind': 'parent_of', 'from': 'omar', 'to': 'omar'},
                          {'kind': 'friend_of', 'from': 'omar', 'to': wife},
                          {'kind': 'parent_of', 'from': 'ghost', 'to': wife},
                          {'kind': 'parent_of', 'from': 'omar', 'to': wife, 'extra': 1}, 'x'])
        case = self.live()
        self.assertEqual(case['edges'], [{'kind': 'parent_of', 'from': 'omar', 'to': wife}])
        self.assertEqual([p['id'] for p in case['persons']], [wife, 'omar'])
        self.assertNotIn('father', self.relationships(case['placement']['root']))

    @override_settings(SNAPSHOT_WRITE_VERSION=2)
    def test_writer_2_keeps_lineage_across_commands(self):
        self.plant_lineage()
        before = self.live()
        response = self.heir(before, 'daughter', name='D')
        self.assertEqual(response.status_code, 201)
        after = response.json()['case']
        self.assertEqual((after['edges'], after['persons'][-1]['id']), (before['edges'], 'omar'))
        self.assertEqual(self.stored()['edges'], before['edges'])
        self.assertEqual(self.stored()['died_before'][0]['id'], 'omar')
        for derived in ('persons', 'placement'):
            self.assertNotIn(derived, self.stored())
        self.assertEqual(anonymous_case.export_snapshot(after)['edges'], before['edges'])

    def test_writer_1_refuses_to_persist_lineage(self):
        self.plant_lineage()
        case = self.live()
        before = self.stored()
        response = self.heir(case, 'daughter')
        self.assertEqual((response.status_code, response.json()['code']), (422, 'unsupported_content'))
        self.assertEqual(self.stored(), before)

    def test_saved_case_save_with_lineage_follows_the_writer(self):
        user = get_user_model().objects.create_user('lineage', 'lineage@example.com', 'pw-lineage-1')
        self.client.force_login(user)
        self.plant_lineage()
        case = self.live()
        for version, expected in ((1, 400), (2, 201)):
            with override_settings(SNAPSHOT_WRITE_VERSION=version):
                response = self.send('post', '/api/v1/saved-cases/', {'case_id': case['id']})
                self.assertEqual(response.status_code, expected, response.content)
                if version == 1:
                    self.assertEqual(response.json()['code'], 'unsupported_content')
                    self.assertEqual(SavedCase.objects.count(), 0)
        row = SavedCase.objects.get()
        self.assertEqual(row.schema_version, 2)
        self.assertEqual(row.snapshot['family']['edges'][0]['from'], 'omar')

    def test_restore_with_lineage_follows_the_writer(self):
        self.plant_lineage()
        snapshot = anonymous_case.export_snapshot(self.live())
        self.assertEqual(set(snapshot) - {'madhab', 'deceased', 'heirs', 'deaths'}, {'edges', 'died_before'})
        case_id = self.live()['id']
        before = self.stored()
        response = self.send('post', '/api/v1/case/restore/', {'case_id': case_id, 'snapshot': snapshot})
        self.assertEqual((response.status_code, response.json()['error']), (400, 'invalid_snapshot'))
        self.assertEqual(self.stored(), before)
        with override_settings(SNAPSHOT_WRITE_VERSION=2):
            snapshot['edges'] = snapshot['edges'][:1]
            response = self.send('post', '/api/v1/case/restore/', {'case_id': case_id, 'snapshot': snapshot})
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.json()['case']['edges'], snapshot['edges'])

    @override_settings(SNAPSHOT_WRITE_VERSION=2)
    def test_restore_without_lineage_replaces_died_before(self):
        self.plant_lineage()
        snapshot = anonymous_case.export_snapshot(self.live())
        for key in ('edges', 'died_before'):
            del snapshot[key]
        response = self.send('post', '/api/v1/case/restore/', {'case_id': self.live()['id'], 'snapshot': snapshot})
        self.assertEqual(response.status_code, 200, response.content)
        case = response.json()['case']
        self.assertEqual((case['edges'], [p['status'] for p in case['persons']]), ([], ['alive', 'alive']))
        self.assertNotIn('died_before', self.stored())

    @override_settings(SNAPSHOT_WRITE_VERSION=2)
    def test_remove_impact_matches_the_rows_removed_despite_edges(self):
        from api import case_commands
        grandson = self.plant_lineage()
        wife = self.live()['heirs'][0]['id']
        self.plant(edges=[{'kind': 'parent_of', 'from': wife, 'to': grandson}])
        case = self.live()
        impact = case_commands.remove_impact(case, wife)
        self.assertEqual(impact, {'persons': [], 'estates': []})
        response = self.send('delete', f'{HEIRS_URL}{wife}/', {'case_id': case['id']})
        self.assertEqual([h['id'] for h in response.json()['case']['heirs']], [grandson])

    @override_settings(SNAPSHOT_WRITE_VERSION=2)
    def test_alias_promotion_remaps_edges_and_removal_drops_them(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1).status_code, 201)
        case = self.live()
        alias = case['deaths'][0]['heirs'][0]
        self.assertEqual((alias['relationship'], alias['same_as']), ('mother', self.w))
        self.plant(died_before=[{'id': 'omar', 'relationship': 'father'}],
                   edges=[{'kind': 'spouse_of', 'from': 'omar', 'to': self.w},
                          {'kind': 'parent_of', 'from': 'omar', 'to': self.s2}])
        response = self.send('delete', f'{HEIRS_URL}{self.w}/', {'case_id': self.case_id})
        self.assertEqual(response.status_code, 200, response.content)
        case = response.json()['case']
        promoted = case['deaths'][0]['heirs'][0]['id']
        self.assertEqual(promoted, alias['id'])
        self.assertEqual(case['edges'], [{'kind': 'spouse_of', 'from': 'omar', 'to': promoted},
                                         {'kind': 'parent_of', 'from': 'omar', 'to': self.s2}])
        self.assertIn(promoted, [p['id'] for p in case['persons']])
        # Removing the last row of a person drops the person's edges.
        response = self.send('delete', f'{HEIRS_URL}{promoted}/', {'case_id': self.case_id})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['case']['edges'], [{'kind': 'parent_of', 'from': 'omar', 'to': self.s2}])
        self.assertEqual(self.stored()['edges'], response.json()['case']['edges'])
