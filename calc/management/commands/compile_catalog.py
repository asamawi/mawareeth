import polib
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Compile locale .po files to .mo, skipping untranslated and fuzzy entries'

    def handle(self, *args, **options):
        for po_path in sorted(Path(settings.BASE_DIR, 'locale').glob('*/LC_MESSAGES/django.po')):
            mo_path = po_path.with_suffix('.mo')
            po = polib.pofile(str(po_path))
            out = polib.POFile()
            out.metadata = po.metadata
            for entry in po:
                if entry.msgstr and 'fuzzy' not in entry.flags and not entry.obsolete:
                    out.append(entry)
            out.save_as_mofile(str(mo_path))
            self.stdout.write(f'compiled {mo_path.relative_to(settings.BASE_DIR)}')
