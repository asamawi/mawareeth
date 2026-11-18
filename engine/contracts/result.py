"""Result contract: what the engine decided for one School, as codes, exact fractions and integers."""
from dataclasses import dataclass
from fractions import Fraction
from typing import Dict, Optional, Tuple

from . import codes
from .values import (array, check_version, code, dump_fraction, fail, fraction, ident, integer, nullable, obj, snake,
                     unique)

STATUSES = ('calculated', 'refused')


@dataclass(frozen=True)
class Stage:
    step: str
    base: int


@dataclass(frozen=True)
class Allocation:
    person: str
    kind: str
    share: Fraction
    stage: Optional[Stage]
    rule: str
    condition: Optional[str]
    blocked_by: Optional[str]
    school_rule: Optional[str]
    option: Optional[str]
    citations: Tuple[str, ...]


@dataclass(frozen=True)
class Param:
    type: str
    value: object


@dataclass(frozen=True)
class Step:
    step: str
    params: Dict[str, Param]


@dataclass(frozen=True)
class Layer:
    order: int
    deceased: str
    inherited: Fraction
    allocations: Tuple[Allocation, ...]
    steps: Tuple[Step, ...]
    unallocated: Optional[Fraction]


@dataclass(frozen=True)
class Result:
    version: int
    school: str
    status: str
    refusal: Optional[str]
    allocations: Tuple[Allocation, ...]
    unallocated: Optional[Fraction]
    steps: Tuple[Step, ...]
    layers: Tuple[Layer, ...]


def _allocation(value, path):
    obj(value, path, ('person', 'kind', 'share', 'stage', 'rule', 'condition', 'blocked_by', 'school_rule', 'option',
                      'citations'))
    share = fraction(value['share'], f'{path}.share')
    kind = code(value['kind'], f'{path}.kind', codes.ALLOCATION_KINDS)
    if kind == 'blocked' and share != 0:
        fail(path, 'a blocked allocation has a zero share')
    if (kind == 'blocked') != (value['rule'] == 'blocked'):
        fail(path, 'the kind is blocked exactly when the rule is blocked')
    stage = value['stage']
    if stage is not None:
        obj(stage, f'{path}.stage', ('step', 'base'))
        stage = Stage(code(stage['step'], f'{path}.stage.step', codes.PROOF_STEPS),
                      integer(stage['base'], f'{path}.stage.base', 1))
        if (share * stage.base).denominator != 1:
            fail(path, 'share times the stage base must be a whole number')
    citations = tuple(snake(c, f'{path}.citations[{i}]') for i, c in enumerate(array(value['citations'], f'{path}.citations')))
    unique(citations, f'{path}.citations', 'citation')
    return Allocation(
        ident(value['person'], f'{path}.person'), kind, share, stage,
        code(value['rule'], f'{path}.rule', codes.PROOF_RULES),
        nullable(code, value['condition'], f'{path}.condition', codes.PROOF_CONDITIONS),
        nullable(code, value['blocked_by'], f'{path}.blocked_by', codes.BLOCKED_BY),
        nullable(code, value['school_rule'], f'{path}.school_rule', codes.SCHOOL_RULES),
        nullable(code, value['option'], f'{path}.option', codes.PROOF_OPTIONS), citations)


def _param(value, path):
    obj(value, path, ('type', 'value'))
    kind = code(value['type'], f'{path}.type', codes.PARAM_TYPES)
    raw = value['value']
    if kind == 'int':
        raw = integer(raw, f'{path}.value')
    elif kind == 'fraction':
        raw = fraction(raw, f'{path}.value')
    elif kind == 'person':
        raw = ident(raw, f'{path}.value')
    else:
        raw = snake(raw, f'{path}.value')
    return Param(kind, raw)


def _steps(value, path):
    steps = []
    for i, item in enumerate(array(value, path)):
        p = f'{path}[{i}]'
        obj(item, p, ('step', 'params'))
        params = item['params']
        if not isinstance(params, dict):
            fail(f'{p}.params', 'must be an object')
        steps.append(Step(code(item['step'], f'{p}.step', codes.PROOF_STEPS),
                          {snake(k, f'{p}.params'): _param(v, f'{p}.params.{k}') for k, v in params.items()}))
    return tuple(steps)


