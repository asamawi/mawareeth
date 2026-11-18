"""Catalog contract: the terms of one Locale, each with a review state and its declared placeholders."""
import re
from dataclasses import dataclass
from typing import Dict

from . import codes
from .values import LANG_RE, check_version, code, fail, obj, pattern, snake, string

KEY_RE = re.compile(r'^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$')
PLACEHOLDER_RE = re.compile(r'\{([^{}]*)\}')


@dataclass(frozen=True)
class Term:
    text: str
    review: str
    placeholders: Dict[str, str]


@dataclass(frozen=True)
class Catalog:
    schema_version: int
    locale: str
    terms: Dict[str, Term]


def parse_catalog(data):
    check_version(data, 'schema_version', 'catalog')
    obj(data, 'catalog', ('schema_version', 'locale', 'terms'))
    locale = pattern(data['locale'], 'catalog.locale', LANG_RE, 'a locale tag')
    if not isinstance(data['terms'], dict):
        fail('catalog.terms', 'must be an object')
    terms = {}
    for key, item in data['terms'].items():
        path = f'catalog.terms.{key}'
        pattern(key, path, KEY_RE, 'a dotted snake_case key')
        obj(item, path, ('text', 'review', 'placeholders'))
        text = string(item['text'], f'{path}.text', True)
        if not isinstance(item['placeholders'], dict):
            fail(f'{path}.placeholders', 'must be an object')
        placeholders = {snake(n, f'{path}.placeholders'): code(t, f'{path}.placeholders.{n}', codes.PARAM_TYPES)
                        for n, t in item['placeholders'].items()}
        if set(PLACEHOLDER_RE.findall(text)) != set(placeholders):
            fail(path, 'the {placeholders} in the text must equal the declared placeholders')
        terms[key] = Term(text, code(item['review'], f'{path}.review', codes.REVIEW_STATES), placeholders)
    return Catalog(data['schema_version'], locale, terms)


def dump_catalog(c):
    return {'schema_version': c.schema_version, 'locale': c.locale,
            'terms': {k: {'text': t.text, 'review': t.review, 'placeholders': dict(t.placeholders)}
                      for k, t in c.terms.items()}}
