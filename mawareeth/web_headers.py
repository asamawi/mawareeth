"""Response headers for the Next.js export that WhiteNoise serves from the site root."""

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
