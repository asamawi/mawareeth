"""Pure lineage derivation for relatives already recorded in an interview layer.

Paths use f/m for parents, s/d for children, and p for a spouse. Multiple paths record both
parents of a full sibling; unnamed descending branches are never presumed equal.
"""
from itertools import product

PATHS = {
    'father': ('f',), 'mother': ('m',), 'son': ('s',), 'daughter': ('d',),
    'son_of_son': ('ss',), 'daughter_of_son': ('sd',),
    'grandfather': ('ff',), 'paternal_grandmother': ('fm',),
    'maternal_grandmother': ('mm',),
    'brother': ('fs', 'ms'), 'sister': ('fd', 'md'),
    'paternal_brother': ('fs',), 'paternal_sister': ('fd',),
    'maternal_brother': ('ms',), 'maternal_sister': ('md',),
    'son_of_brother': ('fss', 'mss'), 'son_of_paternal_brother': ('fss',),
    'uncle': ('ffs', 'fms'), 'paternal_uncle': ('ffs',),
    'son_of_uncle': ('ffss', 'fmss'), 'son_of_paternal_uncle': ('ffss',),
    'husband': ('p',), 'wife': ('p',),
}


GENDERS = {relationship: 'male' if relationship == 'husband' or paths[0][-1] in 'fs' else 'female'
           for relationship, paths in PATHS.items()}


def _person(row):
    return row.get('same_as') or row['id']


def _layers(case):
    yield None, case['deceased'], case['heirs']
    for death in case['deaths']:
        yield death['heir_id'], {'gender': death['gender']}, death['heirs']


def _reverse(path, gender):
    sexes = [gender] + ['male' if c in 'fs' else 'female' for c in path]
    return ''.join(('s' if sexes[i] == 'male' else 'd') if c in 'fm'
                   else ('f' if sexes[i] == 'male' else 'm')
                   for i, c in reversed(list(enumerate(path))))


def _classify(routes):
    matches = [(max(map(len, paths)), -len(paths), relationship)
               for relationship, paths in PATHS.items() if paths and set(paths) <= routes]
    return min(matches)[2] if matches else 'none'


def _can_share(xpaths, rpaths, depth):
    """A full and an explicitly half sibling cannot be the same unnamed parent."""
    for length in range(1, depth + 1):
        left = {path[:length] for path in xpaths if len(path) >= length}
        right = {path[:length] for path in rpaths if len(path) >= length}
        for paternal, maternal in (('fs', 'ms'), ('fd', 'md'), ('ffs', 'fms')):
            pair = {paternal, maternal}
            if (pair <= left and len(pair & right) == 1
                    or pair <= right and len(pair & left) == 1):
                return False
    return True


def _pair(x, r, gender):
    xp, rp = PATHS[x], PATHS[r]
    if x in ('husband', 'wife') or r in ('husband', 'wife'):
        return {'none'}
    certain, optional = set(), []
    for a, b in product(xp, rp):
        prefix = 0
        while prefix < min(len(a), len(b)) and a[prefix] == b[prefix]:
            prefix += 1
        known = 0
        while known < prefix and a[known] in 'fm':
            known += 1
        # The endpoint is a different person, even if their relationship is identical.
        known = min(known, len(a) - 1 if a == b else known)
        route = _reverse(a[known:], 'male' if known and a[known-1] in 'fs' else
                         'female' if known else gender) + b[known:]
        certain.add(route)
        for shared in range(known + 1, min(prefix, max(len(a), len(b))-1) + 1):
            if not _can_share(xp, rp, shared):
                continue
            optional.append(_reverse(a[shared:], 'male' if a[shared-1] in 'fs' else 'female') + b[shared:])
    results = {_classify(certain)}
    for route in optional:
        results.add(_classify(certain | {route}))
    if optional:
        results.add(_classify(certain | set(optional)))
    # Unnamed fathers may be shared without their wives being shared.
    for value in tuple(results):
        if value in ('paternal_brother', 'paternal_sister') and optional:
            results.add('brother' if value.endswith('brother') else 'sister')
    return results


def _suggest(offered):
    for value in ('mother', 'father', 'brother', 'sister', 'son', 'daughter'):
        if value in offered:
            return value
    return next((value for value in offered if value != 'none'), 'none')


