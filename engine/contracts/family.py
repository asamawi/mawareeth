"""Family contract: who is in the family, how they relate, and the facts about the estate."""
from dataclasses import dataclass
from typing import Optional, Tuple, Union

from . import codes
from .values import (CURRENCY_RE, array, boolean, check_version, code, fail, ident, integer, nullable, obj, pattern,
                     snake, string, unique)

EDGE_KINDS = ('parent_of', 'spouse_of')


@dataclass(frozen=True)
class Person:
    id: str
    gender: str
    name: Optional[str]
    relationship: Optional[str]
    status: str
    death_order: Optional[int]


@dataclass(frozen=True)
class Edge:
    kind: str
    from_: str
    to: str


@dataclass(frozen=True)
class LayerHeir:
    person: str
    relationship: str


@dataclass(frozen=True)
class Estate:
    order: int
    deceased: str
    heirs: Tuple[LayerHeir, ...]


@dataclass(frozen=True)
class Answer:
    question: str
    person: Optional[str]
    value: Union[str, bool]


@dataclass(frozen=True)
class Amount:
    branch: str
    amount_minor: int


@dataclass(frozen=True)
class Currency:
    code: str
    explicit: bool


@dataclass(frozen=True)
class EstateFacts:
    amount_minor: Optional[int]
    currency: Optional[Currency]


@dataclass(frozen=True)
class Family:
    version: int
    root: str
    persons: Tuple[Person, ...]
    edges: Tuple[Edge, ...]
    estates: Tuple[Estate, ...]
    answers: Tuple[Answer, ...]
    gifts: Tuple[Amount, ...]
    bequests: Tuple[Amount, ...]
    estate: EstateFacts


def _person(value, path):
    obj(value, path, ('id', 'gender', 'name', 'relationship', 'status', 'death_order'))
    status = code(value['status'], f'{path}.status', codes.PERSON_STATUSES)
    order = nullable(integer, value['death_order'], f'{path}.death_order', 2, 3)
    if status == 'died_later' and order is None:
        fail(path, 'died_later needs a death_order')
    if status != 'died_later' and order is not None:
        fail(path, f'{status} must not carry a death_order')
    return Person(
        ident(value['id'], f'{path}.id'), code(value['gender'], f'{path}.gender', codes.GENDERS),
        nullable(string, value['name'], f'{path}.name'),
        nullable(code, value['relationship'], f'{path}.relationship', codes.RELATIONSHIPS), status, order)


def _amounts(value, path, known):
    result = []
    for i, item in enumerate(array(value, path)):
        p = f'{path}[{i}]'
        obj(item, p, ('branch', 'amount_minor'))
        branch = ident(item['branch'], f'{p}.branch')
        if branch not in known:
            fail(p, f'branch {branch!r} is not in the family')
        result.append(Amount(branch, integer(item['amount_minor'], f'{p}.amount_minor', 0)))
    return tuple(result)


