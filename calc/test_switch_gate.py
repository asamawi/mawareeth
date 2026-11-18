"""AD-15: production consumers cannot switch until these corpus comparisons pass."""
from fractions import Fraction

from django.test import TransactionTestCase, tag

import engine
import presentation
from engine import contracts
from api import heir_rules, preview as production
from calc import schools
from calc.adapters import basis_from_madhab, family_from_calculation, family_from_session
from calc import legacy_preview_reference as reference
from calc.test_engine_parity import (ALL_SCHOOLS, GENDER, core_families, fixture_families, relationship)
from calc.tests import HEIR_SEX, build_case, build_layer, families
from calc.manasikhat import compute_manasikhat
from engine.tests.test_layered import layered_cases


def switched(body):
    """The production preview's legacy fields; `presented` is additive and checked on its own."""
    return {key: value for key, value in body.items() if key != 'presented'}


def mapped(value, ids, deaths):
    if isinstance(value, dict):
        return {key: (ids[item] if key in ('heir', 'row', 'person') and item is not None else
                      deaths[item] if key == 'deceased' and item is not None else mapped(item, ids, deaths))
                for key, item in value.items()}
    if isinstance(value, list):
        return [mapped(item, ids, deaths) for item in value]
    return value


class SwitchGate:
    def check(self, calc, case):
        family, ids = family_from_calculation(calc)
        session_family, currency = family_from_session(case)
        for school in ALL_SCHOOLS:
            with self.subTest(school=school):
                evaluation = engine.evaluate(family, engine.school_rule_set(school))
                session_evaluation = engine.evaluate(session_family, engine.school_rule_set(school))
                selected = {**case, 'madhab': school}
                expected = reference.preview(selected)
                served = production.preview(selected)
                self.assertEqual(switched(served), expected)
                if expected['status'] != 'not_ready':
                    contracts.parse_presented_result(served['presented'])
                    self.assertEqual(served['presented']['state'], {'available': 'answer', 'unavailable': 'refused'}[
                        expected['status']])
                # Preview guards impossible families before the legacy ORM entry point.
                invalid = production.is_impossible(case) or any(heir_rules.is_impossible_family(
                    d['gender'], heir_rules.counts(d['heirs'])) for d in case.get('deaths', []))
                if invalid:
                    self.assertEqual(expected['reason'], 'invalid_family')
                    self.assertEqual(evaluation.result.refusal, 'invalid_family')
                    self.assertEqual(session_evaluation.result.refusal, 'invalid_family')
                    for result in (evaluation.result, session_evaluation.result):
                        self.assertEqual(result.status, 'refused')
                        self.assertEqual((result.allocations, result.steps, result.unallocated), ((), (), None))
                    continue  # Impossible inputs have a consumer refusal, not raw ORM shares.
                try:
                    if case.get('deaths'):
                        exact, proof = compute_manasikhat(calc, school)
                    else:
                        exact = calc.legacy_compute(school)
                        proof = calc.proof
                except schools.UnsupportedCase as refusal:
                    self.assertEqual(evaluation.result.refusal, refusal.reason)
                    self.assertEqual(session_evaluation.result.refusal, refusal.reason)
                    continue
                self.assertEqual(engine.final_shares(evaluation.result),
                                 {ids.heir_to_person[pk]: share for pk, share in exact.items()})
                expected_proof = mapped(proof, ids.heir_to_person, ids.deceased_to_person)
                if expected_proof['version'] == 2:
                    expected_proof['people'] = [p for p in expected_proof['people'] if p['row'] != p['person']]
                self.assertEqual(engine.thaw(evaluation.proof), expected_proof)
                self.assertEqual(engine.thaw(evaluation.table), mapped(calc.table, ids.heir_to_person,
                                                                      ids.deceased_to_person))
                resolved = basis_from_madhab(school)
                for source, cur in ((family, currency), (session_family, currency)):
                    shown = presentation.present(presentation.outcome(source, resolved), resolved, 'en', cur)
                    contracts.parse_presented_result(contracts.dump_presented_result(shown))
                    final = engine.final_shares(engine.evaluate(source, engine.school_rule_set(school)).result)
                    self.assertEqual({row['person']: Fraction(**row['share']['fraction']) for row in shown.rows}, final)
                    self.assertEqual({row['person']: row['blocked'] for row in shown.rows},
                                     {pid: share == 0 for pid, share in final.items()})
        self.assertEqual(switched(production.preview({**case, 'madhab': None})), reference.preview({**case, 'madhab': None}))
        resolved = basis_from_madhab(None)
        shown = presentation.present(presentation.outcome(session_family, resolved), resolved, 'en', currency)
        expected = reference.preview({**case, 'madhab': None})
        if expected['status'] != 'not_ready':
            self.assertEqual(shown.state, {'available': 'answer', 'unavailable': 'refused',
                                          'choose_school': 'selection_required'}[expected['status']])

    def sweep(self, corpus):
        for sex, types in corpus:
            if not types:
                continue  # not_ready has no calculation or presented result
            with self.subTest(sex=sex, heirs=[t.__name__ for t in types]):
                calc, rows = build_case(sex, types)
                case = {'madhab': None, 'deceased': {'gender': GENDER[sex], 'estate': '7000'},
                        'heirs': [{'id': f'h{r.pk}', 'relationship': relationship(t),
                                   'gender': GENDER[HEIR_SEX[t]], 'name': r.first_name}
                                  for r, t in zip(rows, types)], 'deaths': []}
                self.check(calc, case)


