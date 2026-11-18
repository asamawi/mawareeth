"""AD-19 display changes, kept apart from engine answers. For representative values in each Locale the legacy
string (preview amount `.2f`, report `percent_of` / `kirat_of`, fraction `n/d`) sits beside the presented one.
The test regenerates the table and compares it with fixtures/display-changes.json; engine answers never appear.

Rewrite the file after an intended change:  uv run python -m presentation.tests.test_display_changes --write
"""
import json
import sys
import unittest
from fractions import Fraction as F
from pathlib import Path

from presentation.formatting import formatter
from presentation.money import round_minor

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'display-changes.json'
LOCALES = ('ar', 'en', 'fr')
SHARES = (F(1, 8), F(1, 3), F(7, 40), F(1, 16), F(17, 48), F(1, 960))
ESTATE_MINOR = 100001
CURRENCIES = {'ar': 'SAR', 'en': 'USD', 'fr': 'EUR'}


def legacy_percent(share):
    """reports.report.percent_of, copied (this module may not import Django), shown with the template's %."""
    tenths = (share.numerator * 2000 + share.denominator) // (2 * share.denominator)
    return f'{tenths // 10}.{tenths % 10}%'


def legacy_kirat(share):
    """reports.report.kirat_of, copied."""
    hundredths = (share.numerator * 4800 + share.denominator) // (2 * share.denominator)
    return f'{hundredths // 100}.{hundredths % 100:02}'


def legacy_amount(share):
    """api.preview: the amount rounded half-up to two decimals, shown with `.2f` and no currency."""
    cents = round_minor(ESTATE_MINOR, share)
    return f'{cents // 100}.{cents % 100:02}'


def table():
    rows = []
    for locale in LOCALES:
        f = formatter(locale)
        for share in SHARES:
            for kind, legacy, presented in (
                    ('fraction', f'{share.numerator}/{share.denominator}', f.fraction(share)),
                    ('percent', legacy_percent(share), f.percent(share)),
                    ('kirat', legacy_kirat(share), f.kirat(share)),
                    ('amount', legacy_amount(share), f.money(round_minor(ESTATE_MINOR, share), CURRENCIES[locale]))):
                rows.append({'locale': locale, 'kind': kind, 'value': f'{share.numerator}/{share.denominator}',
                             'estate_minor': ESTATE_MINOR if kind == 'amount' else None,
                             'legacy': legacy, 'presented': presented, 'display_change': legacy != presented})
    return rows


def dump(rows):
    return json.dumps(rows, indent=2, ensure_ascii=False) + '\n'


class DisplayChangeTests(unittest.TestCase):
    def test_the_table_is_current(self):
        self.assertEqual(json.loads(FIXTURE.read_text(encoding='utf-8')), table())

    def test_fractions_never_change_and_every_change_is_labelled(self):
        rows = table()
        self.assertTrue(all(not r['display_change'] for r in rows if r['kind'] == 'fraction'))
        self.assertTrue(any(r['display_change'] for r in rows if r['kind'] == 'amount'))
        self.assertTrue(all(r['display_change'] == (r['legacy'] != r['presented']) for r in rows))

    def test_the_file_holds_no_engine_answer(self):
        for row in json.loads(FIXTURE.read_text(encoding='utf-8')):
            self.assertEqual(set(row), {'locale', 'kind', 'value', 'estate_minor', 'legacy', 'presented', 'display_change'})


if __name__ == '__main__':
    if sys.argv[1:] == ['--write']:
        FIXTURE.write_text(dump(table()), encoding='utf-8', newline='\n')
    else:
        unittest.main()
