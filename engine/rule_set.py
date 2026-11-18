"""Rule sets: where the schools of law differ, as data the core reads (AD-17).

A School is a built-in rule set. A Country preset names a default School and overlays its own rule
values on that School's. The core never reads a school name to decide a position, except to refuse
Ja'fari, which it cannot calculate yet.
"""
from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping, Optional

from .contracts import codes
from .contracts.errors import ContractError
from .contracts.preset import parse_preset as parse_preset_contract

# rule key -> the values it accepts: a tuple of codes, or `bool`.
RULE_SCHEMA = {
    'grandfather_with_siblings': ('blocks', 'shares'),
    'mushtaraka': bool,
    'father_blocks_his_mother': bool,
    'malikiyya_disputed': bool,
    'radd_position': ('radd', 'radd_later_scholars'),
}
SETTING_SCHEMA = {}


def _invalid(detail):
    return ContractError('invalid_contract', detail)


def _check(values, schema, what):
    for key, value in values.items():
        if key not in schema:
            raise _invalid(f'{what}.{key}: is not a known {what} key')
        accepted = schema[key]
        if accepted is bool:
            if not isinstance(value, bool):
                raise _invalid(f'{what}.{key}: must be a boolean')
        elif not isinstance(value, str) or value not in accepted:
            raise _invalid(f'{what}.{key}: must be one of {", ".join(accepted)}')


@dataclass(frozen=True)
class RuleSet:
    """The positions one calculation follows. Immutable: `rules` and `settings` are read-only mappings."""
    school: str
    rules: Mapping[str, object]
    settings: Mapping[str, object]
    preset_id: Optional[str] = None
    preset_version: Optional[str] = None
    default_currency: Optional[str] = None

    def __post_init__(self):
        if not isinstance(self.school, str) or self.school not in codes.SCHOOLS:
            raise _invalid(f'rule_set.school: {self.school!r} is not a known school')
        rules, settings = dict(self.rules), dict(self.settings)
        _check(rules, RULE_SCHEMA, 'rules')
        _check(settings, SETTING_SCHEMA, 'settings')
        missing = [key for key in RULE_SCHEMA if key not in rules]
        if missing:
            raise _invalid(f'rules.{missing[0]}: is required')
        object.__setattr__(self, 'rules', MappingProxyType(rules))
        object.__setattr__(self, 'settings', MappingProxyType(settings))


def _school_rules(school):
    """The decisions of `calc/schools.py`, one rule value each."""
    return {
        'grandfather_with_siblings': 'blocks' if school == 'hanafi' else 'shares',
        'mushtaraka': school in ('maliki', 'shafii'),
        'father_blocks_his_mother': school in ('hanafi', 'maliki', 'shafii'),
        'malikiyya_disputed': school == 'maliki',
        'radd_position': 'radd_later_scholars' if school in ('maliki', 'shafii') else 'radd',
    }


def school_rule_set(school):
    """The built-in rule set of a School. An unknown School is an `invalid_contract` error."""
    if not isinstance(school, str) or school not in codes.SCHOOLS:
        raise _invalid(f'school: {school!r} is not a known school')
    return RuleSet(school, _school_rules(school), {})


def parse_preset(data):
    """A preset document as a RuleSet: contract-valid, only known keys and value types, and the
    preset's rules laid over the defaults of its `default_school`."""
    preset = parse_preset_contract(data)
    _check(preset.rules, RULE_SCHEMA, 'rules')
    _check(preset.settings, SETTING_SCHEMA, 'settings')
    rules = {**school_rule_set(preset.default_school).rules, **preset.rules}
    return RuleSet(preset.default_school, rules, preset.settings, preset.id, preset.version, preset.default_currency)
