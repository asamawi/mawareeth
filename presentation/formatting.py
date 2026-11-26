"""Every number a person reads is formatted here, once, by Babel with the Locale's numbering system."""
from dataclasses import dataclass, field
from decimal import Decimal
from fractions import Fraction

from babel import Locale, dates, numbers

import i18n

from .money import decimal_of, precision

PERCENT_PATTERN = '#,##0.0%'
DATE_PATTERN = 'yyyy-MM-dd HH:mm'


@dataclass(frozen=True)
class Formatter:
    """The formatting of one Locale. Built once per presentation; its only state is a memo of the
    texts it has produced, each a pure function of the Locale and the value."""
    locale: str
    direction: str
    babel: Locale
    numbering: str
    memo: dict = field(default_factory=dict, init=False, repr=False, compare=False)

    def integer(self, value):
        key = ('integer', type(value), str(value))
        text = self.memo.get(key)
        if text is None:
            text = self.memo[key] = numbers.format_decimal(
                value, format='0', locale=self.babel, numbering_system=self.numbering)
        return text

    def fraction(self, value):
        """The reduced `n/d`, each integer ungrouped."""
        value = Fraction(value)
        return f'{self.integer(value.numerator)}/{self.integer(value.denominator)}'

    def percent(self, value):
        """The exact share x 100, half-up to one decimal in Decimal; Babel never rounds it again."""
        value = Fraction(value)
        key = ('percent', value)
        text = self.memo.get(key)
        if text is None:
            tenths = (value.numerator * 2000 + value.denominator) // (2 * value.denominator)
            text = self.memo[key] = numbers.format_percent(
                Decimal(tenths).scaleb(-3), format=self.percent_pattern(), locale=self.babel,
                decimal_quantization=True, numbering_system=self.numbering)
        return text

    def percent_pattern(self):
        """The Locale's own percent pattern (its spacing and sign placement) with exactly one decimal."""
        pattern = self.babel.percent_formats[None].pattern
        return pattern.replace('#,##0', '#,##0.0', 1) if '#,##0' in pattern else PERCENT_PATTERN

    def kirat(self, value):
        """The exact share x 24, half-up to two decimals."""
        value = Fraction(value)
        key = ('kirat', value)
        text = self.memo.get(key)
        if text is None:
            hundredths = (value.numerator * 4800 + value.denominator) // (2 * value.denominator)
            text = self.memo[key] = numbers.format_decimal(
                Decimal(hundredths).scaleb(-2), format='#,##0.00', locale=self.babel,
                decimal_quantization=True, numbering_system=self.numbering)
        return text

    def money(self, minor, code):
        key = ('money', minor, code)
        text = self.memo.get(key)
        if text is None:
            text = self.memo[key] = numbers.format_currency(
                decimal_of(minor, precision(code)), code, locale=self.babel, numbering_system=self.numbering)
        return text


def formatter(locale):
    code = i18n.resolve_locale(locale)
    config = i18n.locale_config(code)
    return Formatter(code, config['direction'], Locale.parse(config['babel_locale']), config['numbering_system'])


def format_datetime(value, locale):
    """A date and time as `yyyy-MM-dd HH:mm` (the PDF's stamp) in the Locale."""
    return dates.format_datetime(value, format=DATE_PATTERN, locale=formatter(locale).babel)
