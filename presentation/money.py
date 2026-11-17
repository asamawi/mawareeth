"""Money in integer minor units. Babel gives the currency precision; nothing here uses a float."""
import re
from decimal import Decimal
from fractions import Fraction

from babel import numbers

import i18n

MAX_SAFE = 2 ** 53 - 1
PLAIN_DECIMAL = re.compile(r'^[0-9]+(\.[0-9]+)?$')


class PresentationError(Exception):
    """A typed refusal of the presentation layer: `invalid_currency`, `invalid_amount`, `no_heirs` or
    `invalid_outcome`."""

    def __init__(self, code, detail=''):
        super().__init__(f'{code}: {detail}' if detail else code)
        self.code = code


def precision(code):
    """The number of decimals of a currency, or `invalid_currency` for a code Babel does not know."""
    if not isinstance(code, str) or code not in numbers.list_currencies():
        raise PresentationError('invalid_currency', str(code))
    return numbers.get_currency_precision(code)


def minor_units(text, code):
    """A decimal estate string as integer minor units. Raises `invalid_amount` for a value that is not a
    plain positive decimal or that has more decimals than the currency allows."""
    digits = precision(code)
    if not isinstance(text, str) or not PLAIN_DECIMAL.fullmatch(text):
        raise PresentationError('invalid_amount', 'not a plain decimal')
    whole, _dot, decimals = text.partition('.')
    if len(decimals) > digits:
        raise PresentationError('invalid_amount', f'{code} has {digits} decimals')
    value = int(whole + decimals.ljust(digits, '0'))
    if value <= 0 or value > MAX_SAFE:
        raise PresentationError('invalid_amount', 'out of range')
    return value


def default_currency(locale, preset=None):
    """The currency of a presentation that did not name one: the preset's, else the Locale's."""
    if preset is not None:
        return preset.default_currency
    return i18n.locale_config(i18n.resolve_locale(locale))['default_currency']


def round_minor(estate_minor, share):
    """floor(estate * share + 1/2) in exact integers: half-up, never a float."""
    share = Fraction(share)
    return (2 * estate_minor * share.numerator + share.denominator) // (2 * share.denominator)


def decimal_of(minor, digits):
    return Decimal(minor).scaleb(-digits)
