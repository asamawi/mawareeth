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
from .contracts.result import Allocation, Layer, Param, Result, Stage, Step
from .rule_set import RuleSet
from .single import Refused, solve

from .kinship import SECOND_OF, MAX_WIVES, RELATIONSHIP_GENDERS, is_impossible as impossible_counts

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
    return impossible_counts(counts)


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


def _estate(estate, rule_set):
    """Map one unchanged single-estate solution into Result values and evidence."""
    heirs = estate.heirs
    solved = solve([(heir.person, heir.relationship) for heir in heirs], rule_set.rules)
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


def evaluate(family, rule_set):
    """Solve in death order, carrying exact running totals between estates.

    Refuses (invalid_family) a Family carrying gifts, bequests or answers: content the engine cannot compute yet.
    """
    if not isinstance(rule_set, RuleSet):
        raise ContractError('invalid_contract', 'rule_set must be a RuleSet')
    people = {person.id: person for person in family.persons}
    for person in family.persons:
        if person.relationship is not None and RELATIONSHIP_GENDERS[person.relationship] != person.gender:
            return _refused(rule_set, 'invalid_family')
    for estate in family.estates:
        if any(RELATIONSHIP_GENDERS[heir.relationship] != people[heir.person].gender for heir in estate.heirs):
            return _refused(rule_set, 'invalid_family')
    for estate in family.estates:
        rels = [heir.relationship for heir in estate.heirs]
        if (is_impossible(rels) or (estate.order > 1 and (
                ('husband' in rels and people[estate.deceased].gender == 'male') or
                ('wife' in rels and people[estate.deceased].gender == 'female')))):
            return _refused(rule_set, 'invalid_family')
    if family.gifts or family.bequests or family.answers:
        return _refused(rule_set, 'invalid_family')
    if rule_set.school == 'jafari':
        return _refused(rule_set, 'school_not_supported')
    earlier = set()
    for estate in family.estates:
        if estate.order > 1 and estate.deceased not in earlier:
            return _refused(rule_set, 'manasikhat_unsupported')
        earlier.update(heir.person for heir in estate.heirs)
    totals, identities, entries, tables, layers = {}, {}, [], [], []
    root = None
    for estate in family.estates:
        try:
            evaluation = _estate(estate, rule_set)
        except Refused as refusal:
            return _refused(rule_set, refusal.reason)
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
                        'estate': inherited, 'proof': thaw(evaluation.proof)})
        tables.append(thaw(evaluation.table))
        if estate.order > 1:
            layers.append(Layer(estate.order, estate.deceased, inherited, result.allocations,
                                result.steps, result.unallocated))
    if not layers:
        return root
    result = root.result
    result = Result(result.version, result.school, result.status, result.refusal, result.allocations,
                    result.unallocated, result.steps, tuple(layers))
    return Evaluation(result, freeze(proof_module.build_layered(rule_set.school, entries, totals)),
                      freeze(proof_module.build_layered_table(entries, tables, totals, identities)))


def final_shares(result) -> Optional[dict]:
    """Recompose living persons' exact fractions from a calculated Result."""
    if result.status == 'refused':
        return None
    totals = {allocation.person: allocation.share for allocation in result.allocations}
    for layer in result.layers:
        inherited = totals.pop(layer.deceased, Fraction(0))
        if inherited != layer.inherited:
            raise ContractError('invalid_contract', 'layer inherited share disagrees with running total')
        for allocation in layer.allocations:
            pid = allocation.person
            totals[pid] = totals.get(pid, Fraction(0)) + inherited * allocation.share
    return totals


def calculate(family, rule_set):
    """The Result for a Family under a RuleSet."""
    return evaluate(family, rule_set).result
