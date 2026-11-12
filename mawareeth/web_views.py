from django.conf import settings
from django.contrib.auth.decorators import login_not_required
from django.http import HttpResponseRedirect
from django.utils.cache import patch_vary_headers
from django.utils.translation import get_language
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe


@login_not_required
@never_cache
@require_safe
def app_root(request):
    """Send /app/ to the export's page for the language LocaleMiddleware activated."""
    language = get_language()
    if language not in dict(settings.LANGUAGES):
        language = settings.LANGUAGE_CODE
    query = request.META.get('QUERY_STRING')
    response = HttpResponseRedirect(f'/app/{language}/' + (f'?{query}' if query else ''))
    response['X-Robots-Tag'] = 'noindex'
    patch_vary_headers(response, ('Cookie', 'Accept-Language'))
    return response


@login_not_required
@never_cache
@require_safe
def auth_redirect(request, page='login', uidb64=None, token=None, lang=None):
    language = lang or get_language()
    if language not in ('ar', 'en', 'fr'):
        language = 'en'
    query = request.GET.copy()
    if uidb64 is not None:
        query['uid'] = uidb64
        query['token'] = token
    encoded = query.urlencode()
    return HttpResponseRedirect(f'/app/{language}/{page}/' + (f'?{encoded}' if encoded else ''))
