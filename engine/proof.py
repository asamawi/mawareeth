"""The proof and the scholars' table of one estate: pure data, no labels and no language.

A port of `calc/proof.py` (`build` and `build_table`). The shapes are the same, so a parity test can
hold the two together. Whoever shows a proof attaches the labels; this module only holds codes.
"""
from fractions import Fraction

VERSION = 1

FIXED = 'fixed'
FIXED_AND_RESIDUARY = 'fixed_and_residuary'
RESIDUARY = 'residuary'
BLOCKED = 'blocked'
GRANDFATHER_BEST_OPTION = 'grandfather_best_option'
MUSHTARAKA = 'mushtaraka'
AKDARIYYA = 'akdariyya'
# The rules that carry a prescribed fraction.
FRACTION_RULES = (FIXED, FIXED_AND_RESIDUARY)
# The rules a verse can stand behind: the heir's own entitlement, not a pooled or blocked one.
VERSE_RULES = (FIXED, FIXED_AND_RESIDUARY, RESIDUARY)

VERSES = {
    'father': '4:11', 'mother': '4:11', 'son': '4:11', 'daughter': '4:11',
    'husband': '4:12', 'wife': '4:12', 'maternal_brother': '4:12', 'maternal_sister': '4:12',
    'brother': '4:176', 'sister': '4:176', 'paternal_brother': '4:176', 'paternal_sister': '4:176',
}
# The citation key a verse code becomes in a Result.
CITATION_KEYS = {'4:11': 'quran_4_11', '4:12': 'quran_4_12', '4:176': 'quran_4_176'}

RELATIONSHIPS = (
    'father', 'mother', 'husband', 'wife', 'son', 'daughter', 'son_of_son', 'daughter_of_son', 'grandfather',
    'paternal_grandmother', 'maternal_grandmother', 'brother', 'sister', 'paternal_brother', 'paternal_sister',
    'maternal_brother', 'maternal_sister', 'son_of_brother', 'son_of_paternal_brother', 'uncle', 'paternal_uncle',
    'son_of_uncle', 'son_of_paternal_uncle',
)


def fraction_body(value):
    value = Fraction(value)
    return {'numerator': value.numerator, 'denominator': value.denominator}


def build(school, heirs, steps):
    """Assemble the proof.

    `heirs` is a list of (reference, relationship, basis, final share) in the order the proof should
    list them. A basis is the dict recorded for the heir: rule, condition, blocked_by, fraction,
    school_rule and option. `steps` holds base, awl, radd and correction as whole numbers or None, and
    unallocated as a fraction or None."""
    entries = []
    for reference, relationship, basis, share in heirs:
        if basis is None:
            raise ValueError(f'No basis was recorded for a {relationship}')
        if relationship not in RELATIONSHIPS:
            raise ValueError(f'Unknown relationship: {relationship}')
        rule = basis['rule']
        entries.append({
            'heir': reference,
            'relationship': relationship,
            'rule': rule,
            'condition': basis['condition'],
            'blocked_by': basis['blocked_by'],
            'fraction': None if basis['fraction'] is None else fraction_body(basis['fraction']),
            'share': fraction_body(share),
            'verse': VERSES.get(relationship) if rule in VERSE_RULES else None,
            'school_rule': basis['school_rule'],
            'option': basis['option'],
        })
    listed = [{'step': 'base', 'value': steps['base']}]
    for name in ('awl', 'radd', 'correction'):
        if steps[name] is not None:
            listed.append({'step': name, 'value': steps[name]})
    if steps['unallocated'] is not None:
        listed.append({'step': 'unallocated', 'value': fraction_body(steps['unallocated'])})
    return {
        'version': VERSION,
        'madhab': school,
        'school_rules': sorted({entry['school_rule'] for entry in entries if entry['school_rule']}),
        'heirs': entries,
        'steps': listed,
    }


def build_table(columns, groups, heir_ids, prescribed, blocked):
    """The scholars' table of a single-death calculation.

    `columns` lists, in legacy order, dicts of code, total, values (heir id to the whole number) and
    merged (indexes of the groups whose cell is one merged group total). `groups` lists each group's
    member ids in row order; heirs of `heir_ids` in no group, and blocked heirs, follow. `prescribed`
    maps an id to its fixed fraction or None for a residuary. `group_span` covers the group's
    prescribed cell: its row count first, then 0. It is merged only when every member has the same
    prescribed share. Every cell is {'value', 'span'}; blocked heirs have empty cells (value None)."""
    order = []
    shared = set()
    for index, members in enumerate(groups):
        if len({prescribed.get(heir) for heir in members}) == 1:
            shared.add(index)
        for position, heir in enumerate(members):
            if heir not in blocked:
                order.append((heir, index, position, len(members)))
    seen = {heir for heir, *_rest in order}
    rest = [heir for heir in heir_ids if heir not in seen and heir not in blocked]
    rows = []
    for heir, index, position, size in order:
        cells = []
        for column in columns:
            merge = index in column['merged'] and size > 1
            cells.append({'value': column['values'][heir],
                          'span': (size if position == 0 else 0) if merge else 1})
        group_span = (size if position == 0 else 0) if index in shared else 1
        rows.append((heir, group_span, cells))
    for heir in rest:
        rows.append((heir, 1, [{'value': column['values'][heir], 'span': 1} for column in columns]))
    for heir in heir_ids:
        if heir in blocked:
            rows.append((heir, 1, [{'value': None, 'span': 1} for _column in columns]))
    return {
        'columns': [{'code': column['code'], 'total': column['total']} for column in columns],
        'rows': [{
            'heir': heir,
            'blocked': heir in blocked,
            'group_span': group_span,
            'prescribed': None if prescribed.get(heir) is None else fraction_body(prescribed[heir]),
            'cells': cells,
        } for heir, group_span, cells in rows],
    }


