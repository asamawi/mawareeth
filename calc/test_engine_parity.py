"""Parity of the in-memory engine with `Calculation.compute`, over the existing test corpus.

Every family of the corpus runs through both paths under every School. A mismatch is a port bug in
`engine/`, never a reason to edit a fixture or an expected value. The pure engine takes ids `h0..hn`
in the order the heirs were entered; the database path takes the rows made by `build_case`.

Only constants and functions are imported from `calc.tests`, never a TestCase class.
"""
import ast
import inspect
from fractions import Fraction as F
from itertools import product

from django.test import SimpleTestCase, TransactionTestCase, tag

import engine
from api import heir_rules
from engine import contracts
from engine import core as engine_core
from engine.proof import CITATION_KEYS

from . import schools
from . import tests as corpus
from .models import Calculation
from .proof import RELATIONSHIPS
from .tests import FIXTURES, HEIR_SEX, MUADDA_FIXTURES, SCHOOL_FIXTURES, build_case, families

ALL_SCHOOLS = schools.KNOWN
# the test classes whose `(sex, [types])` literals join the corpus
LITERAL_CLASSES = ('ProofMatrixTests', 'ProofGrandfatherOptionTests', 'ScholarsTableTests', 'MuaddaTests')
LITERAL_COUNT = 25
# ProofGrandfatherOptionTests writes no literal: it iterates families(), which the sweep already covers
NO_LITERALS = ('ProofGrandfatherOptionTests',)
GENDER = {'M': 'male', 'F': 'female'}


def relationship(cls):
    return RELATIONSHIPS[cls.__name__]


def build_family(sex, types):
    """The Family for `types`, with ids h0..hn in order of entry. The root has no sex in a Family."""
    ids = [f'h{i}' for i in range(len(types))]
    rels = [relationship(cls) for cls in types]
    return contracts.parse_family({
        'version': 1, 'root': 'root',
        'persons': [{'id': i, 'gender': 'male' if HEIR_SEX[cls] == 'M' else 'female', 'name': None,
                     'relationship': r, 'status': 'alive', 'death_order': None}
                    for i, cls, r in zip(ids, types, rels)],
        'edges': [],
        'estates': [{'order': 1, 'deceased': 'root',
                     'heirs': [{'person': i, 'relationship': r} for i, r in zip(ids, rels)]}],
        'answers': [], 'gifts': [], 'bequests': [],
        'estate': {'amount_minor': None, 'currency': None}})


def map_ids(value, ids):
    """A copy of the database proof or table with each heir pk replaced by its person id."""
    if isinstance(value, dict):
        return {key: (ids[item] if key == 'heir' else map_ids(item, ids)) for key, item in value.items()}
    if isinstance(value, list):
        return [map_ids(item, ids) for item in value]
    return value


def core_families():
    """Every mix of spouses, parents and up to three sons and three daughters (as CoreFamilyReferenceTests)."""
    cls = {name: getattr(corpus, name) for name in ('Wife', 'Husband', 'Father', 'Mother', 'Son', 'Daughter')}
    spouses = [('M', count, 0) for count in range(5)] + [('F', 0, 0), ('F', 0, 1)]
    found = []
    for sex, wives, husband in spouses:
        for father, mother, sons, daughters in product((0, 1), (0, 1), range(4), range(4)):
            if not (wives or husband or father or mother or sons or daughters):
                continue
            found.append((sex, [cls['Wife']] * wives + [cls['Husband']] * husband + [cls['Father']] * father
                          + [cls['Mother']] * mother + [cls['Son']] * sons + [cls['Daughter']] * daughters))
    return found


def literal_families(by_class=None):
    """The `(sex, [types])` literals written in the proof and table test classes, found in the source.
    When `by_class` is a dict, it collects the number of families each class contributed first."""
    namespace = vars(corpus)
    tree = ast.parse(inspect.getsource(corpus))
    found = {}
    for node in tree.body:
        if not (isinstance(node, ast.ClassDef) and node.name in LITERAL_CLASSES):
            continue
        for sub in ast.walk(node):
            if isinstance(sub, ast.Tuple) and len(sub.elts) >= 2:
                pair = sub.elts[:2]
            elif isinstance(sub, ast.Call) and len(sub.args) >= 2:
                pair = sub.args[:2]
            else:
                continue
            sex, types = pair
            if not (isinstance(sex, ast.Constant) and sex.value in GENDER and isinstance(types, (ast.List, ast.BinOp))):
                continue
            try:
                value = eval(compile(ast.Expression(types), '<corpus>', 'eval'), namespace)
            except Exception:
                continue
            if isinstance(value, list) and value and all(item in HEIR_SEX for item in value):
                if (sex.value, tuple(value)) not in found and by_class is not None:
                    by_class[node.name] = by_class.get(node.name, 0) + 1
                found.setdefault((sex.value, tuple(value)), (sex.value, list(value)))
    return list(found.values())


