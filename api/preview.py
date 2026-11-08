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

from api import anonymous_case, heir_rules
from calc import proof as proof_codes, schools
from calc.models import (
    Brother, Calculation, Daughter, DaughterOfSon, Deceased, Father, GrandFather, GrandMother,
    Heir, Husband, MaternalBrother, MaternalSister, Mother, PaternalBrother, PaternalSister,
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
    'grandmother': GrandMother,
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
    return {
        'madhab': case['madhab'],
        'gender': deceased['gender'],
        'estate': deceased['estate'],
        'heirs': [{'id': heir['id'], 'relationship': heir['relationship']} for heir in case['heirs']],
    }


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
    return outcome, _labelled(calc.proof, by_pk)


def preview(case):
    """The preview body for a session case: available, unavailable or not ready.

    Never writes: the transaction is always rolled back. Raises only for an unexpected
    engine error, which the caller turns into a 503.
    """
    if case['madhab'] is None or case['deceased'] is None or not case['heirs']:
        return {'status': 'not_ready'}
    madhab = case['madhab']
    if is_impossible(case):
        return {'status': 'unavailable', 'madhab': madhab, 'reason': INVALID_FAMILY, 'basis': basis(case)}
    try:
        with transaction.atomic():
            try:
                outcome, proof = _compute(case)
            finally:
                transaction.set_rollback(True)
    except schools.UnsupportedCase as refused:
        return {'status': 'unavailable', 'madhab': madhab, 'reason': refused.reason, 'basis': basis(case)}

    estate = case['deceased']['estate']
    shares = []
    for heir in case['heirs']:
        fraction, blocked = outcome[heir['id']]
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
    }
