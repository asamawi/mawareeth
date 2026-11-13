from django.db import migrations

from api.legacy_cases import import_all


def forwards(apps, schema_editor):
    converted, reports, ownerless = import_all(
        apps.get_model('calc', 'Calculation'), apps.get_model('contenttypes', 'ContentType'),
        apps.get_model('calc', 'Heir'), apps.get_model('calc', 'Deceased'),
        apps.get_model('api', 'SavedCase'), using=schema_editor.connection.alias)
    for line in reports:
        print(line)
    if converted or reports or ownerless:
        print(f'Legacy calculations: converted={converted}, reported={len(reports)}, ownerless={ownerless}')


class Migration(migrations.Migration):
    dependencies = [('api', '0003_invites'), ('calc', '0028_manasikhat'),
                    ('contenttypes', '0002_remove_content_type_name')]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
