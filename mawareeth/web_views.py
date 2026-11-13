from django.conf import settings
from django.contrib.auth.decorators import login_not_required
from django.http import HttpResponseRedirect
from django.utils.cache import patch_vary_headers
from django.utils.translation import get_language
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe


def _language_redirect(language, query):
    response = HttpResponseRedirect(f'/{language}/' + (f'?{query}' if query else ''))
    response['X-Robots-Tag'] = 'noindex'
    patch_vary_headers(response, ('Cookie', 'Accept-Language'))
    return response


@login_not_required
@never_cache
@require_safe
def site_root(request):
    """Send / to the export's page for the language LocaleMiddleware activated.

    A static index.html cannot negotiate the language, so Django owns this path.
    """
    language = get_language()
    if language not in dict(settings.LANGUAGES):
        language = settings.LANGUAGE_CODE
    return _language_redirect(language, request.META.get('QUERY_STRING'))


@login_not_required
@never_cache
@require_safe
def legacy_app_redirect(request, rest=''):
    """Redirect the retired /app/<rest> URLs to /<rest> (302, so a rollback stays safe)."""
    # A backslash or control character right after the slash would let a browser read
    # the Location as protocol-relative (/\evil.com, /<TAB>/evil.com), so such paths
    # get the plain language redirect instead.
    rest = rest.lstrip('/\\')
    if not rest or any(ord(char) < 32 or ord(char) == 127 or char == '\\' for char in rest):
        return site_root(request)
    query = request.META.get('QUERY_STRING')
    response = HttpResponseRedirect(f'/{rest}' + (f'?{query}' if query else ''))
    response['X-Robots-Tag'] = 'noindex'
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
    return HttpResponseRedirect(f'/{language}/{page}/' + (f'?{encoded}' if encoded else ''))
