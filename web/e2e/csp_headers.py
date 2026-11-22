"""Prints the production response headers of every exported HTML page as JSON.

Usage: python csp_headers.py <export dir>. The headers come from mawareeth.web_headers
(the code WhiteNoise runs in production), so the CSP has one source of truth.
Output: {"/en/": {"Content-Security-Policy": "..."}, "/en/index.html": {...}, ...}
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from mawareeth.web_headers import add_web_headers  # noqa: E402


def main():
    if len(sys.argv) != 2:
        print('usage: csp_headers.py <export dir>', file=sys.stderr)
        return 1
    root = os.path.abspath(sys.argv[1])
    result = {}
    for folder, _dirs, files in os.walk(root):
        for name in sorted(files):
            if not name.endswith('.html'):
                continue
            path = os.path.join(folder, name)
            relative = os.path.relpath(folder, root).replace(os.sep, '/')
            directory = '/' if relative == '.' else f'/{relative}/'
            urls = [directory, directory + name] if name == 'index.html' else [directory + name]
            for url in urls:
                headers = {}
                add_web_headers(headers, path, url)
                result[url] = headers
    if not result:
        print(f'no HTML page found in {root}', file=sys.stderr)
        return 1
    json.dump(result, sys.stdout)
    return 0


if __name__ == '__main__':
    sys.exit(main())
