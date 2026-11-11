"""The anonymous interview case: the one owner of its session key.

Reads never touch the session, so a visitor without a case gets no session row.
The deceased and the heirs live here too. This module owns their rules; names and
amounts are never logged.
"""
import re
import unicodedata
import uuid
from decimal import Decimal

from django.conf import settings
from django.utils import timezone

from api import heir_rules
from api.kinship import derive

SESSION_KEY = 'anonymous_case'
SAVED_LINK_KEY = 'saved_case_link'
MADHABS = ('hanafi', 'maliki', 'shafii', 'hanbali', 'jafari')
GENDERS = ('male', 'female')
# Relationship id to the heir's gender, which is derived and never asked. The same for every madhab.
RELATIONSHIPS = {
    'father': 'male',
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
    'son_of_paternal_uncle': 'male',
}
# Ids that older sessions and clients still use, and the relationship they now mean.
ALIASES = {'grandmother': 'paternal_grandmother'}
MAX_HEIRS = 50
MAX_NAME_LENGTH = 100
ESTATE_PATTERN = re.compile(r'^([0-9]+)(?:([.,])([0-9]+))?$')
# Eastern Arabic and Persian digits, and the Arabic decimal separator, become ASCII.
DIGITS = str.maketrans(
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫',
    '01234567890123456789.',
)


class StaleCase(Exception):
    """The caller meant a case that is no longer the live one."""

    def __init__(self, case):
        super().__init__('The live case is not the one the caller meant.')
        self.case = case


class FieldErrors(Exception):
    """Input broke a rule. `errors` maps a field to a code the client turns into text."""

    def __init__(self, errors, questions=None):
        super().__init__('Invalid input.')
        self.errors = errors
        self.questions = questions


class HeirNotFound(Exception):
    """The heir is gone; `case` is the live case so the caller can refresh its list."""

    def __init__(self, case):
        super().__init__('No such heir.')
        self.case = case


def clean_estate(value):
    """The estate as a canonical string (no leading zeros), or None when it is left out."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise FieldErrors({'estate': 'invalid'})
    text = value.strip().translate(DIGITS)
    if text == '':
        return None
    match = ESTATE_PATTERN.match(text)
    if match is None:
        raise FieldErrors({'estate': 'invalid'})
    whole, separator, fraction = match.group(1), match.group(2), match.group(3)
    # A comma is a decimal separator only with one or two digits after it: "1,250" is a
    # thousands separator and stays invalid.
    if separator == ',' and len(fraction) > 2:
        raise FieldErrors({'estate': 'invalid'})
    whole = whole.lstrip('0') or '0'
    if len(whole) > 15:
        raise FieldErrors({'estate': 'too_large'})
    if fraction is not None and len(fraction) > 2:
        raise FieldErrors({'estate': 'decimals'})
    if Decimal(whole + '.' + (fraction or '0')) <= 0:
        raise FieldErrors({'estate': 'not_positive'})
    return whole if fraction is None else f'{whole}.{fraction}'


def clean_deceased(data):
    """The deceased as {'gender', 'estate'}. Raises FieldErrors."""
    errors = {}
    gender = data.get('gender')
    if gender is None or gender == '':
        errors['gender'] = 'required'
    elif not isinstance(gender, str) or gender not in GENDERS:
        errors['gender'] = 'invalid'
    estate = None
    try:
        estate = clean_estate(data.get('estate'))
    except FieldErrors as error:
        errors.update(error.errors)
    if errors:
        raise FieldErrors(errors)
    return {'gender': gender, 'estate': estate}


# Bidirectional embeddings, overrides and isolates can reorder the text around a name.
BIDI_CONTROLS = frozenset(chr(code) for code in (*range(0x202A, 0x202F), *range(0x2066, 0x206A)))
# What shows nothing: spaces, controls and format characters (the zero-width joiners stay legal
# inside a name, they just do not count as something to see).
INVISIBLE_CATEGORIES = ('Zs', 'Zl', 'Zp', 'Cc', 'Cf')


def clean_name(value):
    """A trimmed name, or None when it is left out or shows nothing. Raises FieldErrors."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise FieldErrors({'name': 'invalid'})
    text = value.strip()
    for char in text:
        # Cs is a lone surrogate, which cannot be encoded and would fail when rendered.
        if unicodedata.category(char) in ('Cc', 'Zl', 'Zp', 'Cs') or char in BIDI_CONTROLS:
            raise FieldErrors({'name': 'invalid'})
    if len(text) > MAX_NAME_LENGTH:
        raise FieldErrors({'name': 'too_long'})
    if all(unicodedata.category(char) in INVISIBLE_CATEGORIES for char in text):
        return None
    return text


