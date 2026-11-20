"""Core tests: unittest only, no Django. The School answers of the existing engine, in memory."""
import json
import unittest
from dataclasses import FrozenInstanceError
from fractions import Fraction
from pathlib import Path

from engine import RuleSet, calculate, evaluate, parse_preset, school_rule_set, thaw
from engine import contracts as c

F = Fraction
ROOT = Path(__file__).resolve().parent.parent.parent
FEMALE = {'mother', 'wife', 'daughter', 'daughter_of_son', 'paternal_grandmother', 'maternal_grandmother', 'sister',
          'paternal_sister', 'maternal_sister'}
SCHOOLS = ('hanafi', 'maliki', 'shafii', 'hanbali', 'jafari')
MALIKIYYA = ['husband', 'mother', 'grandfather', 'maternal_brother', 'maternal_brother', 'paternal_brother']


def person(pid, relationship, status='alive', order=None):
    return {'id': pid, 'gender': 'female' if relationship in FEMALE else 'male', 'name': None,
            'relationship': relationship, 'status': status, 'death_order': order}


def family_document(relationships):
    ids = [f'h{i}' for i in range(len(relationships))]
    return {
        'version': 1, 'root': 'root', 'persons': [person(i, r) for i, r in zip(ids, relationships)], 'edges': [],
        'estates': [{'order': 1, 'deceased': 'root',
                     'heirs': [{'person': i, 'relationship': r} for i, r in zip(ids, relationships)]}],
        'answers': [], 'gifts': [], 'bequests': [], 'estate': {'amount_minor': None, 'currency': None}}


def family(relationships):
    """A single-estate Family whose heirs are h0, h1, ... in the order given."""
    return c.parse_family(family_document(relationships))


def later_deaths_document(second_heirs=(('h2', 'wife'),)):
    return {
        'version': 1, 'root': 'root',
        'persons': [person('h0', 'son', 'died_later', 2), person('h1', 'wife'), person('h2', 'wife')],
        'edges': [],
        'estates': [{'order': 1, 'deceased': 'root', 'heirs': [{'person': 'h0', 'relationship': 'son'},
                                                              {'person': 'h1', 'relationship': 'wife'}]},
                    {'order': 2, 'deceased': 'h0',
                     'heirs': [{'person': p, 'relationship': r} for p, r in second_heirs]}],
        'answers': [], 'gifts': [], 'bequests': [], 'estate': {'amount_minor': None, 'currency': None}}


def shares(family_, school):
    result = calculate(family_, school_rule_set(school))
    return {a.person: a.share for a in result.allocations}, result


