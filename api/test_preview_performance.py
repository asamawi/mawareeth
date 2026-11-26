"""The preview does less repeated work and answers byte for byte as before."""
import json
from contextlib import ExitStack
from decimal import Decimal
from fractions import Fraction
from unittest import skipUnless
from unittest.mock import patch

from babel import numbers
from django.contrib.sessions.models import Session
from django.db import connection
from django.test import TransactionTestCase
from django.utils import translation

import engine.core as core
from api import preview
from api.capacity import Harness
from api.throttling import CasePreviewThrottle, CaseWriteThrottle
from calc import schools
from calc.adapters import basis_from_madhab, family_from_session
from engine.contracts import dump_presented_result
from engine.contracts.codes import SUNNI_SCHOOLS
from engine.rule_set import school_rule_set
from presentation.formatting import formatter
from presentation.money import decimal_of, precision
from presentation import outcome as evaluate_outcome, present, refused_outcome


def reference_preview(case):
    """The preview as it was before the change: four full legacy bodies, compared, and a deep-copied dump."""
    if not preview._ready(case):
        return {'status': 'not_ready'}
    family, currency = family_from_session(case, names=False)
    resolved = basis_from_madhab(case['madhab'])
    out = (refused_outcome(family, resolved, preview.INVALID_FAMILY) if preview._impossible(case)
           else evaluate_outcome(family, resolved))
    shown = dump_presented_result(present(out, resolved, translation.get_language() or 'en', currency))
    estate = family.estate.amount_minor
    if case['madhab'] is not None:
        return {**preview._body(case, out.evaluations[0][1], estate), 'presented': shown}
    bodies = preview.compare(case, family, out)
    if all(b['status'] == 'available' for b in bodies.values()) and (
            len({repr(preview._signature(b)) for b in bodies.values()}) == 1):
        return {**bodies[schools.HANBALI], 'madhab': None, 'basis': preview.basis(case), 'agreement': 'all',
                'presented': shown}
    reasons = {b.get('reason') for b in bodies.values()}
    if all(b['status'] == 'unavailable' for b in bodies.values()) and len(reasons) == 1:
        return {**bodies[schools.HANBALI], 'madhab': None, 'basis': preview.basis(case), 'presented': shown}
    return {'status': 'choose_school', 'basis': preview.basis(case), 'schools': bodies,
            'rules': preview._differences(bodies), 'presented': shown}


def reference_evaluate(family, rule_set):
    """`engine.core.evaluate` as it was before the change: each estate's evidence frozen, then thawed
    for the layered build. (Family validity checks are skipped: the workloads are valid.)"""
    totals, identities, entries, tables, layers = {}, {}, [], [], []
    root = None
    for estate in family.estates:
        evaluation = core._estate(estate, rule_set)
        if root is None:
            root = evaluation
        inherited = Fraction(1) if estate.order == 1 else totals.pop(estate.deceased, Fraction(0))
        result = evaluation.result
        for allocation in result.allocations:
            pid = allocation.person
            identities.setdefault(pid, pid)
            totals[pid] = totals.get(pid, Fraction(0)) + inherited * allocation.share
        entries.append({'order': estate.order, 'deceased': estate.deceased,
                        'heir': None if estate.order == 1 else estate.deceased,
                        'estate': inherited, 'proof': core.thaw(evaluation.proof)})
        tables.append(core.thaw(evaluation.table))
        if estate.order > 1:
            layers.append(core.Layer(estate.order, estate.deceased, inherited, result.allocations,
                                     result.steps, result.unallocated))
    if not layers:
        return root
    result = root.result
    result = core.Result(result.version, result.school, result.status, result.refusal, result.allocations,
                         result.unallocated, result.steps, tuple(layers))
    return core.Evaluation(
        result, core.freeze(core.proof_module.build_layered(rule_set.school, entries, totals)),
        core.freeze(core.proof_module.build_layered_table(entries, tables, totals, identities)))


def dumped(body):
    # The member order is the order the response is rendered in.
    return json.dumps(body, ensure_ascii=False, default=str)


