"""Comparison contract: the Schools side by side, and whether the family must choose one."""
from dataclasses import dataclass
from typing import Optional, Tuple

from . import codes
from .result import Result, dump_result, parse_result
from .values import array, boolean, check_version, code, fail, ident, nullable, obj, unique


@dataclass(frozen=True)
class SchoolResult:
    school: str
    result: Result


@dataclass(frozen=True)
class Refusal:
    school: str
    reason: str


@dataclass(frozen=True)
class Comparison:
    version: int
    outcome: str
    schools: Tuple[SchoolResult, ...]
    differing_persons: Tuple[str, ...]
    refusals: Tuple[Refusal, ...]
    selection_required: bool
    selected_school: Optional[str]


def parse_comparison(data):
    check_version(data, 'version', 'comparison')
    obj(data, 'comparison', ('version', 'outcome', 'schools', 'differing_persons', 'refusals', 'selection_required',
                             'selected_school'))
    outcome = code(data['outcome'], 'comparison.outcome', codes.COMPARISON_OUTCOMES)
    schools = []
    for i, item in enumerate(array(data['schools'], 'comparison.schools')):
        p = f'comparison.schools[{i}]'
        obj(item, p, ('school', 'result'))
        entry = SchoolResult(code(item['school'], f'{p}.school', codes.SCHOOLS), parse_result(item['result']))
        if entry.result.school != entry.school:
            fail(p, 'the result belongs to a different School')
        schools.append(entry)
    if not schools:
        fail('comparison.schools', 'at least one School is compared')
    unique([s.school for s in schools], 'comparison.schools', 'School')
    differing = tuple(ident(x, f'comparison.differing_persons[{i}]')
                      for i, x in enumerate(array(data['differing_persons'], 'comparison.differing_persons')))
    unique(differing, 'comparison.differing_persons', 'person')
    refusals = []
    for i, item in enumerate(array(data['refusals'], 'comparison.refusals')):
        p = f'comparison.refusals[{i}]'
        obj(item, p, ('school', 'reason'))
        refusals.append(Refusal(code(item['school'], f'{p}.school', codes.SCHOOLS),
                                code(item['reason'], f'{p}.reason', codes.REFUSAL_REASONS)))
    selection_required = boolean(data['selection_required'], 'comparison.selection_required')
    selected = nullable(code, data['selected_school'], 'comparison.selected_school', codes.SCHOOLS)

    refused = {s.school: s.result.refusal for s in schools if s.result.status == 'refused'}
    if {r.school: r.reason for r in refusals} != refused or len(refusals) != len(refused):
        fail('comparison.refusals', 'refusals must list exactly the refused Schools with their reasons')
    calculated = [s.school for s in schools if s.result.status == 'calculated']
    if selected is not None and selected not in calculated:
        fail('comparison.selected_school', 'the selected School must be a calculated one')
    if (not calculated) != (outcome == 'all_refused'):
        fail('comparison.outcome', 'all_refused holds exactly when every School refused')
    if outcome == 'agreement':
        if differing or refusals or selection_required:
            fail('comparison.outcome', 'agreement has no differing persons, refusals or selection')
    elif outcome == 'all_refused':
        if differing or selection_required or selected is not None:
            fail('comparison.outcome', 'all_refused has no differing persons or selection')
    else:
        if not differing and not (refusals and calculated):
            fail('comparison.outcome', 'difference needs a differing person or a partial refusal')
        if selection_required != (selected is None):
            fail('comparison.selection_required', 'selection is required exactly when no School is selected')
    return Comparison(data['version'], outcome, tuple(schools), differing, tuple(refusals), selection_required, selected)


def dump_comparison(c):
    return {
        'version': c.version, 'outcome': c.outcome,
        'schools': [{'school': s.school, 'result': dump_result(s.result)} for s in c.schools],
        'differing_persons': list(c.differing_persons),
        'refusals': [{'school': r.school, 'reason': r.reason} for r in c.refusals],
        'selection_required': c.selection_required, 'selected_school': c.selected_school,
    }
