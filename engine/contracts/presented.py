"""PresentedResult contract: the one answer every screen, PDF and API renders without adding meaning."""
from dataclasses import dataclass
from fractions import Fraction
from typing import Optional, Tuple

from . import codes
from .basis import dump_basis, parse_basis
from .values import (CURRENCY_RE, LANG_RE, array, check_version, code, dump_fraction, fail, fraction, ident, integer,
                     nullable, obj, pattern, snake, string, unique)

DIRECTIONS = ('ltr', 'rtl')
STATES = ('answer', 'selection_required', 'refused')


@dataclass(frozen=True)
class Segment:
    text: str
    lang: str
    dir: str


@dataclass(frozen=True)
class Money:
    amount_minor: int
    currency: str
    text: str


@dataclass(frozen=True)
class Row:
    person: str
    name: Optional[str]
    translated: Segment
    original: Segment
    kind: str
    share: Fraction
    share_text: str
    amount: Optional[Money]


@dataclass(frozen=True)
class FractionText:
    fraction: Fraction
    text: str


@dataclass(frozen=True)
class RefusalText:
    school: Optional[str]
    reason: str
    text: str


@dataclass(frozen=True)
class Notice:
    code: str
    text: str


@dataclass(frozen=True)
class PresentedResult:
    version: int
    locale: str
    direction: str
    basis: object
    state: str
    comparison_outcome: Optional[str]
    rows: Tuple[Row, ...]
    rounding: Optional[Money]
    unallocated: Optional[FractionText]
    refusals: Tuple[RefusalText, ...]
    notices: Tuple[Notice, ...]


def _segment(value, path, arabic=False):
    obj(value, path, ('text', 'lang', 'dir'))
    lang = pattern(value['lang'], f'{path}.lang', LANG_RE, 'a language tag')
    direction = code(value['dir'], f'{path}.dir', DIRECTIONS)
    if arabic and (lang != 'ar' or direction != 'rtl'):
        fail(path, 'the original relationship is Arabic and right-to-left')
    return Segment(string(value['text'], f'{path}.text', True), lang, direction)


def _money(value, path, minimum=None):
    if value is None:
        return None
    obj(value, path, ('amount_minor', 'currency', 'text'))
    return Money(integer(value['amount_minor'], f'{path}.amount_minor', minimum),
                 pattern(value['currency'], f'{path}.currency', CURRENCY_RE, 'a currency code'),
                 string(value['text'], f'{path}.text', True))


def _fraction_text(value, path):
    if value is None:
        return None
    obj(value, path, ('fraction', 'text'))
    return FractionText(fraction(value['fraction'], f'{path}.fraction'), string(value['text'], f'{path}.text', True))


def parse_presented_result(data):
    check_version(data, 'version', 'presented_result')
    obj(data, 'presented_result', ('version', 'locale', 'direction', 'basis', 'state', 'comparison_outcome', 'rows',
                                   'rounding', 'unallocated', 'refusals', 'notices'))
    locale = pattern(data['locale'], 'presented_result.locale', LANG_RE, 'a locale tag')
    direction = code(data['direction'], 'presented_result.direction', DIRECTIONS)
    basis = parse_basis(data['basis'])
    state = code(data['state'], 'presented_result.state', STATES)
    outcome = nullable(code, data['comparison_outcome'], 'presented_result.comparison_outcome',
                       codes.COMPARISON_OUTCOMES)
    rows = []
    for i, item in enumerate(array(data['rows'], 'presented_result.rows')):
        p = f'presented_result.rows[{i}]'
        obj(item, p, ('person', 'name', 'relationship', 'kind', 'share', 'amount'))
        name = item['name']
        if name is not None:
            obj(name, f'{p}.name', ('text',))
            name = string(name['text'], f'{p}.name.text')
        relationship = obj(item['relationship'], f'{p}.relationship', ('translated', 'original'))
        share = obj(item['share'], f'{p}.share', ('fraction', 'text'))
        rows.append(Row(
            ident(item['person'], f'{p}.person'), name, _segment(relationship['translated'], f'{p}.relationship.translated'),
            _segment(relationship['original'], f'{p}.relationship.original', True),
            code(item['kind'], f'{p}.kind', codes.ALLOCATION_KINDS), fraction(share['fraction'], f'{p}.share.fraction'),
            string(share['text'], f'{p}.share.text', True), _money(item['amount'], f'{p}.amount', 0)))
    rounding = _money(data['rounding'], 'presented_result.rounding')
    unallocated = _fraction_text(data['unallocated'], 'presented_result.unallocated')
    refusals = []
    for i, item in enumerate(array(data['refusals'], 'presented_result.refusals')):
        p = f'presented_result.refusals[{i}]'
        obj(item, p, ('school', 'reason', 'text'))
        refusals.append(RefusalText(nullable(code, item['school'], f'{p}.school', codes.SCHOOLS),
                                    code(item['reason'], f'{p}.reason', codes.REFUSAL_REASONS),
                                    string(item['text'], f'{p}.text', True)))
    notices = []
    for i, item in enumerate(array(data['notices'], 'presented_result.notices')):
        p = f'presented_result.notices[{i}]'
        obj(item, p, ('code', 'text'))
        notices.append(Notice(snake(item['code'], f'{p}.code'), string(item['text'], f'{p}.text', True)))
    unique([r.person for r in rows], 'presented_result.rows', 'person')
    if state == 'refused':
        if rows:
            fail('presented_result.rows', 'a refused answer has no rows')
        if not refusals or rounding is not None or unallocated is not None:
            fail('presented_result', 'a refused answer names a refusal and has no rounding or unallocated share')
    if state == 'selection_required' and (outcome != 'difference' or rows):
        fail('presented_result', 'a required selection follows a difference and has no rows')
    return PresentedResult(data['version'], locale, direction, basis, state, outcome, tuple(rows), rounding,
                           unallocated, tuple(refusals), tuple(notices))


def _dump_segment(s):
    return {'text': s.text, 'lang': s.lang, 'dir': s.dir}


def _dump_money(m):
    return None if m is None else {'amount_minor': m.amount_minor, 'currency': m.currency, 'text': m.text}


def dump_presented_result(p):
    return {
        'version': p.version, 'locale': p.locale, 'direction': p.direction, 'basis': dump_basis(p.basis),
        'state': p.state, 'comparison_outcome': p.comparison_outcome,
        'rows': [{'person': r.person, 'name': None if r.name is None else {'text': r.name},
                  'relationship': {'translated': _dump_segment(r.translated), 'original': _dump_segment(r.original)},
                  'kind': r.kind, 'share': {'fraction': dump_fraction(r.share), 'text': r.share_text},
                  'amount': _dump_money(r.amount)} for r in p.rows],
        'rounding': _dump_money(p.rounding),
        'unallocated': None if p.unallocated is None
        else {'fraction': dump_fraction(p.unallocated.fraction), 'text': p.unallocated.text},
        'refusals': [{'school': r.school, 'reason': r.reason, 'text': r.text} for r in p.refusals],
        'notices': [{'code': n.code, 'text': n.text} for n in p.notices],
    }
