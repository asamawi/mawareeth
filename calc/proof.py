"""The proof of a result: why each heir gets what they get, as plain data.

The proof is built from stable codes and is language-free, so the same family under the
same school always gives the same proof. Every code has a label in each language in
LABELS; whoever shows a proof attaches the labels in the reader's language.

Everything here is pure: it works on the facts the engine hands it and never reads the
database. The engine records the facts, and `build()` puts them in one fixed shape.
"""
from fractions import Fraction

from django.utils.translation import gettext_lazy as _

from . import schools

VERSION = 1

# What an heir's share rests on.
FIXED = 'fixed'
FIXED_AND_RESIDUARY = 'fixed_and_residuary'
RESIDUARY = 'residuary'
BLOCKED = 'blocked'
GRANDFATHER_BEST_OPTION = 'grandfather_best_option'
MUSHTARAKA = 'mushtaraka'
AKDARIYYA = 'akdariyya'
RULES = (FIXED, FIXED_AND_RESIDUARY, RESIDUARY, BLOCKED, GRANDFATHER_BEST_OPTION, MUSHTARAKA, AKDARIYYA)
# The rules that carry a prescribed fraction.
FRACTION_RULES = (FIXED, FIXED_AND_RESIDUARY)
# The rules a verse can stand behind: the heir's own entitlement, not a pooled or blocked one.
VERSE_RULES = (FIXED, FIXED_AND_RESIDUARY, RESIDUARY)

CONDITIONS = (
    'male_descendant', 'female_descendant', 'descendant', 'no_descendant', 'siblings',
    'no_descendant_or_siblings', 'spouse_and_father', 'with_son', 'with_son_of_son', 'with_daughter',
    'with_brother', 'with_paternal_brother', 'with_grandfather', 'with_siblings', 'with_sister',
    'with_maternal_siblings', 'no_mother', 'single', 'several', 'estate_exhausted',
    'excluded_by_full_siblings',
)

BLOCKED_BY = (
    'male_descendant', 'descendant', 'father', 'grandfather', 'mother', 'son', 'daughters', 'brother',
    'sisters', 'paternal_brother', 'paternal_sister', 'son_of_brother', 'son_of_paternal_brother',
    'uncle', 'paternal_uncle', 'son_of_uncle',
)

OPTIONS = ('muqasama', 'third_of_remainder', 'sixth_of_estate')

SCHOOL_RULES = schools.SCHOOL_RULES

STEPS = ('base', 'awl', 'radd', 'correction', 'unallocated')

VERSES = {
    'father': '4:11', 'mother': '4:11', 'son': '4:11', 'daughter': '4:11',
    'husband': '4:12', 'wife': '4:12', 'maternal_brother': '4:12', 'maternal_sister': '4:12',
    'brother': '4:176', 'sister': '4:176', 'paternal_brother': '4:176', 'paternal_sister': '4:176',
}
VERSE_CODES = ('4:11', '4:12', '4:176')

# The relationship id of every engine heir class, as the API names them.
RELATIONSHIPS = {
    'Father': 'father', 'Mother': 'mother', 'Husband': 'husband', 'Wife': 'wife', 'Son': 'son',
    'Daughter': 'daughter', 'SonOfSon': 'son_of_son', 'DaughterOfSon': 'daughter_of_son',
    'GrandFather': 'grandfather', 'GrandMother': 'paternal_grandmother',
    'MaternalGrandMother': 'maternal_grandmother', 'Brother': 'brother', 'Sister': 'sister',
    'PaternalBrother': 'paternal_brother', 'PaternalSister': 'paternal_sister',
    'MaternalBrother': 'maternal_brother', 'MaternalSister': 'maternal_sister',
    'SonOfBrother': 'son_of_brother', 'SonOfPaternalBrother': 'son_of_paternal_brother',
    'Uncle': 'uncle', 'PaternalUncle': 'paternal_uncle', 'SonOfUncle': 'son_of_uncle',
    'SonOfPaternalUncle': 'son_of_paternal_uncle',
}

