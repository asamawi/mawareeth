"""Pure kinship constraints and blocking decisions shared by all callers."""
from types import MappingProxyType

# Relationship id to the code of the rule broken when the family already has one (or four).
SECOND_OF = MappingProxyType({
    'father': 'second_father',
    'mother': 'second_mother',
    'husband': 'second_husband',
    'grandfather': 'second_grandfather',
    'paternal_grandmother': 'second_paternal_grandmother',
    'maternal_grandmother': 'second_maternal_grandmother',
})
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


RELATIONSHIP_GENDERS = MappingProxyType({'father': 'male',
 'mother': 'female',
 'husband': 'male',
 'wife': 'female',
 'son': 'male',
 'daughter': 'female',
 'son_of_son': 'male',
 'daughter_of_son': 'female',
 'grandfather': 'male',
 'paternal_grandmother': 'female',
 'maternal_grandmother': 'female',
 'brother': 'male',
 'sister': 'female',
 'paternal_brother': 'male',
 'paternal_sister': 'female',
 'maternal_brother': 'male',
 'maternal_sister': 'female',
 'son_of_brother': 'male',
 'son_of_paternal_brother': 'male',
 'uncle': 'male',
 'paternal_uncle': 'male',
 'son_of_uncle': 'male',
 'son_of_paternal_uncle': 'male'})

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


def is_impossible(counts, gender=None):
    """Whether the family cannot exist: a spouse of the wrong sex, a repeat of a relative who
    comes once, or more than four wives."""
    if counts.get('husband', 0) and counts.get('wife', 0):
        return True
    if counts.get('husband', 0) and gender == 'male':
        return True
    if counts.get('wife', 0) and gender == 'female':
        return True
    if any(counts.get(name, 0) > 1 for name in SECOND_OF):
        return True
    return counts.get('wife', 0) > MAX_WIVES


def _sisters_asaba(rules, c):
    """Whether the engine marks the full sisters as residuary (they exist and are not blocked)."""
    if not c['sister']:
        return False
    if c['male_desc'] or c['father'] or (c['grandfather'] and (rules['grandfather_with_siblings'] == 'blocks')):
        return False
    return bool(c['grandfather'] or c['brother'] or c['female_desc'])


def _paternal_sisters_asaba(rules, c):
    if not c['paternal_sister']:
        return False
    if c['male_desc'] or c['father'] or (c['grandfather'] and (rules['grandfather_with_siblings'] == 'blocks')):
        return False
    if c['grandfather']:
        return True
    if c['brother'] or _sisters_asaba(rules, c):
        return False
    return bool(c['paternal_brother'] or (not c['sister'] and c['female_desc']))


def _paternal_counted_out(c):
    """The mu'adda exclusion beside a sharing grandfather, as `Calculation.paternal_siblings_counted_out`:
    a full brother, or full sisters residuary with a female descendant, take the whole siblings' pool."""
    return bool(c['brother'] or (c['sister'] and c['female_desc']))


# The relatives after the siblings, each with the extra blockers the engine checks for it, in order.
LATER_BLOCKERS = MappingProxyType({'son_of_brother': (),
 'son_of_paternal_brother': ('son_of_brother',),
 'uncle': ('son_of_brother', 'son_of_paternal_brother'),
 'paternal_uncle': ('son_of_brother', 'son_of_paternal_brother', 'uncle'),
 'son_of_uncle': ('son_of_brother', 'son_of_paternal_brother', 'uncle', 'paternal_uncle'),
 'son_of_paternal_uncle': ('son_of_brother',
                           'son_of_paternal_brother',
                           'uncle',
                           'paternal_uncle',
                           'son_of_uncle')})


def _is_blocked(relationship, rules, c):
    """Whether the engine would block `relationship` in the family `c`, which includes it."""
    male_desc, father, grandfather = c['male_desc'], c['father'], c['grandfather']
    if relationship in ('father', 'mother', 'husband', 'wife', 'son', 'daughter'):
        return False
    if relationship == 'grandfather':
        return bool(father)
    if relationship == 'paternal_grandmother':
        return bool(c['mother'] or (father and rules['father_blocks_his_mother']))
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
    siblings_blocked = bool(male_desc or father or (grandfather and (rules['grandfather_with_siblings'] == 'blocks')))
    if relationship in ('brother', 'sister'):
        return siblings_blocked
    if relationship == 'paternal_brother':
        if siblings_blocked:
            return True
        if grandfather:
            return _paternal_counted_out(c)
        return bool(c['brother'] or _sisters_asaba(rules, c))
    if relationship == 'paternal_sister':
        if siblings_blocked:
            return True
        if grandfather:
            return _paternal_counted_out(c)
        if c['brother'] or _sisters_asaba(rules, c):
            return True
        if c['paternal_brother']:
            return False
        return c['sister'] > 1
    # From here every relative is blocked by the ones before it in this chain.
    chain = [
        bool(male_desc), bool(father), bool(grandfather), bool(c['brother']),
        _sisters_asaba(rules, c), bool(c['paternal_brother']), _paternal_sisters_asaba(rules, c),
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


def blocked(rules, school, counts):
    """Candidate relationships blocked by the current family and rule values."""
    if school == 'jafari':
        return frozenset()
    result = set()
    for relationship in BLOCKABLE:
        c = _facts({**counts, relationship: counts.get(relationship, 0) + 1})
        if _is_blocked(relationship, rules, c):
            result.add(relationship)
    return frozenset(result)
