"""Strict readers shared by every contract parser. Each raises ContractError('invalid_contract', ...)."""
import datetime
import math
import re
from fractions import Fraction

from .codes import CONTRACT_VERSIONS
from .errors import ContractError

MAX_SAFE = 2 ** 53 - 1
ID_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
SNAKE_RE = re.compile(r'^[a-z][a-z0-9_]*$')
DATE_RE = re.compile(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
CURRENCY_RE = re.compile(r'^[A-Z]{3}$')
LANG_RE = re.compile(r'^[a-z]{2,3}(-[A-Za-z0-9]+)*$')


def fail(path, message, code='invalid_contract'):
    raise ContractError(code, f'{path}: {message}')


def check_version(data, key, contract):
    """Reject a non-object, a missing or unknown version, before any other key is looked at."""
    if not isinstance(data, dict):
        fail(contract, 'must be an object')
    version = data.get(key)
    if key not in data:
        fail(contract, f'{key} is required')
    if isinstance(version, bool) or not isinstance(version, int):
        fail(f'{contract}.{key}', 'must be an integer')
    if version != CONTRACT_VERSIONS[contract]:
        fail(f'{contract}.{key}', f'{version} is not supported', 'unsupported_version')


def obj(value, path, keys):
    """An object with exactly these keys: unknown and missing keys are both rejected."""
    if not isinstance(value, dict):
        fail(path, 'must be an object')
    extra = sorted(set(value) - set(keys))
    missing = [k for k in keys if k not in value]
    if extra:
        fail(path, f'unknown key {extra[0]!r}')
    if missing:
        fail(path, f'missing key {missing[0]!r}')
    return value


def array(value, path):
    if not isinstance(value, list):
        fail(path, 'must be an array')
    return value


def integer(value, path, minimum=None, maximum=None):
    if isinstance(value, bool) or not isinstance(value, int):
        fail(path, 'must be an integer')
    if abs(value) > MAX_SAFE:
        fail(path, 'is outside the safe integer range')
    if minimum is not None and value < minimum:
        fail(path, f'must be at least {minimum}')
    if maximum is not None and value > maximum:
        fail(path, f'must be at most {maximum}')
    return value


def boolean(value, path):
    if not isinstance(value, bool):
        fail(path, 'must be a boolean')
    return value


def string(value, path, nonempty=False):
    if not isinstance(value, str):
        fail(path, 'must be a string')
    if nonempty and not value.strip():
        fail(path, 'must not be empty')
    return value


def code(value, path, vocabulary):
    if not isinstance(value, str) or value not in vocabulary:
        fail(path, 'is not a known code')
    return value


def snake(value, path):
    if not isinstance(value, str) or not SNAKE_RE.fullmatch(value):
        fail(path, 'must be a lowercase snake_case code')
    return value


def ident(value, path):
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        fail(path, 'must be a stable id')
    return value


def iso_date(value, path):
    if not isinstance(value, str) or not DATE_RE.fullmatch(value):
        fail(path, 'must be a YYYY-MM-DD date')
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        fail(path, 'must be a real date')
    return value


def pattern(value, path, regex, what):
    if not isinstance(value, str) or not regex.fullmatch(value):
        fail(path, f'must be {what}')
    return value


def nullable(reader, value, path, *args):
    return None if value is None else reader(value, path, *args)


def fraction(value, path):
    """`{numerator, denominator}` -> Fraction. Never normalises: an unreduced fraction is rejected."""
    obj(value, path, ('numerator', 'denominator'))
    numerator = integer(value['numerator'], f'{path}.numerator', 0)
    denominator = integer(value['denominator'], f'{path}.denominator', 1)
    if math.gcd(numerator, denominator) != 1:
        fail(path, 'must be a reduced fraction')
    return Fraction(numerator, denominator)


def dump_fraction(value):
    return {'numerator': value.numerator, 'denominator': value.denominator}


def unique(items, path, what):
    seen = set()
    for item in items:
        if item in seen:
            fail(path, f'duplicate {what} {item!r}')
        seen.add(item)
