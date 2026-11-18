"""Basis contract (AD-18) and the one resolver every consumer uses."""
from dataclasses import dataclass
from typing import Mapping, Optional, Union

from . import codes
from .errors import ContractError
from .values import iso_date


@dataclass(frozen=True)
class CompareBasis:
    kind: str = 'compare'


@dataclass(frozen=True)
class SchoolBasis:
    school: str
    kind: str = 'school'


@dataclass(frozen=True)
class CountryBasis:
    preset_id: str
    preset_version: str
    kind: str = 'country'


Basis = Union[CompareBasis, SchoolBasis, CountryBasis]


@dataclass(frozen=True)
class ResolvedBasis:
    basis: Basis
    school: Optional[str]


def _bad(detail):
    raise ContractError('invalid_basis', f'basis: {detail}')


def _is_preset_id(value):
    return isinstance(value, str) and len(value) == 2 and 'a' <= value[0] <= 'z' and 'a' <= value[1] <= 'z'


def parse_basis(data):
    if not isinstance(data, dict):
        _bad('must be an object')
    kind = data.get('kind')
    if not isinstance(kind, str) or kind not in codes.BASIS_KINDS:
        _bad('unknown kind')
    keys = {'compare': {'kind'}, 'school': {'kind', 'school'}, 'country': {'kind', 'preset_id', 'preset_version'}}[kind]
    if set(data) != keys:
        _bad(f'a {kind} basis has exactly the keys {sorted(keys)}')
    if kind == 'compare':
        return CompareBasis()
    if kind == 'school':
        if not isinstance(data['school'], str) or data['school'] not in codes.SCHOOLS:
            _bad('unknown school')
        return SchoolBasis(data['school'])
    if not _is_preset_id(data['preset_id']):
        _bad('preset_id must be two lowercase letters')
    try:
        iso_date(data['preset_version'], 'preset_version')
    except ContractError:
        _bad('preset_version must be a YYYY-MM-DD date')
    return CountryBasis(data['preset_id'], data['preset_version'])


def dump_basis(basis):
    if isinstance(basis, CompareBasis):
        return {'kind': 'compare'}
    if isinstance(basis, SchoolBasis):
        return {'kind': 'school', 'school': basis.school}
    return {'kind': 'country', 'preset_id': basis.preset_id, 'preset_version': basis.preset_version}


def resolve_basis(data, presets: Mapping):
    """Validate a Basis and derive its School. `presets` maps (preset_id, version) to default_school."""
    basis = parse_basis(data)
    if isinstance(basis, SchoolBasis):
        return ResolvedBasis(basis, basis.school)
    if isinstance(basis, CountryBasis):
        school = presets.get((basis.preset_id, basis.preset_version))
        if school is None:
            raise ContractError('preset_unavailable', f'preset {basis.preset_id}@{basis.preset_version} is not available')
        return ResolvedBasis(basis, school)
    return ResolvedBasis(basis, None)


def basis_for_snapshot(snapshot, presets: Mapping):
    """The Basis of a saved snapshot. Only a snapshot with no `basis` key falls back to its legacy madhab."""
    if not isinstance(snapshot, dict):
        _bad('a snapshot must be an object')
    if 'basis' in snapshot:
        return resolve_basis(snapshot['basis'], presets)
    madhab = snapshot.get('madhab')
    if isinstance(madhab, str) and madhab in codes.SCHOOLS:
        return ResolvedBasis(SchoolBasis(madhab), madhab)
    return ResolvedBasis(CompareBasis(), None)