def canonical(relationship):
    """The relationship id an alias stands for; anything else is returned as it came."""
    if isinstance(relationship, str):
        return ALIASES.get(relationship, relationship)
    return relationship


def clean_heir(data):
    """The heir's editable fields as {'relationship', 'name'}. Raises FieldErrors."""
    errors = {}
    relationship = canonical(data.get('relationship'))
    if relationship is None or relationship == '':
        errors['relationship'] = 'required'
    elif not isinstance(relationship, str) or relationship not in RELATIONSHIPS:
        errors['relationship'] = 'invalid'
    name = None
    try:
        name = clean_name(data.get('name'))
    except FieldErrors as error:
        errors.update(error.errors)
    if errors:
        raise FieldErrors(errors)
    return {'relationship': relationship, 'name': name}


def _read_deceased(value):
    if not isinstance(value, dict):
        return None
    try:
        return clean_deceased(value)
    except FieldErrors:
        return None


def _read_heirs(value):
    """The valid heirs, in order. A tampered entry is left out."""
    if not isinstance(value, list):
        return []
    heirs, seen = [], set()
    for item in value:
        if not isinstance(item, dict):
            continue
        heir_id = item.get('id')
        if not isinstance(heir_id, str) or not heir_id or heir_id in seen:
            continue
        try:
            fields = clean_heir(item)
        except FieldErrors:
            continue
        seen.add(heir_id)
        heirs.append({
            'id': heir_id,
            'relationship': fields['relationship'],
            'gender': RELATIONSHIPS[fields['relationship']],
            'name': fields['name'],
        })
    return heirs[:MAX_HEIRS]


def heir_options(madhab, deceased, heirs):
    """What adding a relative to the whole family would meet: {'blocked': [...], 'invalid': {...}}.

    `blocked` lists the relationships the engine would give nothing (hajb): they are labelled,
    never refused. `invalid` maps a relationship to the code of the kinship rule it would
    break. The two never overlap: kinship comes first.
    """
    if deceased is None:
        return {'blocked': [], 'invalid': {}}
    counts = heir_rules.counts(heirs)
    invalid = {}
    for relationship in RELATIONSHIPS:
        code = heir_rules.kinship_code(relationship, deceased['gender'], counts)
        if code is not None:
            invalid[relationship] = code
    blocked = heir_rules.blocked_relationships(madhab, counts)
    return {
        'blocked': [name for name in RELATIONSHIPS if name in blocked and name not in invalid],
        'invalid': invalid,
    }


def get(request):
    """The current case as {'id', 'started_at', 'madhab', 'deceased', 'heirs', 'heir_options'}, or None.

    A stored madhab that is not one of MADHABS reads as None, an invalid deceased as None,
    and invalid heirs are left out. `heir_options` is worked out here and never stored.
    """
    case = request.session.get(SESSION_KEY)
    if not isinstance(case, dict) or 'id' not in case or 'started_at' not in case:
        return None
    madhab = case.get('madhab')
    madhab = madhab if isinstance(madhab, str) and madhab in MADHABS else None
    deceased = _read_deceased(case.get('deceased'))
    heirs = _read_heirs(case.get('heirs'))
    result = {
        'id': case['id'],
        'started_at': case['started_at'],
        'madhab': madhab,
        'deceased': deceased,
        'heirs': heirs,
        'heir_options': heir_options(madhab, deceased, heirs),
        'deaths': [],
    }
    _read_deaths(result, case.get('deaths'))
    return result


