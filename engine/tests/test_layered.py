"""Successive-death matrix and exact evidence tests, without Django."""
import copy
import unittest
from contextlib import nullcontext
from dataclasses import replace, FrozenInstanceError
from fractions import Fraction as F

from engine import calculate, evaluate, final_shares, school_rule_set, thaw, contracts as c
from engine.tests.test_core import family_document, person, SCHOOLS, MALIKIYYA


def layered_document(root, later):
    """Build a Family from rows and later (deceased, rows) estates."""
    doc = family_document([])
    known = {}
    for order, (deceased, rows) in enumerate([('root', root)] + later, 1):
        for pid, rel in rows:
            known.setdefault(pid, person(pid, rel))
        doc['estates'].append({'order': order, 'deceased': deceased,
                              'heirs': [{'person': pid, 'relationship': rel} for pid, rel in rows]})
        if order > 1:
            known[deceased]['status'] = 'died_later'
            known[deceased]['death_order'] = order
    doc['estates'].pop(0)
    doc['persons'] = list(known.values())
    return doc


def layered_cases():
    root = [('W', 'wife'), ('S1', 'son'), ('S2', 'son')]
    second = ('S1', [('W', 'mother'), ('S2', 'brother')])
    cases = {}
    for third in (False, True):
        for reverse in (False, True):
            rows = root[1:] + root[:1] if reverse else root
            later = [second] + ([('W', [('S2', 'son'), ('N', 'mother')])] if third else [])
            cases[f'fixture_{third}_{reverse}'] = layered_document(rows, later)
    cases['sibling'] = layered_document(root, [second, ('S2', [('W', 'mother'), ('U', 'uncle')])])
    cases['school'] = layered_document([('H', 'husband'), ('S1', 'son'), ('S2', 'son')],
                                      [('S1', [('H', 'father'), ('G', 'paternal_grandmother'), ('S2', 'brother')])])
    cases['malikiyya'] = layered_document([('W', 'wife'), ('D', 'daughter')],
                                         [('D', [(f'm{i}', rel) for i, rel in enumerate(MALIKIYYA)])])
    cases['zero'] = layered_document([('F', 'father'), ('B', 'brother')], [('B', [('S', 'son')])])
    cases['blocked_then_heir'] = layered_document([('F', 'father'), ('B', 'brother')], [('F', [('B', 'son')])])
    cases['unallocated'] = layered_document([('W', 'wife'), ('S', 'son')], [('S', [('V', 'wife')])])
    cases['empty'] = layered_document([('W', 'wife'), ('S', 'son')], [('S', [])])
    cases['non_root_deceased'] = layered_document(
        [('S', 'son')], [('S', [('V', 'wife')]), ('V', [('N', 'son')])])
    cases['later_awl'] = layered_document(
        [('D', 'daughter')],
        [('D', [('H', 'husband'), ('S1', 'sister'), ('S2', 'sister'), ('M', 'mother')])])
    cases['later_grandfather_brother'] = layered_document(
        [('S', 'son')], [('S', [('G', 'grandfather'), ('B', 'brother')])])
    cases['wrong_sex'] = layered_document([('S', 'son')], [('S', [('H', 'husband')])])
    cases['wrong_sex_female'] = layered_document([('D', 'daughter')], [('D', [('W', 'wife')])])
    return cases


