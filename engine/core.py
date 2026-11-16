"""The calculation core: a Family and a RuleSet in, the same answer the School engine gives, out.

`calculate` is the 8.1 contract. `evaluate` also returns the proof and the scholars' table, which sit
outside Result v1 and are deep-frozen. Nothing here reads a database, a clock or a translation.
"""
from dataclasses import dataclass
from fractions import Fraction
from types import MappingProxyType
from typing import Optional

from . import proof as proof_module
from .contracts.errors import ContractError
from .contracts.codes import CONTRACT_VERSIONS
from .contracts.result import Allocation, Param, Result, Stage, Step
from .rule_set import RuleSet
from .single import Refused, solve

# Relationship id to the code of the rule broken when a family already has one of them.
SECOND_OF = {
    'father': 'second_father',
    'mother': 'second_mother',
    'husband': 'second_husband',
    'grandfather': 'second_grandfather',
    'paternal_grandmother': 'second_paternal_grandmother',
    'maternal_grandmother': 'second_maternal_grandmother',
}
MAX_WIVES = 4

# What an allocation's `kind` is, by the proof rule it rests on.
KINDS = {
    'fixed': 'fixed', 'mushtaraka': 'fixed', 'akdariyya': 'fixed',
    'residuary': 'residue', 'fixed_and_residuary': 'residue', 'grandfather_best_option': 'residue',
    'blocked': 'blocked',
}


@dataclass(frozen=True)
class Evaluation:
    """A Result with the evidence behind it. `proof` and `table` are None for a refusal."""
    result: Result
    proof: Optional[object]
    table: Optional[object]


def freeze(value):
    """Deep-freeze plain evidence: dicts become read-only mappings, lists become tuples."""
    if isinstance(value, dict):
        return MappingProxyType({key: freeze(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(freeze(item) for item in value)
    return value


def thaw(value):
    """The reverse of `freeze`: plain dicts and lists again."""
    if isinstance(value, (dict, MappingProxyType)):
        return {key: thaw(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [thaw(item) for item in value]
    return value


def is_impossible(relationships):
    """Whether a family cannot exist: a repeat of a relative who comes once, more than four wives, or
    a husband and a wife together. The family holds no sex for the deceased, so a spouse of the wrong
    sex alone cannot be seen here."""
    counts = {}
    for relationship in relationships:
        counts[relationship] = counts.get(relationship, 0) + 1
    if any(counts.get(name, 0) > 1 for name in SECOND_OF):
        return True
    if counts.get('husband', 0) and counts.get('wife', 0):
        return True
    return counts.get('wife', 0) > MAX_WIVES


def _refused(rule_set, reason):
    result = Result(CONTRACT_VERSIONS['result'], rule_set.school, 'refused', reason, (), None, (), ())
    return Evaluation(result, None, None)


def _steps(facts):
    """The proof's steps as typed Result steps. Nothing is left over when there are no heirs."""
    steps = []
    for name in ('base', 'awl', 'radd', 'correction'):
        value = facts[name]
        if value is not None:
            steps.append(Step(name, MappingProxyType({'base': Param('int', value)})))
    if facts['unallocated'] is not None and facts['base'] != 0:
        steps.append(Step('unallocated', MappingProxyType({'rest': Param('fraction', facts['unallocated'])})))
    return tuple(steps)


def evaluate(family, rule_set):
    """Calculate the Family under the RuleSet and return the Result with its proof and table."""
    if not isinstance(rule_set, RuleSet):
        raise ContractError('invalid_contract', 'rule_set must be a RuleSet')
    # refusals, in order: an impossible family, a School not supported, later deaths
    for estate in family.estates:
        if is_impossible([heir.relationship for heir in estate.heirs]):
            return _refused(rule_set, 'invalid_family')
    if rule_set.school == 'jafari':
        return _refused(rule_set, 'school_not_supported')
    if len(family.estates) > 1:
        return _refused(rule_set, 'manasikhat_unsupported')

    heirs = family.estates[0].heirs
    try:
        solved = solve([(heir.person, heir.relationship) for heir in heirs], rule_set.rules)
    except Refused as refusal:
        return _refused(rule_set, refusal.reason)

    final = solved.final
    evidence = proof_module.build(
        rule_set.school, [(h.id, h.rel, h.basis, final[h.id]) for h in solved.heirs], solved.steps)
    entries = {entry['heir']: entry for entry in evidence['heirs']}
    integer_steps = [s for s in evidence['steps'] if s['step'] != 'unallocated']
    stage = integer_steps[-1] if integer_steps and integer_steps[-1]['value'] else None

    allocations = []
    for heir in heirs:
        entry = entries[heir.person]
        blocked = entry['rule'] == 'blocked'
        verse = entry['verse']
        allocations.append(Allocation(
            heir.person, KINDS[entry['rule']], final[heir.person],
            None if blocked or stage is None else Stage(stage['step'], stage['value']),
            entry['rule'], entry['condition'], entry['blocked_by'], entry['school_rule'], entry['option'],
            () if verse is None else (proof_module.CITATION_KEYS[verse],)))
    unallocated = Fraction(1) - sum(final.values(), Fraction(0))
    result = Result(CONTRACT_VERSIONS['result'], rule_set.school, 'calculated', None, tuple(allocations),
                    unallocated, _steps(solved.steps), ())
    return Evaluation(result, freeze(evidence), freeze(solved.table))


def calculate(family, rule_set):
    """The Result for a Family under a RuleSet."""
    return evaluate(family, rule_set).result