def derive(case, x_row, shared_father=None, unordered=False):
    """Return proposed linked fields and unanswered-choice descriptions; never mutate case.

    Question answers are keyed by question id. Each per-person option is a relationship
    id or ``none``; the single shared-father question uses yes/no.
    """
    person = _person(x_row)
    source = next((entry for entry in _layers(case)
                   if any(r['id'] == person for r in entry[2])), None)
    if source is None:
        return [], []
    layer, deceased, heirs = source
    if deceased is None:
        return [], []
    x = next(r for r in heirs if r['id'] == person)
    order = next((d['order'] for d in case['deaths'] if d['heir_id'] == person), len(case['deaths']) + 2)
    dead = set() if unordered else {d['heir_id'] for d in case['deaths'] if d['order'] < order}
    spouses = [r for r in heirs if r['relationship'] in ('wife', 'husband')]
    children = [r for r in heirs if r['relationship'] in ('son', 'daughter')]
    descendants = [r for r in heirs if r['relationship'] in ('son', 'daughter', 'son_of_son', 'daughter_of_son')]
    female_children = deceased['gender'] == 'female' and bool(descendants) and (x in descendants or x in spouses)
    questions, rows = [], []
    if female_children and shared_father is None:
        questions.append({'id': 'shared_father', 'kind': 'shared_father', 'person': person,
                          'options': ['yes', 'no'], 'suggested': 'yes'})
    for r in heirs:
        identity = _person(r)
        if identity == person or identity == layer or identity in dead:
            continue
        if female_children and shared_father is None and (r in descendants or r in spouses):
            continue
        xr, rr = x['relationship'], r['relationship']
        options = _pair(xr, rr, deceased['gender'])
        # With the stated common-parent assumption, branches through D's children
        # are full, rather than paternal, kinship.
        common_children = deceased['gender'] == 'male' and len(spouses) <= 1 or shared_father == 'yes'
        if common_children and PATHS[xr] and PATHS[rr] and PATHS[xr][0][0] in 'sd' and PATHS[rr][0][0] in 'sd':
            full = {'paternal_brother': 'brother', 'paternal_sister': 'sister',
                    'son_of_paternal_brother': 'son_of_brother', 'paternal_uncle': 'uncle',
                    'son_of_paternal_uncle': 'son_of_uncle'}
            options = {full.get(value, value) for value in options}
        if x in children:
            if r in children:
                suffix = 'brother' if r['gender'] == 'male' else 'sister'
                if deceased['gender'] == 'male':
                    options = {suffix} if len(spouses) <= 1 else {suffix, 'paternal_' + suffix}
                else:
                    options = {suffix} if shared_father == 'yes' else {suffix, 'maternal_' + suffix}
            elif r in spouses:
                if deceased['gender'] == 'male':
                    options = {'mother'} if len(spouses) == 1 else {'mother', 'none'}
                else:
                    options = {'father'} if shared_father == 'yes' else {'father', 'none'}
        if x['relationship'] in ('son_of_son', 'daughter_of_son') and r in spouses:
            grandparent = 'paternal_grandmother' if r['gender'] == 'female' else 'grandfather'
            known_spouse = deceased['gender'] == 'male' and len(spouses) == 1 or shared_father == 'yes'
            options = {grandparent} if known_spouse else {grandparent, 'none'}
        if x in spouses and r in descendants:

            if deceased['gender'] == 'male':
                options = {rr} if len(spouses) <= 1 else {rr, 'none'}
            else:
                options = {rr} if shared_father == 'yes' else {rr, 'none'}
        if xr in ('son_of_son', 'daughter_of_son') and rr in ('son_of_son', 'daughter_of_son'):
            options = {'brother' if r['gender'] == 'male' else 'sister', 'none'}
            if r['gender'] == 'male':
                options.add('son_of_uncle')
        # Recorded parents are treated as spouses, as required by the parent-death matrix.
        if {xr, rr} == {'father', 'mother'}:
            options = {'wife' if xr == 'father' else 'husband'}
        options = {value for value in options if value == 'none' or GENDERS[value] == r['gender']} or {'none'}
        if len(options) == 1:
            relationship = next(iter(options))
            if relationship != 'none':
                rows.append({'relationship': relationship, 'same_as': identity, 'name': None})
        else:
            offered = sorted(options - {'none'}) + ['none']
            questions.append({'id': identity, 'kind': 'relative', 'person': identity,
                              'options': offered, 'suggested': _suggest(offered)})
    return rows, questions