def start(request):
    """Create a case, replacing any existing one, and return it."""
    clear_saved_link(request)
    case = {'id': uuid.uuid4().hex, 'started_at': timezone.now().isoformat()}
    request.session[SESSION_KEY] = case
    touch(request)
    return get(request)


def _live(request, case_id):
    """The live case, None when there is none. Raises StaleCase when case_id is another case."""
    current = get(request)
    if current is None:
        return None
    if case_id is not None and case_id != current['id']:
        raise StaleCase(current)
    return current


def _save(request, **changes):
    stored = get(request)
    stored.update(changes)
    stored.pop('heir_options', None)
    for death in stored.get('deaths', []):
        death.pop('heir_options', None)
    # Reassign: changing the nested dict would not mark the session modified.
    request.session[SESSION_KEY] = stored
    touch(request)
    return get(request)


def set_madhab(request, madhab, case_id=None):
    """Store the madhab on the live case and return the case, or None when there is none.

    Raises ValueError for an unknown madhab and StaleCase when case_id is given and is
    not the live case. Nothing is written in either of those or the None case.
    """
    if not isinstance(madhab, str) or madhab not in MADHABS:
        raise ValueError('Unknown madhab.')
    if _live(request, case_id) is None:
        return None
    return _save(request, madhab=madhab)


def set_deceased(request, data, case_id):
    """Store the deceased, replacing any earlier one. Returns the case, or None without one.

    Raises StaleCase, or FieldErrors (nothing is stored).
    """
    current = _live(request, case_id)
    if current is None:
        return None
    errors = {}
    deceased = None
    try:
        deceased = clean_deceased(data)
    except FieldErrors as invalid:
        errors.update(invalid.errors)
    gender = data.get('gender')
    if isinstance(gender, str) and gender in GENDERS:
        conflict = heir_rules.gender_conflict(gender, heir_rules.counts(current['heirs']))
        if conflict is not None:
            errors['gender'] = conflict
    if errors:
        raise FieldErrors(errors)
    return _save(request, deceased=deceased, heirs=current['heirs'])


def touch(request):
    """Refresh the idle expiry. Only anonymous sessions get the short one."""
    if not request.user.is_authenticated:
        request.session.set_expiry(settings.ANONYMOUS_CASE_IDLE_SECONDS)


def _layers(case):
    yield None, case['deceased'], case['heirs']
    for death in case['deaths']:
        yield death['heir_id'], {'gender': death['gender']}, death['heirs']


def _rows(case):
    return {row['id']: row for _, _, rows in _layers(case) for row in rows}


def _person(row):
    return row.get('same_as') or row['id']


def _decorate(case):
    rows = _rows(case)
    for death in case['deaths']:
        death['gender'] = rows[death['heir_id']]['gender']
        death['heir_options'] = heir_options(case['madhab'], death, death['heirs'])
        for row in death['heirs']:
            if row.get('same_as'):
                row['name'] = rows[row['same_as']]['name']


def _read_deaths(case, value):
    """Read forward only: every identity and death must refer to an earlier live row."""
    if not isinstance(value, list):
        return
    for item in sorted((d for d in value if isinstance(d, dict)),
                       key=lambda d: d.get('order') if type(d.get('order')) is int else 99):
        order = item.get('order')
        rows = _rows(case)
        target = item.get('heir_id')
        if (type(order) is not int or order != len(case['deaths']) + 2
                or not isinstance(target, str) or target not in rows
                or _person(rows[target]) != target
                or any(d['heir_id'] == target for d in case['deaths'])
                or len(case['deaths']) >= 2):
            continue
        dead = {d['heir_id'] for d in case['deaths']} | {target}
        heirs, people = [], set()
        raw = item.get('heirs', [])
        raw = raw if isinstance(raw, list) else []
        for original in raw:
            if len(heirs) >= MAX_HEIRS:
                break
            valid = _read_heirs([original])
            if not valid:
                continue
            row = valid[0]
            if row['id'] in rows or any(h['id'] == row['id'] for h in heirs):
                continue
            link = original.get('same_as')
            if link is not None:
                if (not isinstance(link, str) or link not in rows or _person(rows[link]) != link
                        or link in dead or rows[link]['gender'] != row['gender'] or link in people):
                    continue
                row['same_as'] = link
            people.add(_person(row))
            heirs.append(row)
        case['deaths'].append({'heir_id': target, 'order': len(case['deaths']) + 2,
                               'gender': rows[target]['gender'], 'heirs': heirs})
    _decorate(case)