@tag('slow')
class FixtureSwitchGateTests(SwitchGate, TransactionTestCase):
    def test_known_answers_schools_proofs_and_refusals(self):
        self.sweep(fixture_families())


@tag('slow')
class SweepSwitchGateTests(SwitchGate, TransactionTestCase):
    def test_impossible_families_are_not_exempt_from_adapter_parity(self):
        refused = [(sex, types) for sex, types in families()
                   if heir_rules.is_impossible_family(GENDER[sex], heir_rules.counts(
                       [{'relationship': relationship(t)} for t in types]))]
        self.assertTrue(refused, 'the refusal corpus must be exercised')
        self.sweep(refused)

    def test_relationship_and_random_families(self):
        self.sweep(families())

    def test_core_families(self):
        self.sweep(core_families())


@tag('slow')
class LayeredSwitchGateTests(SwitchGate, TransactionTestCase):
    def test_later_deaths(self):
        classes = {relationship(cls): cls for cls in HEIR_SEX}
        for name, document in layered_cases().items():
            with self.subTest(name=name):
                source = contracts.parse_family(document)
                people = {p.id: p for p in source.persons}
                first_rows, calcs = {}, []
                case = {'madhab': None, 'deceased': {'gender': 'male', 'estate': '7000'},
                        'heirs': [], 'deaths': []}
                for estate in source.estates:
                    types = [classes[h.relationship] for h in estate.heirs]
                    sex = ('F' if any(h.relationship == 'husband' for h in estate.heirs) else 'M') if estate.order == 1 else (
                        'M' if people[estate.deceased].gender == 'male' else 'F')
                    if estate.order == 1:
                        calc, rows = build_case(sex, types)
                        case['deceased']['gender'] = GENDER[sex]
                    else:
                        links = [(i, first_rows[h.person]) for i, h in enumerate(estate.heirs) if h.person in first_rows]
                        calc, rows = build_layer(calcs[-1], first_rows[estate.deceased], sex, types, links,
                                                 order=estate.order)
                    calcs.append(calc)
                    session_rows = []
                    for heir, row in zip(estate.heirs, rows):
                        session_rows.append({'id': f'h{row.pk}', 'relationship': heir.relationship,
                                             'gender': GENDER[row.sex], 'name': row.first_name,
                                             **({'same_as': f'h{first_rows[heir.person].pk}'}
                                                if heir.person in first_rows else {})})
                        first_rows.setdefault(heir.person, row)
                    if estate.order == 1:
                        case['heirs'] = session_rows
                    else:
                        case['deaths'].append({'heir_id': f'h{first_rows[estate.deceased].pk}',
                                               'order': estate.order, 'gender': GENDER[sex], 'heirs': session_rows})
                self.check(calcs[0], case)