class LayeredCoreTests(unittest.TestCase):
    def test_matrix_roundtrip_and_determinism(self):
        for name, doc in layered_cases().items():
            for school in SCHOOLS:
                with self.subTest(name=name, school=school):
                    fam = c.parse_family(doc)
                    ev = evaluate(fam, school_rule_set(school))
                    result = ev.result
                    self.assertEqual(evaluate(fam, school_rule_set(school)), ev)
                    restored = c.parse_result(c.dump_result(result))
                    self.assertEqual(restored, result)
                    self.assertEqual(final_shares(restored), final_shares(result))
                    reason = ('invalid_family' if name.startswith('wrong_sex') else
                              'school_not_supported' if school == 'jafari' else
                              'malikiyya_disputed' if name == 'malikiyya' and school == 'maliki' else None)
                    self.assertEqual(result.refusal, reason)
                    if reason:
                        self.assertEqual((result.allocations, result.layers, ev.proof, ev.table), ((), (), None, None))
                        self.assertIsNone(final_shares(result))
                        continue
                    for layer, estate in zip(result.layers, fam.estates[1:]):
                        standalone = c.parse_family(layered_document(
                            [(h.person, h.relationship) for h in estate.heirs], []))
                        self.assertEqual(layer.steps, evaluate(standalone, school_rule_set(school)).result.steps)
                    proof = thaw(ev.proof)
                    final = final_shares(result)
                    self.assertEqual(final, {r['heir']: F(r['fraction']['numerator'], r['fraction']['denominator'])
                                             for r in proof['final']})
                    self.assertEqual(proof['people'], [])
                    self.assertEqual([l.order for l in result.layers], list(range(2, len(doc['estates']) + 1)))
                    if name.startswith('fixture'):
                        third = name.startswith('fixture_True')
                        self.assertEqual(final, {'S2': F(275, 288), 'N': F(13, 288)} if third else {'W': F(13, 48), 'S2': F(35, 48)})
                        self.assertEqual(proof['base'], 288 if third else 48)
                        self.assertEqual(result.layers[0].inherited, F(7, 16))
                        self.assertEqual([a.share for a in result.allocations],
                                         [F(7, 16), F(7, 16), F(1, 8)] if name.endswith('True') else [F(1, 8), F(7, 16), F(7, 16)])
                    elif name == 'sibling':
                        self.assertEqual(final, {'W': F(37, 72), 'U': F(35, 72)})
                        self.assertEqual(proof['base'], 72)
                    elif name == 'school':
                        self.assertEqual(final, {'H': F(9, 16) if school == 'hanbali' else F(5, 8),
                                                 'G': F(1, 16) if school == 'hanbali' else F(0), 'S2': F(3, 8)})
                    elif name == 'non_root_deceased':
                        self.assertEqual(result.layers[1].inherited, F(1, 4))
                        self.assertEqual(final, {'N': F(1, 4)})
                    elif name == 'later_awl':
                        self.assertEqual(final, {'H': F(3, 8), 'S1': F(1, 4), 'S2': F(1, 4), 'M': F(1, 8)})
                    elif name == 'later_grandfather_brother':
                        self.assertEqual(final, {'G': F(1) if school == 'hanafi' else F(1, 2),
                                                 'B': F(0) if school == 'hanafi' else F(1, 2)})
                    elif name == 'zero':
                        self.assertEqual(final, {'F': F(1), 'S': F(0)})
                        self.assertEqual(result.layers[0].inherited, 0)
                        self.assertEqual(ev.table['layers'][1]['relation'], 'no_share')
                    elif name == 'blocked_then_heir':
                        self.assertEqual(final, {'B': F(1)})
                    elif name == 'empty':
                        self.assertEqual(result.layers[0].allocations, ())
                        self.assertEqual(result.layers[0].unallocated, 1)
                        self.assertEqual(final, {'W': F(1, 8)})
                        self.assertIsNone(ev.table)
                    elif name == 'unallocated':
                        self.assertEqual(final, {'W': F(1, 8), 'V': F(7, 32)})
                        last = ev.table['layers'][-1]
                        self.assertEqual(F(last['unallocated'], last['jamia']), 1 - sum(final.values()))

    def test_unlinked_and_refusal_order(self):
        doc = layered_cases()['empty']
        doc['persons'].append(person('outsider', 'son', 'died_later', 2))
        doc['persons'][1].update(status='alive', death_order=None)
        doc['estates'][1]['deceased'] = 'outsider'
        fam = c.parse_family(doc)
        self.assertEqual(evaluate(fam, school_rule_set('hanbali')).result.refusal, 'manasikhat_unsupported')
        with_bequest = copy.deepcopy(doc)
        with_bequest['bequests'].append({'branch': 'W', 'amount_minor': 1000})
        self.assertEqual(calculate(c.parse_family(with_bequest), school_rule_set('hanbali')).refusal, 'invalid_family')
        self.assertEqual(evaluate(fam, school_rule_set('jafari')).result.refusal, 'school_not_supported')
        doc['estates'][1]['heirs'] = [{'person': 'W', 'relationship': 'husband'}]
        self.assertEqual(evaluate(c.parse_family(doc), school_rule_set('jafari')).result.refusal, 'invalid_family')

    def test_later_estate_gender_mismatch_is_refused(self):
        base = layered_document([('S', 'son'), ('W', 'wife')], [('S', [('N', 'son')])])
        for school in SCHOOLS:
            result = evaluate(c.parse_family(base), school_rule_set(school)).result
            self.assertEqual((result.status, result.refusal),
                             ('refused', 'school_not_supported') if school == 'jafari' else ('calculated', None))
        only = layered_document([('S', 'son'), ('W', 'wife')], [('S', [('N', 'son')])])
        next(p for p in only['persons'] if p['id'] == 'N')['gender'] = 'female'
        aliased = layered_document([('S', 'son'), ('W', 'wife')], [('S', [('W', 'mother')])])
        aliased['estates'][1]['heirs'] = [{'person': 'W', 'relationship': 'son'}]
        third = layered_document([('S', 'son'), ('W', 'wife')], [('S', [('W', 'mother'), ('N', 'son')]),
                                                                  ('W', [('N', 'daughter')])])
        for name, doc in (('only', only), ('aliased', aliased), ('third_estate', third)):
            for school in SCHOOLS:
                with self.subTest(name=name, school=school):
                    result = evaluate(c.parse_family(doc), school_rule_set(school)).result
                    self.assertEqual((result.status, result.refusal), ('refused', 'invalid_family'))

    def test_inherited_mismatch_and_frozen_evidence(self):
        ev = evaluate(c.parse_family(layered_cases()['fixture_True_False']), school_rule_set('hanbali'))
        bad = replace(ev.result, layers=(replace(ev.result.layers[0], inherited=F(1)),) + ev.result.layers[1:])
        with self.assertRaises(c.ContractError) as raised:
            final_shares(bad)
        self.assertEqual(raised.exception.code, 'invalid_contract')
        with self.assertRaises(TypeError):
            ev.proof['layers'][1]['proof']['heirs'][0]['share']['numerator'] = 0
        with self.assertRaises(TypeError):
            ev.table['layers'][1]['parts'][0]['value'] = 0
        with self.assertRaises(FrozenInstanceError):
            ev.result.layers[0].inherited = F(1)


