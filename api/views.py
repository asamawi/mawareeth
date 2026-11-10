import logging
import traceback

from django.contrib.auth.decorators import login_not_required
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from api import anonymous_case, preview
from api.permissions import CsrfProtectedWrites
from api.throttling import CasePreviewThrottle, CaseWriteThrottle

logger = logging.getLogger(__name__)


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
        data = request.data if isinstance(request.data, dict) else {}
        replace = data.get('replace') is True
        # A tab confirming "start over" names the case it showed; replacing a newer one is refused.
        meant = data.get('case_id')
        if existing and replace and isinstance(meant, str) and meant != existing['id']:
            return Response(
                {'detail': 'That case is no longer the current one.', 'case': existing},
                status=status.HTTP_409_CONFLICT)
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


@method_decorator(never_cache, name='dispatch')
class CaseWriteView(ApiView):
    """Base for the interview writes: each needs the case_id and answers with the whole case."""

    permission_classes = [CsrfProtectedWrites]
    throttle_classes = [CaseWriteThrottle]

    def write(self, request, action, success=status.HTTP_200_OK, data=None):
        """Run `action(data, case_id)`, which returns the case or None when there is none.

        `data` replaces the request body for a write that carries its input elsewhere.
        """
        data = request.data if data is None else data
        if not isinstance(data, dict):
            return Response({'detail': 'Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)
        case_id = data.get('case_id')
        if not isinstance(case_id, str) or not case_id:
            return Response({'detail': 'case_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            case = action(data, case_id)
        except anonymous_case.FieldErrors as invalid:
            return Response(
                {'detail': 'Invalid input.', 'errors': invalid.errors,
                 **({'questions': invalid.questions} if invalid.questions is not None else {})}, status=status.HTTP_400_BAD_REQUEST)
        except anonymous_case.StaleCase as stale:
            return Response(
                {'detail': 'That case is no longer the current one.', 'case': stale.case},
                status=status.HTTP_409_CONFLICT)
        except anonymous_case.HeirNotFound as missing:
            return Response(
                {'detail': 'That heir no longer exists.', 'case': missing.case},
                status=status.HTTP_404_NOT_FOUND)
        if case is None:
            return Response({'detail': 'There is no current case.', 'case': None}, status=status.HTTP_404_NOT_FOUND)
        return Response({'case': case}, status=success)


class DeceasedView(CaseWriteView):
    """Store the deceased on the visitor's case."""

    def put(self, request):
        return self.write(request, lambda data, case_id: anonymous_case.set_deceased(request, data, case_id))


class HeirsView(CaseWriteView):
    """Add an heir to the visitor's case."""

    def post(self, request):
        return self.write(
            request, lambda data, case_id: anonymous_case.add_heir(request, data, case_id),
            success=status.HTTP_201_CREATED)


class HeirView(CaseWriteView):
    """Edit or remove one heir."""

    def put(self, request, heir_id):
        return self.write(
            request, lambda data, case_id: anonymous_case.update_heir(request, heir_id, data, case_id))

    def delete(self, request, heir_id):
        # Intermediaries may drop a DELETE body, so the case id travels in the query string.
        return self.write(
            request, lambda data, case_id: anonymous_case.remove_heir(request, heir_id, case_id),
            data={'case_id': request.query_params.get('case_id')})


class NotFoundView(ApiView):
    """Answer unknown /api/v1/ paths in JSON instead of Django's HTML 404 page."""

    permission_classes = [AllowAny]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        raise NotFound()


@method_decorator(never_cache, name='dispatch')
class PreviewView(ApiView):
    """The shares of the visitor's case under its school, from the engine. Writes nothing.

    It reads the session and never touches it, so it does not refresh the expiry.
    """

    permission_classes = [AllowAny]
    throttle_classes = [CasePreviewThrottle]

    def get(self, request):
        case_id = request.query_params.get('case_id')
        if not case_id:
            return Response({'detail': 'case_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        case = anonymous_case.get(request)
        if case is None:
            return Response({'detail': 'There is no current case.', 'case': None}, status=status.HTTP_404_NOT_FOUND)
        if case['id'] != case_id:
            return Response(
                {'detail': 'That case is no longer the current one.', 'case': case},
                status=status.HTTP_409_CONFLICT)
        try:
            body = preview.preview(case)
        except Exception as error:
            # The kind of error and where it came from, never its message or locals: the case
            # holds names and amounts.
            logger.error(
                'Share preview failed: %s\n%s', type(error).__name__,
                ''.join(traceback.format_tb(error.__traceback__)))
            return Response({'detail': 'The preview is unavailable.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(body)


class DeathsView(CaseWriteView):
    def post(self, request):
        return self.write(request, lambda data, case_id: anonymous_case.mark_deceased(
            request, data.get('heir_id'), data.get('first'), case_id,
            relatives=data.get('relatives'), shared_father=data.get('shared_father')), success=status.HTTP_201_CREATED)


class DeathView(CaseWriteView):
    def delete(self, request, heir_id):
        return self.write(request, lambda data, case_id: anonymous_case.unmark_deceased(
            request, heir_id, case_id), data={'case_id': request.query_params.get('case_id')})
