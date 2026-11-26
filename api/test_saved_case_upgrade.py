from copy import deepcopy
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from api import anonymous_case, test_snapshots
from api.models import SavedCase
from api.snapshots import SnapshotError, default_name, encode_v2, lossless_v1
from engine.contracts import ContractError
from api.test_snapshots import fixture
from api.tests import InterviewHelpers


@override_settings(SNAPSHOT_WRITE_VERSION=2)
class SavedCaseUpgradeTests(InterviewHelpers, TestCase):
    put_session = test_snapshots.SnapshotTests.put_session
    readers = test_snapshots.SnapshotTests.readers

    def setUp(self):
        super().setUp()
        self.owner = get_user_model().objects.create_user(username='upgrade-owner')
        self.client.force_login(self.owner)
        self.recipient = get_user_model().objects.create_user(username='upgrade-recipient')
        self.reader = self.client.__class__(enforce_csrf_checks=True)
        self.reader.force_login(self.recipient)

    def command(self, **kwargs):
        output = StringIO()
        call_command('backfill_saved_cases', stdout=output, **kwargs)
        return output.getvalue()

    def test_switched_writer_and_conflict(self):
        row = SavedCase.objects.create(owner=self.owner, snapshot=fixture('estate'), revision=2)
        case = self.send('post', f'/api/v1/saved-cases/{row.pk}/open/', {}).json()['case']
        saved = self.send('post', '/api/v1/saved-cases/', {'case_id': case['id']})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(self.client.session[anonymous_case.SAVED_LINK_KEY]['base_revision'], 3)
        row.refresh_from_db()
        self.assertEqual((row.schema_version, row.revision), (2, 3))
        before = deepcopy(dict(self.client.session))
        SavedCase.objects.filter(pk=row.pk).update(revision=4)
        response = self.send('post', '/api/v1/saved-cases/', {'case_id': case['id']})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'saved_case_conflict')
        self.assertEqual(dict(self.client.session), before)

    def test_backfill_dry_run_lossless_and_rerun(self):
        for name in ('estate', 'no-estate', 'later-deaths'):
            row = SavedCase.objects.create(owner=self.owner, snapshot=fixture(name))
            before = (row.updated_at, row.created_at, row.revision, row.owner_id)
            self.command(dry_run=True, batch_size=1)
            row.refresh_from_db()
            self.assertEqual(row.schema_version, 1)
            self.command(batch_size=1)
            row.refresh_from_db()
            self.assertEqual(row.snapshot, encode_v2(fixture(name)))
            self.assertEqual((row.updated_at, row.created_at, row.revision, row.owner_id), before)
            self.assertTrue(row.name)
            self.assertEqual(self.send('post', f'/api/v1/saved-cases/{row.pk}/open/', {}).status_code, 200)
        self.assertIn('converted=0 named=0', self.command())

    def test_malformed_named_and_fallback(self):
        bad = fixture('estate')
        bad['heirs'][0]['relationship'] = 'unknown'
        row = SavedCase.objects.create(owner=self.owner, snapshot=bad)
        self.assertIn('malformed=1', self.command())
        row.refresh_from_db()
        self.assertEqual(row.snapshot, bad)
        self.assertEqual(row.schema_version, 1)
        self.assertTrue(row.name)
        for school in (None, 'invalid', 'hanbali'):
            value = fixture('estate')
            value['madhab'] = school
            self.assertIsNotNone(lossless_v1(value))

    def test_switch_required_and_name_limit(self):
        with override_settings(SNAPSHOT_WRITE_VERSION=1), self.assertRaises(CommandError):
            self.command()
        with patch('django.utils.translation.gettext', return_value='\u0639' * 150):
            self.assertEqual(len(default_name(timezone.now())), 100)

    def test_oversized_save_preserves_session(self):
        for school in ('hanbali', None):
            value = fixture('estate')
            value['madhab'] = school
            value['deceased']['estate'] = '999999999999999'
            self.put_session(1, value)
            case = self.live()
            before = deepcopy(dict(self.client.session))
            response = self.send('post', '/api/v1/saved-cases/', {'case_id': case['id']})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()['code'], 'unsupported_content')
            self.assertFalse(SavedCase.objects.exists())
            self.assertEqual(dict(self.client.session), before)

    def test_invalid_v2_save_preserves_session(self):
        self.put_session(1, fixture('estate'))
        case = self.live()
        before = deepcopy(dict(self.client.session))
        for target in ('api.views.encode_v2', 'api.views.decode'):
            for error in (ContractError('invalid', 'Invalid snapshot'), SnapshotError('invalid', 'Invalid snapshot'), ValueError(), KeyError()):
                with self.subTest(target=target, error=error), patch(target, side_effect=error):
                    response = self.send('post', '/api/v1/saved-cases/', {'case_id': case['id']})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {
                    'detail': 'The case cannot be saved.', 'code': 'unsupported_content'})
                self.assertFalse(SavedCase.objects.exists())
                self.assertEqual(dict(self.client.session), before)

    def test_named_malformed_row_is_not_skipped(self):
        bad = fixture('estate')
        bad['heirs'][0]['relationship'] = 'unknown'
        SavedCase.objects.create(owner=self.owner, snapshot=bad, name='Existing name')
        self.assertIn('malformed=1 skipped=0 retry=0', self.command())

    def test_legacy_backfill_preserves_live_readers_and_identity(self):
        from django.contrib.contenttypes.models import ContentType
        from api.legacy_cases import convert
        from calc.models import Deceased, Heir, Wife, Son, Mother, Brother
        from calc.tests import build_case, build_layer
        from api.models import ShareLink, ShareInvite
        from api.test_snapshots import normalized, normalized_body
        root, (wife, son, brother) = build_case('M', [Wife, Son, Brother], estate=1200.50)
        build_layer(root, son, 'M', [Mother, Brother], [(0, wife), (1, brother)])
        value = convert(root, ContentType, Heir, Deceased)
        row, share, token, invite = self.readers(value, 1)
        before = (row.pk, row.owner_id, row.created_at, row.updated_at, row.revision)
        share_before = ShareLink.objects.values().get(pk=share.pk)
        invite_before = ShareInvite.objects.values().get(pk=invite.pk)
        def views():
            return [self.send('post', '/api/v1/shares/view/', {'token': token}),
                    self.send('post', f'/api/v1/received/{invite.pk}/view/', {}, self.reader)]
        aliases = {person['id']: person['same_as'] + '~' + str(death['order'])
                   for death in value['deaths'] for person in death['heirs'] if person.get('same_as')}
        def canonical_ids(body):
            if isinstance(body, dict):
                return {key: canonical_ids(item) for key, item in body.items()}
            if isinstance(body, list):
                return [canonical_ids(item) for item in body]
            return aliases.get(body, body) if isinstance(body, str) else body
        previous = [canonical_ids(r.json()['preview']) for r in views()]
        self.command()
        row.refresh_from_db()
        self.assertEqual((row.pk, row.owner_id, row.created_at, row.updated_at, row.revision), before)
        self.assertEqual(ShareLink.objects.values().get(pk=share.pk), share_before)
        self.assertEqual(ShareInvite.objects.values().get(pk=invite.pk), invite_before)
        self.assertEqual([normalized_body(r.json()['preview']) for r in views()],
                         [normalized_body(body) for body in previous])
        opened = self.send('post', f'/api/v1/saved-cases/{row.pk}/open/', {}).json()['case']
        self.assertEqual(normalized(anonymous_case.export_snapshot(opened)), normalized(value))
        listed = self.client.get('/api/v1/saved-cases/', secure=True).json()['cases']
        self.assertEqual(next(item['name'] for item in listed if item['id'] == row.pk), row.name)

    def test_name_preserved_and_new_rows_both_writer_versions(self):
        for version in (1, 2):
            self.send('post', '/api/v1/case/', {'replace': True})
            self.put_session(1, fixture('estate'))
            case = self.live()
            with override_settings(SNAPSHOT_WRITE_VERSION=version):
                response = self.send('post', '/api/v1/saved-cases/', {'case_id': case['id']})
                self.assertEqual(response.status_code, 201)
                row = SavedCase.objects.get(pk=response.json()['id'])
                self.assertEqual(row.schema_version, version)
                self.assertEqual(row.name, default_name(row.created_at))
                self.assertEqual(row.snapshot, fixture('estate') if version == 1 else encode_v2(fixture('estate')))
                SavedCase.objects.filter(pk=row.pk).update(name='\u0639\u0627\u0626\u0644\u062a\u064a')
                self.assertEqual(self.send('post', '/api/v1/saved-cases/', {'case_id': case['id']}).status_code, 200)
                row.refresh_from_db()
                self.assertEqual(row.name, '\u0639\u0627\u0626\u0644\u062a\u064a')
        self.command()
        self.assertIn('converted=0 named=0', self.command())

    def test_old_link_defaults_to_revision_one(self):
        row = SavedCase.objects.create(owner=self.owner, snapshot=fixture('estate'))
        case = self.send('post', f'/api/v1/saved-cases/{row.pk}/open/', {}).json()['case']
        session = self.client.session
        link = session[anonymous_case.SAVED_LINK_KEY]
        link.pop('base_revision')
        session[anonymous_case.SAVED_LINK_KEY] = link
        session.save()
        self.assertEqual(self.send('post', '/api/v1/saved-cases/', {'case_id': case['id']}).status_code, 200)
        self.assertEqual(self.client.session[anonymous_case.SAVED_LINK_KEY]['base_revision'], 2)

    def test_guest_reads_preserve_storage_and_warn_only_for_drops(self):
        self.client.logout()
        value = fixture('estate')
        value['deceased']['estate'] = '500'
        stored = self.put_session(1, value)
        session = self.client.session
        stored.pop('schema_version')
        session[anonymous_case.SESSION_KEY] = stored
        session.save()
        with self.assertNoLogs('mawareeth.snapshots', level='WARNING'):
            case = self.live()
            response = self.client.get(f'/api/v1/case/preview/?case_id={case["id"]}', secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(encode_v2(anonymous_case.export_snapshot(case))['family']['estate']['currency'],
                         {'code': 'SAR', 'explicit': True})
        self.assertEqual(self.client.session[anonymous_case.SESSION_KEY], stored)
        stored['heirs'][0]['relationship'] = 'unknown'
        session = self.client.session
        session[anonymous_case.SESSION_KEY] = stored
        session.save()
        with self.assertLogs('mawareeth.snapshots', level='WARNING') as logs:
            self.live()
        self.assertEqual(len(logs.records), 1)
        self.assertEqual(logs.records[0].code, 'normalized_on_read')
        self.assertEqual(logs.records[0].getMessage(), 'normalized_on_read')
        self.assertEqual(self.client.session[anonymous_case.SESSION_KEY], stored)

    def test_backfill_concurrent_save_needs_retry(self):
        row = SavedCase.objects.create(owner=self.owner, snapshot=fixture('estate'))
        def concurrent(snapshot):
            SavedCase.objects.filter(pk=row.pk).update(revision=2)
            return encode_v2(snapshot)
        with patch('api.management.commands.backfill_saved_cases.lossless_v1', side_effect=concurrent):
            self.assertIn('skipped=0 retry=1', self.command())
        row.refresh_from_db()
        self.assertEqual((row.schema_version, row.name, row.revision), (1, '', 2))
        self.assertIn('converted=1', self.command())

    def test_missing_madhab_and_no_amount(self):
        value = fixture('no-estate')
        value.pop('madhab')
        row = SavedCase.objects.create(owner=self.owner, snapshot=value)
        self.command()
        row.refresh_from_db()
        self.assertEqual(row.snapshot['basis'], {'kind': 'compare'})
        self.assertEqual(row.snapshot['family']['estate'], {'amount_minor': None, 'currency': None})

    def test_two_working_copies_conflict_without_losing_inputs(self):
        row = SavedCase.objects.create(owner=self.owner, snapshot=fixture('estate'), revision=2)
        device = self.client.__class__(enforce_csrf_checks=True)
        device.force_login(self.owner)
        a = self.send('post', f'/api/v1/saved-cases/{row.pk}/open/', {}).json()['case']
        b = self.send('post', f'/api/v1/saved-cases/{row.pk}/open/', {}, device).json()['case']
        self.send('patch', '/api/v1/case/', {'case_id': b['id'], 'madhab': 'hanafi'}, device)
        self.assertEqual(self.send('post', '/api/v1/saved-cases/', {'case_id': b['id']}, device).status_code, 200)
        before = deepcopy(dict(self.client.session))
        row.refresh_from_db()
        snapshot = deepcopy(row.snapshot)
        response = self.send('post', '/api/v1/saved-cases/', {'case_id': a['id']})
        self.assertEqual(response.json(), {'error': 'conflict', 'code': 'saved_case_conflict',
            'detail': 'This saved case changed since it was opened.', 'revision': 3,
            'saved_id': row.pk, 'saved_name': row.name, 'working_revision': a['revision']})
        row.refresh_from_db()
        self.assertEqual(row.snapshot, snapshot)
        self.assertEqual(dict(self.client.session), before)

    def test_default_name_uses_site_locale_and_local_creation_date(self):
        from datetime import datetime, timezone as utc
        from django.utils import translation
        with override_settings(LANGUAGE_CODE='en', TIME_ZONE='Asia/Riyadh'):
            with timezone.override('UTC'), translation.override('fr'):
                self.assertEqual(default_name(datetime(2026, 5, 2, 22, tzinfo=utc.utc)),
                                 'Estate of the deceased, May 3, 2026')

    def test_dry_run_counts_match_and_output_is_redacted(self):
        valid = fixture('estate')
        bad = deepcopy(valid)
        bad['heirs'][0]['relationship'] = 'unknown'
        SavedCase.objects.create(owner=self.owner, snapshot=valid)
        row = SavedCase.objects.create(owner=self.owner, snapshot=bad)
        before = list(SavedCase.objects.values())
        dry = self.command(dry_run=True)
        self.assertEqual(list(SavedCase.objects.values()), before)
        self.assertEqual(dry, self.command())
        self.assertEqual(dry, f'converted=1 named=2 malformed=1 skipped=0 retry=0\nmalformed_pks={row.pk}\n')


class SavedCaseNameMigrationTests(TransactionTestCase):
    def test_existing_rows_and_rollback_image_insert(self):
        executor = MigrationExecutor(connection)
        executor.migrate([('api', '0005_savedcase_revision')])
        try:
            apps = executor.loader.project_state([('api', '0005_savedcase_revision')]).apps
            User = apps.get_model('auth', 'User')
            owner = User.objects.create(username='migration-owner')
            OldCase = apps.get_model('api', 'SavedCase')
            existing = OldCase.objects.create(owner_id=owner.pk, snapshot=fixture('estate'))
            executor = MigrationExecutor(connection)
            executor.migrate([('api', '0006_savedcase_name')])
            self.assertEqual(SavedCase.objects.get(pk=existing.pk).name, '')
            with connection.cursor() as cursor:
                cursor.execute(
                    'INSERT INTO api_savedcase (owner_id, snapshot, schema_version, created_at, updated_at) '
                    'VALUES (%s, %s, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id',
                    [owner.pk, '{}'])
                pk = cursor.fetchone()[0]
            row = SavedCase.objects.get(pk=pk)
            self.assertEqual((row.name, row.revision), ('', 1))
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes('api'))
