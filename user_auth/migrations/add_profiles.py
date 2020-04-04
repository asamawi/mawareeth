from django.db import migrations
from django.conf import settings
from django.contrib.auth.models import User
from ..models import Profile


def forwards(apps, schema_editor):
    try:
        OldModel = User
    except LookupError:
        # The old app isn't installed.
        return

    NewModel = Profile
    NewModel.objects.bulk_create(
        NewModel(user=old_object)
        for old_object in OldModel.objects.all()
    )

class Migration(migrations.Migration):
    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
    dependencies = [
        ('user_auth', '0001_initial'),
    ]
