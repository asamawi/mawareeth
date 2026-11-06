"""The anonymous interview case: the one owner of its session key.

Reads never touch the session, so a visitor without a case gets no session row.
Later stories add interview content to the dict stored here.
"""
import uuid

from django.conf import settings
from django.utils import timezone

SESSION_KEY = 'anonymous_case'
MADHABS = ('hanafi', 'maliki', 'shafii', 'hanbali', 'jafari')


class StaleCase(Exception):
    """The caller meant a case that is no longer the live one."""

    def __init__(self, case):
        super().__init__('The live case is not the one the caller meant.')
        self.case = case


def get(request):
    """The current case as {'id', 'started_at', 'madhab'}, or None.

    A stored madhab that is not one of MADHABS reads as None.
    """
    case = request.session.get(SESSION_KEY)
    if not isinstance(case, dict) or 'id' not in case or 'started_at' not in case:
        return None
    madhab = case.get('madhab')
    return {
        'id': case['id'],
        'started_at': case['started_at'],
        'madhab': madhab if isinstance(madhab, str) and madhab in MADHABS else None,
    }


def start(request):
    """Create a case, replacing any existing one, and return it."""
    case = {'id': uuid.uuid4().hex, 'started_at': timezone.now().isoformat()}
    request.session[SESSION_KEY] = case
    touch(request)
    return get(request)


def set_madhab(request, madhab, case_id=None):
    """Store the madhab on the live case and return the case, or None when there is none.

    Raises ValueError for an unknown madhab and StaleCase when case_id is given and is
    not the live case. Nothing is written in either of those or the None case.
    """
    if not isinstance(madhab, str) or madhab not in MADHABS:
        raise ValueError('Unknown madhab.')
    current = get(request)
    if current is None:
        return None
    if case_id is not None and case_id != current['id']:
        raise StaleCase(current)
    stored = dict(request.session[SESSION_KEY])
    stored['madhab'] = madhab
    # Reassign: changing the nested dict would not mark the session modified.
    request.session[SESSION_KEY] = stored
    touch(request)
    return get(request)


def touch(request):
    """Refresh the idle expiry. Only anonymous sessions get the short one."""
    if not request.user.is_authenticated:
        request.session.set_expiry(settings.ANONYMOUS_CASE_IDLE_SECONDS)