def build_layered(school, entries, final):
    """Combine unchanged per-death proofs with fractions of the first estate."""
    from math import lcm
    return {
        'version': 2,
        'people': [],
        'madhab': school,
        'layers': [dict(layer, estate=fraction_body(layer['estate']))
                   for layer in sorted(entries, key=lambda layer: layer['order'])],
        'final': [{'heir': pk, 'fraction': fraction_body(share)}
                  for pk, share in final.items()],
        'base': lcm(*(share.denominator for share in final.values())),
    }


def build_layered_table(entries, tables, final, people):
    """Combine layer parts without reducing the jami'a; fail closed on any disagreement."""
    from math import gcd

    identities = people
    try:
        if len(entries) != len(tables) or any(table is None for table in tables):
            raise ValueError('Missing layer table')
        people = list(dict.fromkeys(identities[row] for row in identities))
        running, unallocated, jamia = {}, 0, 1
        combined = []
        for index, (layer, table) in enumerate(zip(entries, tables)):
            columns, rows = table['columns'], table['rows']
            if not columns or any(len(row['cells']) != len(columns) for row in rows):
                raise ValueError('Invalid layer table dimensions')
            for c in range(len(columns)):
                owner = 0
                while owner < len(rows):
                    span = rows[owner]['cells'][c]['span']
                    if not isinstance(span, int) or span < 1 or owner + span > len(rows):
                        raise ValueError('Invalid layer cell span')
                    if any(rows[r]['cells'][c]['span'] != 0 for r in range(owner + 1, owner + span)):
                        raise ValueError('Invalid covered layer cell')
                    owner += span
            base = columns[-1]['total']
            parts = {}
            rows = table['rows']
            for start, row in enumerate(rows):
                cell = row['cells'][-1]
                if cell['span'] == 0:
                    continue
                span = cell['span']
                value = cell['value'] or 0
                if value % span:
                    raise ValueError('Nonintegral layer parts')
                for member in rows[start:start + span]:
                    person = identities[member['heir']]
                    parts[person] = parts.get(person, 0) + value // span
            expected = {}
            for entry in layer['proof']['heirs']:
                person = identities[entry['heir']]
                share = entry['share']
                expected[person] = expected.get(person, 0) + Fraction(share['numerator'], share['denominator'])
            if any(Fraction(parts.get(person, 0), base) != expected.get(person, 0)
                   for person in set(parts) | set(expected)):
                raise ValueError('Layer parts disagree with proof shares')
            remainder = base - sum(parts.values())
            if remainder < 0:
                raise ValueError('Negative layer remainder')
            p = None if index == 0 else running.pop(layer['heir'], 0)
            g = None if index == 0 else gcd(p, base)
            old = 1 if index == 0 or p == 0 else base // g
            new = 1 if index == 0 else p // g
            relation = None if index == 0 else ('no_share' if p == 0 else
                       'tamathul' if p % base == 0 else 'tawafuq' if g > 1 else 'tabayun')
            jamia = base if index == 0 else jamia * old
            running = {person: value * old for person, value in running.items()}
            for person, value in parts.items():
                running[person] = running.get(person, 0) + value * new
            unallocated = unallocated * old + remainder * new
            combined.append({
                'order': layer['order'], 'heir': layer['heir'], 'table': table,
                'p': p, 'base': base, 'gcd': g, 'old_multiplier': old,
                'new_multiplier': new, 'relation': relation, 'jamia': jamia,
                'parts': [{'heir': person, 'value': running.get(person, 0)} for person in people],
                'unallocated': unallocated,
                'unallocated_cells': [max(0, column['total'] - sum(
                    row['cells'][c]['value'] or 0 for row in rows if row['cells'][c]['span'] > 0))
                    for c, column in enumerate(table['columns'])],
            })
        if any(value and person not in people for person, value in final.items()):
            raise ValueError('Final person missing from table')
        if any(Fraction(running.get(person, 0), jamia) != final.get(person, 0) for person in people):
            raise ValueError('Final parts disagree with final fractions')
        if Fraction(unallocated, jamia) != 1 - sum(final.values()):
            raise ValueError('Unallocated parts disagree with final remainder')
        return {'layers': combined, 'rows': [{'heir': person} for person in people],
                'unallocated': any(layer['unallocated'] for layer in combined)}
    except (ValueError, KeyError, TypeError, IndexError, ZeroDivisionError):
        return None
