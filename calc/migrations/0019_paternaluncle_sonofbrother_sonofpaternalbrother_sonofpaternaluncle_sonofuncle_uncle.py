# Generated by Django 3.0.2 on 2020-04-18 14:39

from django.db import migrations, models
import django.db.models.deletion
import django.db.models.manager


class Migration(migrations.Migration):

    dependencies = [
        ('calc', '0018_auto_20200414_0953'),
    ]

    operations = [
        migrations.CreateModel(
            name='PaternalUncle',
            fields=[
                ('heir_ptr', models.OneToOneField(auto_created=True, on_delete=django.db.models.deletion.CASCADE, parent_link=True, primary_key=True, serialize=False, to='calc.Heir')),
            ],
            options={
                'abstract': False,
                'base_manager_name': 'objects',
            },
            bases=('calc.heir',),
            managers=[
                ('non_polymorphic', django.db.models.manager.Manager()),
                ('objects', django.db.models.manager.Manager()),
            ],
        ),
        migrations.CreateModel(
            name='SonOfBrother',
            fields=[
                ('heir_ptr', models.OneToOneField(auto_created=True, on_delete=django.db.models.deletion.CASCADE, parent_link=True, primary_key=True, serialize=False, to='calc.Heir')),
            ],
            options={
                'abstract': False,
                'base_manager_name': 'objects',
            },
            bases=('calc.heir',),
            managers=[
                ('non_polymorphic', django.db.models.manager.Manager()),
                ('objects', django.db.models.manager.Manager()),
            ],
        ),
        migrations.CreateModel(
            name='SonOfPaternalBrother',
            fields=[
                ('heir_ptr', models.OneToOneField(auto_created=True, on_delete=django.db.models.deletion.CASCADE, parent_link=True, primary_key=True, serialize=False, to='calc.Heir')),
            ],
            options={
                'abstract': False,
                'base_manager_name': 'objects',
            },
            bases=('calc.heir',),
            managers=[
                ('non_polymorphic', django.db.models.manager.Manager()),
                ('objects', django.db.models.manager.Manager()),
            ],
        ),
        migrations.CreateModel(
            name='SonOfPaternalUncle',
            fields=[
                ('heir_ptr', models.OneToOneField(auto_created=True, on_delete=django.db.models.deletion.CASCADE, parent_link=True, primary_key=True, serialize=False, to='calc.Heir')),
            ],
            options={
                'abstract': False,
                'base_manager_name': 'objects',
            },
            bases=('calc.heir',),
            managers=[
                ('non_polymorphic', django.db.models.manager.Manager()),
                ('objects', django.db.models.manager.Manager()),
            ],
        ),
        migrations.CreateModel(
            name='SonOfUncle',
            fields=[
                ('heir_ptr', models.OneToOneField(auto_created=True, on_delete=django.db.models.deletion.CASCADE, parent_link=True, primary_key=True, serialize=False, to='calc.Heir')),
            ],
            options={
                'abstract': False,
                'base_manager_name': 'objects',
            },
            bases=('calc.heir',),
            managers=[
                ('non_polymorphic', django.db.models.manager.Manager()),
                ('objects', django.db.models.manager.Manager()),
            ],
        ),
        migrations.CreateModel(
            name='Uncle',
            fields=[
                ('heir_ptr', models.OneToOneField(auto_created=True, on_delete=django.db.models.deletion.CASCADE, parent_link=True, primary_key=True, serialize=False, to='calc.Heir')),
            ],
            options={
                'abstract': False,
                'base_manager_name': 'objects',
            },
            bases=('calc.heir',),
            managers=[
                ('non_polymorphic', django.db.models.manager.Manager()),
                ('objects', django.db.models.manager.Manager()),
            ],
        ),
    ]
