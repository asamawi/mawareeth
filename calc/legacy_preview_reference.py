"""The pre-switch ORM share preview, kept only as the parity reference of the AD-15 switch gate.

It builds Calculation, Deceased and Heir rows inside a rolled-back transaction and runs the legacy
`legacy_compute`. No production code path imports it; it goes with `legacy_compute` in Epic 12.
"""
from decimal import Decimal
from fractions import Fraction

from django.db import transaction

from api import anonymous_case, heir_rules
from api.preview import (
    HEIR_CLASSES, INVALID_FAMILY, SEX, _differences, _fraction, _labelled, _ready, _signature, _table, basis,
    is_impossible,
)
from calc import schools
from calc.manasikhat import compute_manasikhat
from calc.models import Calculation, Deceased, Heir, money

PLACEHOLDER_ESTATE = 1


def _compute(case):
    """The engine's fractions, blocked flags and proof by session heir id. Leaves rows; roll back."""
    calc = Calculation.objects.create(name='')
    Deceased.objects.create(sex=SEX[case['deceased']['gender']], estate=PLACEHOLDER_ESTATE, calc=calc)
    by_pk = {}
    for heir in case['heirs']:
        row = HEIR_CLASSES[heir['relationship']].objects.create(sex=SEX[heir['gender']], calc=calc)
        by_pk[row.pk] = heir['id']
    final = calc.legacy_compute(madhab=case['madhab'])
    blocked = dict(Heir.objects.filter(calc=calc).values_list('pk', 'blocked'))
    outcome = {
        by_pk[pk]: (Fraction(fraction), bool(blocked.get(pk)))
        for pk, fraction in final.items() if pk in by_pk
    }
    return outcome, _labelled(calc.proof, by_pk), _table(calc.table, by_pk)


def _compute_layered(case):
    root = Calculation.objects.create(name='')
    Deceased.objects.create(sex=SEX[case['deceased']['gender']], estate=PLACEHOLDER_ESTATE, calc=root)
    by_id, by_pk = {}, {}
    for key, deceased, heirs in anonymous_case._layers(case):
        calc = root
        if key is not None:
            death = next(d for d in case['deaths'] if d['heir_id'] == key)
            calc = Calculation.objects.create(name='', parent=root)
            Deceased.objects.create(sex=SEX[deceased['gender']], estate=PLACEHOLDER_ESTATE,
                                    calc=calc, heir=by_id[key], death_order=death['order'])
        for heir in heirs:
            row = HEIR_CLASSES[heir['relationship']].objects.create(
                sex=SEX[heir['gender']], calc=calc,
                same_person=by_id.get(heir.get('same_as')))
            by_id[heir['id']] = row
            by_pk[row.pk] = heir['id']
    final, evidence = compute_manasikhat(root, case['madhab'])
    deaths = {d['order']: d['heir_id'] for d in case['deaths']}
    labelled = {
        **evidence,
        'people': [{'row': by_pk[p['row']], 'person': by_pk[p['person']]} for p in evidence['people']],
        'final': [{**entry, 'heir': by_pk[entry['heir']]} for entry in evidence['final']],
        'layers': [{**layer, 'deceased': None if layer['order'] == 1 else deaths[layer['order']],
                    'heir': deaths.get(layer['order']), 'proof': _labelled(layer['proof'], by_pk)}
                   for layer in evidence['layers']],
    }
    table = root.table
    if table is not None:
        table = {
            **table,
            'rows': [{'heir': by_pk[row['heir']]} for row in table['rows']],
            'layers': [{**layer, 'heir': deaths.get(layer['order']),
                        'table': _table(layer['table'], by_pk),
                        'parts': [{**part, 'heir': by_pk[part['heir']]} for part in layer['parts']]}
                       for layer in table['layers']],
        }
    return {by_pk[pk]: (Fraction(value), value == 0) for pk, value in final.items()}, labelled, table


def _single(case):
    """The preview of a ready case under the school it holds (or null, which the engine reads as Hanbali)."""
    madhab = case['madhab']
    if is_impossible(case) or any(heir_rules.is_impossible_family(
            d['gender'], heir_rules.counts(d['heirs'])) for d in case.get('deaths', [])):
        return {'status': 'unavailable', 'madhab': madhab, 'reason': INVALID_FAMILY, 'basis': basis(case)}
    try:
        with transaction.atomic():
            try:
                outcome, proof, table = _compute_layered(case) if case.get('deaths') else _compute(case)
            finally:
                transaction.set_rollback(True)
    except schools.UnsupportedCase as refused:
        return {'status': 'unavailable', 'madhab': madhab, 'reason': refused.reason, 'basis': basis(case)}

    estate = case['deceased']['estate']
    shares = []
    rows = anonymous_case._rows(case) if case.get('deaths') else {r['id']: r for r in case['heirs']}
    for heir_id in rows:
        if heir_id not in outcome:
            continue
        heir = rows[heir_id]
        fraction, blocked = outcome[heir_id]
        shares.append({
            'heir_id': heir['id'],
            **_fraction(fraction),
            'blocked': blocked or fraction == 0,
            'amount': None if estate is None else f'{money(Fraction(Decimal(estate)) * fraction):.2f}',
        })
    left = 1 - sum((fraction for fraction, _blocked in outcome.values()), Fraction(0))
    return {
        'status': 'available',
        'madhab': madhab,
        'basis': basis(case),
        'shares': shares,
        'unallocated': _fraction(left) if left > 0 else None,
        'proof': proof,
        'table': table,
    }


def compare(case):
    """The four Sunni schools' previews of a case that has no school, as {school: body}."""
    return {school: _single({**case, 'madhab': school}) for school in schools.SUNNI}


def preview(case):
    """The preview body for a session case: available, unavailable, choose_school or not ready.

    With a school it is that school's answer. Without one the four Sunni schools are compared:
    when they agree the answer is one result with `agreement: "all"`, and when they differ the
    visitor is asked to choose. Never writes: every engine run is rolled back. Raises only for
    an unexpected engine error, which the caller turns into a 503.
    """
    if not _ready(case):
        return {'status': 'not_ready'}
    if case['madhab'] is not None:
        return _single(case)
    bodies = compare(case)
    if all(b['status'] == 'available' for b in bodies.values()) and (
            len({repr(_signature(b)) for b in bodies.values()}) == 1):
        return {**bodies[schools.HANBALI], 'madhab': None, 'basis': basis(case), 'agreement': 'all'}
    reasons = {b.get('reason') for b in bodies.values()}
    if all(b['status'] == 'unavailable' for b in bodies.values()) and len(reasons) == 1:
        return {**bodies[schools.HANBALI], 'madhab': None, 'basis': basis(case)}
    return {'status': 'choose_school', 'basis': basis(case), 'schools': bodies, 'rules': _differences(bodies)}
