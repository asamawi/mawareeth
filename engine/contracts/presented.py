"""PresentedResult v3. Nested values retain the wire shape; readers validate every key.

This contract contains display strings, never calculation or localization policy.
"""
from copy import deepcopy
from dataclasses import dataclass

from . import codes
from .basis import dump_basis, parse_basis
from .result import _param
from .values import (CURRENCY_RE, LANG_RE, array, boolean, check_version, code, fail, fraction,
                     ident, integer, nullable, obj, pattern, snake, string, unique)

TABLE_COLUMNS = ('base', 'awl', 'radd', 'remainder', 'radd_calc', 'radd_union', 'correction')


@dataclass(frozen=True)
class PresentedResult:
    version: int
    locale: str
    direction: str
    basis: object
    state: str
    comparison_outcome: object
    school_line: object
    rows: tuple
    rounding: object
    unallocated: object
    comparison: object
    evidence: tuple
    refusals: tuple
    notices: tuple
    table: object


def _text(v, p, direction='ltr', empty=False):
    obj(v, p, ('text', 'dir'))
    string(v['text'], p + '.text', not empty)
    code(v['dir'], p + '.dir', (direction,))


def _fraction(v, p):
    obj(v, p, ('fraction', 'text', 'dir'))
    fraction(v['fraction'], p + '.fraction')
    _text({k: v[k] for k in ('text', 'dir')}, p)


def _money(v, p, signed=False):
    if v is None:
        return
    obj(v, p, ('amount_minor', 'currency', 'text', 'dir'))
    integer(v['amount_minor'], p + '.amount_minor', None if signed else 0)
    pattern(v['currency'], p + '.currency', CURRENCY_RE, 'a currency code')
    _text({k: v[k] for k in ('text', 'dir')}, p, 'auto')


def _label(v, p, vocabulary):
    obj(v, p, ('code', 'text'))
    code(v['code'], p + '.code', vocabulary)
    string(v['text'], p + '.text', True)


def _segment(v, p, arabic=False):
    obj(v, p, ('text', 'lang', 'dir'))
    string(v['text'], p + '.text', True)
    lang = pattern(v['lang'], p + '.lang', LANG_RE, 'a language tag')
    direction = code(v['dir'], p + '.dir', ('ltr', 'rtl'))
    if arabic and (lang != 'ar' or direction != 'rtl'):
        fail(p, 'the original relationship is Arabic and right-to-left')


def _refusal(v, p, school=False):
    obj(v, p, ('school', 'reason', 'text') if school else ('reason', 'text'))
    if school:
        nullable(code, v['school'], p + '.school', codes.SCHOOLS)
    code(v['reason'], p + '.reason', codes.REFUSAL_REASONS)
    string(v['text'], p + '.text', True)


def _comparison(v, p):
    if v is None:
        return
    obj(v, p, ('schools', 'differing_persons'))
    schools = array(v['schools'], p + '.schools')
    for i, s in enumerate(schools):
        q = f'{p}.schools[{i}]'
        obj(s, q, ('school', 'label', 'status', 'refusal', 'shares'))
        code(s['school'], q + '.school', codes.SUNNI_SCHOOLS)
        string(s['label'], q + '.label', True)
        code(s['status'], q + '.status', ('calculated', 'refused'))
        shares = array(s['shares'], q + '.shares')
        for j, share in enumerate(shares):
            r = f'{q}.shares[{j}]'
            obj(share, r, ('person', 'blocked', 'share'))
            ident(share['person'], r + '.person')
            boolean(share['blocked'], r + '.blocked')
            _fraction(share['share'], r + '.share')
        unique([s['person'] for s in shares], q + '.shares', 'person')
        if s['status'] == 'refused':
            if s['refusal'] is None or shares:
                fail(q, 'a refused School names its refusal and has no shares')
            _refusal(s['refusal'], q + '.refusal')
        elif s['refusal'] is not None:
            fail(q, 'a calculated School has no refusal')
    if [s['school'] for s in schools] != list(codes.SUNNI_SCHOOLS):
        fail(p, 'comparison lists the four Sunni Schools in order')
    differing = array(v['differing_persons'], p + '.differing_persons')
    for person in differing:
        ident(person, p + '.differing_persons')
    unique(differing, p + '.differing_persons', 'person')
    calculated = [s for s in schools if s['status'] == 'calculated']
    if not calculated or (not differing and len(calculated) == len(schools)):
        fail(p, 'a comparison needs a difference or a partial refusal')


