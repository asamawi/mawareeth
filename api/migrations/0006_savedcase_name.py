from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0005_savedcase_revision')]
    operations = [
        migrations.AddField(
            model_name='savedcase', name='name',
            field=models.CharField(max_length=100, blank=True, default='', db_default=''),
        ),
        migrations.AlterField(
            model_name='savedcase', name='revision',
            field=models.PositiveIntegerField(default=1, db_default=1),
        ),
    ]
