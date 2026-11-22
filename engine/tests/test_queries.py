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
from engine.tests.test_core import family, family_document, MALIKIYYA
from engine.tests.test_layered import layered_cases, layered_document

H = school_rule_set('hanafi')


def family_document_with_died_before():
    from engine.tests.test_core import person
    document = {
        'version': 1, 'root': 'root',
        'persons': [person('wife', 'wife'), person('dead', 'son', 'died_before_or_with'),
                    person('father', 'father', 'died_before_or_with')],
        'edges': [{'kind': 'parent_of', 'from': 'dead', 'to': 'grandson'}],
        'estates': [{'order': 1, 'deceased': 'root', 'heirs': [{'person': 'wife', 'relationship': 'wife'}]}],
        'answers': [], 'gifts': [], 'bequests': [], 'estate': {'amount_minor': None, 'currency': None}}
    document['persons'].append(person('grandson', 'son_of_son'))
    document['estates'][0]['heirs'].append({'person': 'grandson', 'relationship': 'son_of_son'})
    return document


def later_estate_document():
    from engine.tests.test_core import later_deaths_document
    return later_deaths_document()


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

    def test_replacing_person_keeps_gender(self):
        male = family(['son', 'wife'])
        options = q.relationship_options(male, H, replacing='h0')
        for rel, gender in RELATIONSHIP_GENDERS.items():
            if rel in options.impossible and options.impossible[rel] != 'gender_locked':
                continue
            self.assertEqual(options.impossible.get(rel) == 'gender_locked', gender == 'female', rel)
        self.assertEqual(options.impossible['daughter'], 'gender_locked')
        self.assertNotIn('daughter', options.blocked)
        self.assertNotIn('son', options.impossible)
        self.assertNotIn('brother', options.impossible)
        self.assertEqual(q.change_impossible(male, H, 'daughter', replacing='h0'), 'gender_locked')
        add = q.relationship_options(male, H)
        self.assertNotIn('gender_locked', add.impossible.values())
        female = family(['daughter'])
        for rel in ('son', 'father', 'husband'):
            self.assertEqual(q.change_impossible(female, H, rel, replacing='h0'), 'gender_locked')
        self.assertIsNone(q.change_impossible(female, H, 'mother', replacing='h0'))
        both = q.relationship_options(family(['son', 'brother']), H, replacing='h1')
        self.assertEqual(both.impossible['daughter_of_son'], 'gender_locked')
        self.assertNotIn('daughter_of_son', both.blocked)
        self.assertEqual(q.change_impossible(family(['father', 'daughter']), H, 'father', replacing='h1'),
                         'second_father')
        doc = family_document(['daughter'])
        doc['persons'][0]['gender'] = 'male'
        recorded = parse_family(doc)
        self.assertNotEqual(q.change_impossible(recorded, H, 'son', replacing='h0'), 'gender_locked')
        self.assertEqual(q.change_impossible(recorded, H, 'daughter', replacing='h0'), 'gender_locked')
        # precedence: an estate code wins over gender_locked
        wife = family(['wife'])
        self.assertEqual(q.change_impossible(wife, H, 'husband', replacing='h0', deceased_gender='male'),
                         'husband_of_male')

    def test_replacing_aliased_person_in_later_estate(self):
        doc = layered_document([('S', 'son'), ('W', 'wife')], [('W', [('S', 'husband')])])
        fam = parse_family(doc)
        options = q.relationship_options(fam, H, estate=2, replacing='S')
        self.assertEqual(options.impossible['daughter'], 'gender_locked')
        self.assertNotIn('brother', options.impossible)
        self.assertEqual(q.change_impossible(fam, H, 'daughter', estate=2, replacing='S'), 'gender_locked')
        self.assertEqual(q.change_impossible(fam, H, 'brother', estate=2, replacing='S'),
                         options.impossible.get('brother'))
        for school in ('hanafi', 'maliki', 'shafii', 'hanbali'):
            rules = school_rule_set(school)
            options = q.relationship_options(fam, rules, estate=2, replacing='S')
            for rel in codes.RELATIONSHIPS:
                applied = copy.deepcopy(doc)
                applied['estates'][1]['heirs'][0]['relationship'] = rel
                result = calculate(parse_family(applied), rules)
                with self.subTest(school=school, relationship=rel):
                    if options.impossible.get(rel) == 'gender_locked':
                        self.assertEqual(result.refusal, 'invalid_family')
                    elif rel not in options.impossible:
                        self.assertNotEqual(result.refusal, 'invalid_family')
        with self.assertRaises(ContractError):
            q.relationship_options(fam, H, estate=2, replacing='W')

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
        document = family_document(['grandfather', 'brother'])
        document['gifts'].append({'branch': 'h0', 'amount_minor': 100})
        self.assertEqual(q.share_changing_presets(parse_family(document), H, [H, s]), ())
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

    def test_placement_table_and_kinship(self):
        from engine.placement import ANCHORS
        from dataclasses import FrozenInstanceError
        f = family(['wife', 'son', 'son'])
        found = q.placement_options(f, H, deceased_gender='male')
        self.assertEqual(set(found), {'root', 'h0', 'h1', 'h2'})
        names = lambda anchor, link=None: [p.relationship for p in found[anchor] if link in (None, p.link)]
        self.assertEqual(names('root', 'parent'), ['father', 'mother'])
        self.assertEqual(names('root', 'spouse'), ['wife'])
        self.assertEqual(names('root', 'child'), ['son', 'daughter'])
        self.assertEqual(names('h1'), ['son_of_son', 'daughter_of_son'])
        self.assertEqual(names('h0'), [])
        mother = q.placement_options(family(['mother']), H, deceased_gender='male')['h0']
        self.assertEqual([(p.relationship, p.link, p.blocked) for p in mother], [
            ('maternal_grandmother', 'parent', True), ('brother', 'child', False), ('sister', 'child', False),
            ('maternal_brother', 'child', False), ('maternal_sister', 'child', False)])
        # every candidate comes from the table and the table covers only known relationships
        for entries in ANCHORS.values():
            for link, relationship in entries:
                self.assertIn(relationship, codes.RELATIONSHIPS)
                self.assertIn(link, ('parent', 'child', 'spouse'))
        # the deceased woman may have a husband but no wife
        female = q.placement_options(family([]), H, deceased_gender='female')
        self.assertEqual([p.relationship for p in female['root'] if p.link == 'spouse'], ['husband'])
        # unknown gender offers both
        either = q.placement_options(family([]), H)
        self.assertEqual([p.relationship for p in either['root'] if p.link == 'spouse'], ['husband', 'wife'])
        with self.assertRaises(TypeError):
            found['h0'] = ()
        with self.assertRaises(FrozenInstanceError):
            found['root'][0].blocked = True

    def test_placement_excludes_second_and_fifth(self):
        found = q.placement_options(family(['father', 'wife', 'wife', 'wife', 'wife']), H, deceased_gender='male')
        root = [p.relationship for p in found['root']]
        self.assertNotIn('father', root)
        self.assertIn('mother', root)
        self.assertNotIn('wife', root)
        self.assertNotIn('husband', root)
        self.assertEqual([p.relationship for p in found['h0']],
                         ['grandfather', 'paternal_grandmother', 'brother', 'sister',
                          'paternal_brother', 'paternal_sister'])

    def test_placement_blocked_flag_and_rule_set(self):
        found = q.placement_options(family(['son', 'brother']), H, deceased_gender='male')
        entry = next(p for p in found['h1'] if p.relationship == 'son_of_brother')
        self.assertTrue(entry.blocked)
        self.assertFalse(next(p for p in found['root'] if p.relationship == 'daughter').blocked)
        # the same candidates under another rule set: the grandfather blocks brothers only for the Hanafis
        for school in ('hanafi', 'shafii'):
            found = q.placement_options(family(['grandfather', 'father']), school_rule_set(school), deceased_gender='male')
            brother = next(p for p in found['h1'] if p.relationship == 'brother')
            self.assertTrue(brother.blocked, school)  # a father blocks brothers under every school
        found = q.placement_options(family(['grandfather', 'mother']), school_rule_set('shafii'), deceased_gender='male')
        self.assertFalse(next(p for p in found['h1'] if p.relationship == 'brother').blocked)
        found = q.placement_options(family(['grandfather', 'mother']), H, deceased_gender='male')
        self.assertTrue(next(p for p in found['h1'] if p.relationship == 'brother').blocked)

    def test_placement_died_before_anchor_and_cardinality(self):
        document = family_document_with_died_before()
        f = parse_family(document)
        found = q.placement_options(f, H, deceased_gender='male')
        self.assertEqual([(p.relationship, p.link) for p in found['dead']],
                         [('son_of_son', 'child'), ('daughter_of_son', 'child')])
        self.assertNotIn('father', [p.relationship for p in found['root']])
        self.assertEqual(found['wife'], ())
        # died-before persons are not heirs: they never block anyone
        self.assertFalse(any(p.blocked for p in found['root']))
        with_wives = copy.deepcopy(document)
        for i in range(4):
            with_wives['persons'].append({'id': f'w{i}', 'gender': 'female', 'name': None, 'relationship': 'wife',
                                          'status': 'died_before_or_with', 'death_order': None})
        found = q.placement_options(parse_family(with_wives), H, deceased_gender='male')
        self.assertNotIn('wife', [p.relationship for p in found['root']])

    def test_placement_later_estate_and_errors(self):
        f = parse_family(later_estate_document())
        found = q.placement_options(f, H, estate=2)
        self.assertEqual([p.relationship for p in found['root'] if p.link == 'spouse'], ['wife'])
        self.assertEqual([p.relationship for p in found['root'] if p.link == 'parent'], ['father', 'mother'])
        # a wife, who is no anchor in the table, and an heir of the earlier estate only
        self.assertEqual(found['h2'], ())
        self.assertEqual(found['h1'], ())
        for bad in (lambda: q.placement_options(f, H, estate=9), lambda: q.placement_options(f, H, estate='1'),
                    lambda: q.placement_options(f, H, estate=2, deceased_gender='male'),
                    lambda: q.placement_options(f, H, deceased_gender='x'),
                    lambda: q.placement_options('family', H), lambda: q.placement_options(f, 'rules')):
            with self.assertRaises(ContractError):
                bad()

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