# (title, [(relationship, expected share), ...]) of calc.tests.FIXTURES, the Hanbali answers
FIXTURES = [
    ('two wives, one son', [('wife', '1/16'), ('wife', '1/16'), ('son', '7/8')]),
    ('three wives, mother, two sons', [('wife', '1/24'), ('wife', '1/24'), ('wife', '1/24'), ('mother', '1/6'), ('son', '17/48'), ('son', '17/48')]),
    ('radd with spouse', [('wife', '1/8'), ('mother', '7/40'), ('daughter', '7/30'), ('daughter', '7/30'), ('daughter', '7/30')]),
    ('radd, deceased female', [('husband', '1/4'), ('daughter', '1/4'), ('daughter', '1/4'), ('daughter', '1/4')]),
    ('radd, two wives', [('wife', '1/16'), ('wife', '1/16'), ('mother', '7/32'), ('daughter', '21/32')]),
    ('awl', [('wife', '1/18'), ('wife', '1/18'), ('mother', '4/27'), ('father', '4/27'), ('daughter', '8/27'), ('daughter', '8/27')]),
    ('father with daughters', [('wife', '1/16'), ('wife', '1/16'), ('father', '5/24'), ('daughter', '1/3'), ('daughter', '1/3')]),
    ('mushtaraka gives the full brother nothing', [('husband', '1/2'), ('mother', '1/6'), ('maternal_brother', '1/6'), ('maternal_brother', '1/6'), ('brother', '0/1')]),
    ('sister residuary blocks the paternal brother', [('daughter', '1/3'), ('daughter', '1/3'), ('sister', '1/6'), ('sister', '1/6'), ('paternal_brother', '0/1')]),
    ('grandfather, one brother', [('grandfather', '1/2'), ('brother', '1/2')]),
    ('grandfather, three brothers', [('grandfather', '1/3'), ('brother', '2/9'), ('brother', '2/9'), ('brother', '2/9')]),
    ('grandfather, sister', [('grandfather', '2/3'), ('sister', '1/3')]),
    ('grandfather after a spouse', [('wife', '1/4'), ('grandfather', '3/8'), ('brother', '3/8')]),
    ("grandfather's minimum, deceased female", [('husband', '1/2'), ('mother', '1/3'), ('grandfather', '1/6'), ('brother', '0/1')]),
    ('daughter, sister, grandfather', [('daughter', '1/2'), ('grandfather', '1/3'), ('sister', '1/6')]),
    ('akdariyya', [('husband', '1/3'), ('mother', '2/9'), ('grandfather', '8/27'), ('sister', '4/27')]),
    ('akdariyya with a paternal sister', [('husband', '1/3'), ('mother', '2/9'), ('grandfather', '8/27'), ('paternal_sister', '4/27')]),
    ('counting paternal siblings', [('grandfather', '1/3'), ('brother', '2/3'), ('paternal_brother', '0/1')]),
    ('ashariyya', [('grandfather', '2/5'), ('sister', '1/2'), ('paternal_brother', '1/10')]),
    ('spouse alone', [('wife', '1/4')]),
    ('no heirs yet', []),
    ('umariyyatan, deceased male', [('wife', '1/4'), ('mother', '1/4'), ('father', '1/2')]),
    ('umariyyatan, deceased female', [('husband', '1/2'), ('mother', '1/6'), ('father', '1/3')]),
    ('minbariyya', [('wife', '1/9'), ('mother', '4/27'), ('father', '4/27'), ('daughter', '8/27'), ('daughter', '8/27')]),
    ('husband with two full sisters', [('husband', '3/7'), ('sister', '2/7'), ('sister', '2/7')]),
    ("daughter with son's daughter", [('daughter', '3/4'), ('daughter_of_son', '1/4')]),
    ("daughter, son's daughter and father", [('daughter', '1/2'), ('daughter_of_son', '1/6'), ('father', '1/3')]),
    ("daughter, son's daughter and brother", [('daughter', '1/2'), ('daughter_of_son', '1/6'), ('brother', '1/3')]),
    ('mother and daughter', [('mother', '1/4'), ('daughter', '3/4')]),
    ('grandfather, full sister and paternal sister', [('grandfather', '1/2'), ('sister', '1/2'), ('paternal_sister', '0/1')]),
    ('grandfather, brother and sister', [('grandfather', '2/5'), ('brother', '2/5'), ('sister', '1/5')]),
    ('grandfather, two sisters and a paternal brother', [('grandfather', '1/3'), ('sister', '1/3'), ('sister', '1/3'), ('paternal_brother', '0/1')]),
    ('grandfather still blocks maternal siblings, nephews and uncles', [('grandfather', '1/2'), ('brother', '1/2'), ('maternal_brother', '0/1'), ('son_of_brother', '0/1'), ('uncle', '0/1')]),
    ('grandfather with a daughter and no siblings', [('daughter', '1/2'), ('grandfather', '1/2')]),
    ('grandfather with a son', [('son', '5/6'), ('grandfather', '1/6'), ('brother', '0/1')]),
    ('son of brother blocks the uncle', [('son_of_brother', '1/1'), ('uncle', '0/1')]),
    ('son of brother blocks the son of a paternal brother', [('son_of_brother', '1/1'), ('son_of_paternal_brother', '0/1')]),
    ('paternal brother blocks the son of a brother', [('paternal_brother', '1/1'), ('son_of_brother', '0/1')]),
    ('wife, daughter, grandfather and sister', [('wife', '1/8'), ('daughter', '1/2'), ('grandfather', '1/4'), ('sister', '1/8')]),
    ('grandfather, two sisters and a paternal sister', [('grandfather', '2/5'), ('sister', '3/10'), ('sister', '3/10'), ('paternal_sister', '0/1')]),
    ('daughter, sister and paternal sister', [('daughter', '1/2'), ('sister', '1/2'), ('paternal_sister', '0/1')]),
    ('two daughters, sister and paternal sister', [('daughter', '1/3'), ('daughter', '1/3'), ('sister', '1/3'), ('paternal_sister', '0/1')]),
    ('mother, two daughters, sister and paternal sister', [('mother', '1/6'), ('daughter', '1/3'), ('daughter', '1/3'), ('sister', '1/6'), ('paternal_sister', '0/1')]),
    ('uncle, sister and paternal sister', [('uncle', '1/3'), ('sister', '1/2'), ('paternal_sister', '1/6')]),
    ('sister and two paternal sisters, with radd', [('sister', '3/4'), ('paternal_sister', '1/8'), ('paternal_sister', '1/8')]),
    ('sister, paternal brother and paternal sister', [('sister', '1/2'), ('paternal_brother', '1/3'), ('paternal_sister', '1/6')]),
]