def _number(v, p):
    """A numeric leaf of the scholars' table: its exact value, its Babel text, left-to-right."""
    obj(v, p, ('value', 'text', 'dir'))
    if isinstance(v['value'], dict):
        fraction(v['value'], p + '.value')
    else:
        integer(v['value'], p + '.value', 0)
    _text({k: v[k] for k in ('text', 'dir')}, p)


def _single_table(v, p):
    obj(v, p, ('columns', 'rows'))
    columns = array(v['columns'], p + '.columns')
    for i, column in enumerate(columns):
        q = f'{p}.columns[{i}]'
        obj(column, q, ('code', 'label', 'total'))
        code(column['code'], q + '.code', TABLE_COLUMNS)
        string(column['label'], q + '.label', True)
        _number(column['total'], q + '.total')
    rows = array(v['rows'], p + '.rows')
    for i, row in enumerate(rows):
        q = f'{p}.rows[{i}]'
        obj(row, q, ('heir', 'blocked', 'group_span', 'prescribed', 'cells'))
        ident(row['heir'], q + '.heir')
        boolean(row['blocked'], q + '.blocked')
        integer(row['group_span'], q + '.group_span', 0)
        nullable(_number, row['prescribed'], q + '.prescribed')
        cells = array(row['cells'], q + '.cells')
        if len(cells) != len(columns):
            fail(q, 'a row has one cell per column')
        for j, cell in enumerate(cells):
            obj(cell, f'{q}.cells[{j}]', ('value', 'span'))
            nullable(_number, cell['value'], f'{q}.cells[{j}].value')
            integer(cell['span'], f'{q}.cells[{j}].span', 0)
    unique([r['heir'] for r in rows], p + '.rows', 'heir')


def _table(v, p):
    if v is None:
        return
    if isinstance(v, dict) and 'layers' in v:
        obj(v, p, ('layers', 'rows', 'unallocated'))
        boolean(v['unallocated'], p + '.unallocated')
        for i, row in enumerate(array(v['rows'], p + '.rows')):
            obj(row, f'{p}.rows[{i}]', ('heir',))
            ident(row['heir'], f'{p}.rows[{i}].heir')
        for i, layer in enumerate(array(v['layers'], p + '.layers')):
            q = f'{p}.layers[{i}]'
            obj(layer, q, ('order', 'heir', 'table', 'p', 'base', 'gcd', 'old_multiplier', 'new_multiplier',
                           'relation', 'jamia', 'parts', 'unallocated', 'unallocated_cells'))
            integer(layer['order'], q + '.order', 1, 3)
            nullable(ident, layer['heir'], q + '.heir')
            _single_table(layer['table'], q + '.table')
            for key in ('p', 'gcd'):
                nullable(_number, layer[key], f'{q}.{key}')
            for key in ('base', 'old_multiplier', 'new_multiplier', 'jamia', 'unallocated'):
                _number(layer[key], f'{q}.{key}')
            nullable(code, layer['relation'], q + '.relation', ('no_share', 'tamathul', 'tawafuq', 'tabayun'))
            for j, part in enumerate(array(layer['parts'], q + '.parts')):
                obj(part, f'{q}.parts[{j}]', ('heir', 'value'))
                ident(part['heir'], f'{q}.parts[{j}].heir')
                _number(part['value'], f'{q}.parts[{j}].value')
            for j, cell in enumerate(array(layer['unallocated_cells'], q + '.unallocated_cells')):
                _number(cell, f'{q}.unallocated_cells[{j}]')
    else:
        _single_table(v, p)


