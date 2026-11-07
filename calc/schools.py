"""Where the schools of law differ, kept apart from the engine.

Every function here is pure: it takes a school id and plain facts about the
family and returns a decision, so it can be read and tested on its own.
Anything not decided here follows the Hanbali position, which is the engine's
default.
"""
from django.utils.translation import gettext_lazy as _

HANAFI = 'hanafi'
MALIKI = 'maliki'
SHAFII = 'shafii'
HANBALI = 'hanbali'
JAFARI = 'jafari'

SUNNI = (HANAFI, MALIKI, SHAFII, HANBALI)
KNOWN = SUNNI + (JAFARI,)
DEFAULT = HANBALI

SCHOOL_NOT_SUPPORTED = 'school_not_supported'
MALIKIYYA_DISPUTED = 'malikiyya_disputed'
RADD_DISPUTED = 'radd_disputed'
GRANDMOTHER_LINE_UNKNOWN = 'grandmother_line_unknown'

REASONS = {
    SCHOOL_NOT_SUPPORTED: _("This school of law is not supported yet"),
    MALIKIYYA_DISPUTED: _("The Malikiyya case is disputed within the Maliki school, so no result is given"),
    RADD_DISPUTED: _("The classical position of this school has no radd, so the remainder cannot be shared out"),
    GRANDMOTHER_LINE_UNKNOWN: _("The case does not record which line the grandmother belongs to, so no result is given"),
}


class UnsupportedCase(Exception):
    """The engine refuses to give a number. `reason` is a stable code from REASONS."""

    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)

    @property
    def message(self):
        return str(REASONS[self.reason])


def is_known(madhab):
    return isinstance(madhab, str) and madhab in KNOWN


def grandfather_blocks_siblings(madhab):
    """Hanafi: the grandfather blocks full and paternal siblings, as the father does."""
    return madhab == HANAFI


def has_mushtaraka(madhab, live):
    """Maliki and Shafi'i: husband, mother or grandmother, two or more maternal siblings
    and a full brother. The full siblings join the maternal ones in their third.

    `live` maps the class name of each heir that is not blocked to how many there are."""
    if madhab not in (MALIKI, SHAFII):
        return False
    allowed = {'Husband', 'Mother', 'GrandMother', 'MaternalBrother', 'MaternalSister', 'Brother', 'Sister'}
    if not set(live) <= allowed:
        return False
    maternal = live.get('MaternalBrother', 0) + live.get('MaternalSister', 0)
    return (live.get('Husband', 0) == 1
            and live.get('Mother', 0) + live.get('GrandMother', 0) == 1
            and maternal >= 2
            and live.get('Brother', 0) >= 1)


def is_malikiyya_family(madhab, live, maternal_count):
    """Maliki only: husband, mother or grandmother, grandfather, two or more maternal
    siblings and a paternal brother. The maternal siblings are blocked by the
    grandfather in the engine, so they are counted from `maternal_count`."""
    return (madhab == MALIKI
            and live.get('Husband', 0) == 1
            and live.get('Mother', 0) + live.get('GrandMother', 0) >= 1
            and live.get('GrandFather', 0) == 1
            and live.get('PaternalBrother', 0) >= 1
            and maternal_count >= 2)


def allows_radd(madhab):
    """Maliki and Shafi'i classically give the remainder to the public treasury."""
    return madhab not in (MALIKI, SHAFII)


def grandmother_line_is_unknown(madhab, live):
    """Hanafi, Maliki and Shafi'i treat grandmothers by line, which the case does not
    record: a father blocks only his own mother, and two grandmothers may be of
    different lines."""
    if madhab not in (HANAFI, MALIKI, SHAFII):
        return False
    grandmothers = live.get('GrandMother', 0)
    return grandmothers >= 2 or (grandmothers >= 1 and live.get('Father', 0) >= 1)


def check_school(madhab):
    """Raise ValueError for an unknown id and UnsupportedCase for a known school the
    engine cannot calculate yet."""
    if not is_known(madhab):
        raise ValueError(f'Unknown school: {madhab!r}')
    if madhab == JAFARI:
        raise UnsupportedCase(SCHOOL_NOT_SUPPORTED)


def check_family(madhab, live, maternal_count):
    """Refuse the families whose answer the data cannot settle or the school disputes."""
    if grandmother_line_is_unknown(madhab, live):
        raise UnsupportedCase(GRANDMOTHER_LINE_UNKNOWN)
    if is_malikiyya_family(madhab, live, maternal_count):
        raise UnsupportedCase(MALIKIYYA_DISPUTED)
