from django.conf import settings
from django.db import models


class SavedCase(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    snapshot = models.JSONField()
    schema_version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=['owner', '-updated_at'], name='saved_owner_updated_idx')]
