"""Preset contract: a Country's rule choices, each with the citation that stands behind it."""
import re
from dataclasses import dataclass
from typing import Dict, Optional

from . import codes
from .values import (CURRENCY_RE, boolean, check_version, code, fail, integer, iso_date, nullable, obj, pattern, snake,
                     string)

ID_RE = re.compile(r'^[a-z]{2}$')


@dataclass(frozen=True)
class Preset:
    schema_version: int
    id: str
    version: str
    default_school: str
    default_currency: str
    settings: Dict[str, object]
    rules: Dict[str, object]
    citations: Dict[str, Dict[str, str]]
    reviewed_by: Optional[str]
    reviewed_on: Optional[str]


def _values(value, path):
    if not isinstance(value, dict):
        fail(path, 'must be an object')
    result = {}
    for key, item in value.items():
        snake(key, f'{path}.{key}')
        if isinstance(item, bool):
            result[key] = item
        elif isinstance(item, int):
            result[key] = integer(item, f'{path}.{key}')
        else:
            result[key] = snake(item, f'{path}.{key}')
    return result


def _citation(value, path):
    if not isinstance(value, dict):
        fail(path, 'must be an object')
    if set(value) == {'gap_school'}:
        return {'gap_school': code(value['gap_school'], f'{path}.gap_school', codes.SCHOOLS)}
    obj(value, path, ('statute_id', 'article', 'checked_on'))
    return {'statute_id': string(value['statute_id'], f'{path}.statute_id', True),
            'article': string(value['article'], f'{path}.article', True),
            'checked_on': iso_date(value['checked_on'], f'{path}.checked_on')}


def parse_preset(data):
    check_version(data, 'schema_version', 'preset')
    obj(data, 'preset', ('schema_version', 'id', 'version', 'default_school', 'default_currency', 'settings', 'rules',
                         'citations', 'reviewed_by', 'reviewed_on'))
    settings = _values(data['settings'], 'preset.settings')
    rules = _values(data['rules'], 'preset.rules')
    if not isinstance(data['citations'], dict):
        fail('preset.citations', 'must be an object')
    citations = {snake(k, 'preset.citations'): _citation(v, f'preset.citations.{k}') for k, v in data['citations'].items()}
    for key in rules:
        if key not in citations:
            fail('preset.rules', f'rule {key!r} has no citation')
    reviewed_by = nullable(string, data['reviewed_by'], 'preset.reviewed_by', True)
    reviewed_on = nullable(iso_date, data['reviewed_on'], 'preset.reviewed_on')
    if (reviewed_by is None) != (reviewed_on is None):
        fail('preset', 'reviewed_by and reviewed_on are both set or both null')
    return Preset(data['schema_version'], pattern(data['id'], 'preset.id', ID_RE, 'two lowercase letters'),
                  iso_date(data['version'], 'preset.version'),
                  code(data['default_school'], 'preset.default_school', codes.SCHOOLS),
                  pattern(data['default_currency'], 'preset.default_currency', CURRENCY_RE, 'a currency code'),
                  settings, rules, citations, reviewed_by, reviewed_on)


def dump_preset(p):
    return {
        'schema_version': p.schema_version, 'id': p.id, 'version': p.version, 'default_school': p.default_school,
        'default_currency': p.default_currency, 'settings': dict(p.settings), 'rules': dict(p.rules),
        'citations': {k: dict(v) for k, v in p.citations.items()},
        'reviewed_by': p.reviewed_by, 'reviewed_on': p.reviewed_on,
    }