LABELS = {
    'rule': {
        FIXED: _("Fixed share"),
        FIXED_AND_RESIDUARY: _("Fixed share plus the remainder"),
        RESIDUARY: _("Residuary heir, who takes what is left"),
        BLOCKED: _("Blocked from inheriting"),
        GRANDFATHER_BEST_OPTION: _("The grandfather takes the best of his options with the siblings"),
        MUSHTARAKA: _("Shares the maternal siblings' third equally"),
        AKDARIYYA: _("The grandfather and the sister pool their shares and split them two to one"),
    },
    'condition': {
        'male_descendant': _("There is a male descendant"),
        'female_descendant': _("There is a female descendant and no male descendant"),
        'descendant': _("There is a descendant"),
        'no_descendant': _("There is no descendant"),
        'siblings': _("There are two or more siblings"),
        'no_descendant_or_siblings': _("There is no descendant and fewer than two siblings"),
        'spouse_and_father': _("A spouse and the father are present, so she takes a third of the remainder"),
        'with_son': _("Together with a son"),
        'with_son_of_son': _("Together with a son of a son"),
        'with_daughter': _("Together with one daughter"),
        'with_brother': _("Together with a full brother"),
        'with_paternal_brother': _("Together with a paternal brother"),
        'with_grandfather': _("Together with the grandfather"),
        'with_siblings': _("Together with full or paternal siblings"),
        'with_sister': _("Together with one full sister"),
        'with_maternal_siblings': _("Maternal brothers and sisters share one third"),
        'no_mother': _("There is no mother"),
        'single': _("Only one of this kind of heir"),
        'several': _("Several of this kind of heir share one fixed share"),
        'estate_exhausted': _("The fixed shares use up the whole estate"),
        'excluded_by_full_siblings': _("The full siblings take all that is left"),
    },
    'blocked_by': {
        'male_descendant': _("Blocked by a male descendant"),
        'descendant': _("Blocked by a descendant"),
        'father': _("Blocked by the father"),
        'grandfather': _("Blocked by the grandfather"),
        'mother': _("Blocked by the mother"),
        'son': _("Blocked by a son"),
        'daughters': _("Blocked by two or more daughters"),
        'brother': _("Blocked by a full brother"),
        'sisters': _("Blocked by the full sisters"),
        'paternal_brother': _("Blocked by a paternal brother"),
        'paternal_sister': _("Blocked by a paternal sister"),
        'son_of_brother': _("Blocked by a son of a full brother"),
        'son_of_paternal_brother': _("Blocked by a son of a paternal brother"),
        'uncle': _("Blocked by a full uncle"),
        'paternal_uncle': _("Blocked by a paternal uncle"),
        'son_of_uncle': _("Blocked by a son of a full uncle"),
    },
    'school_rule': {
        schools.GRANDFATHER_BLOCKS_SIBLINGS: _("Hanafi school: the grandfather blocks the full and paternal siblings"),
        schools.GRANDFATHER_SHARES_WITH_SIBLINGS: _("Hanbali, Maliki and Shafi'i schools: the grandfather shares the estate with the full and paternal siblings"),
        schools.MUSHTARAKA: _("Maliki and Shafi'i schools: the full siblings join the maternal siblings in their third"),
        schools.NO_MUSHTARAKA: _("Hanafi and Hanbali schools: the full siblings stay residuary heirs and do not join the maternal siblings' third"),
        schools.RADD: _("The remainder is returned to the heirs in proportion to their shares"),
        schools.RADD_LATER_SCHOLARS: _("Later Maliki and Shafi'i scholars: the remainder is returned to the heirs other than a spouse, in proportion to their shares"),
        schools.FATHER_BLOCKS_HIS_MOTHER: _("Hanafi, Maliki and Shafi'i schools: the father blocks his own mother, the paternal grandmother"),
        schools.GRANDMOTHER_INHERITS_WITH_HER_SON: _("Hanbali school: the paternal grandmother inherits although her son, the father, is alive"),
    },
    'option': {
        'muqasama': _("Sharing the estate with the siblings as one more brother"),
        'third_of_remainder': _("A third of what is left after the fixed shares"),
        'sixth_of_estate': _("A sixth of the whole estate"),
    },
    'step': {
        'base': _("The common base of the fixed shares"),
        'awl': _("Awl: the base is raised because the fixed shares exceed the estate"),
        'radd': _("Radd: the shares are recalculated so that the remainder returns to the heirs"),
        'correction': _("Correction: the base is multiplied so that every heir gets whole parts"),
        'unallocated': _("The part of the estate that no heir takes"),
    },
    'verse': {
        '4:11': _("Quran 4:11 (An-Nisa)"),
        '4:12': _("Quran 4:12 (An-Nisa)"),
        '4:176': _("Quran 4:176 (An-Nisa)"),
    },
}

# Every code of each kind, which is what the labels must cover.
VOCABULARY = {
    'rule': RULES,
    'condition': CONDITIONS,
    'blocked_by': BLOCKED_BY,
    'school_rule': SCHOOL_RULES,
    'option': OPTIONS,
    'step': STEPS,
    'verse': VERSE_CODES,
}


