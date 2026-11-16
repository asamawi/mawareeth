"""The shared contract vocabularies must equal the constants the app already uses; none may be renamed or dropped."""
import json
from pathlib import Path

from django.test import SimpleTestCase

from api import anonymous_case, preview
from calc import proof, schools

CODES = json.loads((Path(__file__).resolve().parent.parent / 'contracts' / 'codes.json').read_text(encoding='utf-8'))


class ContractCodesTests(SimpleTestCase):
    def check(self, name, source):
        self.assertEqual(CODES[name], list(source), name)

    def test_relationships_genders_and_schools(self):
        self.check('relationships', anonymous_case.RELATIONSHIPS)
        self.check('genders', anonymous_case.GENDERS)
        self.check('schools', anonymous_case.MADHABS)
        self.check('schools', schools.KNOWN)
        self.check('sunni_schools', schools.SUNNI)

    def test_refusal_reasons(self):
        reasons = [*schools.REASONS, *schools.LAYERED_REASONS, preview.INVALID_FAMILY]
        self.check('refusal_reasons', reasons)

    def test_proof_vocabularies(self):
        self.check('proof_rules', proof.RULES)
        self.check('proof_conditions', proof.CONDITIONS)
        self.check('blocked_by', proof.BLOCKED_BY)
        self.check('proof_options', proof.OPTIONS)
        self.check('school_rules', proof.SCHOOL_RULES)
        self.check('proof_steps', proof.STEPS)

    def test_verse_codes_have_citation_keys(self):
        self.assertEqual([f'quran_{v.replace(":", "_")}' for v in proof.VERSE_CODES],
                         ['quran_4_11', 'quran_4_12', 'quran_4_176'])
