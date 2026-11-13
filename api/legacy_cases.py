"""Read-only conversion of legacy calculation trees to saved input snapshots."""
from api import anonymous_case
from calc.proof import RELATIONSHIPS


class Unconvertible(Exception):
    """A legacy tree cannot be preserved in the current snapshot format."""


def _rows(model, alias):
    manager = model.objects.using(alias)
    # Historical migration models have an ordinary manager; live models are polymorphic.
    return manager.non_polymorphic() if hasattr(manager, 'non_polymorphic') else manager


def convert(calc, ContentType, Heir, Deceased):
    alias = calc._state.db
    relationships = {name.lower(): value for name, value in RELATIONSHIPS.items()}
    types = dict(ContentType.objects.using(alias).values_list('pk', 'model'))
    layers, pending = [], [calc]
    while pending:
        parent = pending.pop()
        children = list(type(calc).objects.using(alias).filter(parent_id=parent.pk).order_by('pk'))
        layers.extend(children)
        pending.extend(children)

    def deceased(layer):
        rows = list(_rows(Deceased, alias).filter(calc_id=layer.pk))
        if len(rows) != 1:
            raise Unconvertible('no deceased' if not rows else 'multiple deceased')
        if rows[0].sex not in ('M', 'F'):
            raise Unconvertible('invalid deceased sex')
        return rows[0]

    root = deceased(calc)
    later = [(deceased(layer), layer) for layer in layers]
    later.sort(key=lambda pair: (pair[0].death_order, pair[1].pk))
    ids, people, names, genders = {}, {}, {}, {}

    def heirs(layer):
        result = []
        for heir in _rows(Heir, alias).filter(calc_id=layer.pk).order_by('pk'):
            relationship = relationships.get(types.get(heir.polymorphic_ctype_id, '').lower())
            if relationship is None:
                raise Unconvertible('unknown relationship')
            try:
                name = anonymous_case.clean_name(' '.join(
                    part.strip() for part in (heir.first_name, heir.last_name) if part and part.strip()))
            except anonymous_case.FieldErrors:
                raise Unconvertible('invalid name') from None
            row = {'id': f'h{len(ids) + 1}', 'relationship': relationship,
                   'gender': anonymous_case.RELATIONSHIPS[relationship], 'name': name}
            if heir.same_person_id is not None:
                if heir.same_person_id not in people:
                    raise Unconvertible('not representable')
                row['same_as'] = people[heir.same_person_id]
                row['name'] = names[row['same_as']]
            ids[heir.pk] = row['id']
            people[heir.pk] = row.get('same_as', row['id'])
            names[row['id']] = row['name']
            genders[row['id']] = row['gender']
            result.append(row)
        return result

    snapshot = {'madhab': 'hanbali',
                'deceased': {'gender': {'M': 'male', 'F': 'female'}[root.sex],
                             'estate': str(root.estate) if root.estate > 0 else None},
                'heirs': heirs(calc), 'deaths': []}
    if not snapshot['heirs']:
        raise Unconvertible('no heirs')
    for death, layer in later:
        target = people.get(death.heir_id)
        if target is None:
            raise Unconvertible('not representable')
        snapshot['deaths'].append({'heir_id': target, 'order': death.death_order,
                                  # Like every heir's, the gender follows the relationship, not `sex`.
                                  'gender': genders[target],
                                  'heirs': heirs(layer)})
    parsed = anonymous_case.read_snapshot(snapshot, 'legacy', 'legacy')
    if (not parsed['deceased'] or not parsed['heirs']
            or anonymous_case.export_snapshot(parsed) != snapshot):
        raise Unconvertible('not representable')
    return snapshot


def import_all(Calculation, ContentType, Heir, Deceased, SavedCase, using='default'):
    converted, reports, ownerless = 0, [], 0
    for calc in Calculation.objects.using(using).filter(parent_id=None).order_by('pk').iterator():
        if calc.user_id is None:
            ownerless += 1
            continue
        try:
            snapshot = convert(calc, ContentType, Heir, Deceased)
        except Unconvertible as error:
            reports.append(f'Legacy calculation {calc.pk}, owner {calc.user_id}: {error}')
            continue
        SavedCase.objects.using(using).create(owner_id=calc.user_id, snapshot=snapshot, schema_version=1)
        converted += 1
    return converted, reports, ownerless
