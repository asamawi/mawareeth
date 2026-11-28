import json
import unicodedata
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase
from django.utils import translation

import i18n
from calc import proof, schools
from engine.contracts import codes
from i18n import glyphs
from mawareeth import web_headers
from reports.report import build_context

ROOT = Path(__file__).resolve().parent.parent


def presented_hanafi(lang):
    """A presented answer with no heirs' rows to speak of: only the School line, which the report shows."""
    from engine.contracts import dump_presented_result
    from engine.tests.test_core import family
    import presentation
    resolved = codes_resolve({'kind': 'school', 'school': 'hanafi'})
    return dump_presented_result(presentation.present(
        presentation.outcome(family(['son']), resolved), resolved, lang, None))


def codes_resolve(basis):
    from engine.contracts import resolve_basis
    return resolve_basis(basis, {})


def required_keys():
    keys = [f'relationship.{c}' for c in codes.RELATIONSHIPS]
    keys += [f'school.{c}' for c in codes.SCHOOLS] + [f'school.{c}.description' for c in codes.SCHOOLS]
    keys += [f'basis.{c}' for c in codes.BASIS_KINDS] + [f'refusal.{c}' for c in codes.REFUSAL_REASONS]
    for kind, vocabulary in (('rule', codes.PROOF_RULES), ('condition', codes.PROOF_CONDITIONS),
                             ('blocked_by', codes.BLOCKED_BY), ('school_rule', codes.SCHOOL_RULES),
                             ('option', codes.PROOF_OPTIONS), ('step', codes.PROOF_STEPS)):
        keys += [f'proof.{kind}.{c}' for c in vocabulary]
    keys += ['proof.verse.quran_4_11', 'proof.verse.quran_4_12', 'proof.verse.quran_4_176']
    keys += [f'table.column.{c}' for c in ('base', 'awl', 'radd', 'remainder', 'radd_calc', 'radd_union', 'correction')]
    return keys + ['notice.disclaimer', 'notice.supplied_facts', 'notice.supplied_facts_no_amount', 'comparison.same_in_all_schools']


class LookupTests(SimpleTestCase):
    def test_term_resolves_regional_tags_unknown_locales_and_keys(self):
        self.assertEqual(i18n.term('relationship.father', 'fr-ca'), i18n.term('relationship.father', 'fr'))
        self.assertNotEqual(i18n.term('relationship.father', 'fr'), i18n.term('relationship.father', 'en'))
        self.assertEqual(i18n.term('relationship.father', 'de'), i18n.term('relationship.father', i18n.fallback_locale()))
        with self.assertRaises(KeyError):
            i18n.term('relationship.nobody', 'en')

    def test_registry_values(self):
        self.assertEqual(i18n.published_codes(), ['ar', 'en', 'fr'])
        self.assertEqual((i18n.default_locale(), i18n.fallback_locale()), ('ar', 'en'))
        self.assertEqual(i18n.locale_config('ar')['direction'], 'rtl')
        self.assertEqual({c: i18n.locale_config(c)['default_currency'] for c in i18n.published_codes()},
                         {'ar': 'SAR', 'en': 'USD', 'fr': 'EUR'})
        from babel import numbers
        for code in i18n.published_codes():
            self.assertIn(i18n.locale_config(code)['default_currency'], numbers.list_currencies())
        self.assertEqual(i18n.resolve_locale('AR_sa'), 'ar')
        self.assertEqual(i18n.resolve_locale(None), 'en')
        with self.assertRaises(KeyError):
            i18n.locale_config('de')


class ConsumerTests(SimpleTestCase):
    def test_settings_derive_from_the_registry(self):
        self.assertEqual(settings.LANGUAGES, i18n.django_languages())
        self.assertEqual(settings.LANGUAGE_CODE, i18n.default_locale())
        self.assertEqual(web_headers.LANGUAGES, tuple(i18n.published_codes()))

    def test_every_catalog_has_every_required_key_and_no_empty_text(self):
        for code in i18n.published_codes():
            terms = i18n.catalog(code).terms
            with self.subTest(code):
                self.assertEqual(sorted(set(required_keys()) - set(terms)), [])
                self.assertTrue(all(t.text.strip() for t in terms.values()))

    def test_proof_labels_equal_the_catalog(self):
        for lang in i18n.published_codes():
            with translation.override(lang):
                for kind, vocabulary in proof.VOCABULARY.items():
                    for code in vocabulary:
                        segment = 'quran_' + code.replace(':', '_') if kind == 'verse' else code
                        self.assertEqual(proof.label(kind, code), i18n.term(f'proof.{kind}.{segment}', lang))

    def test_refusal_reasons_equal_the_catalog(self):
        for lang in i18n.published_codes():
            with translation.override(lang):
                for reason, message in {**schools.REASONS, **schools.LAYERED_REASONS}.items():
                    self.assertEqual(str(message), i18n.term(f'refusal.{reason}', lang))
                self.assertEqual(schools.UnsupportedCase(schools.MALIKIYYA_DISPUTED).message,
                                 i18n.term('refusal.malikiyya_disputed', lang))

    def test_report_direction_and_font_come_from_the_registry(self):
        case = {'deceased': {'gender': 'male'}, 'heirs': [], 'madhab': 'hanafi'}
        body = {'basis': {'estate': None}}
        for lang in i18n.published_codes():
            with translation.override(lang):
                body['presented'] = presented_hanafi(lang)
                context = build_context(case, body)
            config = i18n.locale_config(lang)
            self.assertEqual(context['direction'], config['direction'])
            for family in config['pdf_font_stack']:
                self.assertIn(f'"{family}"', context['font_family'])
            # A son alone: all four Schools agree, so the chosen School is named and the agreement follows it.
            self.assertEqual(body['presented']['school_line']['code'], 'same_in_all_schools')
            self.assertEqual(context['school'], i18n.term('school.hanafi', lang))
            self.assertEqual(context['agreement'], body['presented']['school_line']['text'])

    def test_non_arabic_catalogs_have_no_arabic_script(self):
        for code in i18n.published_codes():
            if code == 'ar':
                continue
            for key, term in i18n.catalog(code).terms.items():
                self.assertFalse(any('ARABIC' in unicodedata.name(c, '') for c in term.text), (code, key))

    def test_catalog_files_are_valid_json_with_the_catalog_shape(self):
        for code in i18n.published_codes():
            data = json.loads((ROOT / 'i18n' / 'terms' / f'{code}.json').read_text(encoding='utf-8'))
            self.assertEqual(data['locale'], code)
            self.assertEqual({t['review'] for t in data['terms'].values()}, {'pending'})


class GlyphCheckTests(SimpleTestCase):
    FONTS = {'A': {ord('a'), ord('b')}, 'B': {ord('c')}}

    def run_check(self, stack, texts):
        return glyphs.check({'en': stack}, {'en': texts}, self.FONTS.get)

    def test_covered_text_passes_and_skips_whitespace_and_format_characters(self):
        self.assertEqual(self.run_check(['A', 'B'], {'k': 'ab c‏\n'}), [])

    def test_a_missing_character_names_locale_key_and_code_point(self):
        errors = self.run_check(['A'], {'proof.step.base': 'abz'})
        self.assertEqual(len(errors), 1)
        for part in ('en', 'proof.step.base', 'U+007A'):
            self.assertIn(part, errors[0])

    def test_an_absent_family_is_an_error(self):
        errors = self.run_check(['A', 'Missing'], {'k': 'a'})
        self.assertEqual(len(errors), 1)
        self.assertIn('Missing', errors[0])