def _store_case(request, case):
    _decorate(case)
    return _save(request, **case)


def _order(case, first=None):
    deaths = case['deaths']
    if first in ('simultaneous', 'unknown'):
        raise FieldErrors({'death': first})
    if first is not None and (not isinstance(first, str)
                              or first not in {d['heir_id'] for d in deaths}):
        raise FieldErrors({'death': 'order_conflict'})
    if len(deaths) < 2:
        return
    a, b = deaths
    # An heir outlives the deceased whose layer contains that heir.
    a_after_b = any(_person(r) == a['heir_id'] for r in b['heirs'])
    b_after_a = any(_person(r) == b['heir_id'] for r in a['heirs'])
    if a_after_b and b_after_a:
        raise FieldErrors({'death': 'order_conflict'})
    implied = b['heir_id'] if a_after_b else a['heir_id'] if b_after_a else None
    if first is not None and (not isinstance(first, str) or first not in (a['heir_id'], b['heir_id'])
                              or implied is not None and first != implied):
        raise FieldErrors({'death': 'order_conflict'})
    chosen = implied or first
    if chosen is None:
        raise FieldErrors({'death': 'order_required'})
    deaths.sort(key=lambda d: d['heir_id'] != chosen)
    for i, death in enumerate(deaths, 2):
        death['order'] = i
    positions = {r['id']: i for i, (_, _, rows) in enumerate(_layers(case), 1) for r in rows}
    dead = {d['heir_id']: d['order'] for d in deaths}
    for _, _, rows in _layers(case):
        for row in rows:
            person = _person(row)
            if (row.get('same_as') and positions[person] >= positions[row['id']]
                    or dead.get(person, 4) <= positions[row['id']]):
                raise FieldErrors({'death': 'order_conflict'})


def mark_deceased(request, heir_id, first=None, case_id=None, relatives=None, shared_father=None):
    """Add a person's death layer. Raises StaleCase, HeirNotFound or FieldErrors."""
    case = _live(request, case_id)
    if case is None:
        return None
    rows = _rows(case)
    if not isinstance(heir_id, str) or heir_id not in rows:
        raise HeirNotFound(case)
    person = _person(rows[heir_id])
    if any(d['heir_id'] == person for d in case['deaths']):
        raise FieldErrors({'death': 'already_deceased'})
    if len(case['deaths']) == 2:
        raise FieldErrors({'death': 'limit'})
    case['deaths'].append({'heir_id': person, 'order': len(case['deaths']) + 2,
                           'gender': rows[person]['gender'], 'heirs': []})
    if (relatives is not None and not (isinstance(relatives, dict) and all(
            isinstance(k, str) and isinstance(v, str) for k, v in relatives.items()))
            or shared_father not in (None, 'yes', 'no')):
        raise FieldErrors({'relatives': 'invalid'})
    answers = relatives or {}
    errors = {}
    try:
        _order(case, first)
    except FieldErrors as error:
        errors.update(error.errors)
    proposed, questions = derive(case, rows[person], shared_father,
                                 unordered='death' in errors)
    offered = {q['id']: q for q in questions if q['kind'] == 'relative'}
    # A question returned while order was open may concern someone now known to
    # have died earlier. Validate that answer against the offered lineage choices,
    # then omit the person; resolving order must not require a second resend.
    valid_answers = offered
    if first is not None and len(case['deaths']) == 2:
        _, unordered_questions = derive(case, rows[person], shared_father, unordered=True)
        valid_answers = {q['id']: q for q in unordered_questions if q['kind'] == 'relative'}
    if any(key not in valid_answers or value not in valid_answers[key]['options']
           for key, value in answers.items()):
        errors['relatives'] = 'invalid'
    missing = [q for q in questions if (q['kind'] == 'shared_father' and shared_father is None)
               or (q['kind'] == 'relative' and q['id'] not in answers)]
    if missing:
        errors.setdefault('relatives', 'required')
    if errors:
        raise FieldErrors(errors, questions)
    for fields in proposed:
        try:
            _add_heir(case, fields, person, fields['same_as'])
        except FieldErrors:
            # An impossible derived relative must never refuse the death.
            continue
    for key, value in answers.items():
        if key in offered and value != 'none':
            try:
                _add_heir(case, {'relationship': value, 'same_as': key, 'name': None}, person, key)
            except FieldErrors:
                # The visitor's own answer is impossible (e.g. two mothers): refuse, store nothing.
                raise FieldErrors({'relatives': 'invalid'}, questions)
    return _store_case(request, case)


