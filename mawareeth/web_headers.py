"""Response headers for the Next.js export that WhiteNoise serves under /app/."""

WEB_PREFIX = '/app/'
WEB_HASHED_ASSET_PREFIX = '/app/_next/static/'
ONE_YEAR_SECONDS = 31536000


def add_web_headers(headers, path, url):
    """Set WhiteNoise's precomputed headers for files of the export.

    WhiteNoise answers before XFrameOptionsMiddleware runs, so that header has
    to be added here. Everything outside /app/ is left as it is, including the
    immutable-file handling /static/ relies on.
    """
    if not url.startswith(WEB_PREFIX):
        return
    headers['X-Frame-Options'] = 'DENY'
    headers['X-Robots-Tag'] = 'noindex'
    if url.startswith(WEB_HASHED_ASSET_PREFIX):
        headers['Cache-Control'] = f'public, max-age={ONE_YEAR_SECONDS}, immutable'
    else:
        # Pages name the hashed assets of their release, so they must revalidate.
        headers['Cache-Control'] = 'no-cache'