def parse_family(data):
    check_version(data, 'version', 'family')
    obj(data, 'family', ('version', 'root', 'persons', 'edges', 'estates', 'answers', 'gifts', 'bequests', 'estate'))
    root = ident(data['root'], 'family.root')
    persons = tuple(_person(p, f'family.persons[{i}]') for i, p in enumerate(array(data['persons'], 'family.persons')))
    unique([p.id for p in persons], 'family.persons', 'person id')
    by_id = {p.id: p for p in persons}
    if root in by_id:
        fail('family.persons', 'the root is not listed as a person')
    known = set(by_id) | {root}

    edges = []
    for i, item in enumerate(array(data['edges'], 'family.edges')):
        p = f'family.edges[{i}]'
        obj(item, p, ('kind', 'from', 'to'))
        edge = Edge(code(item['kind'], f'{p}.kind', EDGE_KINDS), ident(item['from'], f'{p}.from'),
                    ident(item['to'], f'{p}.to'))
        if edge.from_ not in known or edge.to not in known:
            fail(p, 'edge points at an id that is not in the family')
        if edge.from_ == edge.to:
            fail(p, 'edge must join two different persons')
        edges.append(edge)

    estates = []
    for i, item in enumerate(array(data['estates'], 'family.estates')):
        p = f'family.estates[{i}]'
        obj(item, p, ('order', 'deceased', 'heirs'))
        order = integer(item['order'], f'{p}.order', 1, 3)
        deceased = ident(item['deceased'], f'{p}.deceased')
        if order != i + 1:
            fail(p, 'estate orders must run 1, 2, 3 without gaps')
        if order == 1 and deceased != root:
            fail(p, 'the first estate belongs to the root')
        if order > 1:
            person = by_id.get(deceased)
            if person is None or person.status != 'died_later' or person.death_order != order:
                fail(p, 'a later estate belongs to a person who died later in that order')
        heirs = []
        for j, h in enumerate(array(item['heirs'], f'{p}.heirs')):
            hp = f'{p}.heirs[{j}]'
            obj(h, hp, ('person', 'relationship'))
            person = ident(h['person'], f'{hp}.person')
            if person not in by_id:
                fail(hp, f'heir {person!r} is not in the family')
            heir = by_id[person]
            if heir.status == 'died_before_or_with' or (heir.status == 'died_later' and heir.death_order <= order):
                fail(hp, f'heir {person!r} was already dead at this estate')
            if person == deceased:
                fail(hp, 'a person cannot inherit from themselves')
            heirs.append(LayerHeir(person, code(h['relationship'], f'{hp}.relationship', codes.RELATIONSHIPS)))
        unique([h.person for h in heirs], f'{p}.heirs', 'heir')
        estates.append(Estate(order, deceased, tuple(heirs)))
    if not estates:
        fail('family.estates', 'the first estate is required')
    with_estate = {e.deceased for e in estates[1:]}
    for person in persons:
        if person.status == 'died_later' and person.id not in with_estate:
            fail('family.persons', f'{person.id!r} died later but has no estate of their own')

    first = {h.person: h.relationship for h in estates[0].heirs}
    later = {h.person for e in estates[1:] for h in e.heirs}
    for person in persons:
        if person.id in first and person.relationship != first[person.id]:
            fail('family.persons', f'{person.id!r} relationship differs from the first estate')
        if person.relationship is None and (person.id in first or person.id not in later):
            fail('family.persons', f'{person.id!r} has no relationship but is not only a later deceased relative')

    answers = []
    for i, item in enumerate(array(data['answers'], 'family.answers')):
        p = f'family.answers[{i}]'
        obj(item, p, ('question', 'person', 'value'))
        person = nullable(ident, item['person'], f'{p}.person')
        if person is not None and person not in known:
            fail(p, f'person {person!r} is not in the family')
        value = item['value']
        value = value if isinstance(value, bool) else snake(value, f'{p}.value')
        answers.append(Answer(snake(item['question'], f'{p}.question'), person, value))

    gifts = _amounts(data['gifts'], 'family.gifts', known)
    bequests = _amounts(data['bequests'], 'family.bequests', known)

    est = obj(data['estate'], 'family.estate', ('amount_minor', 'currency'))
    currency = est['currency']
    if currency is not None:
        obj(currency, 'family.estate.currency', ('code', 'explicit'))
        currency = Currency(pattern(currency['code'], 'family.estate.currency.code', CURRENCY_RE, 'a currency code'),
                            boolean(currency['explicit'], 'family.estate.currency.explicit'))
    facts = EstateFacts(nullable(integer, est['amount_minor'], 'family.estate.amount_minor', 0), currency)
    return Family(data['version'], root, persons, tuple(edges), tuple(estates), tuple(answers), gifts, bequests, facts)


def dump_family(family):
    currency = family.estate.currency
    return {
        'version': family.version,
        'root': family.root,
        'persons': [{'id': p.id, 'gender': p.gender, 'name': p.name, 'relationship': p.relationship,
                     'status': p.status, 'death_order': p.death_order} for p in family.persons],
        'edges': [{'kind': e.kind, 'from': e.from_, 'to': e.to} for e in family.edges],
        'estates': [{'order': e.order, 'deceased': e.deceased,
                     'heirs': [{'person': h.person, 'relationship': h.relationship} for h in e.heirs]}
                    for e in family.estates],
        'answers': [{'question': a.question, 'person': a.person, 'value': a.value} for a in family.answers],
        'gifts': [{'branch': g.branch, 'amount_minor': g.amount_minor} for g in family.gifts],
        'bequests': [{'branch': g.branch, 'amount_minor': g.amount_minor} for g in family.bequests],
        'estate': {'amount_minor': family.estate.amount_minor,
                   'currency': None if currency is None else {'code': currency.code, 'explicit': currency.explicit}},
    }
