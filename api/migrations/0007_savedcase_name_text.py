from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0006_savedcase_name')]
    operations = [
        migrations.AlterField(
            model_name='savedcase', name='name',
            field=models.TextField(blank=True, default='', db_default=''),
        ),
    ]
