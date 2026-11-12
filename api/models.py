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


class ShareLink(models.Model):
    PRIVATE = 'private'
    PUBLIC = 'public'
    VISIBILITIES = [(PRIVATE, 'Private'), (PUBLIC, 'Public')]

    saved_case = models.ForeignKey(SavedCase, on_delete=models.CASCADE, related_name='shares')
    token_hash = models.CharField(max_length=64, unique=True)
    visibility = models.CharField(max_length=7, choices=VISIBILITIES, default=PRIVATE)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)


class AppendOnlyError(Exception):
    """Raised by any attempt to delete or update an audit row."""


class AppendOnlyQuerySet(models.QuerySet):
    def delete(self):
        raise AppendOnlyError('Audit rows are append-only.')

    def update(self, **kwargs):
        raise AppendOnlyError('Audit rows are append-only.')


class ShareAuditEvent(models.Model):
    """Append-only. Plain ids, no foreign keys, so deleting a user or case never removes a row.

    `visibility` is the link's visibility after the action.
    """

    share_id = models.BigIntegerField()
    saved_case_id = models.BigIntegerField()
    actor_id = models.BigIntegerField(null=True)
    action = models.CharField(max_length=32)
    visibility = models.CharField(max_length=7)
    at = models.DateTimeField(auto_now_add=True)

    objects = AppendOnlyQuerySet.as_manager()

    class Meta:
        indexes = [
            models.Index(fields=['share_id'], name='audit_share_idx'),
            models.Index(fields=['saved_case_id'], name='audit_saved_case_idx'),
        ]

    def delete(self, *args, **kwargs):
        raise AppendOnlyError('Audit rows are append-only.')
