"""PDF glyph check: every character a published Locale prints must exist in a font of its stack.

`check` is pure. The CLI resolves the font families with fontconfig and reads their character
maps with fontTools, and exits 1 on any gap or missing family.
"""
import subprocess
import sys
import unicodedata
from pathlib import Path

import i18n

ROOT = Path(__file__).resolve().parent.parent


def check(locales, texts, resolve_font):
    """One error per Locale, key and character that no font of the Locale's stack covers.

    `locales` maps a code to its font-family stack, `texts` maps a code to {key: text}, and
    `resolve_font(family)` returns a set of code points, or None when the family is absent."""
    errors = []
    for code, stack in locales.items():
        covered = set()
        absent = False
        for family in stack:
            cmap = resolve_font(family)
            if cmap is None:
                absent = True
                errors.append(f'{code}: font family {family} is not installed')
            else:
                covered |= set(cmap)
        if absent:  # coverage cannot be judged until the whole stack is installed
            continue
        reported = set()
        for key, text in texts.get(code, {}).items():
            for char in text:
                if char.isspace() or unicodedata.category(char) in ('Cf', 'Cc'):
                    continue
                if ord(char) not in covered and (key, char) not in reported:
                    reported.add((key, char))
                    errors.append(f'{code}: {key}: U+{ord(char):04X} is in no font of {", ".join(stack)}')
    return errors


def _po_msgstrs(code):
    import polib
    po = polib.pofile(str(ROOT / 'locale' / code / 'LC_MESSAGES' / 'django.po'))
    texts = {}
    for entry in po:
        if entry.obsolete:
            continue
        if entry.msgstr:
            texts[f'po:{entry.msgid}'] = entry.msgstr
        for index, text in sorted(entry.msgstr_plural.items()):
            if text:
                texts[f'po:{entry.msgid}[{index}]'] = text
    return texts


def texts_of(code):
    terms = {key: term.text for key, term in i18n.catalog(code).terms.items()}
    return {**terms, **_po_msgstrs(code)}


def installed_fonts():
    """{family: font file} from fontconfig. Raises FileNotFoundError when fc-list is absent."""
    out = subprocess.run(['fc-list', ':', 'family', 'file'], capture_output=True, check=True).stdout
    out = out.decode('utf-8', errors='replace')
    fonts = {}
    for line in out.splitlines():
        path, _, families = line.partition(': ')
        for family in families.split(','):
            fonts.setdefault(family.strip(), []).append(path.strip().rstrip(':'))
    return fonts


def main():
    try:
        fonts = installed_fonts()
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        print(f'fc-list is unavailable ({error}); the glyph check cannot run', file=sys.stderr)
        return 2
    from fontTools.ttLib import TTFont, TTCollection
    cache = {}

    def resolve_font(family):
        if family not in fonts:
            return None
        if family not in cache:
            points = set()
            for path in fonts[family]:
                try:
                    if path.lower().endswith(('.ttc', '.otc')):
                        for font in TTCollection(path, lazy=True).fonts:
                            points |= set(font.getBestCmap())
                    else:
                        points |= set(TTFont(path, lazy=True).getBestCmap())
                except Exception:  # an unreadable file is skipped; coverage then fails loudly
                    continue
            cache[family] = points
        return cache[family]

    stacks = {code: i18n.locale_config(code)['pdf_font_stack'] for code in i18n.published_codes()}
    texts = {code: texts_of(code) for code in stacks}
    errors = check(stacks, texts, resolve_font)
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == '__main__':
    sys.path.insert(0, str(ROOT))
    raise SystemExit(main())
