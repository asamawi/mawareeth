"""Presentation tests: unittest only, no Django. Every row of the I/O matrix, in ar, en and fr."""
import ast
import json
import unittest
from datetime import datetime
from decimal import Decimal
from fractions import Fraction as F
from pathlib import Path

from babel import Locale, numbers

import i18n
import presentation as p
from engine import contracts as c
from engine.contracts.family import Currency
from engine.tests.test_core import MALIKIYYA, family_document, later_deaths_document, person

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ('ar', 'en', 'fr')
COMPARE = {'kind': 'compare'}


def family(relationships, estate=None, names=None, edges=(), statuses=None):
    document = family_document(relationships)
    document['estate'] = {'amount_minor': estate, 'currency': None}
    for index, entry in enumerate(document['persons']):
        if names and names[index]:
            entry['name'] = names[index]
    document['edges'] = list(edges)
    return c.parse_family(document)


def run(fam, basis=COMPARE, locale='en', currency=None, enabled=None):
    resolved = c.resolve_basis(basis, {})
    out = p.outcome(fam, resolved)
    result = p.present(out, resolved, locale, currency)
    assert c.parse_presented_result(c.dump_presented_result(result)) == result
    return result


def babel_of(locale):
    config = i18n.locale_config(locale)
    return Locale.parse(config['babel_locale']), config['numbering_system']


