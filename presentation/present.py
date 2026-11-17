"""`present` is the only producer of a PresentedResult. It never calls the engine: the Outcome carries the
evaluations. Every number is an integer, an exact Fraction or a Decimal, and every number string is Babel's."""
import i18n
from engine.contracts.basis import ResolvedBasis
from engine.contracts.codes import CONTRACT_VERSIONS
from engine.contracts.presented import PresentedResult
from engine.contracts.values import dump_fraction

from .compare import answers, compare, row_kinds, unallocated_of
from .formatting import formatter
from .money import PresentationError, default_currency, precision, round_minor
from .notices import notice_text, select_notices

ARABIC = 'ar'


def _text(value, direction):
    return {'text': value, 'dir': direction}


def _fraction(fmt, value):
    return {'fraction': dump_fraction(value), 'text': fmt.fraction(value), 'dir': 'ltr'}


def _label(locale, kind, code):
    return {'code': code, 'text': i18n.term(f'proof.{kind}.{code}', locale)}


def _optional(locale, kind, code):
    return None if code is None else _label(locale, kind, code)


def _param(value):
    return {'type': value.type, 'value': dump_fraction(value.value) if value.type == 'fraction' else value.value}


def _steps(locale, steps):
    return [{'step': s.step, 'text': i18n.term(f'proof.step.{s.step}', locale),
             'params': {name: _param(param) for name, param in s.params.items()}} for s in steps]


def _evidence_heir(locale, a):
    return {
        'person': a.person,
        'stage': None if a.stage is None else {'step': a.stage.step, 'base': a.stage.base},
        'rule': _label(locale, 'rule', a.rule),
        'condition': _optional(locale, 'condition', a.condition),
        'blocked_by': _optional(locale, 'blocked_by', a.blocked_by),
        'school_rule': _optional(locale, 'school_rule', a.school_rule),
        'option': _optional(locale, 'option', a.option),
        'verses': [_label(locale, 'verse', c) for c in a.citations],
    }


def _estate_evidence(fmt, order, deceased, inherited, allocations, steps, unallocated):
    return {
        'order': order, 'deceased': deceased,
        'inherited': None if inherited is None else _fraction(fmt, inherited),
        'heirs': [_evidence_heir(fmt.locale, a) for a in allocations],
        'school_rules': [_label(fmt.locale, 'school_rule', code)
                         for code in sorted({a.school_rule for a in allocations if a.school_rule})],
        'steps': _steps(fmt.locale, steps),
        'unallocated': None if unallocated is None else _fraction(fmt, unallocated),
    }


def _evidence(fmt, result):
    entries = [_estate_evidence(fmt, 1, None, None, result.allocations, result.steps, result.unallocated)]
    entries += [_estate_evidence(fmt, layer.order, layer.deceased, layer.inherited, layer.allocations, layer.steps,
                                 layer.unallocated) for layer in result.layers]
    return entries


def _refusal(locale, reason, school=False, code=None):
    value = {'reason': reason, 'text': i18n.term(f'refusal.{reason}', locale)}
    return {'school': code, **value} if school else value


def _comparison(fmt, out, cmp):
    schools = []
    for entry in cmp.schools:
        result = entry.result
        refused = result.status == 'refused'
        shares = [] if refused else [
            {'person': person, 'blocked': blocked, 'share': _fraction(fmt, share)}
            for person, share, blocked in answers(out.family, result)]
        schools.append({
            'school': entry.school, 'label': i18n.term(f'school.{entry.school}', fmt.locale),
            'status': 'refused' if refused else 'calculated',
            'refusal': _refusal(fmt.locale, result.refusal) if refused else None, 'shares': shares})
    return {'schools': schools, 'differing_persons': list(cmp.differing_persons)}


class _Money:
    """Amounts of one currency, in integer minor units of the estate."""

    def __init__(self, fmt, estate, code):
        self.fmt, self.estate, self.code = fmt, estate, code

    def value(self, minor):
        return {'amount_minor': minor, 'currency': self.code, 'text': self.fmt.money(minor, self.code),
                'dir': 'auto'}

    def of(self, share):
        return None if self.estate is None else round_minor(self.estate, share)


