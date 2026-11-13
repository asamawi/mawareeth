"""The share preview: the one bridge between the anonymous session case and the engine.

The engine works on database rows, so a preview builds them inside a transaction that is
always rolled back and leaves nothing behind. Names never cross this line: the engine gets
relationships, the deceased's gender and a placeholder estate. Amounts are worked out here
from the exact fraction, because the engine's estate is an integer and the session's may
have decimals.
"""
from decimal import Decimal
from fractions import Fraction

from django.db import transaction
from django.utils.translation import gettext as _

from api import anonymous_case, heir_rules
from calc import proof as proof_codes, schools
from calc.manasikhat import compute_manasikhat
from calc.models import (
    Brother, Calculation, Daughter, DaughterOfSon, Deceased, Father, GrandFather, GrandMother,
    Heir, Husband, MaternalBrother, MaternalGrandMother, MaternalSister, Mother, PaternalBrother, PaternalSister,
    PaternalUncle, Sister, Son, SonOfBrother, SonOfPaternalBrother, SonOfPaternalUncle,
    SonOfSon, SonOfUncle, Uncle, Wife, money,
)

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
SEX = {'male': 'M', 'female': 'F'}
INVALID_FAMILY = 'invalid_family'
# The engine's estate is an integer, so it always gets this and amounts are worked out here.
PLACEHOLDER_ESTATE = 1


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


def _compute(case):
    """The engine's fractions, blocked flags and proof by session heir id. Leaves rows; roll back."""
    calc = Calculation.objects.create(name='')
    Deceased.objects.create(sex=SEX[case['deceased']['gender']], estate=PLACEHOLDER_ESTATE, calc=calc)
    by_pk = {}
    for heir in case['heirs']:
        row = HEIR_CLASSES[heir['relationship']].objects.create(sex=SEX[heir['gender']], calc=calc)
        by_pk[row.pk] = heir['id']
    final = calc.compute(madhab=case['madhab'])
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


def _ready(case):
    """Whether the family is far enough along to compute. The school is not needed."""
    if case['deceased'] is None or not case['heirs']:
        return False
    return all(d['heirs'] for d in case.get('deaths', []))


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


def _signature(body):
    """What the schools must share to agree: every heir's blocked flag and fraction, and the rest unallocated."""
    return (
        sorted((s['heir_id'], s['blocked'], s['numerator'], s['denominator']) for s in body['shares']),
        body['unallocated'],
    )


def _proofs(body):
    proof = body['proof']
    return [layer['proof'] for layer in proof['layers']] if proof['version'] == 2 else [proof]


def compare(case):
    """The four Sunni schools' previews of a case that has no school, as {school: body}."""
    return {school: _single({**case, 'madhab': school}) for school in schools.SUNNI}


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