class MatrixTests(unittest.TestCase):
    def test_compare_agreement(self):
        for locale in LOCALES:
            with self.subTest(locale):
                r = run(family(['wife', 'mother', 'daughter', 'daughter', 'daughter'], 100000), locale=locale)
                self.assertEqual((r.state, r.comparison_outcome), ('answer', 'agreement'))
                self.assertEqual(r.school_line['code'], 'same_in_all_schools')
                self.assertEqual(r.school_line['text'], i18n.term('comparison.same_in_all_schools', locale))
                self.assertIsNone(r.comparison)
                self.assertEqual([row['share']['fraction']['denominator'] for row in r.rows], [8, 40, 30, 30, 30])
                self.assertEqual(r.locale, locale)
                self.assertEqual(r.direction, 'rtl' if locale == 'ar' else 'ltr')

    def test_compare_difference_names_the_affected_persons(self):
        r = run(family(['grandfather', 'brother']))
        self.assertEqual((r.state, r.comparison_outcome, r.rows, r.evidence), ('selection_required', 'difference', (), ()))
        self.assertEqual([s['school'] for s in r.comparison['schools']], list(c.codes.SUNNI_SCHOOLS))
        self.assertEqual(r.comparison['differing_persons'], ['h0', 'h1'])
        by = {s['school']: {x['person']: x['share']['fraction'] for x in s['shares']} for s in r.comparison['schools']}
        self.assertEqual(by['hanafi']['h0'], {'numerator': 1, 'denominator': 1})
        self.assertEqual(by['hanbali']['h0'], {'numerator': 1, 'denominator': 2})
        hanafi = {x['person']: x['blocked'] for x in r.comparison['schools'][0]['shares']}
        self.assertEqual(hanafi, {'h0': False, 'h1': True})
        self.assertEqual((r.rounding, r.unallocated), (None, None))

    def test_partial_refusal_is_a_difference(self):
        r = run(family(MALIKIYYA))
        self.assertEqual((r.state, r.comparison_outcome), ('selection_required', 'difference'))
        by = {s['school']: s for s in r.comparison['schools']}
        self.assertEqual(by['maliki']['status'], 'refused')
        self.assertEqual(by['maliki']['refusal']['reason'], 'malikiyya_disputed')
        self.assertEqual(by['maliki']['shares'], [])
        self.assertEqual(r.refusals, ({'school': 'maliki', 'reason': 'malikiyya_disputed',
                                       'text': i18n.term('refusal.malikiyya_disputed', 'en')},))
        self.assertEqual([by[s]['status'] for s in ('hanafi', 'shafii', 'hanbali')], ['calculated'] * 3)
        out = p.outcome(family(MALIKIYYA), c.resolve_basis(COMPARE, {}))
        cmp = p.compare(out)
        self.assertTrue(cmp.selection_required)
        self.assertEqual(c.parse_comparison(c.dump_comparison(cmp)), cmp)

    def test_all_refused(self):
        for locale in LOCALES:
            r = run(family(['father', 'father']), locale=locale)
            self.assertEqual((r.state, r.comparison_outcome), ('refused', 'all_refused'))
            self.assertEqual([(x['reason'], x['text'], x['school']) for x in r.refusals],
                             [('invalid_family', i18n.term('refusal.invalid_family', locale), None)])
            self.assertEqual((r.rows, r.rounding, r.unallocated, r.comparison, r.evidence), ((), None, None, None, ()))

    def test_jafari_refuses(self):
        r = run(family(['son'], 1000), {'kind': 'school', 'school': 'jafari'})
        self.assertEqual((r.state, [x['reason'] for x in r.refusals]), ('refused', ['school_not_supported']))
        self.assertEqual(r.refusals[0]['school'], 'jafari')
        self.assertEqual((r.rows, r.rounding, r.unallocated, r.school_line), ((), None, None, None))

    def test_school_basis_answer(self):
        for locale in LOCALES:
            r = run(family(['grandfather', 'brother']), {'kind': 'school', 'school': 'hanafi'}, locale)
            self.assertEqual((r.state, r.comparison_outcome, r.comparison), ('answer', None, None))
            self.assertEqual(r.school_line, {'code': 'school', 'text': i18n.term('school.hanafi', locale)})

    def test_rounding(self):
        r = run(family(['son', 'son', 'son'], 100), currency=Currency('USD', True))
        self.assertEqual([row['amount']['amount_minor'] for row in r.rows], [33, 33, 33])
        self.assertEqual(r.rounding['amount_minor'], 1)
        self.assertIsNone(r.unallocated)

    def test_negative_rounding(self):
        r = run(family(['son', 'son'], 101))
        self.assertEqual([row['amount']['amount_minor'] for row in r.rows], [51, 51])
        self.assertEqual(r.rounding['amount_minor'], -1)

    def test_unallocated_is_separate_from_rounding(self):
        r = run(family(['wife'], 100001), {'kind': 'school', 'school': 'hanbali'})
        self.assertEqual(r.unallocated['fraction'], {'numerator': 3, 'denominator': 4})
        self.assertEqual(r.rows[0]['amount']['amount_minor'], 25000)
        self.assertEqual(r.unallocated['amount']['amount_minor'], 75001)
        self.assertEqual(r.rounding, None)
        r = run(family(['wife'], 6), {'kind': 'school', 'school': 'hanbali'})
        self.assertEqual((r.rows[0]['amount']['amount_minor'], r.unallocated['amount']['amount_minor']), (2, 5))
        self.assertEqual(r.rounding['amount_minor'], -1)

    def test_no_estate(self):
        r = run(family(['wife'], None), {'kind': 'school', 'school': 'hanbali'})
        self.assertEqual([row['amount'] for row in r.rows], [None])
        self.assertEqual((r.rounding, r.unallocated['amount']), (None, None))
        self.assertIsNotNone(r.unallocated)

    def test_precision_follows_the_currency(self):
        for code, digits, shown in (('KWD', 3, 'KWD'), ('JPY', 0, 'JP')):
            with self.subTest(code):
                r = run(family(['son'], 12345), currency=Currency(code, True))
                amount = r.rows[0]['amount']
                self.assertEqual((amount['amount_minor'], amount['currency']), (12345, code))
                self.assertEqual(amount['text'], numbers.format_currency(Decimal(12345).scaleb(-digits), code, locale='en',
                                                                        numbering_system='latn'))

    def test_minor_units(self):
        self.assertEqual(p.minor_units('1.5', 'USD'), 150)
        self.assertEqual(p.minor_units('2', 'JPY'), 2)
        self.assertEqual(p.minor_units('1.234', 'KWD'), 1234)
        for text, code in (('1.5', 'JPY'), ('1.234', 'USD'), ('0', 'USD'), ('-1', 'USD'), ('1e3', 'USD'), (' 1', 'USD'),
                           ('1,5', 'USD'), ('', 'USD'), ('NaN', 'USD'), (1.5, 'USD'), ('99999999999999999999', 'USD')):
            with self.subTest(text):
                with self.assertRaises(p.PresentationError) as raised:
                    p.minor_units(text, code)
                self.assertEqual(raised.exception.code, 'invalid_amount')
        with self.assertRaises(p.PresentationError) as raised:
            p.minor_units('1', 'XYZ')
        self.assertEqual(raised.exception.code, 'invalid_currency')

    def test_no_heirs_is_a_typed_error(self):
        with self.assertRaises(p.PresentationError) as raised:
            run(family([]), {'kind': 'school', 'school': 'hanbali'})
        self.assertEqual(raised.exception.code, 'no_heirs')

    def test_unknown_currency(self):
        with self.assertRaises(p.PresentationError) as raised:
            run(family(['son'], 100), currency=Currency('XYZ', True))
        self.assertEqual(raised.exception.code, 'invalid_currency')

    def test_explicit_and_defaulted_currency(self):
        fam = family(['son'], 100)
        self.assertEqual(run(fam, locale='ar', currency=Currency('EUR', True)).rows[0]['amount']['currency'], 'EUR')
        for currency in (None, Currency('EUR', False)):
            self.assertEqual(run(fam, locale='ar', currency=currency).rows[0]['amount']['currency'], 'SAR')
        self.assertEqual([p.default_currency(l) for l in LOCALES], ['SAR', 'USD', 'EUR'])
        self.assertEqual(p.default_currency('en', preset=type('P', (), {'default_currency': 'KWD'})()), 'KWD')

    def test_unregistered_locale_falls_back(self):
        r = run(family(['son'], 100), locale='de')
        self.assertEqual(r.locale, 'en')
        self.assertEqual(r.rows[0]['relationship']['translated']['text'], i18n.term('relationship.son', 'en'))

    def test_a_person_in_two_estates_keeps_the_first_estate_relationship(self):
        fam = c.parse_family(later_deaths_document(second_heirs=(('h1', 'mother'),)))
        r = run(fam, {'kind': 'school', 'school': 'hanbali'})
        self.assertEqual([row['person'] for row in r.rows], ['h1'])
        self.assertEqual(r.rows[0]['relationship']['translated']['text'], i18n.term('relationship.wife', 'en'))

    def test_later_deaths(self):
        document = later_deaths_document()
        document['estate'] = {'amount_minor': 1200, 'currency': None}
        fam = c.parse_family(document)
        resolved = c.resolve_basis({'kind': 'school', 'school': 'hanbali'}, {})
        out = p.outcome(fam, resolved)
        r = p.present(out, resolved, 'en', None)
        result = out.evaluations[0][1].result
        from engine import final_shares
        final = final_shares(result)
        self.assertEqual([row['person'] for row in r.rows], ['h1', 'h2'])
        self.assertEqual({row['person']: F(row['share']['fraction']['numerator'], row['share']['fraction']['denominator'])
                          for row in r.rows}, final)
        self.assertEqual([e['order'] for e in r.evidence], [1, 2])
        self.assertEqual((r.evidence[0]['deceased'], r.evidence[0]['inherited']), (None, None))
        self.assertEqual(r.evidence[1]['deceased'], 'h0')
        inherited = result.layers[0].inherited
        self.assertEqual(r.evidence[1]['inherited']['fraction'], {'numerator': inherited.numerator,
                                                                  'denominator': inherited.denominator})


