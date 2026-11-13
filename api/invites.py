"""Account-bound invitations. Tokens exist only in memory and in the invitation email."""
import secrets

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone, translation
from django.utils.translation import gettext as _

from api.models import ShareInvite
from api.sharing import LINK_LIFETIME, audit, hash_token


class DeliveryError(Exception):
    pass


def issue(saved_case, email, actor, request, language):
    token = secrets.token_urlsafe(32)
    with transaction.atomic():
        invite = ShareInvite.objects.create(saved_case=saved_case, email=email.strip().lower(),
            token_hash=hash_token(token), expires_at=timezone.now() + LINK_LIFETIME)
        audit(invite, actor, 'created', subject='invite')
        with translation.override(language):
            link = request.build_absolute_uri(f'/{language}/invite/') + '#' + token
            try:
                sent = send_mail(_('You have been invited to view a draft case'),
                    _('Sign in or register to accept this invitation. The invitation expires in 30 days.\n\n%(link)s') % {'link': link},
                    settings.DEFAULT_FROM_EMAIL, [invite.email], fail_silently=False)
                if sent != 1:
                    raise DeliveryError()
            except Exception:
                raise DeliveryError() from None
    return invite


def live():
    return ShareInvite.objects.filter(revoked_at__isnull=True, expires_at__gt=timezone.now())


def resolve(token, lock=False):
    if not isinstance(token, str) or not token or len(token) > 256:
        return None
    try:
        digest = hash_token(token)
    except UnicodeEncodeError:
        return None
    rows = live()
    if lock:
        rows = rows.select_for_update()
    return rows.filter(token_hash=digest).first()


def accept(token, user):
    with transaction.atomic():
        invite = resolve(token, lock=True)
        if invite is None or (invite.accepted_at is not None and invite.accepted_by_id != user.pk):
            return None
        if invite.accepted_at is None:
            invite.accepted_by = user
            invite.accepted_at = timezone.now()
            invite.save(update_fields=['accepted_by', 'accepted_at'])
            audit(invite, user, 'accepted', subject='invite')
        return invite


def revoke(invite, actor):
    with transaction.atomic():
        invite = ShareInvite.objects.select_for_update().get(pk=invite.pk)
        if invite.revoked_at is None:
            invite.revoked_at = timezone.now()
            invite.save(update_fields=['revoked_at'])
            audit(invite, actor, 'revoked', subject='invite')
