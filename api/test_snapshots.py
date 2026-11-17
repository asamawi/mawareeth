"""Release compatibility gate and reader integration coverage."""
import json
from copy import deepcopy
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase
from django.utils import timezone

from api import anonymous_case, sharing
from api.legacy_cases import convert
from api.models import SavedCase, ShareInvite, ShareLink
from api.snapshots import READ_VERSIONS, WRITE_VERSION, SnapshotError, decode, encode_v2
from api.tests import InterviewHelpers
from calc.models import Deceased, Heir, Wife, Son, Mother, Brother
from calc.tests import build_case, build_layer

FIXTURES = Path(__file__).parent / 'fixtures' / 'snapshots'


def fixture(name, version=1):
    return json.loads((FIXTURES / f'v{version}-{name}.json').read_text(encoding='utf-8'))


def normalized(snapshot):
    value = deepcopy(snapshot)
    if value['deceased'] and value['deceased']['estate'] is not None:
        value['deceased']['estate'] = Decimal(value['deceased']['estate'])
    for death in value['deaths']:
        for row in death['heirs']:
            if row.get('same_as'):
                row['id'] = row['same_as'] + '~' + str(death['order'])
    return value


def normalized_body(value):
    if isinstance(value, dict):
        return {key: (Decimal(item) if key == 'estate' and isinstance(item, str) else
                      normalized_body(item)) for key, item in value.items()}
    if isinstance(value, list):
        return [normalized_body(item) for item in value]
    return 'wife~2' if value == 'alias' else value


