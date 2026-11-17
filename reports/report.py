"""Presentation only: fractions, money, proofs and table parts come from preview."""
from django.template.loader import render_to_string
from django.utils import timezone, translation
from django.utils.safestring import mark_safe
from django.utils.translation import gettext as _, gettext_noop

import i18n
from api import anonymous_case


COMBINATION_RELATIONS = {
    'tamathul': gettext_noop('Equality'),
    'tawafuq': gettext_noop('Common factor'),
    'tabayun': gettext_noop('Coprime'),
    'no_share': gettext_noop('No share'),
}
SAME_IN_ALL_SCHOOLS = gettext_noop('Same result in all four Sunni schools')


def percent_of(numerator, denominator):
    tenths = (numerator * 2000 + denominator) // (2 * denominator)
    return f'{tenths // 10}.{tenths % 10}'


def kirat_of(numerator, denominator):
    hundredths = (numerator * 4800 + denominator) // (2 * denominator)
    return f'{hundredths // 100}.{hundredths % 100:02}'


def fraction(value):
    return f"{value['numerator']}/{value['denominator']}" if value is not None else '—'


def build_context(case, body):
    locale = translation.get_language() or 'en'
    config = i18n.locale_config(i18n.resolve_locale(locale))
    rows = anonymous_case._rows({**case, 'deaths': case.get('deaths', [])})
    def relation(row):
        return i18n.term(f"relationship.{row['relationship']}", locale)
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
    font_family = mark_safe(', '.join([f'"{family}"' for family in config['pdf_font_stack']] + ['sans-serif']))
    return {'locale': locale, 'direction': config['direction'], 'font_family': font_family,
            'generated': timezone.now(), 'school': i18n.term(f"school.{body['madhab']}", locale) if body['madhab'] else _(SAME_IN_ALL_SCHOOLS),
            'deceased': _('Male') if case['deceased']['gender'] == 'male' else _('Female'),
            'estate': body['basis']['estate'], 'with_amount': body['basis']['estate'] is not None,
            'shares': shares, 'evidence': evidence, 'tables': tables,
            'unallocated': fraction(body['unallocated']) if body.get('unallocated') else None}


def render_html(case, body):
    return render_to_string('reports/draft.html', build_context(case, body))


def render_pdf(case, body):
    # Native libraries may be absent on development hosts. Keep Django importable.
    from weasyprint import HTML
    return HTML(string=render_html(case, body)).write_pdf()