class KnownAnswerTests(unittest.TestCase):
    def test_wife_mother_and_three_daughters(self):
        by, result = shares(family(['wife', 'mother', 'daughter', 'daughter', 'daughter']), 'hanbali')
        self.assertEqual(by, {'h0': F(1, 8), 'h1': F(7, 40), 'h2': F(7, 30), 'h3': F(7, 30), 'h4': F(7, 30)})
        self.assertEqual(result.status, 'calculated')
        self.assertEqual(result.unallocated, 0)
        self.assertEqual([s.step for s in result.steps], ['base', 'radd', 'correction'])
        self.assertEqual({a.person: a.school_rule for a in result.allocations},
                         {'h0': None, 'h1': 'radd', 'h2': 'radd', 'h3': 'radd', 'h4': 'radd'})
        self.assertEqual(result.allocations[0].citations, ('quran_4_12',))
        self.assertEqual(result.allocations[2].citations, ('quran_4_11',))
        self.assertEqual(result.allocations[1].stage.step, 'correction')

    def test_grandfather_and_brother_by_school(self):
        fam = family(['grandfather', 'brother'])
        by, result = shares(fam, 'hanafi')
        self.assertEqual(by, {'h0': F(1), 'h1': F(0)})
        brother = result.allocations[1]
        self.assertEqual((brother.kind, brother.rule, brother.blocked_by, brother.stage),
                         ('blocked', 'blocked', 'grandfather', None))
        self.assertEqual(brother.school_rule, 'grandfather_blocks_siblings')
        by, _ = shares(fam, 'hanbali')
        self.assertEqual(by, {'h0': F(1, 2), 'h1': F(1, 2)})

    def test_spouse_alone(self):
        by, result = shares(family(['wife']), 'hanbali')
        self.assertEqual(by, {'h0': F(1, 4)})
        self.assertEqual(result.unallocated, F(3, 4))
        self.assertEqual([s.step for s in result.steps], ['base', 'unallocated'])
        self.assertEqual(result.steps[0].params['base'].value, 4)
        self.assertEqual(result.steps[1].params['rest'].type, 'fraction')
        self.assertEqual(result.steps[1].params['rest'].value, F(3, 4))

    def test_no_heirs(self):
        evaluation = evaluate(family([]), school_rule_set('hanbali'))
        result = evaluation.result
        self.assertEqual((result.status, result.allocations, result.unallocated), ('calculated', (), F(1)))
        self.assertEqual([(s.step, s.params['base'].value) for s in result.steps], [('base', 0)])
        self.assertIsNone(evaluation.table)

    def test_jafari_is_refused(self):
        for rels in ([], ['son'], ['wife', 'son']):
            result = calculate(family(rels), school_rule_set('jafari'))
            self.assertEqual((result.status, result.refusal, result.allocations, result.steps, result.unallocated),
                             ('refused', 'school_not_supported', (), (), None))
            self.assertEqual(result.school, 'jafari')

    def test_malikiyya(self):
        result = calculate(family(MALIKIYYA), school_rule_set('maliki'))
        self.assertEqual((result.status, result.refusal, result.allocations, result.unallocated),
                         ('refused', 'malikiyya_disputed', (), None))
        by, _ = shares(family(MALIKIYYA), 'shafii')
        self.assertEqual(by, {'h0': F(1, 2), 'h1': F(1, 6), 'h2': F(1, 6), 'h3': F(0), 'h4': F(0), 'h5': F(1, 6)})
        self.assertEqual(calculate(family(MALIKIYYA), school_rule_set('hanbali')).status, 'calculated')

    def test_impossible_families(self):
        cases = [['father', 'father'], ['husband', 'wife'], ['wife'] * 5, ['mother', 'mother'],
                 ['husband', 'husband'], ['grandfather', 'grandfather'],
                 ['paternal_grandmother', 'paternal_grandmother'], ['maternal_grandmother', 'maternal_grandmother']]
        for rels in cases:
            for school in SCHOOLS:
                with self.subTest(rels=rels, school=school):
                    self.assertEqual(calculate(family(rels), school_rule_set(school)).refusal, 'invalid_family')
        self.assertEqual(calculate(family(['wife'] * 4), school_rule_set('hanbali')).status, 'calculated')

    def test_impossible_is_checked_before_other_refusals(self):
        self.assertEqual(calculate(family(['father', 'father']), school_rule_set('jafari')).refusal, 'invalid_family')
        document = later_deaths_document((('h2', 'wife'), ('h1', 'husband')))
        fam = c.parse_family(document)
        self.assertEqual(calculate(fam, school_rule_set('hanbali')).refusal, 'invalid_family')
        self.assertEqual(calculate(fam, school_rule_set('jafari')).refusal, 'invalid_family')

    def test_gender_contradicting_relationship_is_refused(self):
        for gender, rel in (('male', 'daughter'), ('female', 'father')):
            document = family_document([rel, 'brother'])
            document['persons'][0]['gender'] = gender
            fam = c.parse_family(document)
            for school in SCHOOLS:
                with self.subTest(rel=rel, school=school):
                    result = calculate(fam, school_rule_set(school))
                    self.assertEqual((result.status, result.refusal, result.allocations), ('refused', 'invalid_family', ()))

    def test_gender_mismatch_of_person_who_died_before(self):
        document = family_document(['son'])
        document['persons'].append(person('d', 'mother', 'died_before_or_with'))
        document['persons'][-1]['gender'] = 'male'
        fam = c.parse_family(document)
        for school in SCHOOLS:
            with self.subTest(school=school):
                self.assertEqual(calculate(fam, school_rule_set(school)).refusal, 'invalid_family')

    def test_uncomputed_content_is_refused(self):
        from engine import queries
        mutations = {
            'bequest': ('bequests', {'branch': 'h0', 'amount_minor': 1000}),
            'gift': ('gifts', {'branch': 'h0', 'amount_minor': 500}),
            'zero bequest': ('bequests', {'branch': 'h0', 'amount_minor': 0}),
            'answer': ('answers', {'question': 'sect', 'person': None, 'value': 'sunni'}),
            'false answer': ('answers', {'question': 'sect', 'person': None, 'value': False}),
        }
        for name, (field, entry) in mutations.items():
            document = family_document(['son', 'wife'])
            document[field].append(entry)
            fam = c.parse_family(document)
            for school in SCHOOLS:
                with self.subTest(name=name, school=school):
                    result = calculate(fam, school_rule_set(school))
                    self.assertEqual((result.status, result.refusal, result.allocations), ('refused', 'invalid_family', ()))
                    self.assertEqual(queries.refusal(fam, school_rule_set(school)), 'invalid_family')

    def test_uncomputed_content_precedes_school_and_successive_refusals(self):
        document = family_document(['son', 'wife'])
        document['bequests'].append({'branch': 'h0', 'amount_minor': 1000})
        self.assertEqual(calculate(c.parse_family(document), school_rule_set('jafari')).refusal, 'invalid_family')
        document = later_deaths_document()
        document['bequests'].append({'branch': 'h0', 'amount_minor': 1000})
        fam = c.parse_family(document)
        for school in SCHOOLS:
            with self.subTest(school=school):
                result = calculate(fam, school_rule_set(school))
                self.assertEqual(result.refusal, 'invalid_family')
                self.assertEqual((result.allocations, result.layers), ((), ()))

    def test_empty_content_is_calculated(self):
        self.assertEqual(calculate(family(['son', 'wife']), school_rule_set('hanbali')).status, 'calculated')

    def test_later_deaths_are_calculated(self):
        fam = c.parse_family(later_deaths_document())
        self.assertEqual(calculate(fam, school_rule_set('hanbali')).status, 'calculated')
        self.assertEqual(calculate(fam, school_rule_set('jafari')).refusal, 'school_not_supported')

    def test_unknown_school(self):
        for bad in ('x', None, 3, ''):
            with self.assertRaises(c.ContractError) as raised:
                school_rule_set(bad)
            self.assertEqual(raised.exception.code, 'invalid_contract')

    def test_fixture_answers(self):
        for title, expected in FIXTURES:
            with self.subTest(title):
                fam = family([relationship for relationship, _share in expected])
                by, result = shares(fam, 'hanbali')
                self.assertEqual([by[f'h{i}'] for i in range(len(expected))], [F(s) for _r, s in expected])
                self.assertEqual(sum(by.values(), F(0)) + result.unallocated, 1)