def _evidence(v, p):
    obj(v, p, ('order', 'deceased', 'inherited', 'heirs', 'school_rules', 'steps', 'unallocated'))
    integer(v['order'], p + '.order', 1, 3)
    nullable(ident, v['deceased'], p + '.deceased')
    nullable(_fraction, v['inherited'], p + '.inherited')
    nullable(_fraction, v['unallocated'], p + '.unallocated')
    heirs = array(v['heirs'], p + '.heirs')
    for i, h in enumerate(heirs):
        q = f'{p}.heirs[{i}]'
        obj(h, q, ('person', 'stage', 'rule', 'condition', 'blocked_by', 'school_rule', 'option', 'verses'))
        ident(h['person'], q + '.person')
        if h['stage'] is not None:
            obj(h['stage'], q + '.stage', ('step', 'base'))
            code(h['stage']['step'], q + '.stage.step', codes.PROOF_STEPS)
            integer(h['stage']['base'], q + '.stage.base', 1)
        for key, vocabulary in (('rule', codes.PROOF_RULES), ('condition', codes.PROOF_CONDITIONS),
                                ('blocked_by', codes.BLOCKED_BY), ('school_rule', codes.SCHOOL_RULES),
                                ('option', codes.PROOF_OPTIONS)):
            if key == 'rule':
                _label(h[key], q + '.' + key, vocabulary)
            else:
                nullable(_label, h[key], q + '.' + key, vocabulary)
        for j, verse in enumerate(array(h['verses'], q + '.verses')):
            _label(verse, f'{q}.verses[{j}]', ('quran_4_11', 'quran_4_12', 'quran_4_176'))
    unique([h['person'] for h in heirs], p + '.heirs', 'person')
    for i, rule in enumerate(array(v['school_rules'], p + '.school_rules')):
        _label(rule, f'{p}.school_rules[{i}]', codes.SCHOOL_RULES)
    for i, step in enumerate(array(v['steps'], p + '.steps')):
        q = f'{p}.steps[{i}]'
        obj(step, q, ('step', 'text', 'params'))
        code(step['step'], q + '.step', codes.PROOF_STEPS)
        string(step['text'], q + '.text', True)
        if not isinstance(step['params'], dict):
            fail(q + '.params', 'must be an object')
        for name, param in step['params'].items():
            snake(name, q + '.params')
            _param(param, q + '.params.' + name)


