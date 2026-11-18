"""The compatibility shim delegates all kinship tables to the engine."""
import ast
from pathlib import Path
import unittest

from api import anonymous_case, heir_rules
from engine.kinship import RELATIONSHIP_GENDERS


class HeirRuleAdapterTests(unittest.TestCase):
    def test_relationship_genders(self):
        self.assertEqual(RELATIONSHIP_GENDERS, anonymous_case.RELATIONSHIPS)

    def test_no_literal_tables(self):
        tree = ast.parse(Path(heir_rules.__file__).read_text())
        for node in tree.body:
            if isinstance(node, (ast.Assign, ast.AnnAssign)):
                self.assertFalse(any(isinstance(n, (ast.Dict, ast.Set, ast.List)) for n in ast.walk(node)))

    def test_unknown_school(self):
        self.assertEqual(heir_rules.blocked_relationships('unknown', {'son': 1}), set())

    def test_unknown_relationship_is_ignored(self):
        self.assertEqual(heir_rules.blocked_relationships('hanafi', {'grandmother': 1, 'son': 1}),
                         heir_rules.blocked_relationships('hanafi', {'son': 1}))

    def test_legacy_blocked_set_includes_impossible_candidates(self):
        self.assertIn('grandfather', heir_rules.blocked_relationships('hanafi', {'father': 1, 'grandfather': 1}))
