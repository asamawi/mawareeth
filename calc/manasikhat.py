"""Exact successive inheritance, bounded to three deaths."""
from fractions import Fraction

from django.db import transaction

from . import proof, schools
from .models import Calculation, Deceased, Heir


def compute_manasikhat(calc, madhab):
    """Return living persons' fractions of the first estate and a v2 proof.

    All topology is checked before the first per-layer computation. The outer
    transaction rolls back every layer if any subsequent layer refuses.
    """
    schools.check_school(madhab)

    def refuse():
        raise schools.UnsupportedCase(schools.MANASIKHAT_UNSUPPORTED)

    with transaction.atomic():
        root = Calculation.objects.select_for_update().get(pk=calc.pk)
        if root.parent_id is not None:
            refuse()
        layers = [root]
        seen = {root.pk}
        for layer in layers:
            children = list(Calculation.objects.select_for_update().filter(parent=layer).order_by('pk'))
            for child in children:
                if child.pk in seen or len(seen) >= 3:
                    refuse()
                seen.add(child.pk)
                layers.append(child)
        deaths = list(Deceased.objects.select_for_update().filter(calc_id__in=seen))
        if len(deaths) != len(layers) or len({d.calc_id for d in deaths}) != len(layers):
            refuse()
        by_calc = {d.calc_id: d for d in deaths}
        orders = {d.death_order for d in deaths}
        if (orders != set(range(1, len(deaths) + 1))
                or by_calc[root.pk].death_order != 1):
            refuse()
        layers.sort(key=lambda layer: by_calc[layer.pk].death_order)
        rows = list(Heir.objects.non_polymorphic().select_for_update().filter(calc_id__in=seen).order_by('pk'))
        by_pk = {row.pk: row for row in rows}
        identities = {}

        def identity(row, path=None):
            if row.pk in identities:
                return identities[row.pk]
            path = set() if path is None else path
            if row.pk in path:
                refuse()
            path.add(row.pk)
            if row.same_person_id is None:
                person = row.pk
            else:
                earlier = by_pk.get(row.same_person_id)
                if (earlier is None or row.sex != earlier.sex
                        or by_calc[earlier.calc_id].death_order >= by_calc[row.calc_id].death_order):
                    refuse()
                person = identity(earlier, path)
            identities[row.pk] = person
            return person

        for layer in layers:
            people = [identity(row) for row in rows if row.calc_id == layer.pk]
            if len(set(people)) != len(people):
                refuse()
        died = {}
        for layer in layers:
            death = by_calc[layer.pk]
            if death.death_order == 1:
                if death.heir_id is not None:
                    refuse()
                continue
            earlier = by_pk.get(death.heir_id)
            if (earlier is None or death.sex != earlier.sex
                    or by_calc[earlier.calc_id].death_order >= death.death_order
                    or by_calc[layer.parent_id].death_order >= death.death_order):
                refuse()
            person = identity(earlier)
            if person in died:
                refuse()
            died[person] = death.death_order
        for row in rows:
            if died.get(identity(row), 4) <= by_calc[row.calc_id].death_order:
                refuse()
        # Do not silently omit a death linked outside this calculation tree.
        if Deceased.objects.filter(heir_id__in=by_pk).exclude(calc_id__in=seen).exists():
            refuse()
        if Heir.objects.filter(same_person_id__in=by_pk).exclude(calc_id__in=seen).exists():
            refuse()
        totals = {}
        entries = []
        tables = []
        for layer in layers:
            death = by_calc[layer.pk]
            estate = Fraction(1) if death.death_order == 1 else totals.pop(identity(by_pk[death.heir_id]), Fraction(0))
            layer._manasikhat_run = True
            try:
                shares = layer.compute(madhab)
            finally:
                del layer._manasikhat_run
            for pk, share in shares.items():
                person = identities[pk]
                totals[person] = totals.get(person, Fraction(0)) + estate * share
            tables.append(layer.table)
            entries.append({'order': death.death_order, 'deceased': death.pk,
                            'heir': None if death.death_order == 1 else identity(by_pk[death.heir_id]),
                            'estate': estate, 'proof': layer.proof})
        final = dict(sorted(totals.items()))
        calc.table = proof.build_layered_table(entries, tables, final, identities)
        return final, proof.build_layered(madhab, entries, final, identities)
