"""The fiqh rules for which relatives a family can hold: pure, with no database.

Two kinds of rule live here. Impossible kinship (two fathers, a fifth wife, a husband for a
male deceased) holds for every school. Hajb (blocking) says which relatives would inherit
nothing given the family so far; it mirrors the `blocked` flags the engine sets in
`calc.models`, which stay the authority for shares, and a test holds the two together. It also
labels the paternal siblings the engine counts against a grandfather and then gives nothing (the
mu'adda exclusion, `paternal_siblings_counted_out`), though the engine keeps them live.

Every function takes plain facts: a school id, the deceased's gender and `counts`, a mapping
of relationship id to how many of that relative the family has. Jafari and an unknown school
label nothing, because applying Sunni rules to them would be wrong.
"""
from calc import schools

# Relationship id to the code of the rule broken when the family already has one (or four).
SECOND_OF = {
    'father': 'second_father',
    'mother': 'second_mother',
    'husband': 'second_husband',
    'grandfather': 'second_grandfather',
    'paternal_grandmother': 'second_paternal_grandmother',
    'maternal_grandmother': 'second_maternal_grandmother',
}
MAX_WIVES = 4
FIFTH_WIFE = 'fifth_wife'
HUSBAND_OF_MALE = 'husband_of_male'
WIFE_OF_FEMALE = 'wife_of_female'
HAS_HUSBAND = 'has_husband'
HAS_WIFE = 'has_wife'
HAS_BOTH_SPOUSES = 'has_both_spouses'
# Every code this module can produce, by the field it belongs to: the contract lists the same.
RELATIONSHIP_CODES = (*SECOND_OF.values(), FIFTH_WIFE, HUSBAND_OF_MALE, WIFE_OF_FEMALE)
GENDER_CODES = (HAS_HUSBAND, HAS_WIFE, HAS_BOTH_SPOUSES)


def counts(heirs):
    """How many heirs of each relationship, from any iterable of heirs with a `relationship`."""
    result = {}
    for heir in heirs:
        result[heir['relationship']] = result.get(heir['relationship'], 0) + 1
    return result


def kinship_code(relationship, gender, counts):
    """The code of the kinship rule that adding `relationship` would break, or None.

    `gender` is the deceased's. `counts` is the family before the addition."""
    if relationship == 'husband' and gender == 'male':
        return HUSBAND_OF_MALE
    if relationship == 'wife' and gender == 'female':
        return WIFE_OF_FEMALE
    if relationship in SECOND_OF and counts.get(relationship, 0) >= 1:
        return SECOND_OF[relationship]
    if relationship == 'wife' and counts.get('wife', 0) >= MAX_WIVES:
        return FIFTH_WIFE
    return None


def gender_conflict(gender, counts):
    """The code for a deceased gender that contradicts the saved spouses, or None.

    A husband and a wife together fit no gender, so that is reported whichever is chosen."""
    if counts.get('husband', 0) and counts.get('wife', 0):
        return HAS_BOTH_SPOUSES
    if gender == 'male' and counts.get('husband', 0):
        return HAS_HUSBAND
    if gender == 'female' and counts.get('wife', 0):
        return HAS_WIFE
    return None


def is_impossible_family(gender, counts):
    """Whether the family cannot exist: a spouse of the wrong sex, a repeat of a relative who
    comes once, or more than four wives."""
    if counts.get('husband', 0) and gender == 'male':
        return True
    if counts.get('wife', 0) and gender == 'female':
        return True
    if any(counts.get(name, 0) > 1 for name in SECOND_OF):
        return True
    return counts.get('wife', 0) > MAX_WIVES


def _sisters_asaba(madhab, c):
    """Whether the engine marks the full sisters as residuary (they exist and are not blocked)."""
    if not c['sister']:
        return False
    if c['male_desc'] or c['father'] or (c['grandfather'] and schools.grandfather_blocks_siblings(madhab)):
        return False
    return bool(c['grandfather'] or c['brother'] or c['female_desc'])


def _paternal_sisters_asaba(madhab, c):
    if not c['paternal_sister']:
        return False
    if c['male_desc'] or c['father'] or (c['grandfather'] and schools.grandfather_blocks_siblings(madhab)):
        return False
    if c['grandfather']:
        return True
    if c['brother'] or _sisters_asaba(madhab, c):
        return False
    return bool(c['paternal_brother'] or (not c['sister'] and c['female_desc']))


