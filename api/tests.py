from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.test import TestCase, override_settings
from django.urls import path, reverse
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.test import APIClient
from rest_framework.views import APIView

from api import urls as api_urls
from api.views import ApiView, SessionView


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
