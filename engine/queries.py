"""Pure family-action queries. Answers contain codes and stable identities only."""
from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping

from .contracts import codes
from .contracts.errors import ContractError
from .contracts.family import Family
from .core import calculate, final_shares
from .rule_set import RuleSet
from . import kinship
from .placement import ANCHORS, ROOT


@dataclass(frozen=True)
class Options:
    impossible: Mapping[str, str]
    blocked: tuple

    def __post_init__(self):
        object.__setattr__(self, 'impossible', MappingProxyType(dict(self.impossible)))
        object.__setattr__(self, 'blocked', tuple(self.blocked))


@dataclass(frozen=True)
class Impact:
    persons: tuple
    estates: tuple


def _invalid():
    raise ContractError('invalid_contract', 'invalid query argument')


def _family(family):
    if not isinstance(family, Family):
        _invalid()


def _rules(family, rule_set):
    _family(family)
    if not isinstance(rule_set, RuleSet):
        _invalid()


def _estate(family, order):
    _family(family)
    if type(order) is not int:
        _invalid()
    for estate in family.estates:
        if estate.order == order:
            return estate
    _invalid()


def _gender(gender, optional=False):
    if not (optional and gender is None) and gender not in codes.GENDERS:
        _invalid()


def _counts(estate, replacing=None):
    if replacing is not None and replacing not in tuple(h.person for h in estate.heirs):
        _invalid()
    counts = {}
    for heir in estate.heirs:
        if heir.person != replacing:
            counts[heir.relationship] = counts.get(heir.relationship, 0) + 1
    return counts


def _options(rule_set, counts, deceased_gender, existing=None):
    """`existing` is the family that cardinality counts; `counts` alone decides what is blocked."""
    existing = counts if existing is None else existing
    impossible = {}
    for relationship in codes.RELATIONSHIPS:
        code = kinship.kinship_code(relationship, deceased_gender, existing)
        if code is None and deceased_gender is None:
            if relationship == 'husband' and existing.get('wife', 0):
                code = kinship.HUSBAND_OF_MALE
            elif relationship == 'wife' and existing.get('husband', 0):
                code = kinship.WIFE_OF_FEMALE
        if code is not None:
            impossible[relationship] = code
    blocked = kinship.blocked(rule_set.rules, rule_set.school, counts)
    return Options(impossible, tuple(r for r in codes.RELATIONSHIPS if r in blocked and r not in impossible))


def relationship_options(family, rule_set, *, estate=1, replacing=None, deceased_gender=None):
    _rules(family, rule_set)
    target = _estate(family, estate)
    _gender(deceased_gender, optional=True)
    if estate != 1:
        if deceased_gender is not None:
            _invalid()
        deceased_gender = next(p.gender for p in family.persons if p.id == target.deceased)
    return _options(rule_set, _counts(target, replacing), deceased_gender)


@dataclass(frozen=True)
class Placement:
    """One relationship that can be added at an anchor, and the new person's role relative to it."""
    relationship: str
    link: str
    blocked: bool


def placement_options(family, rule_set, *, estate=1, deceased_gender=None):
    """What can be added at each person of an estate: {anchor id: (Placement, ...)}.

    The estate's own deceased is `root`. Every person of the family is a key; one that is not an
    anchor of this estate, or whose relationship has no entry in the anchor table, maps to ().
    Candidates the estate's kinship rules make impossible are left out; blocked ones stay and are
    flagged. Persons who died before the deceased count toward cardinality (no second father while
    a father died before) and are anchors in the first estate only."""
    _rules(family, rule_set)
    target = _estate(family, estate)
    _gender(deceased_gender, optional=True)
    if estate != 1:
        if deceased_gender is not None:
            _invalid()
        deceased_gender = next(p.gender for p in family.persons if p.id == target.deceased)
    counts = _counts(target)
    existing = dict(counts)
    anchors = {ROOT: ROOT}
    anchors.update((h.person, h.relationship) for h in target.heirs)
    if estate == 1:
        for person in family.persons:
            if person.status == 'died_before_or_with' and person.relationship is not None:
                existing[person.relationship] = existing.get(person.relationship, 0) + 1
                anchors[person.id] = person.relationship
    options = _options(rule_set, counts, deceased_gender, existing)
    result = {ROOT: ()}
    for person in family.persons:
        result[person.id] = ()
    for anchor, relationship in anchors.items():
        result[anchor] = tuple(
            Placement(candidate, link, candidate in options.blocked)
            for link, candidate in ANCHORS.get(relationship, ())
            if candidate not in options.impossible)
    return MappingProxyType(result)


def change_impossible(family, rule_set, relationship, *, estate=1, replacing=None, deceased_gender=None):
    if relationship not in codes.RELATIONSHIPS:
        _invalid()
    return relationship_options(family, rule_set, estate=estate, replacing=replacing,
                                deceased_gender=deceased_gender).impossible.get(relationship)


def deceased_gender_conflict(family, gender, *, estate=1):
    _gender(gender)
    return kinship.gender_conflict(gender, _counts(_estate(family, estate)))


def delete_impact(family, person, *, estate=None):
    _family(family)
    if person not in tuple(p.id for p in family.persons):
        _invalid()
    if estate is not None:
        target = _estate(family, estate)
        if person not in tuple(h.person for h in target.heirs):
            _invalid()
    memberships = {p.id: {e.order for e in family.estates if any(h.person == p.id for h in e.heirs)}
                   for p in family.persons}
    removed = set()
    estates = set()
    if estate is None:
        removed.add(person)
    else:
        memberships[person].remove(estate)
        if not memberships[person]:
            removed.add(person)
    while True:
        before = (len(removed), len(estates))
        for edge in family.edges:
            if edge.kind == 'parent_of' and edge.from_ in removed:
                removed.add(edge.to)
        for entry in family.estates:
            if entry.deceased in removed:
                estates.add(entry.order)
        for pid, orders in memberships.items():
            if orders and orders <= estates:
                removed.add(pid)
        if before == (len(removed), len(estates)):
            break
    return Impact(tuple(p.id for p in family.persons if p.id in removed), tuple(sorted(estates)))


def refusal(family, rule_set):
    _rules(family, rule_set)
    return calculate(family, rule_set).refusal


def required_facts(family, rule_set):
    _rules(family, rule_set)
    return ()


def share_changing_presets(family, rule_set, presets):
    _rules(family, rule_set)
    try:
        candidates = tuple(presets)
    except TypeError:
        _invalid()
    if any(not isinstance(preset, RuleSet) for preset in candidates):
        _invalid()
    result = calculate(family, rule_set)
    signature = (final_shares(result), result.refusal)
    changed = []
    for preset in candidates:
        result = calculate(family, preset)
        if (final_shares(result), result.refusal) != signature:
            changed.append(preset)
    return tuple(changed)
