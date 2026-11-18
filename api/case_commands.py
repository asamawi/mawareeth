"""The one Case command service.

Every input mutation of the session Case goes through `execute`. The caller has already taken the
session row lock (CaseWriteLockMiddleware), so the checks and the write below see one Case. A
command checks the Case id and `expected_revision`, runs on a copy-protected session, and on
success bumps the revision by exactly one. On any failure the stored Case, its revision and its
`changed_at` are put back byte for byte. This module is the only place that bumps a revision.

Names and amounts are never logged here.
"""
import copy
import json

from django.utils import timezone

from api import anonymous_case
from engine.queries import delete_impact
from calc.adapters import family_from_session


class Conflict(Exception):
    """The Case is no longer the one the caller meant (another id or another revision)."""

    def __init__(self, case):
        super().__init__('That case is no longer the current one.')
        self.case = case


class InvalidRevision(Exception):
    """expected_revision is missing or is not an integer."""


class CascadeUnconfirmed(Exception):
    """The command would drop other people or estates and the caller has not confirmed it."""

    def __init__(self, impact, case):
        super().__init__('The change needs confirmation.')
        self.impact = impact
        self.case = case


class OverCapacity(Exception):
    """The command would put more than MAX_HEIRS Heirs into a layer."""


class InvalidInput(Exception):
    """A bulk item broke a rule. `errors` maps the item index (a string) to its field errors."""

    def __init__(self, errors):
        super().__init__('Invalid input.')
        self.errors = errors


class InvalidSnapshot(Exception):
    """A restore snapshot is not exactly what the Case would export."""


def valid_revision(value):
    return type(value) is int and value >= 1


def _restore(request, backup):
    if request.session.get(anonymous_case.SESSION_KEY) != backup:
        request.session[anonymous_case.SESSION_KEY] = backup


def execute(request, command, *, case_id, expected_revision, run, impact=None, confirm=False):
    """Run one command against the live Case and return the whole Case at its new revision.

    Returns None when there is no live Case (none, or an expired guest Case). `run()` mutates the
    session through `anonymous_case`; `impact(case)` returns {'persons': [...], 'estates': [...]}
    or None, and a non-empty impact needs `confirm`. Raises Conflict, InvalidRevision,
    CascadeUnconfirmed, or whatever `run` raises, after the stored Case has been restored.
    """
    current = anonymous_case.get(request)
    if current is None:
        return None
    if case_id is not None and case_id != current['id']:
        raise Conflict(current)
    if not valid_revision(expected_revision):
        raise InvalidRevision()
    if expected_revision != current['revision']:
        raise Conflict(current)
    backup = copy.deepcopy(request.session.get(anonymous_case.SESSION_KEY))
    try:
        if impact is not None and not confirm:
            found = impact(current)
            if found and (found['persons'] or found['estates']):
                raise CascadeUnconfirmed(found, current)
        run()
        stored = dict(request.session[anonymous_case.SESSION_KEY])
        stored['revision'] = current['revision'] + 1
        stored['changed_at'] = timezone.now().isoformat()
        request.session[anonymous_case.SESSION_KEY] = stored
        return anonymous_case.get(request)
    except BaseException:
        _restore(request, backup)
        raise


# Impact

def _layer_order(case, row_id):
    for key, _, rows in anonymous_case._layers(case):
        if any(row['id'] == row_id for row in rows):
            return 1 if key is None else next(d['order'] for d in case['deaths'] if d['heir_id'] == key)
    return None


def remove_impact(case, heir_id):
    """What removing this row would drop besides the row's own person, from the engine."""
    rows = anonymous_case._rows(case)
    row = rows.get(heir_id)
    if row is None or case['deceased'] is None:
        return None
    person = anonymous_case._person(row)
    family, _ = family_from_session(case)
    found = delete_impact(family, person, estate=_layer_order(case, heir_id))
    return {'persons': [p for p in found.persons if p != person], 'estates': list(found.estates)}


def unmark_impact(case, heir_id):
    """The people and later estates that un-marking a death would drop, by a before/after diff."""
    rows = anonymous_case._rows(case)
    person = anonymous_case._person(rows[heir_id]) if heir_id in rows else heir_id
    death = next((d for d in case['deaths'] if d['heir_id'] == person), None)
    if death is None:
        return None
    owner = {row_id: anonymous_case._person(row) for row_id, row in rows.items()}
    work = copy.deepcopy(case)
    target = next(d for d in work['deaths'] if d['heir_id'] == person)
    removed = {r['id'] for r in target['heirs']}
    old = anonymous_case._rows(work)
    work['deaths'].remove(target)
    anonymous_case._remove_rows(work, removed, old)
    surviving = {owner[row_id] for row_id in anonymous_case._rows(work)}
    persons = sorted(set(owner.values()) - surviving)
    kept = {d['heir_id'] for d in case['deaths'] if d['heir_id'] in surviving}
    estates = sorted(d['order'] for d in case['deaths'] if d['heir_id'] != person and d['heir_id'] not in kept)
    return {'persons': persons, 'estates': estates}


# Bulk add and restore

def bulk_add(request, items, case_id, layer=None):
    """Add 1 to MAX_HEIRS rows to one layer, all or nothing. Raises OverCapacity or InvalidInput."""
    case = anonymous_case._live(request, case_id)
    if case is None:
        return None
    if not isinstance(items, list) or not items:
        raise InvalidInput({'heirs': {'heirs': 'invalid'}})
    if len(items) > anonymous_case.MAX_HEIRS:
        raise OverCapacity()
    if layer is not None and not isinstance(layer, str):
        raise anonymous_case.HeirNotFound(case)
    selected = next((entry for entry in anonymous_case._layers(case) if entry[0] == layer), None)
    if selected is None:
        raise anonymous_case.HeirNotFound(case)
    if len(selected[2]) + len(items) > anonymous_case.MAX_HEIRS:
        raise OverCapacity()
    errors = {}
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            errors[str(index)] = {'item': 'invalid'}
            continue
        try:
            anonymous_case._add_heir(
                case, {'relationship': item.get('relationship'), 'name': item.get('name')}, layer)
        except anonymous_case.FieldErrors as invalid:
            errors[str(index)] = invalid.errors
    if errors:
        raise InvalidInput(errors)
    return anonymous_case._store_case(request, case)


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def restore(request, snapshot, case_id):
    """Replace the inputs with an exported snapshot, keeping the Case id, started_at and heir ids."""
    case = anonymous_case._live(request, case_id)
    if case is None:
        return None
    if not isinstance(snapshot, dict):
        raise InvalidSnapshot()
    try:
        value = anonymous_case.read_snapshot(snapshot, case['id'], case['started_at'])
        same = _canonical(anonymous_case.export_snapshot(value)) == _canonical(snapshot)
    except (TypeError, ValueError, KeyError):
        raise InvalidSnapshot()
    if not same:
        raise InvalidSnapshot()
    return anonymous_case._store_case(request, value)
