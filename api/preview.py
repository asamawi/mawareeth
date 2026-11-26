"""The share preview: the one bridge between the anonymous session case and the engine.

A preview is computed in memory by the pure core and the presenter. It creates, updates and locks no
rows and advances no sequence. The legacy fields (`shares`, `proof`, `table`, ...) stay for one release
so a cached web bundle keeps working; `presented` carries the PresentedResult every renderer shows.
The core gets relationships and genders; amounts are worked out from exact fractions in integer minor
units by the presenter's own rounding.
"""
from decimal import Decimal
from fractions import Fraction

from django.utils.translation import get_language, gettext as _

import engine
from api import anonymous_case, heir_rules
from calc import proof as proof_codes, schools
from calc.adapters import basis_from_madhab, family_from_session
from calc.models import (
    Brother, Daughter, DaughterOfSon, Father, GrandFather, GrandMother,
    Husband, MaternalBrother, MaternalGrandMother, MaternalSister, Mother, PaternalBrother, PaternalSister,
    PaternalUncle, Sister, Son, SonOfBrother, SonOfPaternalBrother, SonOfPaternalUncle,
    SonOfSon, SonOfUncle, Uncle, Wife,
)
from engine.contracts import dump_fresh_presented_result
from presentation import outcome as evaluate_outcome, present, refused_outcome
from presentation.money import round_minor

# Relationship id to the engine's class for it. Every id in anonymous_case.RELATIONSHIPS is here.
HEIR_CLASSES = {
    'father': Father,
    'mother': Mother,
    'husband': Husband,
    'wife': Wife,
    'son': Son,
    'daughter': Daughter,
    'son_of_son': SonOfSon,
    'daughter_of_son': DaughterOfSon,
    'grandfather': GrandFather,
    'paternal_grandmother': GrandMother,
    'maternal_grandmother': MaternalGrandMother,
    'brother': Brother,
    'sister': Sister,
    'paternal_brother': PaternalBrother,
    'paternal_sister': PaternalSister,
    'maternal_brother': MaternalBrother,
    'maternal_sister': MaternalSister,
    'son_of_brother': SonOfBrother,
    'son_of_paternal_brother': SonOfPaternalBrother,
    'uncle': Uncle,
    'paternal_uncle': PaternalUncle,
    'son_of_uncle': SonOfUncle,
    'son_of_paternal_uncle': SonOfPaternalUncle,
}
SEX = {'male': 'M', 'female': 'F'}  # the ORM rows the tests build
INVALID_FAMILY = 'invalid_family'


def is_impossible(case):
    """Whether the family cannot exist. A guard for sessions saved before the writes enforced it."""
    return heir_rules.is_impossible_family(case['deceased']['gender'], heir_rules.counts(case['heirs']))


def basis(case):
    """What the numbers are for, with no names: the client compares it with its own case."""
    deceased = case['deceased']
    result = {
        'madhab': case['madhab'],
        'gender': deceased['gender'],
        'estate': deceased['estate'],
        'heirs': [{'id': heir['id'], 'relationship': heir['relationship']} for heir in case['heirs']],
    }
    if case.get('deaths'):
        result['deaths'] = [
            {'heir_id': d['heir_id'], 'order': d['order'],
             'heirs': [{k: r[k] for k in ('id', 'relationship', 'same_as') if k in r}
                       for r in d['heirs']]} for d in case['deaths']]
    return result


def _fraction(value):
    return {'numerator': value.numerator, 'denominator': value.denominator}


def _labelled(proof, ids):
    """The engine's proof for the client: heirs named by session id, and a label in the active
    language beside every code. The codes themselves stay as the engine gave them."""
    label = proof_codes.label
    heirs = []
    for entry in proof['heirs']:
        heirs.append({
            **entry,
            'heir': ids[entry['heir']],
            'labels': {kind: label(kind, entry[kind]) for kind in
                       ('rule', 'condition', 'blocked_by', 'verse', 'school_rule', 'option')},
        })
    return {
        **proof,
        'heirs': heirs,
        'school_rule_labels': [label('school_rule', code) for code in proof['school_rules']],
        'steps': [{**step, 'label': label('step', step['step'])} for step in proof['steps']],
    }


