"""Presentation only: every number, comparison, School line and evidence text is the PresentedResult's.

The report draws `body['presented']` (the one server-produced PresentedResult) and adds only layout and the
names the visitor typed, which the preview never carries.
"""
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.safestring import mark_safe
from django.utils.translation import gettext as _, gettext_noop

import i18n
from api import anonymous_case
from presentation import format_datetime


COMBINATION_RELATIONS = {
    'tamathul': gettext_noop('Equality'),
    'tawafuq': gettext_noop('Common factor'),
    'tabayun': gettext_noop('Coprime'),
    'no_share': gettext_noop('No share'),
}
LABEL_KINDS = ('rule', 'condition', 'blocked_by', 'verse', 'school_rule', 'option')


def _label(entry, kind):
    if kind == 'verse':
        return '; '.join(verse['text'] for verse in entry['verses']) or None
    label = entry[kind]
    return None if label is None else label['text']


def build_context(case, body):
    presented = body['presented']
    locale = presented['locale']
    config = i18n.locale_config(locale)
    rows = anonymous_case._rows({**case, 'deaths': case.get('deaths', [])})
    relationships = {row['person']: row['relationship']['translated']['text'] for row in presented['rows']}

    def own(row):
        return row.get('name') or i18n.term(f"relationship.{row['relationship']}", locale)

    def person_of(key):
        while rows[key].get('same_as'):
            key = rows[key]['same_as']
        return key

    # In an estate a person is shown as that estate's own heir, so a wife who later dies is a mother there.
    in_estate = {order: {person_of(row['id']): own(row) for row in entries}
                 for order, (_key, _deceased, entries) in enumerate(anonymous_case._layers(
                     {**case, 'deaths': case.get('deaths', [])}), 1)}

    def name(key, order=1):
        if key in in_estate.get(order, {}):
            return in_estate[order][key]
        row = rows.get(key)
        return (row.get('name') if row else None) or relationships.get(key) or (own(row) if row else key)

    shares = [{**row, 'name': name(row['person']), 'relationship': row['relationship']['translated']['text'],
               'fraction': row['share']} for row in presented['rows']]
    layered = len(presented['evidence']) > 1
    evidence = [{'order': entry['order'] if layered else None,
                 'deceased': name(entry['deceased']) if entry['deceased'] else '',
                 'heirs': [{'name': name(heir['person'], entry['order']), 'labels': {kind: _label(heir, kind) for kind in LABEL_KINDS}}
                           for heir in entry['heirs']],
                 'school_rules': [rule['text'] for rule in entry['school_rules']]}
                for entry in presented['evidence']]
    table = presented['table']
    tables = []
    if table:
        for layer in (table['layers'] if 'layers' in table else [{'order': None, 'table': table}]):
            relation = layer.get('relation')
            tables.append({
                **layer, 'deceased': name(layer['heir']) if layer.get('heir') else '',
                'relation_label': _(COMBINATION_RELATIONS[relation]) if relation else '',
                'columns': layer['table']['columns'],
                'rows': [{**row, 'name': name(row['heir'], layer['order'] or 1)} for row in layer['table']['rows']],
                'parts': [{'name': name(part['heir']), 'value': part['value']} for part in layer.get('parts', [])],
                'unallocated_cells': layer.get('unallocated_cells', []),
            })
    estate = body['basis']['estate']
    font_family = mark_safe(', '.join([f'"{family}"' for family in config['pdf_font_stack']] + ['sans-serif']))
    return {'locale': locale, 'direction': config['direction'], 'font_family': font_family,
            'generated': format_datetime(timezone.now(), locale),
            'school': presented['school_line']['text'],
            'deceased': _('Male') if case['deceased']['gender'] == 'male' else _('Female'),
            'estate': estate, 'with_amount': estate is not None,
            'shares': shares, 'evidence': evidence, 'tables': tables,
            'rounding': presented['rounding'], 'unallocated': presented['unallocated']}


def render_html(case, body):
    return render_to_string('reports/draft.html', build_context(case, body))


def render_pdf(case, body):
    # Native libraries may be absent on development hosts. Keep Django importable.
    from weasyprint import HTML
    return HTML(string=render_html(case, body)).write_pdf()
