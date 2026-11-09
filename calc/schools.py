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

# The school rules a proof can name where the schools diverge. Stable codes, never translated here.
GRANDFATHER_BLOCKS_SIBLINGS = 'grandfather_blocks_siblings'
GRANDFATHER_SHARES_WITH_SIBLINGS = 'grandfather_shares_with_siblings'
MUSHTARAKA = 'mushtaraka'
NO_MUSHTARAKA = 'no_mushtaraka'
RADD = 'radd'
RADD_LATER_SCHOLARS = 'radd_later_scholars'
FATHER_BLOCKS_HIS_MOTHER = 'father_blocks_his_mother'
GRANDMOTHER_INHERITS_WITH_HER_SON = 'grandmother_inherits_with_her_son'
SCHOOL_RULES = (GRANDFATHER_BLOCKS_SIBLINGS, GRANDFATHER_SHARES_WITH_SIBLINGS, MUSHTARAKA, NO_MUSHTARAKA, RADD,
                RADD_LATER_SCHOLARS, FATHER_BLOCKS_HIS_MOTHER, GRANDMOTHER_INHERITS_WITH_HER_SON)

REASONS = {
    SCHOOL_NOT_SUPPORTED: _("This school of law is not supported yet"),
    MALIKIYYA_DISPUTED: _("The Malikiyya case is disputed within the Maliki school, so no result is given"),
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


def father_blocks_his_mother(madhab):
    """Hanafi, Maliki and Shafi'i: the father blocks his own mother, the paternal
    grandmother. Hanbali lets her inherit beside her son."""
    return madhab in (HANAFI, MALIKI, SHAFII)


def grandmother_rule(madhab):
    """The school rule that decides a father with a paternal grandmother."""
    return FATHER_BLOCKS_HIS_MOTHER if father_blocks_his_mother(madhab) else GRANDMOTHER_INHERITS_WITH_HER_SON


def is_mushtaraka_family(live):
    """The shape of the family the mushtaraka is about, whichever school it is: husband,
    mother, or one or both grandmothers, two or more maternal siblings and a full brother.
    The count of mother and grandmothers is `>= 1` and not `== 1`, because two grandmothers
    of different lines may both be live and share the one sixth.

    `live` maps the class name of each heir that is not blocked to how many there are."""
    allowed = {'Husband', 'Mother', 'GrandMother', 'MaternalGrandMother', 'MaternalBrother', 'MaternalSister', 'Brother', 'Sister'}
    if not set(live) <= allowed:
        return False
    maternal = live.get('MaternalBrother', 0) + live.get('MaternalSister', 0)
    return (live.get('Husband', 0) == 1
            and live.get('Mother', 0) + live.get('GrandMother', 0) + live.get('MaternalGrandMother', 0) >= 1
            and maternal >= 2
            and live.get('Brother', 0) >= 1)


def has_mushtaraka(madhab, live):
    """Maliki and Shafi'i: the full siblings of that family join the maternal ones in their third."""
    return madhab in (MALIKI, SHAFII) and is_mushtaraka_family(live)


def mushtaraka_rule(madhab):
    """The school rule that decides the mushtaraka family: Maliki and Shafi'i share the
    third, the others keep the full siblings as residuary heirs."""
    return MUSHTARAKA if madhab in (MALIKI, SHAFII) else NO_MUSHTARAKA


def grandfather_rule(madhab):
    """The school rule that decides a grandfather with full or paternal siblings."""
    return GRANDFATHER_BLOCKS_SIBLINGS if grandfather_blocks_siblings(madhab) else GRANDFATHER_SHARES_WITH_SIBLINGS


def radd_rule(madhab):
    """The school rule that lets the remainder go back to the heirs. Maliki and Shafi'i follow the later scholars."""
    return RADD_LATER_SCHOLARS if madhab in (MALIKI, SHAFII) else RADD


def is_malikiyya_family(madhab, live, maternal_count):
    """Maliki only: husband, mother, or one or both grandmothers, grandfather, two or more maternal
    siblings and a paternal brother. The maternal siblings are blocked by the
    grandfather in the engine, so they are counted from `maternal_count`."""
    return (madhab == MALIKI
            and live.get('Husband', 0) == 1
            and live.get('Mother', 0) + live.get('GrandMother', 0) + live.get('MaternalGrandMother', 0) >= 1
            and live.get('GrandFather', 0) == 1
            and live.get('PaternalBrother', 0) >= 1
            and maternal_count >= 2)


def check_school(madhab):
    """Raise ValueError for an unknown id and UnsupportedCase for a known school the
    engine cannot calculate yet."""
    if not is_known(madhab):
        raise ValueError(f'Unknown school: {madhab!r}')
    if madhab == JAFARI:
        raise UnsupportedCase(SCHOOL_NOT_SUPPORTED)


def check_family(madhab, live, maternal_count):
    """Refuse the families whose answer the data cannot settle or the school disputes."""
    if is_malikiyya_family(madhab, live, maternal_count):
        raise UnsupportedCase(MALIKIYYA_DISPUTED)
