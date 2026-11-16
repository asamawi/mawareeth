"""Family action matrix and solver consistency, without Django."""
import copy
import json
from dataclasses import replace
from pathlib import Path
import random
import unittest

from engine import queries as q, school_rule_set, RuleSet, calculate, parse_preset
from engine.contracts import codes, parse_family
from engine.contracts.errors import ContractError
from engine.contracts.family import Edge
from engine.kinship import RELATIONSHIP_GENDERS, SECOND_OF
from engine.single import solve, Refused
from engine.tests.test_core import family, MALIKIYYA
from engine.tests.test_layered import layered_cases

H = school_rule_set('hanafi')


class QueryTests(unittest.TestCase):
    def test_kinship_matrix(self):
        for rel, code in SECOND_OF.items():
            options = q.relationship_options(family([rel]), H)
            self.assertEqual(options.impossible[rel], code)
            self.assertNotIn(rel, options.blocked)
        self.assertEqual(q.change_impossible(family(['wife'] * 4), H, 'wife'), 'fifth_wife')
        self.assertEqual(q.change_impossible(family([]), H, 'husband', deceased_gender='male'), 'husband_of_male')
        self.assertIsNone(q.change_impossible(family([]), H, 'husband'))
        self.assertEqual(q.relationship_options(family(['wife']), H).impossible['husband'], 'husband_of_male')
        self.assertEqual(q.relationship_options(family(['husband']), H).impossible['wife'], 'wife_of_female')
        self.assertEqual(q.change_impossible(family([]), H, 'wife', deceased_gender='female'), 'wife_of_female')
        self.assertIsNone(q.change_impossible(family(['father']), H, 'father', replacing='h0'))
        self.assertEqual(q.deceased_gender_conflict(family(['husband']), 'male'), 'has_husband')
        self.assertEqual(q.deceased_gender_conflict(family(['wife']), 'female'), 'has_wife')
        for gender in codes.GENDERS:
            self.assertEqual(q.deceased_gender_conflict(family(['wife', 'husband']), gender), 'has_both_spouses')

    def test_blocking_matrix_and_rule_values(self):
        o = q.relationship_options(family(['son']), H)
        self.assertTrue({'son_of_son', 'brother'} <= set(o.blocked))
        self.assertFalse(set(o.impossible) & set(o.blocked))
        self.assertIn('brother', q.relationship_options(family(['grandfather']), H).blocked)
        s = school_rule_set('shafii')
        self.assertNotIn('brother', q.relationship_options(family(['grandfather']), s).blocked)
        self.assertIn('paternal_brother', q.relationship_options(family(['grandfather', 'brother']), s).blocked)
        custom = RuleSet('hanafi', s.rules, {})
        self.assertNotIn('brother', q.relationship_options(family(['grandfather']), custom).blocked)
        o = q.relationship_options(family(['father', 'son']), school_rule_set('jafari'))
        self.assertEqual(o.blocked, ())
        self.assertEqual(o.impossible['father'], 'second_father')

    def test_later_gender_and_delete(self):
        cases = layered_cases()
        f = parse_family(cases['fixture_True_False'])
        self.assertEqual(q.change_impossible(f, H, 'wife', estate=3), 'wife_of_female')
        self.assertEqual(q.delete_impact(f, 'S1'), q.Impact(('S1',), (2,)))
        self.assertEqual(q.delete_impact(f, 'W'), q.Impact(('W', 'N'), (3,)))
        self.assertEqual(q.delete_impact(f, 'W', estate=2), q.Impact((), ()))
        self.assertEqual(q.delete_impact(f, 'N', estate=3), q.Impact(('N',), ()))
        f = replace(f, edges=(Edge('parent_of', 'S1', 'S2'), Edge('parent_of', 'S2', 'N')))
        self.assertEqual(q.delete_impact(f, 'S1'), q.Impact(('S1', 'S2', 'N'), (2,)))
        chain = parse_family(cases['non_root_deceased'])
        self.assertEqual(q.delete_impact(chain, 'V', estate=2), q.Impact(('V', 'N'), (3,)))
        simple = replace(family(['son', 'son', 'son']), edges=(Edge('parent_of', 'h0', 'h1'), Edge('parent_of', 'h1', 'h2')))
        self.assertEqual(q.delete_impact(simple, 'h0'), q.Impact(('h0', 'h1', 'h2'), ()))

    def test_refusals_facts_presets_and_immutability(self):
        for f in (family(MALIKIYYA), family(['grandfather', 'brother']), parse_family(layered_cases()['fixture_True_False'])):
            before = copy.deepcopy(f)
            for school in codes.SCHOOLS:
                rules = school_rule_set(school)
                self.assertEqual(q.refusal(f, rules), calculate(f, rules).refusal)
                self.assertEqual(q.required_facts(f, rules), ())
                q.relationship_options(f, rules)
                q.share_changing_presets(f, rules, (H,))
            q.delete_impact(f, f.persons[0].id)
            self.assertEqual(f, before)
        self.assertEqual(q.refusal(family(MALIKIYYA), school_rule_set('maliki')), 'malikiyya_disputed')
        self.assertEqual(q.refusal(family([]), school_rule_set('jafari')), 'school_not_supported')
        s = school_rule_set('shafii')
        f = family(['grandfather', 'brother'])
        self.assertEqual(q.share_changing_presets(f, H, [H, s]), (s,))
        data = json.loads((Path(__file__).resolve().parents[2] / 'contracts/fixtures/preset/zz-2026-01-01.json').read_text())
        data.update(rules={}, settings={}, citations={})
        preset = parse_preset(data)
        q.share_changing_presets(f, H, [preset])

    def test_invalid_arguments(self):
        f = family(['father'])
        calls = [
            lambda: q.relationship_options(f, H, estate=9),
            lambda: q.relationship_options(f, H, estate=True),
            lambda: q.relationship_options(f, H, replacing='root'),
            lambda: q.relationship_options(f, H, deceased_gender='other'),
            lambda: q.change_impossible(f, H, 'unknown'),
            lambda: q.deceased_gender_conflict(f, 'other'),
            lambda: q.delete_impact(f, 'root'),
            lambda: q.delete_impact(f, 'unknown'),
            lambda: q.delete_impact(f, 'h0', estate=2),
            lambda: q.delete_impact(parse_family(layered_cases()['fixture_True_False']), 'N', estate=1),
            lambda: q.relationship_options(parse_family(layered_cases()['fixture_True_False']), H, estate=2, deceased_gender='male'),
            lambda: q.refusal(f, None),
            lambda: q.required_facts(None, H),
            lambda: q.share_changing_presets(f, H, [H, 'hanafi']),
            lambda: q.share_changing_presets(f, H, None),
        ]
        for call in calls:
            with self.assertRaises(ContractError) as caught:
                call()
            self.assertEqual(caught.exception.code, 'invalid_contract')

    def test_vocabulary(self):
        self.assertEqual(tuple(RELATIONSHIP_GENDERS), codes.RELATIONSHIPS)
        self.assertTrue(set(RELATIONSHIP_GENDERS.values()) <= set(codes.GENDERS))

    def test_solver_consistency(self):
        rng = random.Random(84)
        families = [()] + [(r,) for r in codes.RELATIONSHIPS]
        families += [tuple(rng.choices(codes.RELATIONSHIPS, k=n)) for n in range(2, 5) for _ in range(150)]
        for school in codes.SUNNI_SCHOOLS:
            rules = school_rule_set(school)
            for rels in families:
                options = q.relationship_options(family(rels), rules)
                for rel in codes.RELATIONSHIPS:
                    if rel in options.impossible:
                        continue
                    entries = [(f'h{i}', r) for i, r in enumerate(rels)] + [('candidate', rel)]
                    try:
                        solved = solve(entries, rules.rules)
                    except Refused:
                        continue
                    # Proof carries the mu'adda condition even when the solver keeps the heir live.
                    from engine.proof import build
                    proof = build(school, [(h.id, h.rel, h.basis, solved.final[h.id]) for h in solved.heirs], solved.steps)
                    heir = next(h for h in proof['heirs'] if h['heir'] == 'candidate')
                    expected = heir['rule'] == 'blocked' or heir['condition'] == 'excluded_by_full_siblings'
                    # The existing shim intentionally labels only the structural mu'adda
                    # exclusion, not a paternal pool exhausted by the full sisters' cap.
                    cap_exhausted = (heir['condition'] == 'excluded_by_full_siblings'
                                     and 'brother' not in rels and 'daughter' not in rels
                                     and 'daughter_of_son' not in rels)
                    if cap_exhausted:
                        self.assertNotIn(rel, options.blocked)
                    else:
                        self.assertEqual(rel in options.blocked, expected, (school, rels, rel, heir))
