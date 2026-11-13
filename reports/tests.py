import copy
import json
from fractions import Fraction
from html.parser import HTMLParser
from pathlib import Path
import shutil
import subprocess
import tempfile
from unittest import mock

from django.conf import settings
from django.core.cache import cache
from django.test import SimpleTestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import translation
from rest_framework.test import APIClient

from api import anonymous_case
from reports.report import build_context, kirat_of, percent_of, render_html, render_pdf
from reports.status import report_status

FIXTURES = json.loads((Path(settings.BASE_DIR) / 'api/contracts/preview-fixtures.json').read_text())['fixtures']
AVAILABLE = [f for f in FIXTURES if f['response']['status'] == 'available']


class RenderedReport(HTMLParser):
    """Inspect actual rendered cells, including omitted cells under rowspans."""
    def __init__(self, html):
        super().__init__()
        self.tables = []
        self.combinations = []
        self.cell = None
        self.definition = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.tables.append([])
        elif tag == 'tr':
            self.tables[-1].append([])
        elif tag in ('td', 'th'):
            self.cell = [dict(attrs), '']
            self.tables[-1][-1].append(self.cell)
        elif tag == 'dl':
            self.combinations.append([])
        elif tag in ('dt', 'dd'):
            self.definition = ['', '']
            self.definition[0] = tag
            self.combinations[-1].append(self.definition)

    def handle_data(self, data):
        if self.cell is not None:
            self.cell[1] += data
        if self.definition is not None:
            self.definition[1] += data

    def handle_endtag(self, tag):
        if tag in ('td', 'th'):
            self.cell = None
        if tag in ('dt', 'dd'):
            self.definition = None


def other_status(case):
    return 'other'


