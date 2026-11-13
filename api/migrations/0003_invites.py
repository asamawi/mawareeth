from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('api', '0002_sharing'), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.AddField(model_name='shareauditevent', name='subject', field=models.CharField(default='link', max_length=8)),
        migrations.CreateModel(name='ShareInvite', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('email', models.CharField(max_length=254)),
            ('token_hash', models.CharField(max_length=64, unique=True)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('expires_at', models.DateTimeField()),
            ('accepted_at', models.DateTimeField(blank=True, null=True)),
            ('revoked_at', models.DateTimeField(blank=True, null=True)),
            ('accepted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ('saved_case', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='invites', to='api.savedcase')),
        ]),
    ]