def label(kind, code):
    """The label of a code in the active language, or None for no code."""
    return None if code is None else str(LABELS[kind][code])


def fraction_body(value):
    value = Fraction(value)
    return {'numerator': value.numerator, 'denominator': value.denominator}


def build(madhab, heirs, steps):
    """Assemble the proof.

    `heirs` is a list of (reference, class name, basis, final share) in the order the
    proof should list them. A basis is the dict the engine recorded for the heir: rule,
    condition, blocked_by, fraction, school_rule and option. `steps` holds the facts of
    the calculation: base, awl, radd and correction as whole numbers or None, and
    unallocated as a fraction or None."""
    entries = []
    for reference, class_name, basis, share in heirs:
        if basis is None:
            raise ValueError(f'No basis was recorded for a {class_name}')
        if class_name not in RELATIONSHIPS:
            raise ValueError(f'Unknown heir class: {class_name}')
        relationship = RELATIONSHIPS[class_name]
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
        'madhab': madhab,
        'school_rules': sorted({entry['school_rule'] for entry in entries if entry['school_rule']}),
        'heirs': entries,
        'steps': listed,
    }


def build_table(columns, groups, heir_pks, prescribed, blocked):
    """The scholars' table of a single-death calculation, with no language in it.

    `columns` lists, in legacy order, dicts of code, total, values (heir pk to the engine's
    whole number) and merged (indexes of the groups whose cell is one merged group total).
    `groups` lists each group's member pks in row order; heirs of `heir_pks` in no group, and
    blocked heirs, follow. `prescribed` maps a pk to its fixed fraction or None for a residuary.
    `group_span` covers the group's prescribed cell: its row count first, then 0. It is merged
    only when every member has the same prescribed share (wives, daughters, residuaries,
    mushtaraka); akdariyya members keep their own shares, one cell each.
    Every cell is {'value', 'span'}: span is the rows a merged cell covers, 0 for a row
    it covers; blocked heirs have empty cells (value None); a heir with a zero share keeps the engine's 0."""
    order = []
    shared = set()
    for index, members in enumerate(groups):
        if len({prescribed.get(pk) for pk in members}) == 1:
            shared.add(index)
        for position, pk in enumerate(members):
            if pk not in blocked:
                order.append((pk, index, position, len(members)))
    seen = {pk for pk, *_rest in order}
    rest = [pk for pk in heir_pks if pk not in seen and pk not in blocked]
    rows = []
    for pk, index, position, size in order:
        cells = []
        for column in columns:
            merge = index in column['merged'] and size > 1
            cells.append({'value': column['values'][pk],
                          'span': (size if position == 0 else 0) if merge else 1})
        group_span = (size if position == 0 else 0) if index in shared else 1
        rows.append((pk, group_span, cells))
    for pk in rest:
        rows.append((pk, 1, [{'value': column['values'][pk], 'span': 1} for column in columns]))
    for pk in heir_pks:
        if pk in blocked:
            rows.append((pk, 1, [{'value': None, 'span': 1} for _column in columns]))
    return {
        'columns': [{'code': column['code'], 'total': column['total']} for column in columns],
        'rows': [{
            'heir': pk,
            'blocked': pk in blocked,
            'group_span': group_span,
            'prescribed': None if prescribed.get(pk) is None else fraction_body(prescribed[pk]),
            'cells': cells,
        } for pk, group_span, cells in rows],
    }


def build_layered(madhab, layers, final, identities):
    """Combine unchanged per-death proofs with fractions of the first estate."""
    from math import lcm
    return {
        'version': 2,
        'people': [{'row': row, 'person': person}
                   for row, person in sorted(identities.items()) if row != person],
        'madhab': madhab,
        'layers': [dict(layer, estate=fraction_body(layer['estate']))
                   for layer in sorted(layers, key=lambda layer: layer['order'])],
        'final': [{'heir': pk, 'fraction': fraction_body(share)}
                  for pk, share in sorted(final.items())],
        'base': lcm(*(share.denominator for share in final.values())),
    }


def build_layered_table(layers, tables, final, identities):
    """Combine layer parts without reducing the jami'a; fail closed on any disagreement."""
    import logging
    from math import gcd

    try:
        if len(layers) != len(tables) or any(table is None for table in tables):
            raise ValueError('Missing layer table')
        people = list(dict.fromkeys(identities[row] for row in identities))
        running, unallocated, jamia = {}, 0, 1
        combined = []
        for index, (layer, table) in enumerate(zip(layers, tables)):
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
        logging.getLogger(__name__).exception('Cannot build successive-death table')
        return None