class RoundTripTests(unittest.TestCase):
    def test_every_result_survives_its_own_contract(self):
        for title, expected in FIXTURES:
            for school in SCHOOLS:
                with self.subTest(title=title, school=school):
                    result = calculate(family([r for r, _s in expected]), school_rule_set(school))
                    self.assertEqual(c.parse_result(c.dump_result(result)), result)
                    json.dumps(c.dump_result(result))

    def test_refused_results_round_trip(self):
        cases = ((family(['father', 'father']), 'hanbali'), (family(['son']), 'jafari'),
                 (family(MALIKIYYA), 'maliki'), (c.parse_family(later_deaths_document()), 'jafari'))
        for fam, school in cases:
            result = calculate(fam, school_rule_set(school))
            self.assertEqual(result.status, 'refused')
            self.assertEqual(c.parse_result(c.dump_result(result)), result)

    def test_heir_order_does_not_change_a_persons_answer(self):
        for title, expected in FIXTURES:
            rels = [r for r, _s in expected]
            ids = [f'h{i}' for i in range(len(rels))]
            for school in SCHOOLS[:4]:
                with self.subTest(title=title, school=school):
                    forward = calculate(family(rels), school_rule_set(school))
                    document = family_document(rels)
                    document['estates'][0]['heirs'].reverse()
                    backward = calculate(c.parse_family(document), school_rule_set(school))
                    self.assertEqual({a.person: a.share for a in forward.allocations},
                                     {a.person: a.share for a in backward.allocations})
                    self.assertEqual(forward.unallocated, backward.unallocated)
                    self.assertEqual([a.person for a in backward.allocations], list(reversed(ids)))


