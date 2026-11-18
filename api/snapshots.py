"""Versioned snapshot bridges with an operator-controlled writer switch."""
from decimal import Decimal

from engine.contracts import (ContractError, basis_for_snapshot, dump_basis, dump_family,
                              parse_family, resolve_basis)

READ_VERSIONS = (1, 2)
WRITE_VERSION = 2


def write_version():
    from django.conf import settings
    return settings.SNAPSHOT_WRITE_VERSION


def default_name(created_at):
    from zoneinfo import ZoneInfo
    from babel.dates import format_date
    from django.conf import settings
    from django.utils import timezone, translation
    from django.utils.translation import gettext
    from i18n import locale_config
    with translation.override(settings.LANGUAGE_CODE):
        date = format_date(timezone.localtime(created_at, ZoneInfo(settings.TIME_ZONE)).date(), format='long',
                           locale=locale_config(settings.LANGUAGE_CODE)['babel_locale'])
        return (gettext('Estate of %(deceased)s, %(date)s') % {
            'deceased': gettext('the deceased'), 'date': date})[:100]


def lossless_v1(snapshot):
    import json
    from api import anonymous_case
    from presentation.money import PresentationError
    try:
        resolved = basis_for_snapshot(snapshot, {})
        original = {**snapshot, 'madhab': resolved.school}
        exported = anonymous_case.export_snapshot(decode(1, snapshot, 'snapshot', ''))
        canonical = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'))
        if canonical(exported) != canonical(original):
            return None
        encoded = encode_v2(exported)
        decode(2, encoded, 'snapshot', '')
        return encoded
    except (SnapshotError, ContractError, PresentationError, anonymous_case.FieldErrors,
            ValueError, TypeError, KeyError, AttributeError):
        return None


class SnapshotError(Exception):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def ensure_writable(case):
    """Refuse lineage (edges or died-before persons) while the snapshot writer is 1, which cannot store it.

    Takes a session case, an exported snapshot or a Case; raises `unsupported_content` and writes nothing."""
    if write_version() == 1 and (case.get('edges') or case.get('died_before')):
        raise SnapshotError('unsupported_content', 'Snapshot cannot be represented losslessly.')


def session_version(stored):
    return stored.get('schema_version', 1)


def encode_v2(snapshot_v1):
    from api import anonymous_case
    from calc.adapters import family_from_session

    resolved = basis_for_snapshot(snapshot_v1, {})
    case = anonymous_case.read_snapshot(snapshot_v1, 'snapshot', '')
    family_case = {**case, 'deceased': case['deceased'] or {'estate': None}}
    family, _ = family_from_session(family_case)
    return {'deceased': {'gender': case['deceased']['gender']} if case['deceased'] else None,
            'family': dump_family(family), 'basis': dump_basis(resolved.basis)}


def decode(version, snapshot, case_id, started_at):
    from api import anonymous_case
    from presentation.money import PresentationError

    if type(version) is not int or version not in READ_VERSIONS:
        raise SnapshotError('unsupported_version', 'Unsupported snapshot version.')
    if not isinstance(snapshot, dict):
        raise SnapshotError('invalid_snapshot', 'Expected a snapshot object.')
    if version == 1:
        try:
            resolved = basis_for_snapshot(snapshot, {})
        except ContractError as error:
            raise SnapshotError(error.code, str(error)) from error
        return anonymous_case.read_snapshot({**snapshot, 'madhab': resolved.school}, case_id, started_at)
    if set(snapshot) != {'deceased', 'family', 'basis'}:
        raise SnapshotError('invalid_snapshot', 'Invalid snapshot keys.')
    deceased = snapshot['deceased']
    if deceased is not None and (not isinstance(deceased, dict) or set(deceased) != {'gender'} or
                                 deceased['gender'] not in ('male', 'female')):
        raise SnapshotError('invalid_snapshot', 'Invalid deceased.')
    try:
        family = parse_family(snapshot['family'])
    except ContractError as error:
        raise SnapshotError('invalid_snapshot', str(error)) from error
    try:
        resolved = resolve_basis(snapshot['basis'], {})
    except ContractError as error:
        raise SnapshotError(error.code, str(error)) from error

    def unsupported():
        raise SnapshotError('unsupported_content', 'Snapshot cannot be represented losslessly.')

    if family.answers or family.gifts or family.bequests:
        unsupported()
    amount, currency = family.estate.amount_minor, family.estate.currency
    if currency is not None and (currency.code != 'SAR' or not currency.explicit):
        unsupported()
    if amount is not None and deceased is None:
        unsupported()
    people = {p.id: p for p in family.persons}
    seen = set()

    def rows(estate):
        result = []
        for heir in estate.heirs:
            person = people[heir.person]
            alias = person.id in seen
            result.append({'id': f'{person.id}~{estate.order}' if alias else person.id,
                           'relationship': heir.relationship, 'gender': person.gender, 'name': person.name,
                           **({'same_as': person.id} if alias else {})})
        seen.update(h.person for h in estate.heirs)
        return result

    value = {'madhab': resolved.school, 'deceased': None, 'heirs': rows(family.estates[0]), 'deaths': []}
    died_before = [{'id': p.id, 'gender': p.gender, 'name': p.name, 'relationship': p.relationship}
                   for p in family.persons if p.status == 'died_before_or_with']
    if died_before:
        value['died_before'] = died_before
    if family.edges:
        value['edges'] = [{'kind': e.kind, 'from': e.from_, 'to': e.to} for e in family.edges]
    if deceased is not None:
        estate_text = None
        if amount is not None:
            estate_text = format(Decimal(amount).scaleb(-2), 'f').rstrip('0').rstrip('.')
        value['deceased'] = {**deceased, 'estate': estate_text}
    for estate in family.estates[1:]:
        value['deaths'].append({'heir_id': estate.deceased, 'order': estate.order,
                                'gender': people[estate.deceased].gender, 'heirs': rows(estate)})
    case = anonymous_case.read_snapshot(value, case_id, started_at)
    try:
        if encode_v2(anonymous_case.export_snapshot(case)) != snapshot:
            unsupported()
    except (ValueError, KeyError, ContractError, PresentationError, anonymous_case.FieldErrors):
        unsupported()
    return case