class RowTests(unittest.TestCase):
    def test_rows_labels_and_isolation(self):
        for locale in LOCALES:
            with self.subTest(locale):
                r = run(family(['wife', 'son'], 1000, names=['Layla', None]), {'kind': 'school', 'school': 'hanbali'}, locale)
                wife, son = r.rows
                self.assertEqual(wife['name'], {'text': 'Layla', 'dir': 'auto'})
                self.assertIsNone(son['name'])
                self.assertEqual(wife['relationship']['translated'],
                                 {'text': i18n.term('relationship.wife', locale), 'lang': locale,
                                  'dir': 'rtl' if locale == 'ar' else 'ltr'})
                self.assertEqual(wife['relationship']['original'],
                                 {'text': i18n.term('relationship.wife', 'ar'), 'lang': 'ar', 'dir': 'rtl'})
                self.assertEqual((wife['kind'], son['kind']), ('fixed', 'residue'))
                for value in (wife['share'], wife['percent'], wife['kirat']):
                    self.assertEqual(value['dir'], 'ltr')
                self.assertEqual(wife['amount']['dir'], 'auto')
                left = run(family(['wife'], 1000), {'kind': 'school', 'school': 'hanbali'}, locale).unallocated
                self.assertEqual((left['dir'], left['amount']['dir']), ('ltr', 'auto'))

    def test_no_control_characters_are_injected(self):
        r = run(family(['wife', 'son'], 1000, names=['Layla', None]), {'kind': 'school', 'school': 'hanbali'}, 'en')
        for row in r.rows:
            for value in (row['share']['text'], row['percent']['text'], row['kirat']['text'], row['amount']['text']):
                self.assertFalse(any(ord(ch) < 32 or 0x200B <= ord(ch) <= 0x200F or 0x2066 <= ord(ch) <= 0x2069
                                     for ch in value), value)

    def test_blocked_persons_are_rows_with_zero_share(self):
        r = run(family(['son', 'brother'], 100), {'kind': 'school', 'school': 'hanbali'})
        brother = r.rows[1]
        self.assertEqual((brother['blocked'], brother['kind'], brother['share']['fraction']['numerator']),
                         (True, 'blocked', 0))
        self.assertEqual(brother['amount']['amount_minor'], 0)

    def test_evidence_follows_the_result(self):
        r = run(family(['wife', 'mother', 'daughter', 'daughter', 'daughter']), {'kind': 'school', 'school': 'hanbali'}, 'fr')
        entry = r.evidence[0]
        self.assertEqual([h['person'] for h in entry['heirs']], ['h0', 'h1', 'h2', 'h3', 'h4'])
        self.assertEqual(entry['heirs'][0]['verses'], [{'code': 'quran_4_12', 'text': i18n.term('proof.verse.quran_4_12', 'fr')}])
        self.assertEqual([s['step'] for s in entry['steps']], ['base', 'radd', 'correction'])
        self.assertEqual(entry['steps'][0]['text'], i18n.term('proof.step.base', 'fr'))
        self.assertEqual(entry['school_rules'], [{'code': 'radd', 'text': i18n.term('proof.school_rule.radd', 'fr')}])


