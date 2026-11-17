"""The Locale registry and the fiqh term catalogs, read from i18n/locales.json and i18n/terms/.

This package only parses (through the shared catalog contract). Completeness and placeholder
checks belong to the validator in web/scripts/i18n.mjs.
"""
import json
from functools import lru_cache
from pathlib import Path

from engine.contracts.catalog import parse_catalog

ROOT = Path(__file__).resolve().parent


@lru_cache(maxsize=None)
def registry():
    with open(ROOT / 'locales.json', encoding='utf-8') as handle:
        return json.load(handle)


def published_codes():
    return [entry['code'] for entry in registry()['locales'] if entry['published']]


def locale_config(code):
    for entry in registry()['locales']:
        if entry['code'] == code:
            return entry
    raise KeyError(code)


def default_locale():
    return registry()['default_locale']


def fallback_locale():
    return registry()['fallback_locale']


def django_languages():
    return [(entry['code'], entry['own_name']) for entry in registry()['locales'] if entry['published']]


@lru_cache(maxsize=None)
def catalog(code):
    with open(ROOT / 'terms' / f'{code}.json', encoding='utf-8') as handle:
        return parse_catalog(json.load(handle))


def resolve_locale(tag):
    """The registered Locale for a language tag: its base language, else the fallback Locale."""
    base = str(tag or '').lower().replace('_', '-').split('-')[0]
    return base if base in published_codes() else fallback_locale()


def term(key, locale):
    """The text of a fiqh term in a Locale. Raises KeyError for an unknown key."""
    return catalog(resolve_locale(locale)).terms[key].text
