from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q

from api.models import SavedCase
from api.snapshots import default_name, lossless_v1, write_version


class Command(BaseCommand):
    help = 'Losslessly upgrade Saved cases and assign missing default names.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--batch-size', type=int, default=200)

    def handle(self, *args, **options):
        if write_version() != 2:
            raise CommandError('SNAPSHOT_WRITE_VERSION must be 2.')
        if options['batch_size'] < 1:
            raise CommandError('batch-size must be positive.')
        counts = dict(converted=0, named=0, malformed=0, skipped=0, retry=0)
        malformed = []
        # Named, upgraded rows need neither decoding nor rewriting.
        counts['skipped'] = SavedCase.objects.exclude(schema_version=1).exclude(name='').count()
        last = 0
        while True:
            rows = list(SavedCase.objects.filter(pk__gt=last).filter(
                Q(schema_version=1) | Q(name='')).order_by('pk')[:options['batch_size']])
            if not rows:
                break
            for row in rows:
                last = row.pk
                updates = {}
                if not row.name:
                    updates['name'] = default_name(row.created_at)
                if row.schema_version == 1:
                    encoded = lossless_v1(row.snapshot)
                    if encoded is None:
                        counts['malformed'] += 1
                        malformed.append(row.pk)
                    else:
                        updates.update(snapshot=encoded, schema_version=2)
                if not updates:
                    if row.pk not in malformed:
                        counts['skipped'] += 1
                    continue
                changed = options['dry_run'] or SavedCase.objects.filter(
                    pk=row.pk, revision=row.revision, schema_version=row.schema_version,
                    name=row.name).update(**updates)
                if changed:
                    counts['converted'] += 'schema_version' in updates
                    counts['named'] += 'name' in updates
                else:
                    counts['retry'] += 1
        self.stdout.write(' '.join(f'{key}={value}' for key, value in counts.items()))
        self.stdout.write('malformed_pks=' + ','.join(map(str, malformed)))
