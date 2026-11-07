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

SESSION_KEY = 'anonymous_case'
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
    'grandmother': 'female',
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

    def __init__(self, errors):
        super().__init__('Invalid input.')
        self.errors = errors


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


def clean_heir(data):
    """The heir's editable fields as {'relationship', 'name'}. Raises FieldErrors."""
    errors = {}
    relationship = data.get('relationship')
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


def get(request):
    """The current case as {'id', 'started_at', 'madhab', 'deceased', 'heirs'}, or None.

    A stored madhab that is not one of MADHABS reads as None, an invalid deceased as None,
    and invalid heirs are left out.
    """
    case = request.session.get(SESSION_KEY)
    if not isinstance(case, dict) or 'id' not in case or 'started_at' not in case:
        return None
    madhab = case.get('madhab')
    return {
        'id': case['id'],
        'started_at': case['started_at'],
        'madhab': madhab if isinstance(madhab, str) and madhab in MADHABS else None,
        'deceased': _read_deceased(case.get('deceased')),
        'heirs': _read_heirs(case.get('heirs')),
    }


def start(request):
    """Create a case, replacing any existing one, and return it."""
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
    stored = dict(request.session[SESSION_KEY])
    stored.update(changes)
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
    return _save(request, deceased=clean_deceased(data), heirs=current['heirs'])


def add_heir(request, data, case_id):
    """Append an heir. Returns the case, or None without one.

    Raises StaleCase, or FieldErrors for a bad field, no deceased yet (`case`) or a full
    list (`heirs`). Nothing is stored in any of those.
    """
    current = _live(request, case_id)
    if current is None:
        return None
    if current['deceased'] is None:
        raise FieldErrors({'case': 'deceased_required'})
    fields = clean_heir(data)
    if len(current['heirs']) >= MAX_HEIRS:
        raise FieldErrors({'heirs': 'limit'})
    heir = {'id': uuid.uuid4().hex, **fields, 'gender': RELATIONSHIPS[fields['relationship']]}
    return _save(request, heirs=[*current['heirs'], heir])


def update_heir(request, heir_id, data, case_id):
    """Replace an heir's fields, keeping its id and place. Gender is derived again.

    Raises StaleCase, HeirNotFound or FieldErrors. Returns None without a live case.
    """
    current = _live(request, case_id)
    if current is None:
        return None
    if not any(heir['id'] == heir_id for heir in current['heirs']):
        raise HeirNotFound(current)
    fields = clean_heir(data)
    heirs = [
        {'id': heir_id, **fields, 'gender': RELATIONSHIPS[fields['relationship']]}
        if heir['id'] == heir_id else heir
        for heir in current['heirs']
    ]
    return _save(request, heirs=heirs)


def remove_heir(request, heir_id, case_id):
    """Remove an heir. Raises StaleCase or HeirNotFound. Returns None without a live case."""
    current = _live(request, case_id)
    if current is None:
        return None
    heirs = [heir for heir in current['heirs'] if heir['id'] != heir_id]
    if len(heirs) == len(current['heirs']):
        raise HeirNotFound(current)
    return _save(request, heirs=heirs)


def touch(request):
    """Refresh the idle expiry. Only anonymous sessions get the short one."""
    if not request.user.is_authenticated:
        request.session.set_expiry(settings.ANONYMOUS_CASE_IDLE_SECONDS)
