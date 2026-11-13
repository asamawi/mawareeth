"""Response headers for the Next.js export that WhiteNoise serves from the site root."""

import base64
import hashlib
import logging
from html.parser import HTMLParser

logger = logging.getLogger(__name__)

STATIC_PREFIX = '/static/'
WEB_HASHED_ASSET_PREFIX = '/_next/static/'
ONE_YEAR_SECONDS = 31536000

LANGUAGES = ('ar', 'en', 'fr')
PUBLIC_PAGES = ('', 'about/', 'terms/', 'privacy/')
# Only these export files may be indexed. Everything else keeps noindex.
PUBLIC_URLS = frozenset(
    [f'/{lang}/{page}' for lang in LANGUAGES for page in PUBLIC_PAGES]
    + [f'/{lang}/{page}index.html' for lang in LANGUAGES for page in PUBLIC_PAGES]
    + ['/robots.txt', '/sitemap.xml', '/llms.txt']
)

EXECUTABLE_SCRIPT_TYPES = ('', 'text/javascript', 'module')
CSP_TEMPLATE = (
    "default-src 'self'; script-src {script_src}; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; "
    "base-uri 'none'; frame-ancestors 'none'; "
    "form-action 'self' https://www.facebook.com https://www.linkedin.com"
)


class _InlineScriptCollector(HTMLParser):
    """Collects the raw text of inline executable scripts, in document order."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.scripts = []
        self._buffer = None

    def handle_starttag(self, tag, attrs):
        if tag != 'script':
            return
        attributes = dict(attrs)
        if 'src' in attributes:
            return
        script_type = (attributes.get('type') or '').strip().lower()
        if script_type in EXECUTABLE_SCRIPT_TYPES:
            self._buffer = []

    def handle_data(self, data):
        if self._buffer is not None:
            self._buffer.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self._buffer is not None:
            self.scripts.append(''.join(self._buffer))
            self._buffer = None


def inline_script_hashes(html):
    collector = _InlineScriptCollector()
    collector.feed(html)
    collector.close()
    hashes = []
    for script in collector.scripts:
        # Browsers hash the parsed text, and HTML parsing turns CRLF and lone CR into LF.
        script = script.replace('\r\n', '\n').replace('\r', '\n')
        digest = base64.b64encode(hashlib.sha256(script.encode('utf-8')).digest()).decode('ascii')
        token = f"'sha256-{digest}'"
        if token not in hashes:
            hashes.append(token)
    return hashes


def content_security_policy(path):
    """CSP for one export page; unreadable files fail closed (no inline scripts)."""
    try:
        with open(path, encoding='utf-8', newline='') as page:
            hashes = inline_script_hashes(page.read())
    except (OSError, ValueError):
        logger.warning('CSP for %s allows no inline scripts: the page could not be read', path, exc_info=True)
        hashes = []
    return CSP_TEMPLATE.format(script_src=' '.join(["'self'", *hashes]))


def add_web_headers(headers, path, url):
    """Set WhiteNoise's precomputed headers for files of the export.

    WhiteNoise answers before XFrameOptionsMiddleware runs, so that header has
    to be added here. /static/ (Django collectstatic) is left as it is, including
    the immutable-file handling it relies on. WhiteNoise passes both the /ar/ and
    the /ar/index.html form of a page URL.
    """
    if url.startswith(STATIC_PREFIX):
        return
    headers['X-Frame-Options'] = 'DENY'
    if url.startswith(WEB_HASHED_ASSET_PREFIX):
        headers['X-Robots-Tag'] = 'noindex'
        headers['Cache-Control'] = f'public, max-age={ONE_YEAR_SECONDS}, immutable'
        return
    # Pages name the hashed assets of their release, so they must revalidate.
    headers['Cache-Control'] = 'no-cache'
    if url not in PUBLIC_URLS:
        headers['X-Robots-Tag'] = 'noindex'
    if url.endswith('/') or url.endswith('.html'):
        headers['Content-Security-Policy'] = content_security_policy(path)