class RuleSetTests(unittest.TestCase):
    CITE = {'statute_id': 'zz-law', 'article': '1', 'checked_on': '2026-01-01'}

    def preset(self, **overrides):
        data = json.loads((ROOT / 'contracts' / 'fixtures' / 'preset' / 'zz-2026-01-01.json').read_text('utf-8'))
        data.update(overrides)
        return data

    def test_schools(self):
        self.assertEqual(school_rule_set('hanafi').rules['grandfather_with_siblings'], 'blocks')
        self.assertTrue(school_rule_set('maliki').rules['malikiyya_disputed'])
        self.assertFalse(school_rule_set('shafii').rules['malikiyya_disputed'])
        self.assertEqual(school_rule_set('shafii').rules['radd_position'], 'radd_later_scholars')
        self.assertEqual(dict(school_rule_set('hanbali').settings), {})

    def test_preset_overlays_the_default_school(self):
        data = self.preset(default_school='hanbali', rules={'grandfather_with_siblings': 'blocks'}, settings={},
                           citations={'grandfather_with_siblings': self.CITE})
        rule_set = parse_preset(data)
        self.assertEqual((rule_set.school, rule_set.preset_id, rule_set.preset_version),
                         ('hanbali', data['id'], data['version']))
        self.assertEqual(rule_set.default_currency, data['default_currency'])
        self.assertEqual(dict(rule_set.rules), dict(school_rule_set('hanbali').rules, grandfather_with_siblings='blocks'))
        result = calculate(family(['grandfather', 'brother']), rule_set)
        self.assertEqual([a.share for a in result.allocations], [F(1), F(0)])
        self.assertEqual(result.school, 'hanbali')

    def test_invalid_presets(self):
        cite = self.CITE
        cases = [
            self.preset(version='nope'),
            self.preset(schema_version=2),
            self.preset(rules={'no_such_rule': True}, citations={'no_such_rule': cite}),
            self.preset(rules={'mushtaraka': 'yes'}, citations={'mushtaraka': cite}),
            self.preset(rules={'grandfather_with_siblings': 'maybe'}, citations={'grandfather_with_siblings': cite}),
            self.preset(rules={'radd_position': True}, citations={'radd_position': cite}),
            self.preset(settings={'no_such_setting': True}),
        ]
        for data in cases:
            with self.subTest(data=data):
                with self.assertRaises(c.ContractError) as raised:
                    parse_preset(data)
                self.assertIn(raised.exception.code, ('invalid_contract', 'unsupported_version'))

    def test_a_rule_set_needs_every_rule(self):
        with self.assertRaises(c.ContractError):
            RuleSet('hanbali', {}, {})
        with self.assertRaises(c.ContractError):
            RuleSet('x', school_rule_set('hanbali').rules, {})