class SnapshotTests(InterviewHelpers, TestCase):
    def setUp(self):
        super().setUp()
        self.owner = get_user_model().objects.create_user(username='snapshot-owner')
        self.client.force_login(self.owner)
        recipient = get_user_model().objects.create_user(username='snapshot-recipient')
        self.reader = self.client.__class__(enforce_csrf_checks=True)
        self.reader.force_login(recipient)
        self.recipient = recipient

    def roundtrip(self, snapshot):
        v2 = encode_v2(snapshot)
        decoded = decode(2, v2, 'id', 'time')
        self.assertEqual(normalized(anonymous_case.export_snapshot(decoded)), normalized(snapshot))
        self.assertEqual(encode_v2(anonymous_case.export_snapshot(decoded)), v2)

    def test_fixture_and_release_matrix(self):
        matrix = json.loads((FIXTURES / 'matrix.json').read_text())
        self.assertEqual((matrix[-1]['reads'], matrix[-1]['writes']), (list(READ_VERSIONS), WRITE_VERSION))
        self.assertIn(1, READ_VERSIONS)
        for index, image in enumerate(matrix):
            for neighbour in matrix[max(0, index-1):index+2]:
                self.assertIn(image['writes'], neighbour['reads'])
        for path in FIXTURES.glob('v1-*.json'):
            name = path.stem[3:]
            snapshot = fixture(name)
            self.roundtrip(snapshot)
            self.assertEqual(encode_v2(snapshot), fixture(name, 2))
            for version in READ_VERSIONS:
                decode(version, fixture(name, version), 'id', 'time')

    def test_legacy_conversions_and_live_interview(self):
        root, _ = build_case('M', [Wife, Son], estate=120000)
        self.roundtrip(convert(root, ContentType, Heir, Deceased))
        root, (wife, son, brother) = build_case('M', [Wife, Son, Brother])
        second, later = build_layer(root, son, 'M', [Mother, Brother], [(0, wife), (1, brother)])
        self.roundtrip(convert(root, ContentType, Heir, Deceased))
        build_layer(second, later[0], 'F', [Son, Brother], [(1, later[1])], order=3)
        self.roundtrip(convert(root, ContentType, Heir, Deceased))
        case = self.ready()
        self.heir(case, 'wife')
        self.heir(case, 'son', name='Ali')
        self.roundtrip(anonymous_case.export_snapshot(self.live()))

    def readers(self, snapshot, version):
        row = SavedCase.objects.create(owner=self.owner, snapshot=snapshot, schema_version=version)
        share, token = sharing.issue(row, ShareLink.PUBLIC, self.owner)
        invite = ShareInvite.objects.create(saved_case=row, email='reader@example.com', token_hash=f'token-{row.pk}',
                    accepted_by=self.recipient, accepted_at=timezone.now(), expires_at=timezone.now()+timedelta(days=1))
        return row, share, token, invite

    def test_twins_list_open_share_received_and_pdfs(self):
        for name in ('estate', 'no-estate', 'compare', 'jafari', 'later-deaths'):
            bodies = []
            pdf_calls = []
            for version in READ_VERSIONS:
                row, share, token, invite = self.readers(fixture(name, version), version)
                listed = self.client.get('/api/v1/saved-cases/', secure=True).json()['cases']
                summary = next(item for item in listed if item['id'] == row.pk)
                self.assertEqual(summary['madhab'], fixture(name)['madhab'])
                self.assertEqual(summary['heir_count'], 2)
                opened = self.send('post', f'/api/v1/saved-cases/{row.pk}/open/', {})
                self.assertEqual(opened.status_code, 200)
                case = opened.json()['case']
                self.assertEqual(normalized(anonymous_case.export_snapshot(case)), normalized(fixture(name)))
                views = [self.send('post', '/api/v1/shares/view/', {'token': token}),
                         self.send('post', f'/api/v1/received/{invite.pk}/view/', {}, self.reader)]
                for response in views:
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(normalized(anonymous_case.export_snapshot(response.json()['case'])), normalized(fixture(name)))
                bodies.append([response.json()['preview'] for response in views])
                with patch('reports.views.render_pdf', return_value=b'%PDF-test') as render:
                    for response in (self.send('post', '/api/v1/shares/report/', {'token': token}),
                                     self.send('post', f'/api/v1/received/{invite.pk}/report/', {}, self.reader),
                                     self.client.get(f'/api/v1/reports/draft/?case_id={case["id"]}', secure=True)):
                        self.assertEqual(response.status_code, 409 if name == 'jafari' else 200)
                    self.assertEqual(render.call_count, 0 if name == 'jafari' else 3)
                    pdf_calls.append([
                        ((normalized(anonymous_case.export_snapshot(call.args[0])),
                          normalized_body(call.args[1]), *call.args[2:]), call.kwargs)
                        for call in render.call_args_list
                    ])
            # Preview identity fields can carry regenerated alias row ids.
            self.assertEqual(normalized_body(bodies[0]), normalized_body(bodies[1]))
            self.assertEqual(pdf_calls[0], pdf_calls[1])

    def invalids(self):
        valid = fixture('estate', 2)
        for basis, code in [({'kind':'school'}, 'invalid_basis'),
                            ({'kind':'country','preset_id':'sa','preset_version':'2026-01-01'}, 'preset_unavailable')]:
            yield 2, {**deepcopy(valid), 'basis':basis}, code
        yield 3, valid, 'unsupported_version'
        yield 1, [], 'invalid_snapshot'
        yield 2, {**valid, 'extra': True}, 'invalid_snapshot'
        yield 2, {**valid, 'family': {}}, 'invalid_snapshot'
        for mutate in ('gifts','currency','answers','edges','bequests','root','no-deceased','zero'):
            value = deepcopy(valid)
            family = value['family']
            if mutate in ('gifts','bequests'):
                family[mutate] = [{'branch':'root','amount_minor':1}]
            elif mutate == 'currency':
                family['estate']['currency']['code'] = 'USD'
            elif mutate == 'answers':
                family['answers'] = [{'question':'test', 'person':None, 'value':True}]
            elif mutate == 'edges':
                family['edges'] = [{'kind':'parent_of','from':'root','to':'son'}]
            elif mutate == 'root':
                family['root'] = 'other'; family['estates'][0]['deceased'] = 'other'
            elif mutate == 'no-deceased':
                value['deceased'] = None
            else:
                family['estate']['amount_minor'] = 0
            yield 2, value, 'unsupported_content'

    def test_typed_errors_preserve_rows_and_sessions(self):
        self.start()
        for version, value, code in self.invalids():
            row, share, token, invite = self.readers(value, version)
            before = (row.snapshot, row.schema_version, row.updated_at)
            stored = deepcopy(self.client.session[anonymous_case.SESSION_KEY])
            for response, status in [
                (self.send('post', f'/api/v1/saved-cases/{row.pk}/open/', {}), 400),
                (self.send('post', '/api/v1/shares/view/', {'token':token}), 404),
                (self.send('post', '/api/v1/shares/report/', {'token':token}), 404),
                (self.send('post', f'/api/v1/received/{invite.pk}/view/', {}, self.reader), 404),
                (self.send('post', f'/api/v1/received/{invite.pk}/report/', {}, self.reader), 404)]:
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.json()['code'], code)
                row.refresh_from_db()
                self.assertEqual((row.snapshot, row.schema_version, row.updated_at), before)
                self.assertEqual(self.client.session[anonymous_case.SESSION_KEY], stored)
            self.assertNotIn(row.pk, [r['id'] for r in self.client.get('/api/v1/saved-cases/', secure=True).json()['cases']])

    def put_session(self, version, value):
        case = self.start()
        session = self.client.session
        stored = {'id':case['id'], 'started_at':case['started_at'], 'schema_version':version, **value}
        session[anonymous_case.SESSION_KEY] = stored
        session.save()
        return stored

    def test_session_decode_edit_and_writer_remains_v1(self):
        stored = self.put_session(2, fixture('estate',2))
        case = self.live()
        self.assertEqual(normalized(anonymous_case.export_snapshot(case)), normalized(fixture('estate')))
        self.assertEqual(self.client.session[anonymous_case.SESSION_KEY], stored)
        with patch('reports.views.render_pdf', return_value=b'%PDF-test'):
            response = self.client.get(f'/api/v1/reports/draft/?case_id={case["id"]}', secure=True)
            self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.session[anonymous_case.SESSION_KEY], stored)
        response = self.send('patch', '/api/v1/case/', {'case_id':case['id'],'madhab':'hanafi'})
        self.assertEqual(response.status_code,200)
        self.assertNotIn('schema_version', self.client.session[anonymous_case.SESSION_KEY])
        self.assertEqual(self.send('post','/api/v1/saved-cases/',{'case_id':case['id']}).status_code,201)
        self.assertEqual(SavedCase.objects.get().schema_version,1)

    def test_open_v2_edit_and_save_updates_linked_row(self):
        row = SavedCase.objects.create(owner=self.owner, snapshot=fixture('estate', 2), schema_version=2)
        opened = self.send('post', f'/api/v1/saved-cases/{row.pk}/open/', {})
        self.assertEqual(opened.status_code, 200)
        case_id = opened.json()['case']['id']
        edited = self.send('patch', '/api/v1/case/', {'case_id': case_id, 'madhab': 'hanafi'})
        self.assertEqual(edited.status_code, 200)
        saved = self.send('post', '/api/v1/saved-cases/', {'case_id': case_id})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()['id'], row.pk)
        self.assertEqual(SavedCase.objects.count(), 1)
        row.refresh_from_db()
        self.assertEqual(row.schema_version, 1)
        decoded = decode(2, encode_v2(row.snapshot), 'id', 'time')
        expected = {**fixture('estate'), 'madhab': 'hanafi'}
        self.assertEqual(normalized(anonymous_case.export_snapshot(decoded)), normalized(expected))

    def test_unreadable_sessions_and_replace(self):
        for version, value, code in self.invalids():
            if not isinstance(value,dict):
                continue
            stored = self.put_session(version,value)
            for response in [self.client.get('/api/v1/case/',secure=True),
                self.send('patch','/api/v1/case/',{'madhab':'hanafi'}),
                self.send('put','/api/v1/case/deceased/',{'case_id':stored['id'],'gender':'male'}),
                self.client.get(f'/api/v1/reports/draft/?case_id={stored["id"]}',secure=True),
                self.send('post','/api/v1/case/',{})]:
                self.assertEqual(response.status_code,422)
                self.assertEqual(response.json()['code'],code)
                self.assertEqual(self.client.session[anonymous_case.SESSION_KEY],stored)
            before = deepcopy(dict(self.client.session))
            stale = self.send('post', '/api/v1/case/', {'replace': True, 'case_id': 'stale-id'})
            self.assertEqual(stale.status_code, 409)
            self.assertEqual(stale.json(), {'detail': 'That case is no longer the current one.', 'code': code})
            self.assertEqual(dict(self.client.session), before)
            self.assertEqual(self.send('post', '/api/v1/case/',
                                      {'replace': True, 'case_id': stored['id']}).status_code, 201)
            session = self.client.session
            session[anonymous_case.SESSION_KEY] = stored
            session.save()
            self.assertEqual(self.send('post','/api/v1/case/',{'replace':True}).status_code,201)

    def test_access_checks_precede_decode(self):
        row, share, token, invite = self.readers({}, 2)
        for field in ('revoked_at','expires_at'):
            time = timezone.now()-timedelta(days=1)
            ShareLink.objects.filter(pk=share.pk).update(**{field:time})
            ShareInvite.objects.filter(pk=invite.pk).update(**{field:time})
            for url, data in [('/api/v1/shares/view/',{'token':token}),('/api/v1/shares/report/',{'token':token}),
                              (f'/api/v1/received/{invite.pk}/view/',{}),(f'/api/v1/received/{invite.pk}/report/',{})]:
                response = self.send('post',url,data, self.reader if '/received/' in url else self.client)
                self.assertEqual(response.status_code,404)
                self.assertEqual(response.json(),{'detail':'This link is unavailable.'})
            ShareLink.objects.filter(pk=share.pk).update(revoked_at=None)
            ShareInvite.objects.filter(pk=invite.pk).update(revoked_at=None)
        ShareLink.objects.filter(pk=share.pk).update(expires_at=timezone.now()+timedelta(days=1),visibility='private')
        self.client.logout()
        self.assertEqual(self.send('post','/api/v1/shares/view/',{'token':token}).json()['code'],'sign_in_required')

    def test_legacy_basis_fallback_and_explicit_basis(self):
        for madhab, school in [(None,None),('x',None),('jafari','jafari')]:
            snapshot = {**fixture('estate'), 'madhab':madhab}
            self.assertEqual(decode(1,snapshot,'id','time')['madhab'],school)
        snapshot = {**fixture('estate'), 'basis':{'kind':'compare'}}
        self.assertIsNone(decode(1,snapshot,'id','time')['madhab'])
        with self.assertRaises(SnapshotError) as error:
            decode(1,{**snapshot,'basis':{'kind':'school'}},'id','time')
        self.assertEqual(error.exception.code,'invalid_basis')

    def test_encoder_limit_propagates_and_contract_rejects_oversized_amount(self):
        from presentation.money import PresentationError
        snapshot = fixture('estate')
        snapshot['deceased']['estate'] = '90071992547410'
        with self.assertRaises(PresentationError):
            encode_v2(snapshot)
        value = fixture('estate', 2)
        value['family']['estate']['amount_minor'] = 9007199254741000
        with self.assertRaises(SnapshotError) as error:
            decode(2,value,'id','time')
        self.assertEqual(error.exception.code,'invalid_snapshot')