def fixture_families():
    """The named fixtures, the school fixtures and the proof and table literals."""
    found = [(sex, [cls for cls, _fraction in expected]) for _title, sex, expected in FIXTURES]
    found += [(sex, list(types)) for _title, _schools, sex, types, _expected in SCHOOL_FIXTURES]
    found += [('M', list(types)) for _title, types, _expected in MUADDA_FIXTURES]
    found += literal_families()
    unique = {}
    for sex, types in found:
        unique[(sex, tuple(types))] = (sex, types)
    return list(unique.values())


class ParityMixin:
    """Run one family through both paths and require the same answer."""

    def check(self, sex, types, school):
        family = build_family(sex, types)
        rule_set = engine.school_rule_set(school)
        evaluation = engine.evaluate(family, rule_set)
        result = evaluation.result
        rels = [relationship(cls) for cls in types]
        counts = heir_rules.counts([{'relationship': r} for r in rels])
        gender = GENDER[sex]

        if heir_rules.is_impossible_family(gender, counts):
            if engine_core.is_impossible(rels):
                self.assertEqual((result.status, result.refusal), ('refused', 'invalid_family'))
                self.assertEqual((result.allocations, result.steps, result.unallocated), ((), (), None))
            else:
                # a spouse of the wrong sex alone: a Family v1 has no sex for the deceased, so the
                # engine cannot see it. Nothing else may reach here.
                self.assertTrue((counts.get('husband') and gender == 'male') or (counts.get('wife') and gender == 'female'))
                self.assertEqual(result.status, 'calculated')
            return
        self.assertFalse(engine_core.is_impossible(rels))

        calc, heirs = build_case(sex, types)
        ids = {heir.pk: f'h{i}' for i, heir in enumerate(heirs)}
        try:
            exact = calc.compute(madhab=school)
        except schools.UnsupportedCase as refusal:
            self.assertEqual((result.status, result.refusal), ('refused', refusal.reason))
            self.assertEqual((result.allocations, result.steps, result.unallocated), ((), (), None))
            self.assertEqual((evaluation.proof, evaluation.table), (None, None))
            self.assertEqual(contracts.parse_result(contracts.dump_result(result)), result)
            return
        self.assertEqual(result.status, 'calculated')
        shares = {a.person: a.share for a in result.allocations}
        self.assertEqual(shares, {ids[pk]: fraction for pk, fraction in exact.items()})
        self.assertEqual([a.person for a in result.allocations], [f'h{i}' for i in range(len(types))])
        blocked = {ids[h.pk]: h.blocked for h in calc.heir_set.all()}
        self.assertEqual({a.person: a.kind == 'blocked' for a in result.allocations}, blocked)
        self.assertEqual(engine.thaw(evaluation.proof), map_ids(calc.proof, ids))
        self.assertEqual(engine.thaw(evaluation.table), map_ids(calc.table, ids))
        self.assertEqual(result.unallocated, 1 - sum(exact.values(), 0))
        self.assertEqual(result.school, school)
        proof_steps = calc.proof['steps']
        if proof_steps[0]['value'] == 0:
            proof_steps = proof_steps[:1]
        got = [(s.step, s.params['rest'].value if s.step == 'unallocated' else s.params['base'].value)
               for s in result.steps]
        want = [(s['step'], F(s['value']['numerator'], s['value']['denominator']) if s['step'] == 'unallocated'
                 else s['value']) for s in proof_steps]
        self.assertEqual(got, want)
        mapped = map_ids(calc.proof, ids)
        entries = {e['heir']: e for e in mapped['heirs']}
        integer_steps = [s for s in calc.proof['steps'] if s['step'] != 'unallocated']
        last = integer_steps[-1]
        for a in result.allocations:
            entry = entries[a.person]
            self.assertEqual((a.rule, a.condition, a.blocked_by, a.school_rule, a.option),
                             (entry['rule'], entry['condition'], entry['blocked_by'], entry['school_rule'],
                              entry['option']))
            self.assertEqual(a.kind, engine_core.KINDS[a.rule])
            verse = entry['verse']
            self.assertEqual(a.citations, () if verse is None else (CITATION_KEYS[verse],))
            if a.kind == 'blocked' or calc.proof['steps'][0]['value'] == 0:
                self.assertIsNone(a.stage)
            else:
                self.assertEqual((a.stage.step, a.stage.base), (last['step'], last['value']))
        # the engine never emits a Result that its own contract rejects
        self.assertEqual(contracts.parse_result(contracts.dump_result(result)), result)

    def sweep(self, corpus_families, school_list=ALL_SCHOOLS):
        for sex, types in corpus_families:
            for school in school_list:
                with self.subTest(f'{school} {sex}: {[t.__name__ for t in types]}'):
                    self.check(sex, types, school)