def percent_of(numerator, denominator):
    """reports.report.percent_of, copied: the PDF's formula (this module may not import Django)."""
    tenths = (numerator * 2000 + denominator) // (2 * denominator)
    return f'{tenths // 10}.{tenths % 10}'


def kirat_of(numerator, denominator):
    """reports.report.kirat_of, copied."""
    hundredths = (numerator * 4800 + denominator) // (2 * denominator)
    return f'{hundredths // 100}.{hundredths % 100:02}'


class NumberTests(unittest.TestCase):
    def test_babel_strings(self):
        row_of = lambda locale: run(family(['wife', 'son'], 100000), {'kind': 'school', 'school': 'hanbali'}, locale).rows[0]
        expected = {'en': ('12.5%', '3.00'), 'fr': ('12,5\xa0%', '3,00')}
        for locale in LOCALES:
            with self.subTest(locale):
                row = row_of(locale)
                babel, numbering = babel_of(locale)
                amount = numbers.format_currency(Decimal('125.00'), i18n.locale_config(locale)['default_currency'],
                                                 locale=babel, numbering_system=numbering)
                self.assertEqual(row['amount']['text'], amount)
                self.assertEqual(row['share']['text'], '1/8')
                if locale in expected:
                    self.assertEqual((row['percent']['text'], row['kirat']['text']), expected[locale])
                else:
                    self.assertEqual(row['percent']['text'],
                                     numbers.format_percent(Decimal('0.125'), format=babel.percent_formats[None].pattern
                                                            .replace('#,##0', '#,##0.0', 1), locale=babel,
                                                            numbering_system=numbering))
                    self.assertEqual(row['kirat']['text'], '3.00')
        self.assertEqual(row_of('fr')['amount']['text'], '125,00\xa0\u20ac')
        self.assertEqual(row_of('en')['amount']['text'], '$125.00')

    def test_percent_and_kirat_are_half_up_in_decimal(self):
        from presentation.formatting import formatter
        f = formatter('en')
        self.assertEqual(f.percent(F(1, 3)), '33.3%')
        self.assertEqual(f.percent(F(1, 16)), '6.3%')       # 6.25 rounds up, Babel's half-even would give 6.2
        self.assertEqual(f.percent(F(1, 8)), '12.5%')
        self.assertEqual(f.percent(F(5, 1000)), '0.5%')
        self.assertEqual(f.kirat(F(1, 3)), '8.00')
        self.assertEqual(f.kirat(F(1, 16)), '1.50')
        self.assertEqual(f.kirat(F(1, 480)), '0.05')
        self.assertEqual(f.kirat(F(1, 960)), '0.03')        # 0.025 rounds up
        for n, d in ((1, 3), (1, 16), (7, 40), (1, 960), (1, 1), (0, 1), (5, 1000), (17, 48)):
            self.assertEqual(f.percent(F(n, d)), percent_of(n, d) + '%')
            self.assertEqual(f.kirat(F(n, d)), kirat_of(n, d))

    def test_fraction_is_reduced_and_ungrouped(self):
        from presentation.formatting import formatter
        self.assertEqual(formatter('en').fraction(F(2, 6)), '1/3')
        self.assertEqual(formatter('ar').fraction(F(12345, 123457)), '12345/123457')

    def test_no_float_in_the_output(self):
        r = run(family(['wife', 'mother', 'daughter', 'daughter', 'daughter'], 100000), locale='ar')

        def walk(value):
            if isinstance(value, float):
                self.fail('float in a PresentedResult')
            if isinstance(value, dict):
                [walk(v) for v in value.values()]
            if isinstance(value, (list, tuple)):
                [walk(v) for v in value]
        walk(c.dump_presented_result(r))

    def test_format_datetime(self):
        stamp = datetime(2026, 11, 17, 9, 5)
        self.assertEqual([p.format_datetime(stamp, l) for l in LOCALES], ['2026-11-17 09:05'] * 3)