def _paternal_counted_out(c):
    """The mu'adda exclusion beside a sharing grandfather, as `Calculation.paternal_siblings_counted_out`:
    a full brother, or full sisters residuary with a female descendant, take the whole siblings' pool."""
    return bool(c['brother'] or (c['sister'] and c['female_desc']))


# The relatives after the siblings, each with the extra blockers the engine checks for it, in order.
LATER_BLOCKERS = {
    'son_of_brother': [],
    'son_of_paternal_brother': ['son_of_brother'],
    'uncle': ['son_of_brother', 'son_of_paternal_brother'],
    'paternal_uncle': ['son_of_brother', 'son_of_paternal_brother', 'uncle'],
    'son_of_uncle': ['son_of_brother', 'son_of_paternal_brother', 'uncle', 'paternal_uncle'],
    'son_of_paternal_uncle': ['son_of_brother', 'son_of_paternal_brother', 'uncle', 'paternal_uncle',
                              'son_of_uncle'],
}


def _is_blocked(relationship, madhab, c):
    """Whether the engine would block `relationship` in the family `c`, which includes it."""
    male_desc, father, grandfather = c['male_desc'], c['father'], c['grandfather']
    if relationship in ('father', 'mother', 'husband', 'wife', 'son', 'daughter'):
        return False
    if relationship == 'grandfather':
        return bool(father)
    if relationship == 'paternal_grandmother':
        return bool(c['mother'] or (father and schools.father_blocks_his_mother(madhab)))
    if relationship == 'maternal_grandmother':
        return bool(c['mother'])
    if relationship == 'son_of_son':
        return bool(c['son'])
    if relationship == 'daughter_of_son':
        if c['son']:
            return True
        if c['son_of_son']:
            return False
        return c['daughter'] > 1
    if relationship in ('maternal_brother', 'maternal_sister'):
        return bool(c['descendant'] or father or grandfather)
    siblings_blocked = bool(male_desc or father or (grandfather and schools.grandfather_blocks_siblings(madhab)))
    if relationship in ('brother', 'sister'):
        return siblings_blocked
    if relationship == 'paternal_brother':
        if siblings_blocked:
            return True
        if grandfather:
            return _paternal_counted_out(c)
        return bool(c['brother'] or _sisters_asaba(madhab, c))
    if relationship == 'paternal_sister':
        if siblings_blocked:
            return True
        if grandfather:
            return _paternal_counted_out(c)
        if c['brother'] or _sisters_asaba(madhab, c):
            return True
        if c['paternal_brother']:
            return False
        return c['sister'] > 1
    # From here every relative is blocked by the ones before it in this chain.
    chain = [
        bool(male_desc), bool(father), bool(grandfather), bool(c['brother']),
        _sisters_asaba(madhab, c), bool(c['paternal_brother']), _paternal_sisters_asaba(madhab, c),
    ]
    if relationship not in LATER_BLOCKERS:
        return False
    return any(chain) or any(c[name] for name in LATER_BLOCKERS[relationship])


def _facts(counts):
    c = {name: counts.get(name, 0) for name in (
        'father', 'mother', 'son', 'daughter', 'son_of_son', 'daughter_of_son', 'grandfather',
        'brother', 'sister', 'paternal_brother', 'paternal_sister', 'maternal_brother',
        'maternal_sister', 'son_of_brother', 'son_of_paternal_brother', 'uncle', 'paternal_uncle',
        'son_of_uncle', 'son_of_paternal_uncle')}
    c['male_desc'] = c['son'] + c['son_of_son']
    c['female_desc'] = c['daughter'] + c['daughter_of_son']
    c['descendant'] = c['male_desc'] + c['female_desc']
    return c


# The relationships the engine can ever block. The others are never labelled.
BLOCKABLE = (
    'son_of_son', 'daughter_of_son', 'grandfather', 'paternal_grandmother', 'maternal_grandmother', 'brother', 'sister',
    'paternal_brother', 'paternal_sister', 'maternal_brother', 'maternal_sister', 'son_of_brother',
    'son_of_paternal_brother', 'uncle', 'paternal_uncle', 'son_of_uncle', 'son_of_paternal_uncle',
)


def blocked_relationships(madhab, counts):
    """The relationships that would inherit nothing if one were added to the family `counts`,
    as a set. Nothing for Jafari or an unknown school."""
    if madhab not in schools.SUNNI:
        return set()
    blocked = set()
    for relationship in BLOCKABLE:
        c = _facts({**counts, relationship: counts.get(relationship, 0) + 1})
        if _is_blocked(relationship, madhab, c):
            blocked.add(relationship)
    return blocked