def _rows(fmt, out, result, money, relationships):
    persons = {p.id: p for p in out.family.persons}
    kinds = row_kinds(result)
    rows = []
    for person, share, blocked in answers(out.family, result):
        name = persons[person].name
        relationship = relationships[person]
        minor = money.of(share)
        rows.append({
            'person': person,
            'name': None if name is None else _text(name, 'auto'),
            'relationship': {
                'translated': {'text': i18n.term(f'relationship.{relationship}', fmt.locale), 'lang': fmt.locale,
                               'dir': fmt.direction},
                'original': {'text': i18n.term(f'relationship.{relationship}', ARABIC), 'lang': ARABIC,
                             'dir': 'rtl'}},
            'kind': kinds[person], 'blocked': blocked, 'share': _fraction(fmt, share),
            'percent': _text(fmt.percent(share), 'ltr'), 'kirat': _text(fmt.kirat(share), 'ltr'),
            'amount': None if minor is None else money.value(minor)})
    return rows


def _first_relationships(family):
    found = {}
    for estate in family.estates:
        for heir in estate.heirs:
            found.setdefault(heir.person, heir.relationship)
    return found


def present(out, basis, locale, currency):
    """The PresentedResult of an Outcome under a resolved Basis, in a Locale and a currency.

    An explicit currency is used exactly; otherwise the Locale's default currency applies."""
    if not isinstance(basis, ResolvedBasis):
        raise TypeError('basis must be a ResolvedBasis')
    fmt = formatter(locale)
    code = currency.code if currency is not None and currency.explicit else default_currency(fmt.locale)
    precision(code)
    family = out.family
    notices = tuple({'code': c, 'text': notice_text(c, fmt.locale)}
                    for c in select_notices(basis, fmt.locale, out))
    shown = {'rows': (), 'rounding': None, 'unallocated': None, 'comparison': None, 'evidence': (),
             'school_line': None, 'refusals': (), 'comparison_outcome': None}
    result = None

    if basis.basis.kind == 'compare':
        cmp = compare(out)
        shown['comparison_outcome'] = cmp.outcome
        if cmp.outcome == 'agreement':
            state, result = 'answer', out.evaluations[-1][1].result
            shown['school_line'] = {'code': 'same_in_all_schools',
                                    'text': i18n.term('comparison.same_in_all_schools', fmt.locale)}
        elif cmp.outcome == 'difference':
            state = 'selection_required'
            shown['comparison'] = _comparison(fmt, out, cmp)
            seen = {}
            for refusal in cmp.refusals:
                seen.setdefault(refusal.reason, refusal.school)
            shown['refusals'] = tuple(_refusal(fmt.locale, r, True, s) for r, s in seen.items())
        else:
            state = 'refused'
            shown['refusals'] = tuple(_refusal(fmt.locale, r, True)
                                      for r in dict.fromkeys(x.reason for x in cmp.refusals))
    else:
        school, evaluation = out.evaluations[0]
        if evaluation.result.status == 'refused':
            state = 'refused'
            shown['refusals'] = (_refusal(fmt.locale, evaluation.result.refusal, True, school),)
        else:
            state, result = 'answer', evaluation.result
            shown['school_line'] = {'code': 'school', 'text': i18n.term(f'school.{school}', fmt.locale)}

    if result is not None:
        money = _Money(fmt, family.estate.amount_minor, code)
        rows = _rows(fmt, out, result, money, _first_relationships(family))
        if not rows:
            raise PresentationError('no_heirs', 'there is no one to show an answer for')
        shown['rows'] = tuple(rows)
        shown['evidence'] = tuple(_evidence(fmt, result))
        left = unallocated_of(result)
        left_minor = money.of(left) if left > 0 else 0
        if left > 0:
            shown['unallocated'] = {**_fraction(fmt, left),
                                    'amount': None if money.estate is None else money.value(left_minor)}
        if money.estate is not None:
            rounding = money.estate - sum(r['amount']['amount_minor'] for r in rows) - left_minor
            if rounding != 0:
                shown['rounding'] = money.value(rounding)

    return PresentedResult(
        CONTRACT_VERSIONS['presented_result'], fmt.locale, fmt.direction, basis.basis, state,
        shown['comparison_outcome'], shown['school_line'], shown['rows'], shown['rounding'], shown['unallocated'],
        shown['comparison'], shown['evidence'], shown['refusals'], notices)