class NoticeTests(unittest.TestCase):
    def notices(self, fam, basis, locale='en', enabled=None):
        resolved = c.resolve_basis(basis, {('sa', '2026-01-01'): 'hanbali'})
        out = p.Outcome(fam, ())
        return p.select_notices(resolved, locale, out) if enabled is None else p.select_notices(resolved, locale, out, enabled)

    def test_only_the_disclaimer_is_enabled(self):
        self.assertEqual(p.ENABLED_NOTICES, frozenset({'disclaimer'}))
        for basis in (COMPARE, {'kind': 'school', 'school': 'hanafi'}, {'kind': 'country', 'preset_id': 'sa', 'preset_version': '2026-01-01'}):
            self.assertEqual(self.notices(family(['son']), basis), ('disclaimer',))
        for locale in LOCALES:
            r = run(family(['son']), locale=locale)
            self.assertEqual(r.notices, ({'code': 'disclaimer', 'text': i18n.term('notice.disclaimer', locale)},))
        refused = run(family(['father', 'father']))
        self.assertEqual([n['code'] for n in refused.notices], ['disclaimer'])

    def test_enabled_notices_follow_their_predicates(self):
        everything = frozenset(('disclaimer', 'country_notice', 'citation', 'civil_law', 'obligatory_bequest_prompt', 'locale_beta'))
        edges = [{'kind': 'parent_of', 'from': 'd1', 'to': 'k1'}]
        fam = c.parse_family({**family_document(['son']), 'persons': [person('h0', 'son'), person('d1', 'son', 'died_before_or_with'), person('k1', 'son')],
                              'edges': edges})
        plain = family(['son'])
        country = {'kind': 'country', 'preset_id': 'sa', 'preset_version': '2026-01-01'}
        school = {'kind': 'school', 'school': 'hanafi'}
        self.assertEqual(self.notices(plain, COMPARE, enabled=everything), ('disclaimer', 'locale_beta'))
        self.assertEqual(self.notices(plain, school, enabled=everything), ('disclaimer', 'civil_law', 'locale_beta'))
        self.assertEqual(self.notices(plain, country, enabled=everything),
                         ('disclaimer', 'country_notice', 'citation', 'locale_beta'))
        self.assertEqual(self.notices(fam, school, enabled=everything),
                         ('disclaimer', 'civil_law', 'obligatory_bequest_prompt', 'locale_beta'))
        self.assertEqual(self.notices(fam, country, enabled=everything),
                         ('disclaimer', 'country_notice', 'citation', 'locale_beta'))
        self.assertEqual(self.notices(fam, COMPARE, enabled=frozenset({'obligatory_bequest_prompt'})),
                         ('obligatory_bequest_prompt',))
        self.assertEqual(self.notices(fam, school, enabled=frozenset()), ())


class PurityTests(unittest.TestCase):
    def test_presentation_imports_only_stdlib_engine_i18n_and_babel(self):
        allowed = {'engine', 'i18n', 'babel', 'presentation'}
        stdlib = set(__import__('sys').stdlib_module_names)
        for path in ROOT.glob('*.py'):
            for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
                names = []
                if isinstance(node, ast.Import):
                    names = [a.name for a in node.names]
                elif isinstance(node, ast.ImportFrom) and node.level == 0:
                    names = [node.module]
                for name in names:
                    top = name.split('.')[0]
                    self.assertTrue(top in allowed or top in stdlib, f'{path.name}: {name}')
                    self.assertNotIn(top, ('django', 'datetime', 'time', 'os', 'random'), f'{path.name}: {name}')

    def test_engine_does_not_import_presentation(self):
        for path in (ROOT.parent / 'engine').rglob('*.py'):
            self.assertNotIn('presentation', path.read_text(encoding='utf-8'), str(path))

    def test_importing_presentation_loads_no_django(self):
        import subprocess, sys
        code = 'import sys, presentation; sys.exit(1 if any(m == "django" or m.startswith("django.") for m in sys.modules) else 0)'
        self.assertEqual(subprocess.run([sys.executable, '-c', code], cwd=ROOT.parent).returncode, 0)


if __name__ == '__main__':
    unittest.main()
