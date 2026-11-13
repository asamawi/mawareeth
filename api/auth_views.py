"""Session authentication for the statically exported auth pages."""
import logging

from collections.abc import Mapping

from django.conf import settings
from django.contrib.auth import get_user_model, login, logout, update_session_auth_hash
from django.contrib.auth.forms import AuthenticationForm, PasswordChangeForm, PasswordResetForm, SetPasswordForm
from django.contrib.auth.tokens import default_token_generator
from django.db import IntegrityError, transaction
from django.shortcuts import resolve_url
from django.utils import translation
from django.utils.decorators import method_decorator
from django.utils.http import url_has_allowed_host_and_scheme, urlsafe_base64_decode
from django.views.decorators.cache import never_cache
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from api.permissions import CsrfProtectedWrites
from api.throttling import AuthThrottle
from api.views import ApiView
from user_auth.forms import UserCreationForm

logger = logging.getLogger(__name__)


def safe_next(request, value=None):
    if (isinstance(value, str) and value.startswith('/') and not value.startswith('//')
            and url_has_allowed_host_and_scheme(value, {request.get_host()}, require_https=request.is_secure())):
        return value
    return resolve_url(settings.LOGIN_REDIRECT_URL)


def locale():
    language = translation.get_language()
    return language if language in ('ar', 'en', 'fr') else 'en'


@method_decorator(never_cache, name='dispatch')
class AuthView(ApiView):
    permission_classes = [CsrfProtectedWrites]
    throttle_classes = [AuthThrottle]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method == 'POST' and not isinstance(request.data, Mapping):
            raise ValidationError({'error': 'invalid_payload'})


class LoginView(AuthView):
    def get(self, request):
        return Response({'redirect': safe_next(request, request.query_params.get('next'))})

    def post(self, request):
        form = AuthenticationForm(request=request._request, data=request.data)
        if not form.is_valid():
            return Response({'errors': dict(form.errors)}, status=400)
        login(request._request, form.get_user())
        return Response({'redirect': safe_next(request, request.data.get('next'))})


class SignupView(AuthView):
    def post(self, request):
        if request.user.is_authenticated:
            return Response({'redirect': safe_next(request, request.data.get('next'))})
        form = UserCreationForm(request.data)
        if not form.is_valid():
            return Response({'errors': dict(form.errors)}, status=400)
        try:
            with transaction.atomic():
                user = form.save()
        except IntegrityError:
            message = form.instance.unique_error_message(get_user_model(), ('username',))
            return Response({'errors': {'username': message.messages}}, status=400)
        login(request._request, user, backend='django.contrib.auth.backends.ModelBackend')
        return Response({'redirect': safe_next(request, request.data.get('next'))}, status=201)


class LogoutView(AuthView):
    throttle_classes = []

    def post(self, request):
        logout(request._request)
        return Response({'authenticated': False})


class PasswordResetView(AuthView):
    def post(self, request):
        form = PasswordResetForm(request.data)
        if form.is_valid():
            try:
                form.save(request=request._request, use_https=True,
                          domain_override=request.get_host(),
                          email_template_name='api/password_reset_email.txt',
                          extra_email_context={'locale': locale()})
            except Exception:
                logger.exception('Password reset email delivery failed')
        return Response({'sent': True})


class PasswordResetConfirmView(AuthView):
    def get_user(self, data):
        if not isinstance(data.get('uid'), str) or not isinstance(data.get('token'), str):
            return None
        try:
            user = get_user_model().objects.get(pk=urlsafe_base64_decode(data.get('uid', '')).decode())
            if default_token_generator.check_token(user, data.get('token', '')):
                return user
        except (ValueError, TypeError, OverflowError, UnicodeDecodeError, get_user_model().DoesNotExist):
            pass
        return None

    def get(self, request):
        if self.get_user(request.query_params) is None:
            return Response({'error': 'invalid_link'}, status=400)
        return Response({'valid': True})

    def post(self, request):
        user = self.get_user(request.data)
        if user is None:
            return Response({'error': 'invalid_link'}, status=400)
        form = SetPasswordForm(user, request.data)
        if not form.is_valid():
            return Response({'errors': dict(form.errors)}, status=400)
        form.save()
        return Response({'complete': True})


class PasswordChangeView(AuthView):
    permission_classes = [CsrfProtectedWrites, IsAuthenticated]

    def get(self, request):
        return Response({'has_password': request.user.has_usable_password()})

    def post(self, request):
        if not request.user.has_usable_password():
            return Response({'error': 'no_password'}, status=400)
        form = PasswordChangeForm(request.user, request.data)
        if not form.is_valid():
            return Response({'errors': dict(form.errors)}, status=400)
        user = form.save()
        update_session_auth_hash(request._request, user)
        return Response({'complete': True})
