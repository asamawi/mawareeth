"""Read-only bridges from Django inputs to the pure calculation contracts."""
from dataclasses import dataclass

import engine
from engine.contracts import parse_family, resolve_basis
from engine.contracts.family import Currency
from presentation import minor_units

from . import schools


def basis_from_madhab(madhab):
    return resolve_basis({'kind': 'compare'} if madhab is None else
                         {'kind': 'school', 'school': madhab}, {})


def family_from_session(case, names=True):
    """Preserve session identities, including aliases across successive estates.

    `names=False` leaves every person unnamed: the preview computes from relationships and genders only."""
    people, aliases, estates = {}, {}, []

    def identity(key):
        return aliases.get(key, key)

    layers = [(None, 1, case['heirs'])] + [
        (d['heir_id'], d['order'], d['heirs']) for d in sorted(case.get('deaths', []), key=lambda d: d['order'])]
    for deceased, order, rows in layers:
        heirs = []
        if deceased is not None:
            person = people[identity(deceased)]
            person.update(status='died_later', death_order=order)
        for row in rows:
            pid = identity(row['same_as']) if row.get('same_as') else row['id']
            aliases[row['id']] = pid
            people.setdefault(pid, {'id': pid, 'gender': row['gender'], 'name': (row.get('name') or None) if names else None,
                                    'relationship': row['relationship'] if order == 1 else None,
                                    'status': 'alive', 'death_order': None})
            heirs.append({'person': pid, 'relationship': row['relationship']})
        estates.append({'order': order, 'deceased': 'root' if deceased is None else identity(deceased),
                        'heirs': heirs})
    for row in case.get('died_before') or ():
        people[row['id']] = {'id': row['id'], 'gender': row['gender'], 'name': (row.get('name') or None) if names else None,
                             'relationship': row['relationship'], 'status': 'died_before_or_with', 'death_order': None}
    estate = case['deceased'].get('estate')
    currency = Currency('SAR', explicit=True) if estate is not None else None
    return parse_family({'version': 1, 'root': 'root', 'persons': list(people.values()),
                         'edges': [dict(edge) for edge in case.get('edges') or ()], 'estates': estates, 'answers': [], 'gifts': [], 'bequests': [],
                         'estate': {'amount_minor': None if estate is None else minor_units(str(estate), 'SAR'),
                                    'currency': None if currency is None else {'code': 'SAR', 'explicit': True}}}), currency


@dataclass(frozen=True)
class PersonIds:
    """Both directions are explicit; aliases map to the earliest Heir row."""
    person_to_heir: dict
    heir_to_person: dict
    deceased_to_person: dict


def family_from_calculation(calc):
    """Load the complete calculation tree without locks, writes or savepoints."""
    from api.preview import HEIR_CLASSES
    from .models import Calculation, Deceased, Heir

    def refuse():
        raise schools.UnsupportedCase(schools.MANASIKHAT_UNSUPPORTED)

    if calc.parent_id is not None:
        refuse()
    layers, seen = [calc], {calc.pk}
    for layer in layers:
        for child in Calculation.objects.filter(parent_id=layer.pk).order_by('pk'):
            if child.pk in seen or len(seen) >= 3:
                refuse()
            seen.add(child.pk)
            layers.append(child)
    deaths = list(Deceased.objects.filter(calc_id__in=seen))
    if len(deaths) != len(layers) or len({d.calc_id for d in deaths}) != len(layers):
        refuse()
    by_calc = {d.calc_id: d for d in deaths}
    if {d.death_order for d in deaths} != set(range(1, len(layers) + 1)) or by_calc[calc.pk].death_order != 1:
        refuse()
    layers.sort(key=lambda layer: by_calc[layer.pk].death_order)
    rows = list(Heir.objects.filter(calc_id__in=seen).order_by('pk'))
    by_pk = {row.pk: row for row in rows}
    identities = {}

    def identity(row, path=()):
        if row.pk in identities:
            return identities[row.pk]
        if row.pk in path:
            refuse()
        if row.same_person_id is None:
            pid = f'h{row.pk}'
        else:
            earlier = by_pk.get(row.same_person_id)
            if (earlier is None or earlier.sex != row.sex or
                    by_calc[earlier.calc_id].death_order >= by_calc[row.calc_id].death_order):
                refuse()
            pid = identity(earlier, (*path, row.pk))
        identities[row.pk] = pid
        return pid

    for row in rows:
        identity(row)
    if (Deceased.objects.filter(heir_id__in=by_pk).exclude(calc_id__in=seen).exists() or
            Heir.objects.filter(same_person_id__in=by_pk).exclude(calc_id__in=seen).exists()):
        refuse()
    inverse = {cls: code for code, cls in HEIR_CLASSES.items()}
    session_rows, person_to_heir = {}, {}
    for row in rows:
        pid = identities[row.pk]
        person_to_heir.setdefault(pid, row.pk)
        session_rows[row.pk] = {'id': f'h{row.pk}', 'relationship': inverse[type(row)],
                                'gender': 'male' if row.sex == 'M' else 'female',
                                'name': ' '.join(filter(None, (row.first_name, row.last_name))),
                                **({'same_as': identities[row.same_person_id]} if row.same_person_id else {})}
    root_death = by_calc[calc.pk]
    if root_death.heir_id is not None:
        refuse()
    case = {'deceased': {'gender': 'male' if root_death.sex == 'M' else 'female',
                         'estate': str(root_death.estate) if root_death.estate > 0 else None},
            'heirs': [session_rows[r.pk] for r in rows if r.calc_id == calc.pk], 'deaths': []}
    died, death_ids = set(), {root_death.pk: 'root'}
    for layer in layers[1:]:
        death = by_calc[layer.pk]
        earlier = by_pk.get(death.heir_id)
        if (earlier is None or earlier.sex != death.sex or
                by_calc[earlier.calc_id].death_order >= death.death_order or
                by_calc[layer.parent_id].death_order >= death.death_order):
            refuse()
        pid = identities[earlier.pk]
        if pid in died:
            refuse()
        died.add(pid)
        death_ids[death.pk] = pid
        case['deaths'].append({'heir_id': pid, 'order': death.death_order,
                               'gender': 'male' if death.sex == 'M' else 'female',
                               'heirs': [session_rows[r.pk] for r in rows if r.calc_id == layer.pk]})
    try:
        family, _currency = family_from_session(case)
    except (KeyError, ValueError) as error:
        raise schools.UnsupportedCase(schools.MANASIKHAT_UNSUPPORTED) from error
    return family, PersonIds(person_to_heir, identities, death_ids)


def legacy_evidence(evaluation, ids):
    """The core's proof and table with Heir and Deceased pks in place of person ids, as `legacy_compute` left them.

    A later-death proof names each person by its earliest Heir row only."""
    heirs = ids.person_to_heir
    deaths = {person: pk for pk, person in ids.deceased_to_person.items()}

    def walk(value):
        if isinstance(value, dict):
            return {key: (heirs[item] if key in ('heir', 'row', 'person') and item is not None else
                          deaths[item] if key == 'deceased' and item is not None else walk(item))
                    for key, item in value.items()}
        if isinstance(value, list):
            return [walk(item) for item in value]
        return value

    return walk(engine.thaw(evaluation.proof)), walk(engine.thaw(evaluation.table))


def present_calculation(calc, madhab, locale):
    """The PresentedResult (v3, SAR explicit) of a stored calculation under one school, and the person ids."""
    from presentation import outcome, present

    family, ids = family_from_calculation(calc)
    resolved = basis_from_madhab(madhab)
    return present(outcome(family, resolved), resolved, locale, family.estate.currency), ids