class RuleSetParityTests(SimpleTestCase):
    """Each built-in rule set holds the decisions of `calc.schools`."""

    LIVE_MUSHTARAKA = {'husband': 1, 'mother': 1, 'maternal_brother': 2, 'brother': 1}
    LIVE_MALIKIYYA = {'husband': 1, 'mother': 1, 'grandfather': 1, 'paternal_brother': 1}

    def test_every_school_matches_calc_schools(self):
        for school in ALL_SCHOOLS:
            with self.subTest(school):
                rule_set = engine.school_rule_set(school)
                rules = rule_set.rules
                self.assertEqual(rule_set.school, school)
                self.assertEqual(rules['grandfather_with_siblings'] == 'blocks', schools.grandfather_blocks_siblings(school))
                self.assertEqual(rules['grandfather_with_siblings'],
                                 'blocks' if schools.grandfather_rule(school) == schools.GRANDFATHER_BLOCKS_SIBLINGS else 'shares')
                self.assertEqual(rules['mushtaraka'], schools.has_mushtaraka(school, {
                    'Husband': 1, 'Mother': 1, 'MaternalBrother': 2, 'Brother': 1}))
                self.assertEqual(rules['mushtaraka'], schools.mushtaraka_rule(school) == schools.MUSHTARAKA)
                self.assertEqual(rules['father_blocks_his_mother'], schools.father_blocks_his_mother(school))
                self.assertEqual(rules['father_blocks_his_mother'],
                                 schools.grandmother_rule(school) == schools.FATHER_BLOCKS_HIS_MOTHER)
                self.assertEqual(rules['malikiyya_disputed'], schools.is_malikiyya_family(
                    school, {'Husband': 1, 'Mother': 1, 'GrandFather': 1, 'PaternalBrother': 1}, 2))
                self.assertEqual(rules['radd_position'], schools.radd_rule(school))
                self.assertEqual(dict(rule_set.settings), {})

    def test_the_school_rule_codes_are_the_contract_codes(self):
        for code in ('grandfather_blocks_siblings', 'grandfather_shares_with_siblings', 'mushtaraka', 'no_mushtaraka',
                     'radd', 'radd_later_scholars', 'father_blocks_his_mother', 'grandmother_inherits_with_her_son'):
            self.assertIn(code, schools.SCHOOL_RULES)
            self.assertIn(code, contracts.codes.SCHOOL_RULES)

    def test_jafari_rules_equal_the_hanbali_defaults(self):
        self.assertEqual(engine.school_rule_set('jafari').rules, engine.school_rule_set('hanbali').rules)


class FixtureParityTests(ParityMixin, TransactionTestCase):
    """The named fixtures, the school fixtures and the proof and table families, under every School."""

    def test_the_corpus_is_found(self):
        self.assertGreater(len(fixture_families()), len(FIXTURES))
        by_class = {}
        found = literal_families(by_class)
        self.assertEqual(len(found), LITERAL_COUNT)
        self.assertEqual(sum(by_class.values()), LITERAL_COUNT)
        self.assertEqual(by_class.get('ProofGrandfatherOptionTests', 0), 0)
        for name in set(LITERAL_CLASSES) - set(NO_LITERALS):
            self.assertGreaterEqual(by_class.get(name, 0), 1, name)

    def test_fixture_families_match_compute(self):
        self.sweep(fixture_families())


@tag('slow')
class SweepParityTests(ParityMixin, TransactionTestCase):
    """The sweeps: every relationship alone and in common contexts, and the random families."""

    def test_every_family_of_the_sweeps_matches_compute(self):
        self.sweep(families())


@tag('slow')
class CoreFamilyParityTests(ParityMixin, TransactionTestCase):
    """Every mix of spouses, parents, and up to three sons and three daughters."""

    def test_every_core_family_matches_compute(self):
        found = core_families()
        self.assertEqual(len(found), 446)
        self.sweep(found)