def _allocations(value, path):
    items = tuple(_allocation(a, f'{path}[{i}]') for i, a in enumerate(array(value, path)))
    unique([a.person for a in items], path, 'person')
    return items


def parse_result(data):
    check_version(data, 'version', 'result')
    obj(data, 'result', ('version', 'school', 'status', 'refusal', 'allocations', 'unallocated', 'steps', 'layers'))
    school = code(data['school'], 'result.school', codes.SCHOOLS)
    status = code(data['status'], 'result.status', STATUSES)
    refusal = data['refusal']
    if refusal is not None:
        obj(refusal, 'result.refusal', ('reason',))
        refusal = code(refusal['reason'], 'result.refusal.reason', codes.REFUSAL_REASONS)
    allocations = _allocations(data['allocations'], 'result.allocations')
    unallocated = nullable(fraction, data['unallocated'], 'result.unallocated')
    steps = _steps(data['steps'], 'result.steps')
    layers = []
    for i, item in enumerate(array(data['layers'], 'result.layers')):
        p = f'result.layers[{i}]'
        obj(item, p, ('order', 'deceased', 'inherited', 'allocations', 'steps', 'unallocated'))
        layers.append(Layer(
            integer(item['order'], f'{p}.order', 2, 3), ident(item['deceased'], f'{p}.deceased'),
            fraction(item['inherited'], f'{p}.inherited'), _allocations(item['allocations'], f'{p}.allocations'),
            _steps(item['steps'], f'{p}.steps'), nullable(fraction, item['unallocated'], f'{p}.unallocated')))
    if status == 'refused':
        if refusal is None:
            fail('result', 'a refused result names its reason')
        if allocations or steps or layers or unallocated is not None:
            fail('result', 'a refused result has no allocations, steps, layers or unallocated share')
    else:
        if refusal is not None:
            fail('result', 'a calculated result has no refusal')
        if sum((a.share for a in allocations), Fraction(0)) + (unallocated or 0) != 1:
            fail('result', 'allocations plus the unallocated share must add up to exactly 1')
        orders = [layer.order for layer in layers]
        if orders != sorted(set(orders)):
            fail('result.layers', 'layer orders must be unique and ascending')
        for i, layer in enumerate(layers):
            if sum((a.share for a in layer.allocations), Fraction(0)) + (layer.unallocated or 0) != 1:
                fail(f'result.layers[{i}]', 'allocations plus the unallocated share must add up to exactly 1')
    return Result(data['version'], school, status, refusal, allocations, unallocated, steps, tuple(layers))


def _dump_allocation(a):
    return {'person': a.person, 'kind': a.kind, 'share': dump_fraction(a.share),
            'stage': None if a.stage is None else {'step': a.stage.step, 'base': a.stage.base}, 'rule': a.rule,
            'condition': a.condition, 'blocked_by': a.blocked_by, 'school_rule': a.school_rule, 'option': a.option,
            'citations': list(a.citations)}


def _dump_param(p):
    return {'type': p.type, 'value': dump_fraction(p.value) if p.type == 'fraction' else p.value}


def _dump_steps(steps):
    return [{'step': s.step, 'params': {k: _dump_param(v) for k, v in s.params.items()}} for s in steps]


def _dump_optional_fraction(value):
    return None if value is None else dump_fraction(value)


def dump_result(result):
    return {
        'version': result.version, 'school': result.school, 'status': result.status,
        'refusal': None if result.refusal is None else {'reason': result.refusal},
        'allocations': [_dump_allocation(a) for a in result.allocations],
        'unallocated': _dump_optional_fraction(result.unallocated),
        'steps': _dump_steps(result.steps),
        'layers': [{'order': l.order, 'deceased': l.deceased, 'inherited': dump_fraction(l.inherited),
                    'allocations': [_dump_allocation(a) for a in l.allocations], 'steps': _dump_steps(l.steps),
                    'unallocated': _dump_optional_fraction(l.unallocated)} for l in result.layers],
    }
