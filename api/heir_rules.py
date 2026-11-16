"""Compatibility adapter for engine-owned family decisions."""
from engine.kinship import (
    SECOND_OF, MAX_WIVES, FIFTH_WIFE, HUSBAND_OF_MALE, WIFE_OF_FEMALE,
    HAS_HUSBAND, HAS_WIFE, HAS_BOTH_SPOUSES, RELATIONSHIP_CODES, GENDER_CODES,
    RELATIONSHIP_GENDERS, BLOCKABLE, LATER_BLOCKERS, kinship_code, gender_conflict,
)
from engine.kinship import is_impossible, blocked
from engine.queries import relationship_options
from engine.rule_set import school_rule_set
from engine.contracts.codes import SCHOOLS
from engine.contracts.family import Family, Person, Estate, LayerHeir, EstateFacts


def counts(heirs):
    result = {}
    for heir in heirs:
        relationship = heir['relationship']
        result[relationship] = result.get(relationship, 0) + 1
    return result


def is_impossible_family(gender, counts):
    return is_impossible(counts, gender)


def blocked_relationships(madhab, counts):
    if madhab not in SCHOOLS:
        return set()
    # Unknown relationship ids were ignored by the old tables; keep ignoring them.
    counts = {r: count for r, count in counts.items() if r in RELATIONSHIP_GENDERS}
    relationships = tuple(r for r, count in counts.items() for _ in range(count))
    persons = tuple(Person(f'h{i}', RELATIONSHIP_GENDERS[r], None, r, 'alive', None)
                    for i, r in enumerate(relationships))
    heirs = tuple(LayerHeir(p.id, p.relationship) for p in persons)
    family = Family(1, 'root', persons, (), (Estate(1, 'root', heirs),), (), (), (), EstateFacts(None, None))
    rules = school_rule_set(madhab)
    options = relationship_options(family, rules)
    # Legacy callers filter impossible candidates separately. Preserve their raw
    # blocked set even when a candidate is also impossible; queries keep them disjoint.
    impossible_blocked = set(options.impossible) & blocked(rules.rules, rules.school, counts)
    return set(options.blocked) | impossible_blocked
