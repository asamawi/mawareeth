from django.contrib.auth.decorators import login_not_required
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


@method_decorator(login_not_required, name='dispatch')
class ApiView(APIView):
    """Base for every API view: DRF permissions answer in JSON.

    LoginRequiredMiddleware runs first and would otherwise send anonymous API
    clients a redirect to the HTML login page. This opts out of it only; access
    is still decided by permission_classes, which default to IsAuthenticated.
    """


@method_decorator([ensure_csrf_cookie, never_cache], name='dispatch')
class SessionView(ApiView):
    """Tell the frontend whether this browser is logged in, and issue its CSRF cookie."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({'authenticated': request.user.is_authenticated})


class NotFoundView(ApiView):
    """Answer unknown /api/v1/ paths in JSON instead of Django's HTML 404 page."""

    permission_classes = [AllowAny]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        raise NotFound()
