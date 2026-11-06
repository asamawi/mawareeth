"""The anonymous interview case: the one owner of its session key.

Reads never touch the session, so a visitor without a case gets no session row.
Later stories add interview content to the dict stored here.
"""
import uuid

from django.conf import settings
from django.utils import timezone

SESSION_KEY = 'anonymous_case'


def get(request):
    """The current case as {'id', 'started_at'}, or None."""
    case = request.session.get(SESSION_KEY)
    if not isinstance(case, dict) or 'id' not in case or 'started_at' not in case:
        return None
    return {'id': case['id'], 'started_at': case['started_at']}


def start(request):
    """Create a case, replacing any existing one, and return it."""
    case = {'id': uuid.uuid4().hex, 'started_at': timezone.now().isoformat()}
    request.session[SESSION_KEY] = case
    touch(request)
    return get(request)


def touch(request):
    """Refresh the idle expiry. Only anonymous sessions get the short one."""
    if not request.user.is_authenticated:
        request.session.set_expiry(settings.ANONYMOUS_CASE_IDLE_SECONDS)
