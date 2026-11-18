"""Which notices accompany an answer. One owner; only the disclaimer has copy so far."""
import i18n

NOTICE_CODES = ('disclaimer', 'country_notice', 'citation', 'civil_law', 'obligatory_bequest_prompt', 'locale_beta')
ENABLED_NOTICES = frozenset({'disclaimer'})


def _has_descendants(family, person):
    return any(edge.kind == 'parent_of' and edge.from_ == person for edge in family.edges)


def _bequest_prompt(basis, family):
    return basis.basis.kind in ('school', 'compare') and any(
        person.status == 'died_before_or_with' and _has_descendants(family, person.id) for person in family.persons)


def select_notices(resolved_basis, locale, outcome, enabled=ENABLED_NOTICES):
    """The codes of the notices that apply, in a fixed order."""
    kind = resolved_basis.basis.kind
    applies = {
        'disclaimer': True,
        'country_notice': kind == 'country',
        'citation': kind == 'country',
        'civil_law': kind == 'school',
        'obligatory_bequest_prompt': _bequest_prompt(resolved_basis, outcome.family),
        'locale_beta': i18n.locale_config(i18n.resolve_locale(locale))['review'] == 'pending',
    }
    return tuple(code for code in NOTICE_CODES if code in enabled and applies[code])


def notice_text(code, locale):
    """Only the disclaimer has copy; every other notice is still without text."""
    return i18n.term('notice.disclaimer', locale) if code == 'disclaimer' else None