class LayeredTableTests(unittest.TestCase):
    @staticmethod
    def layer(order, heir, shares):
        return {'order': order, 'heir': heir, 'proof': {'heirs': [
            {'heir': pk, 'share': {'numerator': share.numerator, 'denominator': share.denominator}}
            for pk, share in shares.items()]}}

    def test_malformed_layers_fail_closed(self):
        from copy import deepcopy
        from engine.proof import build_layered_table
        table = {'columns': [{'code': 'base', 'total': 1}],
                 'rows': [{'heir': 1, 'cells': [{'value': 1, 'span': 1}]}]}
        for defect in ('empty_columns', 'missing_cell', 'past_end', 'orphan', 'proof_share', 'covered_owner', 'unknown_final'):
            with self.subTest(defect=defect):
                broken = deepcopy(table)
                entry = self.layer(1, None, {1: F(1)})
                final = {1: F(1)}
                if defect == 'empty_columns':
                    broken['columns'] = []
                elif defect == 'missing_cell':
                    broken['rows'][0]['cells'] = []
                elif defect == 'past_end':
                    broken['rows'][0]['cells'][0]['span'] = 2
                elif defect == 'orphan':
                    broken['rows'][0]['cells'][0]['span'] = 0
                elif defect == 'proof_share':
                    entry['proof']['heirs'][0]['share']['numerator'] = 0
                elif defect == 'covered_owner':
                    broken['rows'].append(deepcopy(broken['rows'][0]))
                    broken['rows'][0]['cells'][0]['span'] = 2
                else:
                    final[2] = F(1, 2)
                with nullcontext():
                    self.assertIsNone(build_layered_table([entry], [broken], final, {1: 1}))

    def test_relations_merged_parts_and_fail_closed(self):
        from engine.proof import build_layered_table

        def table(base, values, spans=None):
            spans = spans or [1] * len(values)
            return {'columns': [{'code': 'base', 'total': base}],
                    'rows': [{'heir': pk, 'cells': [{'value': value, 'span': span}]} for pk, value, span in zip(range(1, len(values) + 1), values, spans)]}

        for p, base, relation in [(2, 2, 'tamathul'), (2, 4, 'tawafuq'), (1, 2, 'tabayun'), (0, 2, 'no_share')]:
            first = table(4, [p, 4 - p])
            second = {'columns': [{'code': 'base', 'total': base}],
                      'rows': [{'heir': 3, 'cells': [{'value': base, 'span': 1}]}]}
            layers = [self.layer(1, None, {1: F(p, 4), 2: F(4 - p, 4)}), self.layer(2, 1, {3: F(1)})]
            final = {2: F(4 - p, 4), 3: F(p, 4)}
            result = build_layered_table(layers, [first, second], final, {1: 1, 2: 2, 3: 3})
            self.assertIsNotNone(result)
            self.assertEqual(result['layers'][1]['relation'], relation)
            self.assertEqual(result['layers'][1]['jamia'], 4 if p in (0, 2) and base == 2 else 8)
            with nullcontext():
                self.assertIsNone(build_layered_table(layers, [first, second], {2: F(1, 7)}, {1: 1, 2: 2, 3: 3}))
            with nullcontext():
                self.assertIsNone(build_layered_table(layers, [first, None], final, {1: 1, 2: 2, 3: 3}))
        merged = build_layered_table([self.layer(1, None, {1: F(1, 2), 2: F(1, 2)})], [table(2, [2, 2], [2, 0])],
                                     {1: F(1, 2), 2: F(1, 2)}, {1: 1, 2: 2})
        self.assertEqual(merged['layers'][0]['parts'], [{'heir': 1, 'value': 1}, {'heir': 2, 'value': 1}])

    def test_unallocated_parts_carry_through_each_combination(self):
        from engine.proof import build_layered_table
        # Death 1: base 4, heir 1 (who dies next) holds 2, heir 2 holds 1, 1 part unallocated.
        first = {'columns': [{'code': 'base', 'total': 4}],
                 'rows': [{'heir': 1, 'cells': [{'value': 2, 'span': 1}]},
                          {'heir': 2, 'cells': [{'value': 1, 'span': 1}]}]}
        # Death 2: base 3, heir 3 holds 2, 1 part unallocated. p = 2, g = 1, tabayun: J = 12.
        second = {'columns': [{'code': 'base', 'total': 3}],
                  'rows': [{'heir': 3, 'cells': [{'value': 2, 'span': 1}]}]}
        layers = [self.layer(1, None, {1: F(2, 4), 2: F(1, 4)}), self.layer(2, 1, {3: F(2, 3)})]
        final = {1: F(0), 2: F(3, 12), 3: F(4, 12)}
        result = build_layered_table(layers, [first, second], final, {1: 1, 2: 2, 3: 3})
        self.assertIsNotNone(result)
        self.assertTrue(result['unallocated'])
        self.assertEqual([l['unallocated'] for l in result['layers']], [1, 5])
        self.assertEqual(result['layers'][1]['jamia'], 12)
        self.assertEqual(result['layers'][1]['relation'], 'tabayun')
        with nullcontext():
            self.assertIsNone(build_layered_table(layers, [first, second], {**final, 2: F(4, 12)},
                                                  {1: 1, 2: 2, 3: 3}))

