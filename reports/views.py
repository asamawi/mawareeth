import logging
import traceback

from django.http import HttpResponse
from django.utils import timezone, translation
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from rest_framework.negotiation import BaseContentNegotiation
from rest_framework.renderers import JSONRenderer
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from api import anonymous_case, preview
from api.throttling import ReportDraftThrottle
from api.views import ApiView, _asked_language
from reports.report import render_pdf
from reports.status import report_status

logger = logging.getLogger(__name__)


class DraftContentNegotiation(BaseContentNegotiation):
    """PDF success bypasses DRF rendering; all API errors remain JSON."""

    def select_renderer(self, request, renderers, format_suffix=None):
        renderer = renderers[0]
        return renderer, renderer.media_type


@method_decorator(never_cache, name='dispatch')
class DraftReportView(ApiView):
    renderer_classes = [JSONRenderer]
    content_negotiation_class = DraftContentNegotiation
    permission_classes = [AllowAny]
    throttle_classes = [ReportDraftThrottle]

    def get(self, request):
        case_id = request.query_params.get('case_id')
        if not case_id:
            return Response({'detail': 'case_id is required.'}, status=400)
        case = anonymous_case.get(request)
        if case is None:
            return Response({'detail': 'There is no current case.', 'case': None}, status=404)
        if case['id'] != case_id:
            return Response({'detail': 'That case is no longer the current one.', 'case': case}, status=409)
        try:
            with translation.override(_asked_language(request)):
                if report_status(case) != 'draft':
                    raise ValueError()
                body = preview.preview(case)
                if body['status'] != 'available':
                    return Response({'status': body['status'], 'reason': body.get('reason')}, status=409)
                pdf = render_pdf(case, body)
        except Exception as error:
            logger.error('Draft report failed: %s\n%s', type(error).__name__,
                         ''.join(traceback.format_tb(error.__traceback__)))
            return Response({'detail': 'The draft report is unavailable.'}, status=503)
        response = HttpResponse(pdf, content_type='application/pdf')
        response['Content-Disposition'] = (
            f'attachment; filename="mawareeth-draft-{timezone.now().date().isoformat()}.pdf"')
        response['Cache-Control'] = 'no-store'
        return response
