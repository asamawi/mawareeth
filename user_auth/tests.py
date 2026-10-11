from django.test import TestCase, override_settings
from django.urls import reverse


@override_settings(
    SOCIAL_AUTH_FACEBOOK_KEY="123",
    SOCIAL_AUTH_LINKEDIN_OAUTH2_KEY="abc",
)
class SocialLoginTestCase(TestCase):
    """social-auth-app-django 6 rejects GET on the begin view with 405."""

    BACKENDS = {
        "facebook": "https://www.facebook.com/",
        "linkedin-oauth2": "https://www.linkedin.com/",
    }

    def test_login_and_signup_pages_post_to_begin_view(self):
        for page in (reverse("login"), reverse("calc:signup")):
            html = self.client.get(page, secure=True).content.decode()
            for backend in self.BACKENDS:
                begin = reverse("social:begin", args=[backend])
                self.assertIn(f'method="post" action="{begin}"', html)
                self.assertNotIn(f'href="{begin}"', html)

    def test_post_to_begin_view_redirects_to_provider(self):
        for backend, provider in self.BACKENDS.items():
            response = self.client.post(reverse("social:begin", args=[backend]), secure=True)
            self.assertEqual(response.status_code, 302)
            self.assertTrue(response["Location"].startswith(provider))