def _remove_rows(case, removed, old=None):
    """Promote surviving identities, then recursively prune deaths with no surviving row."""
    old = _rows(case) if old is None else old
    while True:
        for _, _, rows in _layers(case):
            rows[:] = [r for r in rows if r['id'] not in removed]
        remaining = _rows(case)
        groups = {}
        for row in remaining.values():
            groups.setdefault(_person(row), []).append(row)
        replacements = {}
        for person, group in groups.items():
            earliest = group[0]
            replacements[person] = earliest['id']
            earliest['name'] = old[person]['name']
            for row in group:
                row.pop('same_as', None)
                if row is not earliest:
                    row['same_as'] = earliest['id']
        lost = [d for d in case['deaths'] if d['heir_id'] not in replacements]
        for d in case['deaths']:
            if d not in lost:
                d['heir_id'] = replacements[d['heir_id']]
        if not lost:
            break
        for d in lost:
            removed.update(r['id'] for r in d['heirs'])
            case['deaths'].remove(d)
    for i, d in enumerate(case['deaths'], 2):
        d['order'] = i


def unmark_deceased(request, heir_id, case_id=None):
    """Remove a death and prune its layer, promoting surviving identities. Raises StaleCase or HeirNotFound."""
    case = _live(request, case_id)
    if case is None:
        return None
    rows = _rows(case)
    person = _person(rows[heir_id]) if heir_id in rows else heir_id
    death = next((d for d in case['deaths'] if d['heir_id'] == person), None)
    if death is None:
        raise HeirNotFound(case)
    removed = {r['id'] for r in death['heirs']}
    old = _rows(case)
    case['deaths'].remove(death)
    _remove_rows(case, removed, old)
    return _store_case(request, case)


def add_heir(request, data, case_id, layer=None, same_as=None):
    """Add a row to a layer, optionally linking a person. Raises StaleCase, HeirNotFound or FieldErrors."""
    case = _live(request, case_id)
    if case is None:
        return None
    _add_heir(case, data, layer, same_as)
    return _store_case(request, case)


def _add_heir(case, data, layer=None, same_as=None):
    """Validate and insert one row in memory, for both manual and derived additions."""
    layer = data.get('layer', layer)
    link = data.get('same_as', same_as)
    selected = next((entry for entry in _layers(case) if entry[0] == layer), None)
    if selected is None:
        raise HeirNotFound(case)
    _, deceased, heirs = selected
    if deceased is None:
        raise FieldErrors({'case': 'deceased_required'})
    errors = {}
    try:
        fields = clean_heir(data)
    except FieldErrors as error:
        errors.update(error.errors)
    relationship = canonical(data.get('relationship'))
    if isinstance(relationship, str) and relationship in RELATIONSHIPS:
        issue = heir_rules.kinship_code(relationship, deceased['gender'], heir_rules.counts(heirs))
        if issue:
            errors['relationship'] = issue
    if len(heirs) >= MAX_HEIRS:
        errors['heirs'] = 'limit'
    rows = _rows(case)
    if link is not None:
        if not isinstance(link, str) or link not in rows:
            errors['same_as'] = 'not_alive'
        else:
            link = _person(rows[link])
            positions = {r['id']: i for i, (key, _, rs) in enumerate(_layers(case), 1) for r in rs}
            order = next((d['order'] for d in case['deaths'] if d['heir_id'] == layer), 1)
            died = next((d['order'] for d in case['deaths'] if d['heir_id'] == link), 4)
            if any(_person(r) == link for r in heirs):
                errors['same_as'] = 'already_linked'
            elif positions[link] >= order or died <= order:
                errors['same_as'] = 'not_alive'
            elif (isinstance(relationship, str) and relationship in RELATIONSHIPS
                  and rows[link]['gender'] != RELATIONSHIPS[relationship]):
                errors['same_as'] = 'gender_mismatch'
    if errors:
        raise FieldErrors(errors)
    row = {'id': uuid.uuid4().hex, **fields, 'gender': RELATIONSHIPS[relationship]}
    if link is not None:
        row['same_as'] = link
    heirs.append(row)
    return row


