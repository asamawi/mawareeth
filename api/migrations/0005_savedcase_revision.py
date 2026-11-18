from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0004_import_legacy_calculations')]
    operations = [
        migrations.AddField(
            model_name='savedcase',
            name='revision',
            field=models.PositiveIntegerField(default=1),
        ),
    ]