class ImmutabilityTests(unittest.TestCase):
    def test_rule_set_result_and_evidence_cannot_be_changed(self):
        rule_set = school_rule_set('hanbali')
        with self.assertRaises(TypeError):
            rule_set.rules['mushtaraka'] = True
        with self.assertRaises(TypeError):
            rule_set.settings['x'] = 1
        with self.assertRaises(FrozenInstanceError):
            rule_set.school = 'hanafi'
        evaluation = evaluate(family(['wife', 'son']), rule_set)
        with self.assertRaises(FrozenInstanceError):
            evaluation.result.status = 'refused'
        with self.assertRaises(FrozenInstanceError):
            evaluation.result.allocations[0].share = F(1)
        with self.assertRaises(TypeError):
            evaluation.result.steps[0].params['base'] = None
        with self.assertRaises(TypeError):
            evaluation.proof['version'] = 2
        with self.assertRaises(TypeError):
            evaluation.proof['heirs'][0]['share'] = None
        with self.assertRaises(AttributeError):
            evaluation.proof['heirs'].append(1)
        with self.assertRaises(TypeError):
            evaluation.table['rows'][0]['cells'][0]['value'] = 1

    def test_thaw_gives_plain_data(self):
        evaluation = evaluate(family(['wife', 'son']), school_rule_set('hanbali'))
        proof = thaw(evaluation.proof)
        self.assertIs(type(proof), dict)
        self.assertIs(type(proof['heirs']), list)
        self.assertIs(type(proof['heirs'][0]), dict)
        self.assertEqual(proof['steps'], [{'step': 'base', 'value': 8}])
        self.assertEqual(proof['school_rules'], [])
        self.assertEqual(proof['madhab'], 'hanbali')
        self.assertEqual(proof['heirs'][0]['heir'], 'h1')  # the son is classified first
        json.dumps(proof)
        json.dumps(thaw(evaluation.table))
        self.assertIsNone(thaw(None))

    def test_a_refusal_has_no_evidence(self):
        evaluation = evaluate(family(['son']), school_rule_set('jafari'))
        self.assertEqual((evaluation.proof, evaluation.table), (None, None))


if __name__ == '__main__':
    unittest.main()
