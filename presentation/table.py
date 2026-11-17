"""The scholars' table of an answer: the engine's integers and fractions, each with its Babel text."""
from fractions import Fraction

import i18n

from engine import thaw


def _num(fmt, value):
    """A numeric leaf: its exact value unchanged beside its text, left-to-right."""
    if value is None:
        return None
    if isinstance(value, dict):
        return {'value': dict(value), 'text': fmt.fraction(Fraction(value['numerator'], value['denominator'])),
                'dir': 'ltr'}
    return {'value': value, 'text': fmt.integer(value), 'dir': 'ltr'}


def _single(fmt, table):
    return {
        'columns': [{'code': c['code'], 'label': i18n.term(f"table.column.{c['code']}", fmt.locale),
                     'total': _num(fmt, c['total'])} for c in table['columns']],
        'rows': [{'heir': r['heir'], 'blocked': r['blocked'], 'group_span': r['group_span'],
                  'prescribed': _num(fmt, r['prescribed']),
                  'cells': [{'value': _num(fmt, c['value']), 'span': c['span']} for c in r['cells']]}
                 for r in table['rows']],
    }


def present_table(fmt, table):
    """The table of one estate or of successive estates, or None when the engine gave none."""
    table = thaw(table)
    if table is None:
        return None
    if 'layers' not in table:
        return _single(fmt, table)
    return {
        'layers': [{
            'order': layer['order'], 'heir': layer['heir'], 'table': _single(fmt, layer['table']),
            'p': _num(fmt, layer['p']), 'base': _num(fmt, layer['base']), 'gcd': _num(fmt, layer['gcd']),
            'old_multiplier': _num(fmt, layer['old_multiplier']), 'new_multiplier': _num(fmt, layer['new_multiplier']),
            'relation': layer['relation'], 'jamia': _num(fmt, layer['jamia']),
            'parts': [{'heir': part['heir'], 'value': _num(fmt, part['value'])} for part in layer['parts']],
            'unallocated': _num(fmt, layer['unallocated']),
            'unallocated_cells': [_num(fmt, cell) for cell in layer['unallocated_cells']],
        } for layer in table['layers']],
        'rows': [{'heir': row['heir']} for row in table['rows']],
        'unallocated': table['unallocated'],
    }