def parse_presented_result(data):
    check_version(data, 'version', 'presented_result')
    p = 'presented_result'
    obj(data, p, tuple(PresentedResult.__dataclass_fields__))
    pattern(data['locale'], p + '.locale', LANG_RE, 'a locale tag')
    code(data['direction'], p + '.direction', ('ltr', 'rtl'))
    basis = parse_basis(data['basis'])
    state = code(data['state'], p + '.state', ('answer', 'selection_required', 'refused'))
    outcome = nullable(code, data['comparison_outcome'], p + '.comparison_outcome', codes.COMPARISON_OUTCOMES)
    if data['school_line'] is not None:
        _label(data['school_line'], p + '.school_line', ('same_in_all_schools', 'school'))
    rows = array(data['rows'], p + '.rows')
    for i, row in enumerate(rows):
        q = f'{p}.rows[{i}]'
        obj(row, q, ('person', 'name', 'relationship', 'kind', 'blocked', 'share', 'percent', 'kirat', 'amount'))
        ident(row['person'], q + '.person')
        nullable(_text, row['name'], q + '.name', 'auto', True)
        obj(row['relationship'], q + '.relationship', ('translated', 'original'))
        _segment(row['relationship']['translated'], q + '.relationship.translated')
        _segment(row['relationship']['original'], q + '.relationship.original', True)
        code(row['kind'], q + '.kind', codes.ALLOCATION_KINDS)
        boolean(row['blocked'], q + '.blocked')
        _fraction(row['share'], q + '.share')
        if row['blocked'] != (fraction(row['share']['fraction'], q + '.share') == 0):
            fail(q, 'blocked means a zero final share')
        _text(row['percent'], q + '.percent')
        _text(row['kirat'], q + '.kirat')
        _money(row['amount'], q + '.amount')
    unique([r['person'] for r in rows], p + '.rows', 'person')
    _money(data['rounding'], p + '.rounding', True)
    if data['rounding'] is not None and data['rounding']['amount_minor'] == 0:
        fail(p + '.rounding', 'rounding is emitted only when nonzero')
    if data['unallocated'] is not None:
        u = data['unallocated']
        obj(u, p + '.unallocated', ('fraction', 'text', 'dir', 'amount'))
        _fraction({k: u[k] for k in ('fraction', 'text', 'dir')}, p + '.unallocated')
        _money(u['amount'], p + '.unallocated.amount')
    _comparison(data['comparison'], p + '.comparison')
    evidence = array(data['evidence'], p + '.evidence')
    for i, entry in enumerate(evidence):
        _evidence(entry, f'{p}.evidence[{i}]')
    orders = [e['order'] for e in evidence]
    if orders != list(range(1, len(orders) + 1)):
        fail(p + '.evidence', 'estates must be in death order')
    refusals = array(data['refusals'], p + '.refusals')
    for i, refusal in enumerate(refusals):
        _refusal(refusal, f'{p}.refusals[{i}]', True)
    unique([r['reason'] for r in refusals], p + '.refusals', 'reason')
    notices = array(data['notices'], p + '.notices')
    for i, notice in enumerate(notices):
        q = f'{p}.notices[{i}]'
        obj(notice, q, ('code', 'text'))
        code(notice['code'], q + '.code', ('disclaimer', 'country_notice', 'citation', 'civil_law',
                                         'obligatory_bequest_prompt', 'locale_beta'))
        nullable(string, notice['text'], q + '.text', True)
    unique([n['code'] for n in notices], p + '.notices', 'notice')
    _table(data['table'], p + '.table')
    if state != 'answer' and data['table'] is not None:
        fail(p, 'only an answer has a table')
    if state == 'refused':
        if rows or data['comparison'] is not None or data['school_line'] is not None or evidence:
            fail(p, 'a refused answer has no rows, comparison, school line or evidence')
        if not refusals or data['rounding'] is not None or data['unallocated'] is not None:
            fail(p, 'a refused answer names its refusal and has no amounts')
    elif state == 'selection_required':
        if outcome != 'difference' or rows or data['comparison'] is None or evidence or data['school_line'] is not None:
            fail(p, 'selection requires a comparison difference and no answer or evidence')
        if data['rounding'] is not None or data['unallocated'] is not None:
            fail(p, 'selection has no amounts')
    elif not rows or data['school_line'] is None or data['comparison'] is not None or refusals:
        fail(p, 'an answer has rows and a school line, without comparison or refusals')
    if basis.kind == 'compare':
        if outcome != {'answer': 'agreement', 'selection_required': 'difference', 'refused': 'all_refused'}[state]:
            fail(p, 'compare state must match its outcome')
        if state == 'answer' and data['school_line']['code'] != 'same_in_all_schools':
            fail(p, 'agreement uses the shared School line')
    elif outcome is not None or state == 'selection_required' or (state == 'answer' and data['school_line']['code'] != 'school'):
        fail(p, 'a School or Country answer has no comparison outcome')
    values = deepcopy(data)
    values['basis'] = basis
    for key in ('rows', 'evidence', 'refusals', 'notices'):
        values[key] = tuple(values[key])
    return PresentedResult(**values)


def dump_presented_result(presented):
    values = deepcopy(vars(presented))
    values['basis'] = dump_basis(presented.basis)
    for key in ('rows', 'evidence', 'refusals', 'notices'):
        values[key] = list(values[key])
    return values