class ReportContentTests(SimpleTestCase):
    def test_status_extension(self):
        self.assertEqual(report_status({}), 'draft')
        with override_settings(REPORT_STATUS_PROVIDER='reports.tests.other_status'):
            self.assertEqual(report_status({}), 'other')

    def test_rounding_matches_integer_half_up_for_all_fixtures(self):
        for f in AVAILABLE:
            context = build_context(f['case'], f['response'])
            for row, share in zip(context['shares'], f['response']['shares']):
                n, d = share['numerator'], share['denominator']
                tenths = int(Fraction(n * 1000, d) + Fraction(1, 2))
                hundredths = int(Fraction(n * 2400, d) + Fraction(1, 2))
                self.assertEqual(row['percent'], f'{tenths // 10}.{tenths % 10}')
                self.assertEqual(row['kirat'], f'{hundredths // 100}.{hundredths % 100:02}')
                self.assertEqual(row['amount'], share['amount'])
        self.assertEqual(percent_of(1, 16), '6.3')
        self.assertEqual(kirat_of(1, 64), '0.38')

    def test_sections_tables_and_proofs_for_every_available_fixture(self):
        with translation.override('en'):
            for fixture in AVAILABLE:
                with self.subTest(fixture['title']):
                    case, body = fixture['case'], fixture['response']
                    html = render_html(case, body)
                    self.assertIn('Heirs and shares', html)
                    self.assertIn('Proof summary', html)
                    self.assertIn('Draft / not certified', html)
                    self.assertIn('position: fixed', html)
                    self.assertIn('DRAFT', html)
                    for forbidden in ['<svg', '<img', 'signature', 'registry', 'seal']:
                        self.assertNotIn(forbidden, html)
                    context = build_context(case, body)
                    for layer in context['evidence']:
                        for heir in layer['heirs']:
                            for label in heir['labels'].values():
                                if label:
                                    from django.utils.html import escape
                                    self.assertIn(escape(label), html)
                    if body['table']:
                        self.assertIn("Scholars&#x27; table", html.replace("Scholars' table", "Scholars&#x27; table"))
                    if body['proof']['version'] == 2:
                        self.assertEqual(len(context['tables']), len(body['table']['layers']) if body['table'] else 0)
                        self.assertEqual(len(context['evidence']), len(body['proof']['layers']))
                    if body['unallocated']:
                        self.assertIn('Unallocated remainder', html)

    def test_shares_only_report_without_estate(self):
        fixtures = [f for f in AVAILABLE if f['response'].get('table') and f['response']['basis']['estate']
                    and any(s['blocked'] for s in f['response']['shares'])]
        self.assertTrue(fixtures)
        for fixture in fixtures:
            with self.subTest(fixture['title']), translation.override('en'):
                case, body = fixture['case'], copy.deepcopy(fixture['response'])
                with_estate = render_html(case, body)
                def deceased_line(html):
                    return html.split('</h2>', 2)[1].split('</p>')[0]
                self.assertIn('Estate:', deceased_line(with_estate))
                self.assertEqual(len(RenderedReport(with_estate).tables[0][0]), 6)
                body['basis']['estate'] = None
                for share in body['shares']:
                    share['amount'] = None
                html = render_html(case, body)
                self.assertNotIn('Estate', deceased_line(html))
                self.assertNotIn('—', deceased_line(html))
                parsed = RenderedReport(html)
                self.assertEqual([c[1] for c in parsed.tables[0][0]],
                                 ['Name', 'Relationship', 'Fraction', 'Percentage', 'Kirat'])
                for cells, share in zip(parsed.tables[0][1:], body['shares'], strict=True):
                    if share['blocked']:
                        self.assertEqual(cells[2:], [[{'colspan': '3'}, 'Blocked']])
                    else:
                        self.assertEqual(len(cells), 5)
                        self.assertNotIn('\u2014', cells[-1][1])

    def test_rendered_values_and_rowspans(self):
        # Include blocked, shared-row, corrected, and three-death fixtures.
        fixtures = [f for f in AVAILABLE if f['response'].get('table')]
        for fixture in fixtures:
            with self.subTest(fixture['title']), translation.override('en'):
                case, body = fixture['case'], fixture['response']
                parsed = RenderedReport(render_html(case, body))
                names = anonymous_case._rows({**case, 'deaths': case.get('deaths', [])})
                def name(key):
                    row = names[key]
                    from reports.report import RELATIONSHIPS
                    from django.utils.translation import gettext
                    return row.get('name') or gettext(RELATIONSHIPS[row['relationship']])
                with_amount = body['basis']['estate'] is not None
                for cells, share in zip(parsed.tables[0][1:], body['shares'], strict=True):
                    self.assertEqual(cells[0][1], name(share['heir_id']))
                    if share['blocked']:
                        self.assertEqual(cells[2:], [[{'colspan': '4' if with_amount else '3'}, 'Blocked']])
                    else:
                        n, d = share['numerator'], share['denominator']
                        percent = int(Fraction(n * 1000, d) + Fraction(1, 2))
                        kirat = int(Fraction(n * 2400, d) + Fraction(1, 2))
                        self.assertEqual([c[1] for c in cells[2:]], [
                            f'{n}/{d}', f'{percent // 10}.{percent % 10}%',
                            f'{kirat // 100}.{kirat % 100:02}',
                            *([share['amount'] or '\u2014'] if with_amount else [])])
                layered = 'layers' in body['table']
                layers = body['table']['layers'] if layered else [{'table': body['table']}]
                for index, layer in enumerate(layers):
                    rendered = parsed.tables[1 if index == 0 else index * 2]
                    source = layer['table']
                    self.assertEqual([c[1].strip() for c in rendered[0][2:]],
                                     [f"{c['label']}{c['total']}" for c in source['columns']])
                    for actual, row in zip(rendered[1:1 + len(source['rows'])], source['rows'], strict=True):
                        expected = [[{}, name(row['heir'])]]
                        if row['group_span']:
                            value = ('Blocked' if row['blocked'] else
                                     f"{row['prescribed']['numerator']}/{row['prescribed']['denominator']}" if row['prescribed'] else '\u2014')
                            expected.append([{'rowspan': str(row['group_span'])}, value])
                        expected.extend([{'rowspan': str(c['span'])}, str(c['value'])] for c in row['cells'] if c['span'])
                        self.assertEqual(actual, expected)
                    if layered:
                        self.assertEqual(len(rendered), 1 + len(source['rows']) + bool(layer['unallocated']))
                    if layered and index > 0:
                        parts = parsed.tables[1 + index * 2]
                        self.assertEqual([[c[1] for c in r] for r in parts[1:1 + len(layer['parts'])]],
                                         [[name(p['heir']), str(p['value'])] for p in layer['parts']])
                if layered:
                    self.assertEqual(len(parsed.combinations), len(layers) - 1)
                    relations = {'tamathul': 'Equality', 'tawafuq': 'Common factor', 'tabayun': 'Coprime', 'no_share': 'No share'}
                    for actual, layer in zip(parsed.combinations, layers[1:], strict=True):
                        self.assertEqual(actual, [
                            ['dt', "Deceased's parts (p)"], ['dd', str(layer['p']) if layer['p'] else 'No share'],
                            ['dt', 'GCD'], ['dd', str(layer['gcd'])],
                            ['dt', 'Relation'], ['dd', relations[layer['relation']]],
                            ['dt', "Old jami'a multiplier"], ['dd', str(layer['old_multiplier'])],
                            ['dt', 'New problem multiplier'], ['dd', str(layer['new_multiplier'])],
                            ['dt', "New jami'a"], ['dd', str(layer['jamia'])]])

    def test_the_school_line_says_all_four_agree_when_the_case_has_no_school(self):
        fixture = next(f for f in AVAILABLE if f['response'].get('agreement') == 'all')
        self.assertIsNone(fixture['case']['madhab'])
        for lang, line in [('en', 'Same result in all four Sunni schools'),
                           ('fr', 'Même résultat dans les quatre écoles sunnites'),
                           ('ar', 'النتيجة نفسها في المذاهب السنية الأربعة')]:
            with translation.override(lang):
                self.assertEqual(build_context(fixture['case'], fixture['response'])['school'], line)
                self.assertIn(line, render_html(fixture['case'], fixture['response']))
        with translation.override('en'):
            hanafi = next(f for f in AVAILABLE if f['case']['madhab'] == 'hanafi')
            self.assertEqual(build_context(hanafi['case'], hanafi['response'])['school'], 'Hanafi')

    def test_locales_rtl_and_escaping(self):
        f = copy.deepcopy(AVAILABLE[0])
        f['case']['heirs'][0]['name'] = '<script>secret</script>'
        for lang, disclaimer in [('ar', 'مسودة / غير معتمدة'), ('en', 'Draft / not certified'), ('fr', 'Brouillon / non certifié')]:
            with translation.override(lang):
                html = render_html(f['case'], f['response'])
                self.assertIn(f'dir="{"rtl" if lang == "ar" else "ltr"}"', html)
                self.assertIn(disclaimer, html)
                self.assertIn('<bdi>', html)
                self.assertIn('&lt;script&gt;', html)
                self.assertNotIn('<script>', html)
                self.assertNotIn('Report relationship:', html)
                self.assertNotIn('Report school:', html)

    def test_real_pdf_bytes_and_repeated_disclaimer(self):
        try:
            import weasyprint  # noqa: F401
        except (OSError, ImportError) as error:
            self.skipTest(type(error).__name__ + ': WeasyPrint native libraries unavailable')
        f = AVAILABLE[0]
        # A long name per row forces several pages without changing any numbers.
        case, body = copy.deepcopy(f['case']), copy.deepcopy(f['response'])
        case['heirs'][0]['name'] = 'Long heir name ' * 40
        body['shares'] *= 40
        with translation.override('en'):
            pdf = render_pdf(case, body)
        self.assertTrue(pdf.startswith(b'%PDF'))
        if not shutil.which('pdftotext'):
            self.skipTest('pdftotext unavailable for PDF text extraction')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'draft.pdf'
            path.write_bytes(pdf)
            result = subprocess.run(['pdftotext', str(path), '-'], capture_output=True, check=True)
        pages = [page for page in result.stdout.decode().split('\f') if page.strip()]
        self.assertGreater(len(pages), 1)
        for page in pages:
            self.assertIn('Draft / not certified', page)
            self.assertIn('DRAFT', page)


class DraftEndpointTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.url = reverse('api:report-draft')
        self.fixture = copy.deepcopy(AVAILABLE[0])
        self.case = self.fixture['case']
        session = self.client.session
        session[anonymous_case.SESSION_KEY] = self.case
        session.save()

    def get(self, case_id='c1', **headers):
        return self.client.get(self.url, {'case_id': case_id} if case_id is not None else {}, secure=True, **headers)

    def test_missing_absent_and_stale(self):
        self.assertEqual(self.get(None).status_code, 400)
        self.assertEqual(self.get('different').status_code, 409)
        self.client = APIClient()
        self.assertEqual(self.get().status_code, 404)

    def test_available_pdf_headers_and_no_storage(self):
        from calc.models import Calculation
        session_before = dict(self.client.session)
        with mock.patch('reports.views.render_pdf', return_value=b'%PDF-test') as render:
            response = self.get(HTTP_ACCEPT_LANGUAGE='fr', HTTP_ACCEPT='application/pdf')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertIn('attachment; filename="mawareeth-draft-', response['Content-Disposition'])
        self.assertIn('no-store', response['Cache-Control'])
        self.assertEqual(render.call_args.args[1]['status'], 'available')
        self.assertEqual(dict(self.client.session), session_before)
        self.assertEqual(Calculation.objects.count(), 0)

    def test_wildcard_and_absent_accept(self):
        with mock.patch('reports.views.render_pdf', return_value=b'%PDF-test'):
            for headers in ({}, {'HTTP_ACCEPT': '*/*'}):
                self.assertEqual(self.get(**headers).status_code, 200)

    def test_successive_deaths_use_final_shares_and_per_death_proof(self):
        for count in (1, 2):
            fixture = next(f for f in AVAILABLE if len(f['case'].get('deaths', [])) == count)
            case = fixture['case']
            session = self.client.session
            session[anonymous_case.SESSION_KEY] = case
            session.save()
            with mock.patch('reports.views.render_pdf', return_value=b'%PDF-test') as render:
                response = self.get(case['id'])
            self.assertEqual(response.status_code, 200)
            body = render.call_args.args[1]
            self.assertEqual(body['shares'], fixture['response']['shares'])
            self.assertEqual(body['proof']['version'], 2)
            self.assertEqual(len(body['proof']['layers']), count + 1)
            self.assertIsNotNone(body['table'])

    def test_unavailable_and_not_ready_never_render(self):
        for body in [{'status': 'not_ready'}, {'status': 'unavailable', 'reason': 'school_not_supported'}]:
            with mock.patch('reports.views.preview.preview', return_value=body), mock.patch('reports.views.render_pdf') as render:
                response = self.get(HTTP_ACCEPT='application/pdf')
            self.assertEqual(response['Content-Type'], 'application/json')
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json(), {'status': body['status'], 'reason': body.get('reason')})
            render.assert_not_called()

    def plant_fixture(self, title):
        case = copy.deepcopy(next(f for f in FIXTURES if f['title'] == title)['case'])
        session = self.client.session
        session[anonymous_case.SESSION_KEY] = case
        session.save()
        return case

    def test_a_null_school_case_whose_schools_differ_never_renders(self):
        case = self.plant_fixture('Differ: grandfather and full brother')
        self.assertIsNone(case['madhab'])
        with mock.patch('reports.views.render_pdf') as render:
            response = self.get(case['id'], HTTP_ACCEPT='application/pdf')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {'status': 'choose_school', 'reason': None})
        render.assert_not_called()

    def test_a_null_school_case_all_schools_agree_on_renders_the_pdf(self):
        case = self.plant_fixture('Agree: wife, son and daughter in every school')
        with mock.patch('reports.views.render_pdf', return_value=b'%PDF-test') as render:
            response = self.get(case['id'], HTTP_ACCEPT='application/pdf')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        body = render.call_args.args[1]
        self.assertEqual((body['status'], body['madhab'], body['agreement']), ('available', None, 'all'))

    def test_non_draft_and_failures_fail_closed_with_private_safe_logs(self):
        patches = [mock.patch('reports.views.report_status', return_value='other'),
                   mock.patch('reports.views.preview.preview', side_effect=RuntimeError('SECRET CASE CONTENT')),
                   mock.patch('reports.views.render_pdf', side_effect=OSError('SECRET CASE CONTENT'))]
        for patch in patches:
            with patch, self.assertLogs('reports.views', level='ERROR') as logs:
                response = self.get(HTTP_ACCEPT='application/pdf')
            self.assertEqual(response['Content-Type'], 'application/json')
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('SECRET CASE CONTENT', ''.join(logs.output))
            self.assertNotIn('SECRET CASE CONTENT', response.content.decode())

    def test_accept_language_overrides_cookie(self):
        self.client.cookies[settings.LANGUAGE_COOKIE_NAME] = 'en'
        languages = []
        def render(case, body):
            languages.append(translation.get_language())
            return b'%PDF-test'
        with mock.patch('reports.views.render_pdf', side_effect=render):
            self.assertEqual(self.get(HTTP_ACCEPT_LANGUAGE='ar').status_code, 200)
        self.assertEqual(languages, ['ar'])

    def test_throttle_is_30_per_hour(self):
        with mock.patch('reports.views.render_pdf', return_value=b'%PDF-test'):
            for _ in range(30):
                self.assertEqual(self.get().status_code, 200)
            response = self.get()
        self.assertEqual(response.status_code, 429)
        self.assertIn('Retry-After', response)