def _column_labels():
    """The legacy captions of the table's engine columns, in the active language."""
    return {
        'base': _('Shares'), 'awl': _('Excess'), 'radd': _('Shortage'), 'remainder': _('Remainder'),
        'radd_calc': _('Shortage calc'), 'radd_union': _('Calc Union'), 'correction': _('Correction'),
    }


def _table(table, ids):
    """The engine's table for the client: heirs named by session id, a label on each column."""
    if table is None:
        return None
    labels = _column_labels()
    return {
        'columns': [{**column, 'label': labels[column['code']]} for column in table['columns']],
        'rows': [{**row, 'heir': ids[row['heir']]} for row in table['rows']],
    }


def _session_rows(case):
    """Every session heir row by id, across the later deaths when there are any."""
    return anonymous_case._rows(case) if case.get('deaths') else {r['id']: r for r in case['heirs']}


def _evidence(evaluation, case):
    """The core's proof and table for the client, heirs named by session id and labelled."""
    proof, table = engine.thaw(evaluation.proof), engine.thaw(evaluation.table)
    rows = _session_rows(case)
    ids = {key: key for key in rows}
    if proof['version'] == 1:
        return _labelled(proof, ids), _table(table, ids)
    # The core's proof lists distinct people only; the legacy preview also lists each repeated row.
    aliases = {r['id']: r.get('same_as', r['id']) for r in rows.values()}

    def identity(key):
        return identity(aliases[key]) if aliases[key] != key else key

    layer_rows = {i + 1: entries for i, (_key, _deceased, entries) in enumerate(anonymous_case._layers(case))}

    def row_ids(order):
        return {identity(r['id']): r['id'] for r in layer_rows[order]}

    proof = {**proof,
             'people': [{'row': key, 'person': identity(key)} for key in rows if key != identity(key)],
             'layers': [{**layer, 'deceased': None if layer['order'] == 1 else layer['deceased'],
                         'proof': _labelled(layer['proof'], row_ids(layer['order']))} for layer in proof['layers']]}
    if table is not None:
        table = {**table, 'layers': [{**layer, 'table': _table(layer['table'], row_ids(layer['order']))}
                                     for layer in table['layers']]}
    return proof, table


def _ready(case):
    """Whether the family is far enough along to compute. The school is not needed."""
    if case['deceased'] is None or not case['heirs']:
        return False
    return all(d['heirs'] for d in case.get('deaths', []))


def _impossible(case):
    """Whether the family or any later estate cannot exist, as the deceased's own gender sees it."""
    return is_impossible(case) or any(heir_rules.is_impossible_family(
        d['gender'], heir_rules.counts(d['heirs'])) for d in case.get('deaths', []))


def _body(case, evaluation, estate_minor):
    """The legacy body of a ready case under the school it holds, from the core's evaluation of it."""
    madhab = case['madhab']
    invalid = _impossible(case)
    if invalid or evaluation.result.status == 'refused':
        return {'status': 'unavailable', 'madhab': madhab,
                'reason': INVALID_FAMILY if invalid else evaluation.result.refusal, 'basis': basis(case)}
    proof, table = _evidence(evaluation, case)
    final = engine.final_shares(evaluation.result)
    shares = [{
        'heir_id': heir_id,
        **_fraction(final[heir_id]),
        'blocked': final[heir_id] == 0,
        'amount': None if estate_minor is None else
        f'{Decimal(round_minor(estate_minor, final[heir_id])).scaleb(-2):.2f}',
    } for heir_id in _session_rows(case) if heir_id in final]
    left = 1 - sum(final.values(), Fraction(0))
    return {
        'status': 'available',
        'madhab': madhab,
        'basis': basis(case),
        'shares': shares,
        'unallocated': _fraction(left) if left > 0 else None,
        'proof': proof,
        'table': table,
    }


