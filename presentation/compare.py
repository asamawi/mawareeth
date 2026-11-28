"""Evaluate a Family under a Basis and compare the Schools. The only place the engine is called."""
from dataclasses import dataclass
from fractions import Fraction

from engine import Evaluation, evaluate, final_shares, school_rule_set
from engine.contracts import codes
from engine.contracts.codes import CONTRACT_VERSIONS
from engine.contracts.comparison import Comparison, Refusal, SchoolResult
from engine.contracts.result import Result
from engine.contracts.family import Family

from .money import PresentationError


@dataclass(frozen=True)
class Outcome:
    """A Family and the engine Evaluation of each School asked for, in order."""
    family: Family
    evaluations: tuple


def outcome(family, resolved_basis):
    """Evaluate the Family: the four Sunni Schools for compare, else the School of the Basis first. A Sunni
    School Basis also evaluates the other three Schools, after the selected one, for the agreement line."""
    kind = resolved_basis.basis.kind
    if kind == 'compare':
        schools = codes.SUNNI_SCHOOLS
    elif kind == 'school' and resolved_basis.school in codes.SUNNI_SCHOOLS:
        schools = (resolved_basis.school,) + tuple(s for s in codes.SUNNI_SCHOOLS if s != resolved_basis.school)
    else:
        schools = (resolved_basis.school,)
    return Outcome(family, tuple((school, evaluate(family, school_rule_set(school))) for school in schools))


def refused_outcome(family, resolved_basis, reason):
    """An Outcome in which every School asked for refuses for `reason`: a rule only the consumer can see,
    such as a spouse of the deceased's own sex, which the Family does not hold for its root."""
    kind = resolved_basis.basis.kind
    schools = codes.SUNNI_SCHOOLS if kind == 'compare' else (resolved_basis.school,)
    return Outcome(family, tuple(
        (school, Evaluation(Result(CONTRACT_VERSIONS['result'], school, 'refused', reason, (), None, (), ()),
                            None, None)) for school in schools))


def row_kinds(result):
    """Each person's allocation kind: the root estate's, else that of the first layer that allocates to them."""
    kinds = {}
    for allocations in [result.allocations] + [layer.allocations for layer in result.layers]:
        for allocation in allocations:
            kinds.setdefault(allocation.person, allocation.kind)
    return kinds


def person_order(family, persons):
    """The given person ids in Family person order."""
    known = set(persons)
    return [person.id for person in family.persons if person.id in known]


def answers(family, result):
    """`(person, final share, blocked)` in Family person order, or None for a refusal. Blocked is a zero final share."""
    final = final_shares(result)
    if final is None:
        return None
    return [(pid, final[pid], final[pid] == 0) for pid in person_order(family, final)]


def unallocated_of(result):
    """What no heir takes, recomposed over every estate."""
    return 1 - sum(final_shares(result).values(), Fraction(0))


def compare(out):
    """The Comparison of four calculated or refused Schools: agreement means identical per-person
    (final share, blocked) and an identical unallocated fraction in all four."""
    held = dict(out.evaluations)
    if len(out.evaluations) != len(codes.SUNNI_SCHOOLS) or set(held) != set(codes.SUNNI_SCHOOLS):
        raise PresentationError('invalid_outcome', 'a comparison needs the four Sunni Schools')
    schools = tuple(SchoolResult(school, held[school].result) for school in codes.SUNNI_SCHOOLS)
    refusals = tuple(Refusal(s.school, s.result.refusal) for s in schools if s.result.status == 'refused')
    calculated = [s for s in schools if s.result.status == 'calculated']
    signatures = {s.school: answers(out.family, s.result) for s in calculated}
    by_school = {school: {pid: (share, blocked) for pid, share, blocked in rows}
                 for school, rows in signatures.items()}
    known = {pid for rows in by_school.values() for pid in rows}
    differing = [pid for pid in person_order(out.family, known)
                 if len({rows.get(pid) for rows in by_school.values()}) > 1]
    if not calculated:
        kind = 'all_refused'
    elif refusals or differing or len({unallocated_of(s.result) for s in calculated}) > 1:
        kind = 'difference'
    else:
        kind = 'agreement'
    return Comparison(CONTRACT_VERSIONS['comparison'], kind, schools, tuple(differing), refusals,
                      kind == 'difference', None)
