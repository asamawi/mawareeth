"""Parity of the presented answer with the engine and with the legacy path, over the existing corpus.

For every family of the `calc` corpus, under each School and under compare, the presented rows, evidence
codes and comparison outcome equal what the engine evaluation holds and what `Calculation.compute` and the
`api.preview` signature rule decide. A mismatch is a presentation bug, never a reason to edit a fixture.
Formatting differences are not asserted here: they live in fixtures/display-changes.json.

Only functions and constants are imported from the other test modules, never a TestCase class.
"""
from fractions import Fraction as F

from django.test import TransactionTestCase, tag

import engine
import presentation
from api import heir_rules, preview
from calc import schools
from calc.manasikhat import compute_manasikhat
from calc.test_engine_parity import (ALL_SCHOOLS, GENDER, build_family, core_families, fixture_families,
                                     relationship)
from calc.tests import HEIR_SEX, build_case, build_layer, families
from engine import contracts
from engine import core as engine_core
from engine.proof import CITATION_KEYS
from engine.tests.test_layered import layered_cases

SUNNI = contracts.codes.SUNNI_SCHOOLS


def fraction_of(value):
    return F(value['numerator'], value['denominator'])


def legacy_body(finals):
    """The shape `api.preview._signature` reads, from {person: (fraction, blocked)}."""
    shares = [{'heir_id': pid, 'blocked': blocked or fraction == 0, **preview._fraction(fraction)}
              for pid, (fraction, blocked) in finals.items()]
    left = 1 - sum((fraction for fraction, _blocked in finals.values()), F(0))
    return {'status': 'available', 'shares': shares, 'unallocated': preview._fraction(left) if left > 0 else None}


def legacy_decision(by_school):
    """What `api.preview.preview` decides for a case with no School, as the comparison outcome.
    Every School refused is `all_refused` whatever the reasons (the spec's rule)."""
    bodies = [by_school[s] for s in SUNNI]
    if all(b['status'] == 'available' for b in bodies) and len({repr(preview._signature(b)) for b in bodies}) == 1:
        return 'agreement'
    if all(b['status'] == 'unavailable' for b in bodies):
        return 'all_refused'
    return 'difference'


def proof_layers(evaluation):
    proof = engine.thaw(evaluation.proof)
    return [proof] if proof['version'] == 1 else [layer['proof'] for layer in proof['layers']]


class PresentedParity:
    """Assertions shared by the single-estate and the layered corpus."""

    def present(self, family, basis, locale='en'):
        resolved = contracts.resolve_basis(basis, {})
        out = presentation.outcome(family, resolved)
        result = presentation.present(out, resolved, locale, None)
        self.assertEqual(contracts.parse_presented_result(contracts.dump_presented_result(result)), result)
        return out, result

    def assert_evidence(self, presented, evaluation):
        layers = proof_layers(evaluation)
        self.assertEqual(len(presented.evidence), len(layers))
        for entry, proof in zip(presented.evidence, layers):
            heirs = {h['heir']: h for h in proof['heirs']}
            self.assertEqual(sorted(h['person'] for h in entry['heirs']), sorted(heirs))
            steps = proof['steps']
            integer = [s for s in steps if s['step'] != 'unallocated']
            stage = (integer[-1]['step'], integer[-1]['value']) if integer and integer[-1]['value'] else None
            for heir in entry['heirs']:
                want = heirs[heir['person']]
                code = lambda label: None if label is None else label['code']
                self.assertEqual((heir['rule']['code'], code(heir['condition']), code(heir['blocked_by']),
                                  code(heir['school_rule']), code(heir['option'])),
                                 (want['rule'], want['condition'], want['blocked_by'], want['school_rule'],
                                  want['option']))
                self.assertEqual([v['code'] for v in heir['verses']],
                                 [] if want['verse'] is None else [CITATION_KEYS[want['verse']]])
                self.assertEqual(heir['stage'], None if want['rule'] == 'blocked' or stage is None else
                                 {'step': stage[0], 'base': stage[1]})
            self.assertEqual([r['code'] for r in entry['school_rules']], proof['school_rules'])
            if steps[0]['value'] == 0:
                steps = steps[:1]
            want_steps = [(s['step'], {'rest': {'type': 'fraction', 'value': s['value']}} if s['step'] == 'unallocated'
                           else {'base': {'type': 'int', 'value': s['value']}}) for s in steps]
            self.assertEqual([(s['step'], s['params']) for s in entry['steps']], want_steps)

    def assert_answer(self, family, evaluation, presented, legacy):
        """`legacy` is ('refused', reason) or ('ok', {person: (fraction, blocked)})."""
        if legacy[0] == 'refused':
            self.assertEqual((presented.state, presented.rows, presented.rounding, presented.unallocated),
                             ('refused', (), None, None))
            self.assertEqual([r['reason'] for r in presented.refusals], [legacy[1]])
            self.assertEqual(evaluation.result.refusal, legacy[1])
            return
        self.assertEqual(presented.state, 'answer')
        final = engine.final_shares(evaluation.result)
        order = [p.id for p in family.persons if p.id in final]
        self.assertEqual([r['person'] for r in presented.rows], order)
        self.assertEqual({r['person'] for r in presented.rows}, set(legacy[1]))
        for row in presented.rows:
            share = fraction_of(row['share']['fraction'])
            fraction, blocked = legacy[1][row['person']]
            self.assertEqual((share, share == final[row['person']]), (fraction, True))
            self.assertEqual(row['blocked'], blocked or share == 0)
            self.assertIs(row['amount'], None)
        self.assert_evidence(presented, evaluation)

    def check_family(self, family, legacy_by_school, schools_to_check):
        for school in schools_to_check:
            with self.subTest(school=school):
                out, presented = self.present(family, {'kind': 'school', 'school': school})
                self.assert_answer(family, out.evaluations[0][1], presented, legacy_by_school[school])
        bodies = {}
        for school in SUNNI:
            kind, value = legacy_by_school[school]
            bodies[school] = ({'status': 'unavailable', 'reason': value} if kind == 'refused'
                              else legacy_body(value))
        out, presented = self.present(family, {'kind': 'compare'})
        decision = legacy_decision(bodies)
        self.assertEqual(presented.comparison_outcome, decision)
        self.assertEqual(presentation.compare(out).outcome, decision)
        expected_state = {'agreement': 'answer', 'difference': 'selection_required', 'all_refused': 'refused'}
        self.assertEqual(presented.state, expected_state[decision])
        if decision == 'agreement':
            # the preview shows the Hanbali answer when the Schools agree
            self.assertEqual(presented.school_line['code'], 'same_in_all_schools')
            self.assert_answer(family, out.evaluations[-1][1], presented, legacy_by_school['hanbali'])