def update_heir(request, heir_id, data, case_id):
    """Edit a row in any layer and rename all its links. Raises StaleCase, HeirNotFound or FieldErrors."""
    case = _live(request, case_id)
    if case is None:
        return None
    rows = _rows(case)
    if heir_id not in rows:
        raise HeirNotFound(case)
    row = rows[heir_id]
    errors = {}
    try:
        fields = clean_heir(data)
    except FieldErrors as error:
        errors.update(error.errors)
    rel = canonical(data.get('relationship'))
    if isinstance(rel, str) and rel in RELATIONSHIPS:
        person = _person(row)
        locked = (any(_person(r) == person and r['id'] != row['id'] for r in rows.values())
                  or any(d['heir_id'] == person for d in case['deaths']))
        if locked and RELATIONSHIPS[rel] != row['gender']:
            errors['relationship'] = 'gender_locked'
        elif rel != row['relationship']:
            _, deceased, heirs = next(e for e in _layers(case) if row in e[2])
            if deceased is None:
                errors['case'] = 'deceased_required'
            else:
                issue = heir_rules.kinship_code(
                    rel, deceased['gender'], heir_rules.counts(r for r in heirs if r is not row))
                if issue:
                    errors['relationship'] = issue
    if errors:
        raise FieldErrors(errors)
    rows[_person(row)]['name'] = fields['name']
    row['relationship'] = rel
    row['gender'] = RELATIONSHIPS[rel]
    return _store_case(request, case)


def remove_heir(request, heir_id, case_id):
    """Remove a row, promoting linked identities and pruning lost deaths. Raises StaleCase or HeirNotFound."""
    case = _live(request, case_id)
    if case is None:
        return None
    if heir_id not in _rows(case):
        raise HeirNotFound(case)
    _remove_rows(case, {heir_id})
    return _store_case(request, case)


def export_snapshot(case):
    """Only input fields cross the persistence boundary, including linked identities."""
    def row(value):
        return {key: value[key] for key in ('id', 'relationship', 'gender', 'name', 'same_as') if key in value}
    return {
        'madhab': case['madhab'],
        'deceased': {key: case['deceased'][key] for key in ('gender', 'estate')} if case['deceased'] else None,
        'heirs': [row(value) for value in case['heirs']],
        'deaths': [{'heir_id': death['heir_id'], 'order': death['order'], 'gender': death['gender'],
                    'heirs': [row(value) for value in death['heirs']]} for death in case['deaths']],
    }


def clear_saved_link(request):
    request.session.pop(SAVED_LINK_KEY, None)


def get_saved_link(request, case_id):
    link = request.session.get(SAVED_LINK_KEY)
    if isinstance(link, dict) and link.get('case_id') == case_id and type(link.get('saved_id')) is int:
        return link['saved_id']
    return None


def set_saved_link(request, case_id, saved_id):
    request.session[SAVED_LINK_KEY] = {'case_id': case_id, 'saved_id': saved_id}


def load_snapshot(request, snapshot):
    start(request)
    return _save(request, **snapshot)