def _single(case):
    """The preview body of a ready case under the school it holds (null reads as Hanbali, as before)."""
    school = case['madhab'] or schools.HANBALI
    family, _currency = family_from_session(case, names=False)
    out = evaluate_outcome(family, basis_from_madhab(school))
    return _body(case, out.evaluations[0][1], family.estate.amount_minor)


def compare(case, family=None, out=None, only=None):
    """The four Sunni schools' previews of a case that has no school, as {school: body}.

    `only` names the one school whose body is wanted when the schools are known to agree."""
    if out is None:
        family, _currency = family_from_session(case, names=False)
        out = evaluate_outcome(family, basis_from_madhab(None))
    return {school: _body({**case, 'madhab': school}, evaluation, family.estate.amount_minor)
            for school, evaluation in out.evaluations if only is None or school == only}


def _signature(body):
    """What the schools must share to agree: every heir's blocked flag and fraction, and the rest unallocated."""
    return (
        sorted((s['heir_id'], s['blocked'], s['numerator'], s['denominator']) for s in body['shares']),
        body['unallocated'],
    )


def _schools_agree(out):
    """Whether every school calculated the same exact final shares (so the same blocked flags and rest)."""
    first = None
    for _school, evaluation in out.evaluations:
        if evaluation.result.status == 'refused':
            return False
        final = engine.final_shares(evaluation.result)
        if first is None:
            first = final
        elif final != first:
            return False
    return first is not None


def _proofs(body):
    proof = body['proof']
    return [layer['proof'] for layer in proof['layers']] if proof['version'] == 2 else [proof]


def _differences(bodies):
    """The school-rule and refusal labels behind a disagreement, in a stable order."""
    available = [b for b in bodies.values() if b['status'] == 'available']
    used = [{code for proof in _proofs(b) for code in proof['school_rules']} for b in available]
    rules = [{'code': code, 'label': proof_codes.label('school_rule', code)}
             for code in schools.SCHOOL_RULES
             if any(code in u for u in used) and not all(code in u for u in used)]
    for body in bodies.values():
        reason = body.get('reason') if body['status'] == 'unavailable' else None
        if reason and all(rule['code'] != reason for rule in rules):
            rules.append({'code': reason, 'label': str(schools.REASONS[reason])})
    return rules


def preview(case):
    """The preview body for a session case: available, unavailable, choose_school or not ready.

    With a school it is that school's answer. Without one the four Sunni schools are compared:
    when they agree the answer is one result with `agreement: "all"`, and when they differ the
    visitor is asked to choose. Never writes: the core runs in memory. Raises only for an
    unexpected core error, which the caller turns into a 503.
    """
    if not _ready(case):
        return {'status': 'not_ready'}
    family, currency = family_from_session(case, names=False)
    resolved = basis_from_madhab(case['madhab'])
    out = (refused_outcome(family, resolved, INVALID_FAMILY) if _impossible(case)
           else evaluate_outcome(family, resolved))
    shown = dump_fresh_presented_result(present(out, resolved, get_language() or 'en', currency))
    estate = family.estate.amount_minor
    if case['madhab'] is not None:
        return {**_body(case, out.evaluations[0][1], estate), 'presented': shown}
    # When the schools hold the same exact shares the shown body is the Hanbali one: build only it.
    agree = not _impossible(case) and _schools_agree(out)
    bodies = compare(case, family, out, schools.HANBALI) if agree else compare(case, family, out)
    if all(b['status'] == 'available' for b in bodies.values()) and (
            len({repr(_signature(b)) for b in bodies.values()}) == 1):
        return {**bodies[schools.HANBALI], 'madhab': None, 'basis': basis(case), 'agreement': 'all',
                'presented': shown}
    reasons = {b.get('reason') for b in bodies.values()}
    if all(b['status'] == 'unavailable' for b in bodies.values()) and len(reasons) == 1:
        return {**bodies[schools.HANBALI], 'madhab': None, 'basis': basis(case), 'presented': shown}
    return {'status': 'choose_school', 'basis': basis(case), 'schools': bodies, 'rules': _differences(bodies),
            'presented': shown}
