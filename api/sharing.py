"""Share links: issue, resolve and audit. Only the SHA-256 of a token is ever stored."""
import hashlib
import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from api.models import ShareAuditEvent, ShareLink

LINK_LIFETIME = timedelta(days=30)


def hash_token(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def audit(share, actor, action):
    user_id = actor.pk if actor is not None and getattr(actor, 'is_authenticated', False) else None
    ShareAuditEvent.objects.create(
        share_id=share.pk, saved_case_id=share.saved_case_id, actor_id=user_id, action=action,
        visibility=share.visibility)


def issue(saved_case, visibility, actor):
    """Create a link and return (share, raw token). The raw token exists only in this return value."""
    token = secrets.token_urlsafe(32)
    with transaction.atomic():
        share = ShareLink.objects.create(
            saved_case=saved_case, token_hash=hash_token(token), visibility=visibility,
            expires_at=timezone.now() + LINK_LIFETIME)
        audit(share, actor, 'created')
    return share, token


def resolve(token):
    """The live share for a token, or None when it is unknown, revoked or expired."""
    if not isinstance(token, str) or not token or len(token) > 256:
        return None
    try:
        digest = hash_token(token)
    except UnicodeEncodeError:
        return None
    share = ShareLink.objects.select_related('saved_case').filter(token_hash=digest).first()
    if share is None or share.revoked_at is not None or share.expires_at <= timezone.now():
        return None
    return share


def change_visibility(share, visibility, actor):
    with transaction.atomic():
        share.visibility = visibility
        share.save(update_fields=['visibility'])
        audit(share, actor, 'visibility_changed')


def revoke(share, actor):
    with transaction.atomic():
        share.revoked_at = timezone.now()
        share.save(update_fields=['revoked_at'])
        audit(share, actor, 'revoked')
