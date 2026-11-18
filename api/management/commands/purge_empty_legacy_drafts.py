from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.legacy_cases import Unconvertible, convert
from calc.models import Calculation, Deceased, Heir


def select_drafts(roots):
    selected = {'no_deceased': [], 'no_heirs': []}
    for calc in roots:
        try:
            convert(calc, ContentType, Heir, Deceased)
        except Unconvertible:
            # Emptiness is determined only by the root's own rows, regardless
            # of the import failure reason or the state of later layers.
            if not Deceased.objects.filter(calc_id=calc.pk).exists():
                selected['no_deceased'].append(calc.pk)
            elif not Heir.objects.filter(calc_id=calc.pk).exists():
                selected['no_heirs'].append(calc.pk)
    return selected


class Command(BaseCommand):
    help = 'Purge owned root legacy drafts that are unconvertible and have no root deceased or heirs.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--expect', type=int)

    def report(self, selected, expected):
        total = sum(map(len, selected.values()))
        self.stdout.write(
            f"no_deceased={len(selected['no_deceased'])} "
            f"no_heirs={len(selected['no_heirs'])} total={total}")
        for reason, ids in selected.items():
            self.stdout.write(f'{reason}_ids=' + ','.join(map(str, ids)))
        if expected is not None and total != expected:
            raise CommandError(f'expected={expected} actual={total}')
        return total

    def handle(self, *args, **options):
        roots = Calculation.objects.filter(parent_id=None, user_id__isnull=False).order_by('pk')
        selected = select_drafts(roots)
        if options['dry_run']:
            self.report(selected, options['expect'])
            return
        candidate_ids = [pk for ids in selected.values() for pk in ids]
        with transaction.atomic():
            # Legacy edits lock the same root; classify again after acquiring it.
            locked = list(roots.filter(pk__in=candidate_ids).select_for_update())
            selected = select_drafts(locked)
            total = self.report(selected, options['expect'])
            ids = [pk for group in selected.values() for pk in group]
            Calculation.objects.filter(pk__in=ids).delete()
        self.stdout.write(f'deleted={total}')
