from django.contrib.auth.decorators import login_not_required
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from api import anonymous_case
from api.permissions import CsrfProtectedWrites
from api.throttling import CaseWriteThrottle


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


@method_decorator(never_cache, name='dispatch')
class CaseView(ApiView):
    """Read or start the visitor's case, held in the session (no database case rows)."""

    permission_classes = [CsrfProtectedWrites]
    throttle_classes = [CaseWriteThrottle]

    def get(self, request):
        return Response({'case': anonymous_case.get(request)})

    def post(self, request):
        existing = anonymous_case.get(request)
        replace = request.data.get('replace') is True if isinstance(request.data, dict) else False
        if existing and not replace:
            return Response({'detail': 'A case already exists.', 'case': existing}, status=status.HTTP_409_CONFLICT)
        return Response({'case': anonymous_case.start(request)}, status=status.HTTP_201_CREATED)

    def patch(self, request):
        data = request.data
        if not isinstance(data, dict):
            return Response({'detail': 'Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)
        case_id = data.get('case_id')
        if case_id is not None and not isinstance(case_id, str):
            return Response({'detail': 'case_id must be a string.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            case = anonymous_case.set_madhab(request, data.get('madhab'), case_id)
        except ValueError:
            return Response({'detail': 'Unknown madhab.'}, status=status.HTTP_400_BAD_REQUEST)
        except anonymous_case.StaleCase as stale:
            return Response(
                {'detail': 'That case is no longer the current one.', 'case': stale.case},
                status=status.HTTP_409_CONFLICT)
        if case is None:
            raise NotFound()
        return Response({'case': case})


class NotFoundView(ApiView):
    """Answer unknown /api/v1/ paths in JSON instead of Django's HTML 404 page."""

    permission_classes = [AllowAny]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        raise NotFound()
