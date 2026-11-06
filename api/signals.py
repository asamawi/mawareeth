from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver

from api.anonymous_case import SESSION_KEY


@receiver(user_logged_in)
def reset_session_expiry(sender, request, user, **kwargs):
    """A case started anonymously keeps its short expiry; the login must not inherit it.

    Sessions without a case keep whatever expiry their own login flow set.
    """
    if request is not None and hasattr(request, 'session') and SESSION_KEY in request.session:
        request.session.set_expiry(None)