class SingleEstateParity(PresentedParity):
    def check(self, sex, types):
        if not types:
            return  # no heirs yet: the legacy preview is not ready and there is nothing to present
        family = build_family(sex, types)
        rels = [relationship(cls) for cls in types]
        counts = heir_rules.counts([{'relationship': r} for r in rels])
        if heir_rules.is_impossible_family(GENDER[sex], counts):
            if not engine_core.is_impossible(rels):
                return  # a spouse of the wrong sex alone: a Family has no sex for the deceased
            legacy = {school: ('refused', 'invalid_family') for school in ALL_SCHOOLS}
        else:
            calc, heirs = build_case(sex, types)
            ids = {heir.pk: f'h{i}' for i, heir in enumerate(heirs)}
            legacy = {}
            for school in ALL_SCHOOLS:
                try:
                    exact = calc.compute(madhab=school)
                except schools.UnsupportedCase as refusal:
                    legacy[school] = ('refused', refusal.reason)
                    continue
                blocked = {ids[h.pk]: h.blocked for h in calc.heir_set.all()}
                legacy[school] = ('ok', {ids[pk]: (fraction, blocked[ids[pk]]) for pk, fraction in exact.items()})
        self.check_family(family, legacy, ALL_SCHOOLS)

    def sweep(self, corpus):
        for sex, types in corpus:
            with self.subTest(f'{sex}: {[t.__name__ for t in types]}'):
                self.check(sex, types)


class FixtureParityTests(SingleEstateParity, TransactionTestCase):
    def test_fixture_families_present_as_the_legacy_path_answers(self):
        self.sweep(fixture_families())


@tag('slow')
class SweepParityTests(SingleEstateParity, TransactionTestCase):
    def test_every_family_of_the_sweeps(self):
        self.sweep(families())


@tag('slow')
class CoreFamilyParityTests(SingleEstateParity, TransactionTestCase):
    def test_every_core_family(self):
        self.sweep(core_families())


class LayeredParityTests(PresentedParity, TransactionTestCase):
    def legacy(self, family, school, classes):
        """`compute_manasikhat` over database rows built like the layered corpus does: ('ok', finals) or
        ('refused', reason). A person is blocked there when the final share is zero."""
        persons = {p.id: p for p in family.persons}
        impossible = any(heir_rules.is_impossible_family(
            persons[e.deceased].gender,
            heir_rules.counts([{'relationship': h.relationship} for h in e.heirs])) for e in family.estates[1:])
        if impossible:
            return ('refused', 'invalid_family')
        first_rows, row_ids, calcs = {}, {}, []
        for estate in family.estates:
            types = [classes[h.relationship] for h in estate.heirs]
            sex = ('F' if any(h.relationship == 'husband' for h in estate.heirs) else 'M') if estate.order == 1 else (
                'M' if persons[estate.deceased].gender == 'male' else 'F')
            if estate.order == 1:
                calc, rows = build_case(sex, types)
            else:
                links = [(i, first_rows[h.person]) for i, h in enumerate(estate.heirs) if h.person in first_rows]
                calc, rows = build_layer(calcs[-1], first_rows[estate.deceased], sex, types, links,
                                         order=estate.order)
            calcs.append(calc)
            for heir, row in zip(estate.heirs, rows):
                first_rows.setdefault(heir.person, row)
                row_ids[row.pk] = heir.person
        try:
            exact, _evidence = compute_manasikhat(calcs[0], school)
        except schools.UnsupportedCase as refusal:
            return ('refused', refusal.reason)
        return ('ok', {row_ids[pk]: (share, share == 0) for pk, share in exact.items()})

    def test_layered_families_present_as_compute_manasikhat_answers(self):
        classes = {relationship(cls): cls for cls in HEIR_SEX}
        for name, document in layered_cases().items():
            family = contracts.parse_family(document)
            legacy = {school: self.legacy(family, school, classes) for school in ALL_SCHOOLS}
            with self.subTest(name=name):
                self.check_family(family, legacy, ALL_SCHOOLS)
            with self.subTest(name=name, part='rows'):
                for school in ALL_SCHOOLS:
                    out, presented = self.present(family, {'kind': 'school', 'school': school})
                    if presented.state == 'answer':
                        result = out.evaluations[0][1].result
                        self.assertEqual([e['order'] for e in presented.evidence],
                                         [1] + [layer.order for layer in result.layers])
                        for entry, layer in zip(presented.evidence[1:], result.layers):
                            self.assertEqual(fraction_of(entry['inherited']['fraction']), layer.inherited)
                            self.assertEqual(entry['deceased'], layer.deceased)
