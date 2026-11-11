"""Presentation only: fractions, money, proofs and table parts come from preview."""
from django.template.loader import render_to_string
from django.utils import timezone, translation
from django.utils.translation import gettext as _, gettext_noop

from api import anonymous_case


RELATIONSHIPS = {
    'father': gettext_noop('Report relationship: father'),
    'mother': gettext_noop('Report relationship: mother'),
    'husband': gettext_noop('Report relationship: husband'),
    'wife': gettext_noop('Report relationship: wife'),
    'son': gettext_noop('Report relationship: son'),
    'daughter': gettext_noop('Report relationship: daughter'),
    'son_of_son': gettext_noop('Report relationship: son_of_son'),
    'daughter_of_son': gettext_noop('Report relationship: daughter_of_son'),
    'grandfather': gettext_noop('Report relationship: grandfather'),
    'paternal_grandmother': gettext_noop('Report relationship: paternal_grandmother'),
    'maternal_grandmother': gettext_noop('Report relationship: maternal_grandmother'),
    'brother': gettext_noop('Report relationship: brother'),
    'sister': gettext_noop('Report relationship: sister'),
    'paternal_brother': gettext_noop('Report relationship: paternal_brother'),
    'paternal_sister': gettext_noop('Report relationship: paternal_sister'),
    'maternal_brother': gettext_noop('Report relationship: maternal_brother'),
    'maternal_sister': gettext_noop('Report relationship: maternal_sister'),
    'son_of_brother': gettext_noop('Report relationship: son_of_brother'),
    'son_of_paternal_brother': gettext_noop('Report relationship: son_of_paternal_brother'),
    'uncle': gettext_noop('Report relationship: uncle'),
    'paternal_uncle': gettext_noop('Report relationship: paternal_uncle'),
    'son_of_uncle': gettext_noop('Report relationship: son_of_uncle'),
    'son_of_paternal_uncle': gettext_noop('Report relationship: son_of_paternal_uncle'),
}
COMBINATION_RELATIONS = {
    'tamathul': gettext_noop('Equality'),
    'tawafuq': gettext_noop('Common factor'),
    'tabayun': gettext_noop('Coprime'),
    'no_share': gettext_noop('No share'),
}
SCHOOLS = {
    'hanafi': gettext_noop('Report school: hanafi'),
    'maliki': gettext_noop('Report school: maliki'),
    'shafii': gettext_noop('Report school: shafii'),
    'hanbali': gettext_noop('Report school: hanbali'),
    'jafari': gettext_noop('Report school: jafari'),
}


def percent_of(numerator, denominator):
    tenths = (numerator * 2000 + denominator) // (2 * denominator)
    return f'{tenths // 10}.{tenths % 10}'


def kirat_of(numerator, denominator):
    hundredths = (numerator * 4800 + denominator) // (2 * denominator)
    return f'{hundredths // 100}.{hundredths % 100:02}'


def fraction(value):
    return f"{value['numerator']}/{value['denominator']}" if value is not None else '—'


def build_context(case, body):
    rows = anonymous_case._rows({**case, 'deaths': case.get('deaths', [])})
    def relation(row):
        return _(RELATIONSHIPS[row['relationship']])
    def name(key):
        row = rows[key]
        return row.get('name') or relation(row)
    shares = []
    for share in body['shares']:
        row = rows[share['heir_id']]
        shares.append({**share, 'name': name(share['heir_id']), 'relationship': relation(row),
                       'fraction': fraction(share),
                       'percent': percent_of(share['numerator'], share['denominator']),
                       'kirat': kirat_of(share['numerator'], share['denominator'])})
    proof = body.get('proof')
    evidence = []
    if proof:
        layers = proof['layers'] if proof['version'] == 2 else [{'order': None, 'proof': proof}]
        for layer in layers:
            evidence.append({'order': layer['order'],
                             'deceased': name(layer['deceased']) if layer.get('deceased') else '',
                             'heirs': [{'name': name(entry['heir']), 'labels': entry['labels']}
                                       for entry in layer['proof']['heirs']],
                             'school_rules': layer['proof']['school_rule_labels']})
    table = body.get('table')
    tables = []
    if table:
        layers = table['layers'] if 'layers' in table else [{'order': None, 'table': table}]
        for layer in layers:
            source = layer['table']
            tables.append({**layer, 'deceased': name(layer['heir']) if layer.get('heir') else '',
                           'relation_label': _(COMBINATION_RELATIONS[layer['relation']]) if layer.get('relation') else '',
                           'columns': source['columns'],
                           'rows': [{**row, 'name': name(row['heir']),
                                     'prescribed_fraction': fraction(row['prescribed'])}
                                    for row in source['rows']],
                           'parts': [{'name': name(part['heir']), 'value': part['value']}
                                     for part in layer.get('parts', [])]})
    locale = translation.get_language() or 'en'
    return {'locale': locale, 'direction': 'rtl' if locale.split('-')[0] == 'ar' else 'ltr',
            'generated': timezone.now(), 'school': _(SCHOOLS[body['madhab']]),
            'deceased': _('Male') if case['deceased']['gender'] == 'male' else _('Female'), 'estate': body['basis']['estate'],
            'shares': shares, 'evidence': evidence, 'tables': tables,
            'unallocated': fraction(body['unallocated']) if body.get('unallocated') else None}


def render_html(case, body):
    return render_to_string('reports/draft.html', build_context(case, body))


def render_pdf(case, body):
    # Native libraries may be absent on development hosts. Keep Django importable.
    from weasyprint import HTML
    return HTML(string=render_html(case, body)).write_pdf()
