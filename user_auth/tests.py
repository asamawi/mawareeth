from unittest import mock
from urllib.parse import parse_qs, urlparse

from django.contrib import messages
from django.test import TestCase, override_settings
from django.urls import reverse
from social_core.backends.linkedin import LinkedinOpenIdConnect


@override_settings(
    SOCIAL_AUTH_FACEBOOK_KEY="123",
    SOCIAL_AUTH_LINKEDIN_OPENIDCONNECT_KEY="abc",
)
@mock.patch.object(
    LinkedinOpenIdConnect,
    "oidc_config",
    return_value={"authorization_endpoint": "https://www.linkedin.com/oauth/v2/authorization"},
)
class SocialLoginTestCase(TestCase):
    """social-auth-app-django 6 rejects GET on the begin view with 405."""

    BACKENDS = {
        "facebook": "https://www.facebook.com/",
        "linkedin-openidconnect": "https://www.linkedin.com/",
    }

    @override_settings(DEBUG=False)
    def test_complete_without_state_redirects_to_login(self, _oidc_config):
        response = self.client.get(
            reverse('social:complete', args=['linkedin-openidconnect']), secure=True
        )
        self.assertRedirects(response, reverse('login'), fetch_redirect_response=False)
        login = self.client.get(response['Location'], secure=True)
        queued = list(login.context['messages'])
        self.assertEqual(len(queued), 1)
        self.assertEqual(queued[0].level, messages.ERROR)
        self.assertContains(login, str(queued[0]))

    def test_login_and_signup_pages_post_to_begin_view(self, _oidc_config):
        for page in (reverse("login"), reverse("calc:signup")):
            html = self.client.get(page, secure=True).content.decode()
            for backend in self.BACKENDS:
                begin = reverse("social:begin", args=[backend])
                self.assertIn(f'method="post" action="{begin}"', html)
                self.assertNotIn(f'href="{begin}"', html)

    def test_post_to_begin_view_redirects_to_provider(self, _oidc_config):
        for backend, provider in self.BACKENDS.items():
            response = self.client.post(reverse("social:begin", args=[backend]), secure=True)
            self.assertEqual(response.status_code, 302)
            self.assertTrue(response["Location"].startswith(provider))

    def test_linkedin_requests_only_openid_connect_scopes(self, _oidc_config):
        # LinkedIn rejects the retired r_liteprofile/r_emailaddress scopes.
        response = self.client.post(
            reverse("social:begin", args=["linkedin-openidconnect"]), secure=True
        )
        query = parse_qs(urlparse(response["Location"]).query)
        self.assertEqual(query["scope"][0].split(), ["openid", "profile", "email"])