@skipUnless(connection.vendor == 'postgresql', 'requires PostgreSQL')
class PreviewPerformanceTests(TransactionTestCase):
    def setUp(self):
        self.harness = Harness()
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for cls in (CaseWriteThrottle, CasePreviewThrottle):
            self.stack.enter_context(patch.object(cls, 'allow_request', lambda throttle, request, view: True))
        self.addCleanup(lambda: Session.objects.filter(session_key__in=self.harness.keys).delete())

    def session_case(self, name):
        """The case dict the preview view hands to `preview.preview` for a built session."""
        client, case = (self.harness.build(name) if name == 'disagree_compare'
                        else self.harness.build_interview(name))
        seen = []
        original = preview.preview
        with patch('api.preview.preview', lambda case: seen.append(case) or original(case)):
            response = client.get('/api/v1/case/preview/?case_id=' + case['id'], secure=True)
        self.assertEqual(response.status_code, 200)
        return seen[0]

    def variants(self):
        for name in ('compare', 'school', 'two_later_deaths', 'disagree_compare'):
            case = self.session_case(name)
            yield name, case
            if name == 'compare':
                for madhab in ('hanbali', 'hanafi'):
                    yield f'{name} {madhab}', {**case, 'madhab': madhab}
                yield f'{name} not ready', {**case, 'heirs': []}
                # A repeated husband cannot exist: the family is refused.
                husband = next(r for r in case['heirs'] if r['relationship'] == 'wife')
                yield f'{name} impossible', {
                    **case, 'heirs': case['heirs'] + [{**husband, 'id': 'x1', 'relationship': 'father'},
                                                      {**husband, 'id': 'x2', 'relationship': 'father'}]}
                yield f'{name} jafari', {**case, 'madhab': 'jafari'}
            if name == 'two_later_deaths':
                yield f'{name} hanafi', {**case, 'madhab': 'hanafi'}

    def test_response_equals_the_reference_in_both_languages(self):
        statuses = set()
        for label, case in self.variants():
            for language in ('en', 'ar'):
                with self.subTest(case=label, language=language), translation.override(language):
                    actual, expected = preview.preview(case), reference_preview(case)
                    self.assertEqual(dumped(actual), dumped(expected))
                    statuses.add((actual['status'], actual.get('agreement')))
        self.assertIn(('available', 'all'), statuses)
        self.assertIn(('choose_school', None), statuses)
        self.assertIn(('not_ready', None), statuses)
        self.assertIn(('unavailable', None), statuses)

    def test_agreement_builds_one_legacy_body(self):
        for name in ('compare', 'two_later_deaths'):
            case = self.session_case(name)
            with self.subTest(case=name), patch('api.preview._body', wraps=preview._body) as body:
                self.assertEqual(preview.preview(case)['agreement'], 'all')
            self.assertEqual(body.call_count, 1)
            self.assertEqual(body.call_args.args[0]['madhab'], schools.HANBALI)

    def test_disagreement_still_builds_every_school_body(self):
        case = self.session_case('disagree_compare')
        with patch('api.preview._body', wraps=preview._body) as body:
            self.assertEqual(preview.preview(case)['status'], 'choose_school')
        self.assertEqual(body.call_count, 4)

    def test_preview_does_not_deep_copy_the_presented_result(self):
        case = self.session_case('two_later_deaths')
        with patch('engine.contracts.presented.deepcopy') as copy:
            preview.preview(case)
        copy.assert_not_called()

    def test_engine_evaluation_equals_the_pre_change_loop(self):
        for name in ('compare', 'two_later_deaths'):
            family, _currency = family_from_session(self.session_case(name), names=False)
            for school in SUNNI_SCHOOLS:
                with self.subTest(case=name, school=school):
                    rule_set = school_rule_set(school)
                    actual, expected = core.evaluate(family, rule_set), reference_evaluate(family, rule_set)
                    self.assertEqual(actual.result, expected.result)
                    self.assertEqual(core.thaw(actual.proof), core.thaw(expected.proof))
                    self.assertEqual(core.thaw(actual.table), core.thaw(expected.table))
                    self.assertEqual(actual.proof, expected.proof)
                    self.assertEqual(actual.table, expected.table)


class FormatterMemoTests(TransactionTestCase):
    def test_memoized_formatter_matches_direct_babel(self):
        integers = [0, 1, 7, 24, 1234, 1000000, -5, Decimal('0'), Decimal('-0')]
        fractions = [Fraction(0), Fraction(1, 3), Fraction(1, 8), Fraction(2, 3), Fraction(1), Fraction(5, 24),
                     Fraction(1, 1000), Fraction(7, 9)]
        moneys = [(0, 'USD'), (12345, 'USD'), (-250, 'EUR'), (100000, 'JPY'), (5, 'KWD')]
        for locale in ('en', 'ar'):
            fmt = formatter(locale)
            direct = dict(locale=fmt.babel, numbering_system=fmt.numbering)
            for attempt in (1, 2):
                with self.subTest(locale=locale, attempt=attempt):
                    for value in integers:
                        self.assertEqual(fmt.integer(value), numbers.format_decimal(value, format='0', **direct))
                    for value in fractions:
                        tenths = (value.numerator * 2000 + value.denominator) // (2 * value.denominator)
                        self.assertEqual(fmt.percent(value), numbers.format_percent(
                            Decimal(tenths).scaleb(-3), format=fmt.percent_pattern(),
                            decimal_quantization=True, **direct))
                        hundredths = (value.numerator * 4800 + value.denominator) // (2 * value.denominator)
                        self.assertEqual(fmt.kirat(value), numbers.format_decimal(
                            Decimal(hundredths).scaleb(-2), format='#,##0.00', decimal_quantization=True, **direct))
                    for minor, code in moneys:
                        self.assertEqual(fmt.money(minor, code), numbers.format_currency(
                            decimal_of(minor, precision(code)), code, **direct))
            # Signed zero keeps its own entry on one instance, as Babel renders it.
            for value in (Decimal('-0'), Decimal('0'), Decimal('-0')):
                self.assertEqual(fmt.integer(value), numbers.format_decimal(value, format='0', **direct))
