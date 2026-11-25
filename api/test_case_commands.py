"""Story 8.9: Case commands apply atomically against one revision."""
import base64
import gzip
import json
import threading
import time
import traceback
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.sessions.backends.db import SessionStore
from django.contrib.sessions.models import Session
from django.db import connection, connections, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from api import anonymous_case, case_commands
from api import preview as case_preview
from api import views
from api.models import SavedCase
from api.tests import (
    CASE_URL, DEATHS_URL, HEIRS_URL, InterviewDeathsHelpers, InterviewHelpers,
)

BULK_URL = '/api/v1/case/heirs/bulk/'
RESTORE_URL = '/api/v1/case/restore/'
PREVIEW_URL = '/api/v1/case/preview/'
DRAFT_URL = '/api/v1/reports/draft/'
SAVED_URL = '/api/v1/saved-cases/'


class CommandBase(InterviewDeathsHelpers, InterviewHelpers, TransactionTestCase):
    def raw_session(self):
        return Session.objects.get().session_data

    def revision(self):
        return self.live()['revision']

    def age(self, seconds):
        """Make the stored case's last change `seconds` old."""
        moment = (timezone.now() - timedelta(seconds=seconds)).isoformat()
        self.plant(changed_at=moment)

    def assert_untouched(self, response, status, before_raw, before):
        self.assertEqual(response.status_code, status, response.content)
        self.assertEqual(self.raw_session(), before_raw, 'the session was written')
        self.assertEqual(self.stored(), before)


class RevisionTests(CommandBase):
    def test_start_is_revision_one_and_each_success_adds_exactly_one(self):
        case = self.start()
        self.assertEqual(case['revision'], 1)
        self.assertEqual(self.deceased(case).json()['case']['revision'], 2)
        heir = self.heir(case)
        self.assertEqual((heir.status_code, heir.json()['case']['revision']), (201, 3))
        row = heir.json()['case']['heirs'][0]['id']
        edit = self.send('put', f'{HEIRS_URL}{row}/', {'case_id': case['id'], 'relationship': 'daughter'})
        self.assertEqual(edit.json()['case']['revision'], 4)
        basis = self.send('patch', CASE_URL, {'case_id': case['id'], 'madhab': 'hanafi'})
        self.assertEqual(basis.json()['case']['revision'], 5)
        gone = self.send('delete', f'{HEIRS_URL}{row}/', {'case_id': case['id']})
        self.assertEqual(gone.json()['case']['revision'], 6)
        self.assertEqual(self.revision(), 6)
        self.assertEqual(self.stored()['revision'], 6)
        self.assertIn('changed_at', self.stored())

    def test_a_stored_case_without_a_revision_reads_as_one(self):
        case = self.ready()
        row = Session.objects.get()
        data = row.get_decoded()
        data[anonymous_case.SESSION_KEY].pop('revision')
        row.session_data = SessionStore().encode(data)
        row.save()
        self.assertEqual(self.revision(), 1)
        self.assertEqual(self.heir(case, expected_revision=1).json()['case']['revision'], 2)

    def test_edit_at_the_current_revision_returns_the_whole_case(self):
        case = self.ready()
        before = self.revision()
        response = self.heir(case, expected_revision=before)
        self.assertEqual(response.status_code, 201)
        body = response.json()['case']
        self.assertEqual(body['revision'], before + 1)
        self.assertEqual(body, self.live())

    def test_a_stale_tab_gets_a_conflict_with_the_current_case(self):
        case = self.ready()
        self.heir(case)
        raw, stored = self.raw_session(), self.stored()
        response = self.heir(case, expected_revision=self.revision() - 1)
        self.assert_untouched(response, 409, raw, stored)
        body = response.json()
        self.assertEqual(body['error'], 'conflict')
        self.assertEqual(body['detail'], 'That case is no longer the current one.')
        self.assertEqual(body['case'], self.live())

    def test_another_case_id_is_a_conflict_too(self):
        case = self.ready()
        raw, stored = self.raw_session(), self.stored()
        response = self.send('post', HEIRS_URL, {'case_id': 'f' * 32, 'relationship': 'son',
                                                 'expected_revision': case['revision']})
        self.assert_untouched(response, 409, raw, stored)
        self.assertEqual(response.json()['error'], 'conflict')

    def test_a_missing_or_malformed_revision_is_a_typed_400(self):
        case = self.ready()
        raw, stored = self.raw_session(), self.stored()
        for value in (None, 'two', 2.5, True, False):
            with self.subTest(value=value):
                response = self.send('post', HEIRS_URL, {
                    'case_id': case['id'], 'relationship': 'son', 'expected_revision': value})
                self.assert_untouched(response, 400, raw, stored)
                self.assertEqual(response.json()['error'], 'invalid_revision')
        response = self.send('delete', f'{HEIRS_URL}x/', {'case_id': case['id'], 'expected_revision': None})
        self.assert_untouched(response, 400, raw, stored)
        self.assertEqual(response.json()['error'], 'invalid_revision')

    def test_starting_over_with_a_wrong_revision_is_a_conflict(self):
        case = self.ready()
        raw, stored = self.raw_session(), self.stored()
        response = self.send('post', CASE_URL, {'replace': True, 'case_id': case['id'],
                                                'expected_revision': case['revision'] + 5})
        self.assert_untouched(response, 409, raw, stored)
        self.assertEqual(response.json()['error'], 'conflict')
        fresh = self.send('post', CASE_URL, {'replace': True, 'case_id': case['id'],
                                             'expected_revision': self.revision()})
        self.assertEqual((fresh.status_code, fresh.json()['case']['revision']), (201, 1))

    def test_starting_over_with_a_malformed_revision_is_a_typed_400(self):
        case = self.ready()
        raw, stored = self.raw_session(), self.stored()
        for value in (True, 'two'):
            with self.subTest(value=value):
                response = self.send('post', CASE_URL, {'replace': True, 'case_id': case['id'],
                                                        'expected_revision': value})
                self.assert_untouched(response, 400, raw, stored)
                self.assertEqual(response.json()['error'], 'invalid_revision')

    def test_an_impossible_edit_changes_nothing(self):
        case = self.ready()
        self.heir(case, 'father')
        heirs = self.heir(case, 'brother').json()['case']['heirs']
        raw, stored = self.raw_session(), self.stored()
        response = self.send('put', f'{HEIRS_URL}{heirs[1]["id"]}/',
                             {'case_id': case['id'], 'relationship': 'father'})
        self.assert_untouched(response, 400, raw, stored)
        self.assertIn('relationship', response.json()['errors'])
        second = self.heir(case, 'father')
        self.assert_untouched(second, 400, raw, stored)

    def test_a_failed_write_never_raises_the_revision(self):
        case = self.ready()
        raw, stored = self.raw_session(), self.stored()
        before = self.revision()
        for body in ({'relationship': 'nobody'}, {'relationship': 'son', 'name': 5}):
            self.assert_untouched(self.heir(case, **body), 400, raw, stored)
        self.assertEqual(self.revision(), before)

    def test_the_case_endpoint_reads_back_the_revision(self):
        case = self.start()
        self.assertEqual(self.client.get(CASE_URL, secure=True).json()['case']['revision'], case['revision'])


@override_settings(SNAPSHOT_WRITE_VERSION=2)
class HeirStatusTests(CommandBase):
    def edit(self, person, relationship='son', **fields):
        return self.send('put', f'{HEIRS_URL}{person}/', {
            'case_id': self.case_id, 'relationship': relationship, **fields})

    def refused_edit(self, person, expected, **fields):
        raw, stored = self.raw_session(), self.stored()
        response = self.edit(person, **fields)
        self.assert_untouched(response, 400, raw, stored)
        self.assertEqual(response.json()['errors'], expected)

    def test_status_round_trip_and_rename_keep_identity_and_edges(self):
        self.setup_family()
        edge = {'kind': 'parent_of', 'from': self.s1, 'to': self.s2}
        self.plant(edges=[edge])
        changed = self.edit(self.s1, status='died_before_or_with', name='S1').json()['case']
        self.assertNotIn(self.s1, [row['id'] for row in changed['heirs']])
        self.assertEqual(changed['died_before'], [
            {'id': self.s1, 'relationship': 'son', 'name': 'S1', 'gender': 'male'}])
        renamed = self.edit(self.s1, name='Ali').json()['case']
        self.assertEqual(renamed['died_before'][0]['name'], 'Ali')
        self.assertEqual(renamed['edges'], [edge])
        restored = self.edit(self.s1, status='alive', name='Ali').json()['case']
        self.assertNotIn('died_before', restored)
        self.assertEqual(restored['heirs'][-1]['id'], self.s1)
        self.assertEqual(restored['edges'], [edge])

    def test_a_link_is_not_allowed_on_a_died_before_row(self):
        self.setup_family()
        self.edit(self.s1, status='died_before_or_with')
        self.refused_edit(self.s1, {'same_as': 'not_allowed'}, same_as=self.s2)
        self.refused_edit(self.s1, {'same_as': 'not_allowed'}, same_as=None, status='alive')

    @override_settings(SNAPSHOT_WRITE_VERSION=1)
    def test_old_writer_refuses_status_before_storing(self):
        self.setup_family()
        self.refused_edit(self.s1, {'status': 'schema_unsupported'}, status='died_before_or_with')

    def test_later_estates_and_linked_rows(self):
        self.two()
        alias = self.live()['deaths'][0]['heirs'][0]
        for person in (self.s1, self.w, alias['id']):
            self.refused_edit(person, {'status': 'status_locked'}, status='died_before_or_with')
        new = self.add_layer(self.s1, 'son').json()['case']['deaths'][0]['heirs'][-1]
        self.refused_edit(new['id'], {'status': 'first_estate_only'}, status='died_before_or_with')

    def test_relationship_and_capacity_are_checked_on_return(self):
        self.setup_family()
        self.edit(self.s1, relationship='father', status='died_before_or_with')
        self.heir({'id': self.case_id}, 'father')
        self.refused_edit(self.s1, {'relationship': 'second_father'}, relationship='father', status='alive')
        self.assertEqual(self.edit(self.s1, relationship='father', name='Ali').status_code, 200)
        self.assertEqual(self.edit(self.s1, relationship='son').status_code, 200)
        self.refused_edit(self.s1, {'relationship': 'second_father'}, relationship='father')
        self.send('post', BULK_URL, {'case_id': self.case_id, 'heirs': [{'relationship': 'son'}] * 47})
        self.refused_edit(self.s1, {'heirs': 'limit'}, status='alive')

    def test_unknown_status_is_refused_and_nothing_is_stored(self):
        self.setup_family()
        self.refused_edit(self.s1, {'status': 'invalid'}, status='gone')

    def test_died_before_list_at_capacity_refuses_one_more(self):
        self.setup_family()
        self.plant(died_before=[{'id': f'p{i}', 'gender': 'male', 'name': None, 'relationship': 'son'}
                                for i in range(anonymous_case.MAX_HEIRS)])
        self.refused_edit(self.s1, {'heirs': 'limit'}, status='died_before_or_with')

    def test_died_before_removal_drops_only_the_person_and_incident_edges(self):
        self.setup_family()
        edge = {'kind': 'parent_of', 'from': self.s1, 'to': self.s2}
        self.plant(edges=[edge])
        before = self.edit(self.s1, status='died_before_or_with').json()['case']
        self.assertEqual(case_commands.remove_impact(before, self.s1), {'persons': [], 'estates': []})
        removed = self.send('delete', f'{HEIRS_URL}{self.s1}/', {'case_id': self.case_id}).json()['case']
        self.assertNotIn(self.s1, [p['id'] for p in removed['persons']])
        self.assertEqual(removed['heirs'], before['heirs'])
        self.assertEqual(removed['edges'], [])
        self.assertNotIn('died_before', removed)


class BulkTests(CommandBase):
    def bulk(self, case, heirs, **extra):
        return self.send('post', BULK_URL, {'case_id': case['id'], 'heirs': heirs, **extra})

    def test_three_valid_items_add_three_heirs_and_one_revision(self):
        case = self.ready()
        before = self.revision()
        response = self.bulk(case, [{'relationship': 'son', 'name': 'A'}, {'relationship': 'daughter'},
                                    {'relationship': 'wife'}])
        self.assertEqual(response.status_code, 201)
        body = response.json()['case']
        self.assertEqual(len(body['heirs']), 3)
        self.assertEqual(body['revision'], before + 1)

    def test_one_bad_item_adds_nothing(self):
        case = self.ready()
        raw, stored = self.raw_session(), self.stored()
        response = self.bulk(case, [{'relationship': 'son'}, {'relationship': 'cousin'}, {'relationship': 'daughter'}])
        self.assert_untouched(response, 400, raw, stored)
        self.assertEqual(response.json()['error'], 'invalid_input')
        self.assertEqual(list(response.json()['errors']), ['1'])

    def test_a_second_father_inside_one_bulk_is_refused_whole(self):
        case = self.ready()
        raw, stored = self.raw_session(), self.stored()
        response = self.bulk(case, [{'relationship': 'father'}, {'relationship': 'father'}])
        self.assert_untouched(response, 400, raw, stored)
        self.assertEqual(list(response.json()['errors']), ['1'])

    def test_over_capacity_is_checked_before_anything_is_added(self):
        case = self.ready()
        self.assertEqual(self.bulk(case, [{'relationship': 'son'}] * 48).status_code, 201)
        raw, stored = self.raw_session(), self.stored()
        response = self.bulk(case, [{'relationship': 'son'}] * 3)
        self.assert_untouched(response, 400, raw, stored)
        self.assertEqual(response.json()['error'], 'over_capacity')
        self.assertEqual(len(self.live()['heirs']), 48)

    def test_the_item_count_is_between_one_and_fifty(self):
        case = self.ready()
        raw, stored = self.raw_session(), self.stored()
        self.assert_untouched(self.bulk(case, []), 400, raw, stored)
        over = self.bulk(case, [{'relationship': 'son'}] * 51)
        self.assert_untouched(over, 400, raw, stored)
        self.assertEqual(over.json()['error'], 'over_capacity')

    def test_a_later_death_layer_can_be_filled_in_bulk(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1).status_code, 201)
        before = self.live()
        response = self.bulk({'id': self.case_id}, [{'relationship': 'son'}, {'relationship': 'daughter'}],
                             layer=self.s1)
        self.assertEqual(response.status_code, 201)
        layer = response.json()['case']['deaths'][0]['heirs']
        self.assertEqual(len(layer), len(before['deaths'][0]['heirs']) + 2)


class LimitTests(CommandBase):
    def test_a_third_later_death_keeps_its_400_and_the_revision(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1).status_code, 201)
        self.assertEqual(self.mark(self.w).status_code, 201)
        raw, stored = self.raw_session(), self.stored()
        response = self.mark(self.s2)
        self.assert_untouched(response, 400, raw, stored)
        self.assertEqual(response.json()['errors'], {'death': 'limit'})


class EmptyLaterDeathTests(CommandBase):
    """Story 9.8: a later death can be marked with no derived relatives."""
    def test_an_empty_mark_derives_nothing_where_the_old_mark_would(self):
        self.setup_family()
        response = self.mark(self.s1, empty=True)
        self.assertEqual(response.status_code, 201, response.content)
        deaths = response.json()['case']['deaths']
        self.assertEqual([(d['heir_id'], d['heirs']) for d in deaths], [(self.s1, [])])

    def test_no_key_and_false_keep_the_old_derivation(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1).status_code, 201)
        self.assertEqual(len(self.live()['deaths'][0]['heirs']), 2)
        self.send('delete', f'{DEATHS_URL}{self.s1}/', {'case_id': self.case_id, 'confirm_cascade': 'true'})
        self.assertEqual(self.mark(self.s1, empty=False).status_code, 201)
        self.assertEqual(len(self.live()['deaths'][0]['heirs']), 2)

    def test_a_bad_empty_is_refused_without_a_revision(self):
        self.setup_family()
        before, revision = self.stored(), self.revision()
        self.refused(self.mark(self.s1, empty='yes'), {'empty': 'invalid'}, before)
        self.refused(self.mark(self.s1, empty=True, relatives={}), {'relatives': 'invalid'}, before)
        self.refused(self.mark(self.s1, empty=True, shared_father='yes'), {'relatives': 'invalid'}, before)
        self.refused(self.mark(self.s1, empty=True, relatives=None), {'relatives': 'invalid'}, before)
        self.refused(self.mark(self.s1, empty=True, shared_father=None), {'relatives': 'invalid'}, before)
        self.assertEqual(self.revision(), revision)

    def test_the_order_question_applies_and_first_resolves_it(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1, empty=True).status_code, 201)
        before = self.stored()
        self.refused(self.mark(self.s2, empty=True), {'death': 'order_required'}, before)
        response = self.mark(self.s2, empty=True, first=self.s2)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual([d['heir_id'] for d in response.json()['case']['deaths']], [self.s2, self.s1])

    def test_the_limit_is_refused_with_the_revision_unchanged(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1, empty=True).status_code, 201)
        self.assertEqual(self.mark(self.s2, empty=True, first=self.s1).status_code, 201)
        revision, before = self.revision(), self.stored()
        self.refused(self.mark(self.w, empty=True), {'death': 'limit'}, before)
        self.assertEqual(self.revision(), revision)

    def test_an_empty_later_estate_keeps_the_preview_not_ready(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1, empty=True).status_code, 201)
        body = self.preview(self.case_id).json()
        self.assertIs(type(body.pop('revision')), int)
        self.assertEqual(body, {'status': 'not_ready'})
        self.assertEqual(case_preview.preview(self.live()), {'status': 'not_ready'})

    def test_cascade_impact_lists_the_later_estate_people(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1, empty=True).status_code, 201)
        added = self.add_layer(self.s1, 'wife', name='New')
        self.assertEqual(added.status_code, 201)
        new = added.json()['case']['deaths'][0]['heirs'][0]['id']
        response = self.send('delete', f'{HEIRS_URL}{self.s1}/', {'case_id': self.case_id})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['impact'], {'persons': [new], 'estates': [2]})

    @override_settings(SNAPSHOT_WRITE_VERSION=2)
    def test_a_restore_after_removing_a_populated_estate_keeps_rows_edges_and_ids(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1, empty=True).status_code, 201)
        self.assertEqual(self.add_layer(self.s1, 'son', name='New').status_code, 201)
        death = self.live()['deaths'][0]
        anchor, entries = next((a, e) for a, e in death['placement'].items() if a != 'root' and e)
        child = self.add_layer(self.s1, entries[0]['relationship'], name='Kid', anchor=anchor)
        self.assertEqual(child.status_code, 201, child.content)
        before = self.live()
        self.assertEqual(len(before['deaths'][0]['heirs']), 2)
        self.assertEqual(len(before['edges']), 1)
        old = anonymous_case.export_snapshot(anonymous_case.read_snapshot(dict(self.stored()), 'x', 'y'))
        removed = self.send('delete', f'{HEIRS_URL}{self.s1}/', {'case_id': self.case_id, 'confirm_cascade': 'true'})
        self.assertEqual(removed.status_code, 200, removed.content)
        self.assertEqual(removed.json()['case']['deaths'], [])
        response = self.send('post', RESTORE_URL, {'case_id': self.case_id, 'snapshot': old})
        self.assertEqual(response.status_code, 200, response.content)
        case = response.json()['case']
        self.assertEqual(case['deaths'], before['deaths'])
        self.assertEqual(case['heirs'], before['heirs'])
        self.assertEqual(case['edges'], before['edges'])


class CascadeTests(CommandBase):
    def test_removing_a_heir_with_a_later_death_layer_needs_confirmation(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1).status_code, 201)
        raw, stored = self.raw_session(), self.stored()
        url = f'{HEIRS_URL}{self.s1}/'
        response = self.send('delete', url, {'case_id': self.case_id})
        self.assert_untouched(response, 409, raw, stored)
        body = response.json()
        self.assertEqual(body['error'], 'cascade_unconfirmed')
        self.assertEqual(body['impact']['estates'], [2])
        self.assertEqual(body['case'], self.live())

    def test_confirming_the_cascade_removes_the_layer(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1).status_code, 201)
        before = self.revision()
        response = self.send('delete', f'{HEIRS_URL}{self.s1}/', {'case_id': self.case_id, 'confirm_cascade': 'true'})
        self.assertEqual(response.status_code, 200)
        case = response.json()['case']
        self.assertEqual(case['deaths'], [])
        self.assertEqual(case['revision'], before + 1)

    def test_a_simple_removal_needs_no_confirmation(self):
        self.setup_family()
        before = self.revision()
        response = self.send('delete', f'{HEIRS_URL}{self.s2}/', {'case_id': self.case_id})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['case']['revision'], before + 1)

    def test_unmarking_a_death_that_drops_people_needs_confirmation(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1).status_code, 201)
        self.assertEqual(self.add_layer(self.s1, 'wife', name='New').status_code, 201)
        raw, stored = self.raw_session(), self.stored()
        url = f'{DEATHS_URL}{self.s1}/'
        response = self.send('delete', url, {'case_id': self.case_id})
        self.assert_untouched(response, 409, raw, stored)
        self.assertEqual(response.json()['error'], 'cascade_unconfirmed')
        self.assertEqual(len(response.json()['impact']['persons']), 1)
        done = self.send('delete', url, {'case_id': self.case_id, 'confirm_cascade': 'true'})
        self.assertEqual(done.status_code, 200)
        self.assertEqual(done.json()['case']['deaths'], [])


class RestoreTests(CommandBase):
    def snapshot(self):
        return anonymous_case.export_snapshot(anonymous_case.read_snapshot(
            {key: value for key, value in self.stored().items()}, 'x', 'y'))

    def test_a_restore_keeps_ids_and_moves_the_revision_forward(self):
        self.setup_family()
        old = self.snapshot()
        old_ids = [row['id'] for row in old['heirs']]
        self.assertEqual(self.mark(self.s1).status_code, 201)
        self.send('patch', CASE_URL, {'case_id': self.case_id, 'madhab': 'hanafi'})
        before = self.live()
        response = self.send('post', RESTORE_URL, {'case_id': self.case_id, 'snapshot': old})
        self.assertEqual(response.status_code, 200)
        case = response.json()['case']
        self.assertEqual(case['revision'], before['revision'] + 1)
        self.assertEqual([row['id'] for row in case['heirs']], old_ids)
        self.assertEqual((case['id'], case['started_at']), (before['id'], before['started_at']))
        self.assertEqual(case['deaths'], [])
        self.assertEqual(case['madhab'], 'hanbali')

    def test_every_live_case_response_carries_the_servers_own_snapshot(self):
        case = self.setup_family()
        self.assertIn('snapshot', case)
        read = self.live()
        self.assertEqual(read['snapshot'], anonymous_case.export_snapshot(self.stored_case()))
        added = self.send('post', HEIRS_URL, {'case_id': self.case_id, 'relationship': 'daughter'})
        self.assertEqual(added.status_code, 201)
        body = added.json()['case']
        self.assertEqual(body['snapshot'], anonymous_case.export_snapshot(self.stored_case()))
        stale = self.send('post', HEIRS_URL, {'case_id': self.case_id, 'relationship': 'son',
                                              'expected_revision': 1})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()['case']['snapshot'], self.live()['snapshot'])
        self.assertNotIn('snapshot', self.stored())

    def test_posting_the_snapshot_from_before_an_add_restores_that_family(self):
        self.setup_family()
        before = self.live()
        self.assertEqual(self.send('post', HEIRS_URL, {'case_id': self.case_id,
                                                       'relationship': 'daughter'}).status_code, 201)
        response = self.send('post', RESTORE_URL, {'case_id': self.case_id, 'snapshot': before['snapshot']})
        self.assertEqual(response.status_code, 200)
        case = response.json()['case']
        self.assertEqual([row['id'] for row in case['heirs']], [row['id'] for row in before['heirs']])
        self.assertEqual(case['revision'], before['revision'] + 2)

    def stored_case(self):
        return anonymous_case.read_snapshot(dict(self.stored()), 'x', 'y')

    def test_a_restore_at_a_stale_revision_is_a_conflict_that_changes_nothing(self):
        self.setup_family()
        before = self.live()
        self.assertEqual(self.send('post', HEIRS_URL, {'case_id': self.case_id,
                                                       'relationship': 'daughter'}).status_code, 201)
        raw, stored = self.raw_session(), self.stored()
        response = self.send('post', RESTORE_URL, {
            'case_id': self.case_id, 'snapshot': before['snapshot'], 'expected_revision': before['revision']})
        self.assert_untouched(response, 409, raw, stored)
        body = response.json()
        self.assertEqual(body['error'], 'conflict')
        self.assertEqual(body['case'], self.live())
        self.assertIn('snapshot', body['case'])

    def test_an_invalid_snapshot_is_refused_whole(self):
        self.setup_family()
        good = self.snapshot()
        heirs = good['heirs']
        too_many = {**good, 'heirs': [{**heirs[1], 'id': f'h{i}'} for i in range(51)]}
        unknown = {**good, 'heirs': [{**heirs[0], 'relationship': 'cousin'}]}
        extra = {**good, 'surprise': 1}
        for snapshot in (too_many, unknown, extra, 'text', None, {}):
            with self.subTest(snapshot=str(snapshot)[:40]):
                raw, stored = self.raw_session(), self.stored()
                response = self.send('post', RESTORE_URL, {'case_id': self.case_id, 'snapshot': snapshot})
                self.assert_untouched(response, 400, raw, stored)
                self.assertEqual(response.json()['error'], 'invalid_snapshot')

    def test_a_gzipped_snapshot_restores_the_same_family_as_the_plain_one(self):
        self.setup_family()
        old = self.snapshot()
        old_ids = [row['id'] for row in old['heirs']]
        self.assertEqual(self.mark(self.s1).status_code, 201)
        before = self.live()
        packed = base64.b64encode(gzip.compress(
            json.dumps(old, separators=(',', ':')).encode())).decode()
        response = self.send('post', RESTORE_URL, {'case_id': self.case_id, 'snapshot_gz': packed})
        self.assertEqual(response.status_code, 200, response.content)
        case = response.json()['case']
        self.assertEqual(case['revision'], before['revision'] + 1)
        self.assertEqual([row['id'] for row in case['heirs']], old_ids)

    def test_a_malformed_gzipped_snapshot_is_refused_as_invalid(self):
        self.setup_family()
        good = gzip.compress(json.dumps(self.snapshot()).encode())
        corrupt = bytearray(good)
        # Flip a byte in the DEFLATE body (past the 10-byte header) so the stream is corrupt, not truncated.
        corrupt[12] ^= 0xFF
        for packed in ('not base64!!', base64.b64encode(b'not gzip').decode(),
                       base64.b64encode(gzip.compress(b'"text"')).decode(),
                       base64.b64encode(good[:-4]).decode(),          # truncated: missing trailer -> EOFError
                       base64.b64encode(bytes(corrupt)).decode()):    # corrupt DEFLATE -> zlib.error
            with self.subTest(packed=packed[:24]):
                raw, stored = self.raw_session(), self.stored()
                response = self.send('post', RESTORE_URL, {'case_id': self.case_id, 'snapshot_gz': packed})
                self.assert_untouched(response, 400, raw, stored)
                self.assertEqual(response.json()['error'], 'invalid_snapshot')

    def test_an_oversized_decompressed_snapshot_is_refused_as_invalid(self):
        self.setup_family()
        # A tiny compressed body that expands past MAX_SNAPSHOT_BYTES must be refused, not decompressed whole.
        bomb = gzip.compress(b'x' * (views.MAX_SNAPSHOT_BYTES + 1))
        self.assertLess(len(bomb), views.MAX_SNAPSHOT_BYTES)
        packed = base64.b64encode(bomb).decode()
        raw, stored = self.raw_session(), self.stored()
        response = self.send('post', RESTORE_URL, {'case_id': self.case_id, 'snapshot_gz': packed})
        self.assert_untouched(response, 400, raw, stored)
        self.assertEqual(response.json()['error'], 'invalid_snapshot')


class ExpiryTests(CommandBase):
    LIMIT = settings.ANONYMOUS_CASE_IDLE_SECONDS

    def test_an_expired_guest_case_reads_as_none_with_a_code(self):
        case = self.ready()
        self.age(self.LIMIT + 1)
        self.assertEqual(self.client.get(CASE_URL, secure=True).json(), {'case': None, 'code': 'expired'})
        for response in (self.heir(case, expected_revision=case['revision']),
                         self.client.get(f'{PREVIEW_URL}?case_id={case["id"]}', secure=True),
                         self.client.get(f'{DRAFT_URL}?case_id={case["id"]}', secure=True)):
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json(), {'detail': 'There is no current case.', 'case': None, 'code': 'expired'})

    def test_a_case_just_inside_the_limit_still_works(self):
        case = self.ready()
        self.age(self.LIMIT - 60)
        self.assertEqual(self.heir(case).status_code, 201)

    def test_without_changed_at_started_at_decides(self):
        case = self.ready()
        row = Session.objects.get()
        data = row.get_decoded()
        stored = data[anonymous_case.SESSION_KEY]
        stored.pop('changed_at')
        stored['started_at'] = (timezone.now() - timedelta(seconds=self.LIMIT + 5)).isoformat()
        row.session_data = SessionStore().encode(data)
        row.save()
        self.assertEqual(self.client.get(CASE_URL, secure=True).json()['code'], 'expired')

    def test_starting_without_replace_after_expiry_makes_a_fresh_case(self):
        case = self.ready()
        self.age(self.LIMIT + 1)
        response = self.send('post', CASE_URL, {})
        self.assertEqual(response.status_code, 201)
        self.assertNotEqual(response.json()['case']['id'], case['id'])

    def test_reads_and_previews_never_refresh_changed_at(self):
        case = self.ready()
        self.heir(case)
        changed = self.stored()['changed_at']
        self.client.get(CASE_URL, secure=True)
        self.client.get(f'{PREVIEW_URL}?case_id={case["id"]}', secure=True)
        self.assertEqual(self.stored()['changed_at'], changed)
        self.heir(case)
        self.assertGreater(self.stored()['changed_at'], changed)

    def test_saving_an_expired_guest_case_is_a_404_with_the_code(self):
        user = get_user_model().objects.create_user('saver3', password='pw-12345-abc')
        self.client.force_login(user)
        case = self.ready()
        self.heir(case)
        self.age(self.LIMIT + 1)
        response = self.send('post', SAVED_URL, {'case_id': case['id']})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['code'], 'expired')
        self.assertEqual(SavedCase.objects.count(), 0)

    def test_a_saved_working_copy_never_expires_here(self):
        user = get_user_model().objects.create_user('saver', password='pw-12345-abc')
        self.client.force_login(user)
        case = self.ready()
        self.heir(case)
        self.assertEqual(self.send('post', SAVED_URL, {'case_id': case['id']}).status_code, 201)
        self.age(self.LIMIT * 3)
        live = self.client.get(CASE_URL, secure=True).json()['case']
        self.assertIsNotNone(live)
        self.assertEqual(self.heir(live, 'daughter').status_code, 201)


class SavedCaseRevisionTests(CommandBase):
    def test_each_save_adds_one_and_writes_schema_one(self):
        user = get_user_model().objects.create_user('saver2', password='pw-12345-abc')
        self.client.force_login(user)
        case = self.ready()
        self.heir(case)
        first = self.send('post', SAVED_URL, {'case_id': case['id']})
        self.assertEqual((first.status_code, first.json()['revision']), (201, 1))
        self.heir(case, 'daughter')
        second = self.send('post', SAVED_URL, {'case_id': case['id']})
        self.assertEqual((second.status_code, second.json()['revision']), (200, 2))
        row = SavedCase.objects.get()
        self.assertEqual((row.revision, row.schema_version), (2, 1))
        self.assertNotIn('revision', row.snapshot)

    def test_existing_rows_read_revision_one_after_the_migration(self):
        executor = MigrationExecutor(connection)
        target = executor.loader.graph.leaf_nodes('api')[0]
        before = [('api', '0004_import_legacy_calculations')]
        executor.migrate(before)
        try:
            old = MigrationExecutor(connection).loader.project_state(before).apps
            owner = get_user_model().objects.create_user('old-owner')
            row = old.get_model('api', 'SavedCase').objects.create(owner_id=owner.pk, snapshot={})
        finally:
            MigrationExecutor(connection).migrate([target])
        self.assertEqual(SavedCase.objects.get(pk=row.pk).revision, 1)


class LockBudgetTests(CommandBase):
    def hold(self, key, locked, release, failures):
        def run():
            try:
                with transaction.atomic():
                    list(Session.objects.select_for_update().filter(session_key=key).values_list('pk', flat=True))
                    locked.set()
                    release.wait(30)
            except BaseException:
                failures.append(traceback.format_exc())
                locked.set()
            finally:
                connections.close_all()
        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return thread

    def test_a_held_session_row_gives_a_retryable_503_and_a_redacted_log(self):
        case = self.ready()
        key = self.client.cookies[settings.SESSION_COOKIE_NAME].value
        raw, stored = self.raw_session(), self.stored()
        locked, release, failures = threading.Event(), threading.Event(), []
        thread = self.hold(key, locked, release, failures)
        self.assertTrue(locked.wait(10))
        try:
            started = time.monotonic()
            with self.assertLogs('mawareeth.case_lock', level='INFO') as logs:
                response = self.heir(case, expected_revision=case['revision'] + 1)
            elapsed_ms = (time.monotonic() - started) * 1000
        finally:
            release.set()
            thread.join(30)
        self.assertEqual(failures, [])
        self.assertEqual(response.status_code, 503, response.content)
        self.assertEqual(response.json(), {'error': 'busy', 'detail': 'The case is busy. Try again.',
                                           'retryable': True})
        self.assertEqual(response['Retry-After'], '1')
        self.assertLess(elapsed_ms, settings.CASE_LOCK_TIMEOUT_MS + 1500)
        self.assertEqual(self.raw_session(), raw)
        self.assertEqual(self.stored(), stored)
        records = [r for r in logs.records if r.name == 'mawareeth.case_lock']
        self.assertTrue(any(r.outcome == 'timeout' and type(r.wait_ms) is int for r in records))
        text = ' '.join(r.getMessage() + json.dumps(r.__dict__, default=str) for r in records)
        self.assertNotIn(key, text)
        self.assertNotIn(case['id'], text)

    def test_an_acquired_lock_is_logged_with_its_wait(self):
        case = self.ready()
        with self.assertLogs('mawareeth.case_lock', level='INFO') as logs:
            self.assertEqual(self.heir(case).status_code, 201)
        self.assertTrue(any(r.outcome == 'acquired' and type(r.wait_ms) is int for r in logs.records))

    def test_two_edits_at_the_same_revision_let_exactly_one_win(self):
        case = self.ready()
        revision = self.revision()
        headers = self.csrf(self.client)
        results, failures = [], []

        def send():
            try:
                client = APIClient(enforce_csrf_checks=True)
                client.cookies = self.client.cookies
                results.append(client.post(
                    HEIRS_URL, {'case_id': case['id'], 'relationship': 'son', 'expected_revision': revision},
                    format='json', secure=True, headers=headers).status_code)
            except BaseException:
                failures.append(traceback.format_exc())
            finally:
                connections.close_all()

        threads = [threading.Thread(target=send, daemon=True) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(60)
        self.assertEqual(failures, [])
        self.assertEqual(sorted(results), [201, 409])
        self.assertEqual(self.revision(), revision + 1)
        self.assertEqual(len(self.live()['heirs']), 1)


class PreviewRevisionTests(CommandBase):
    def test_a_preview_names_the_revision_it_was_computed_from(self):
        case = self.ready()
        self.heir(case)
        live = self.live()
        body = self.preview(live['id']).json()
        self.assertEqual(body['revision'], live['revision'])
        self.heir(case, 'daughter')
        self.assertEqual(self.preview(live['id']).json()['revision'], live['revision'] + 1)


class PositionedAddTests(CommandBase):
    """Story 9.7: an add may name the person it hangs from."""

    def son_and_anchor(self, **post):
        case = self.build('hanbali', 'male', None, ['son'], ['S'])
        return case, case['heirs'][0]['id']

    def test_no_anchor_key_is_unchanged_and_root_adds_no_edge(self):
        case = self.ready()
        plain = self.heir(case)
        self.assertEqual(plain.status_code, 201)
        rooted = self.heir(case, 'daughter', anchor='root')
        self.assertEqual(rooted.status_code, 201)
        self.assertEqual(rooted.json()['case']['edges'], [])
        self.assertEqual([h['relationship'] for h in rooted.json()['case']['heirs']], ['son', 'daughter'])
        self.assertEqual(set(plain.json()['case']), set(rooted.json()['case']))

    def test_every_placement_entry_has_a_gender(self):
        case, _ = self.son_and_anchor()
        for entries in case['placement'].values():
            for entry in entries:
                self.assertIn(entry['gender'], ('male', 'female'))
        self.assertEqual({e['relationship']: e['gender'] for e in case['placement']['root']}['son'], 'male')

    @override_settings(SNAPSHOT_WRITE_VERSION=2)
    def test_child_edge(self):
        case, son = self.son_and_anchor()
        response = self.heir(case, 'son_of_son', anchor=son)
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()['case']
        new = next(h['id'] for h in body['heirs'] if h['relationship'] == 'son_of_son')
        self.assertEqual(body['edges'], [{'kind': 'parent_of', 'from': son, 'to': new}])
        self.assertEqual(self.stored()['edges'], body['edges'])

    @override_settings(SNAPSHOT_WRITE_VERSION=2)
    def test_parent_edge(self):
        case = self.build('hanbali', 'male', None, ['father'], ['F'])
        father = case['heirs'][0]['id']
        response = self.heir(case, 'paternal_grandmother', anchor=father)
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()['case']
        new = next(h['id'] for h in body['heirs'] if h['relationship'] == 'paternal_grandmother')
        self.assertEqual(body['edges'], [{'kind': 'parent_of', 'from': new, 'to': father}])

    @override_settings(SNAPSHOT_WRITE_VERSION=2)
    def test_died_before_anchor_and_restore(self):
        case, son = self.son_and_anchor()
        edit = self.send('put', f'{HEIRS_URL}{son}/', {
            'case_id': case['id'], 'relationship': 'son', 'status': 'died_before_or_with'})
        self.assertEqual(edit.status_code, 200, edit.content)
        before = self.live()
        response = self.heir(before, 'son_of_son', anchor=son)
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()['case']
        new = next(h['id'] for h in body['heirs'] if h['relationship'] == 'son_of_son')
        self.assertEqual(body['edges'], [{'kind': 'parent_of', 'from': son, 'to': new}])
        restored = self.send('post', RESTORE_URL, {
            'case_id': case['id'], 'snapshot': anonymous_case.export_snapshot(before)})
        self.assertEqual(restored.status_code, 200, restored.content)
        self.assertEqual(restored.json()['case']['edges'], [])
        self.assertEqual(restored.json()['case']['heirs'], [])

    @override_settings(SNAPSHOT_WRITE_VERSION=2)
    def test_later_estate_anchor(self):
        self.setup_family()
        self.assertEqual(self.mark(self.s1).status_code, 201)
        death = self.live()['deaths'][0]
        anchor, entries = next((a, e) for a, e in death['placement'].items() if a != 'root' and e)
        entry = entries[0]
        response = self.add_layer(death['heir_id'], entry['relationship'], anchor=anchor)
        self.assertEqual(response.status_code, 201, response.content)
        edges = response.json()['case']['edges']
        self.assertEqual(len(edges), 1)
        self.assertIn(anchor, (edges[0]['from'], edges[0]['to']))

    def test_writer_1_refuses_a_non_root_anchor_without_changes(self):
        case, son = self.son_and_anchor()
        before_raw, before = self.raw_session(), self.stored()
        response = self.heir(case, 'son_of_son', anchor=son)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['errors'], {'anchor': 'schema_unsupported'})
        self.assertEqual(self.raw_session(), before_raw)
        self.assertEqual(self.stored(), before)

    @override_settings(SNAPSHOT_WRITE_VERSION=2)
    def test_not_offered_unknown_non_string_and_same_as_are_refused(self):
        case, son = self.son_and_anchor()
        before_raw, before = self.raw_session(), self.stored()
        for extra in ({'anchor': son, 'relationship': 'son'},
                      {'anchor': 'nobody', 'relationship': 'son'},
                      {'anchor': 7, 'relationship': 'son'},
                      {'anchor': None, 'relationship': 'son'},
                      {'anchor': son, 'relationship': 'son_of_son', 'same_as': son}):
            response = self.heir(case, **extra)
            self.assertEqual(response.status_code, 400, extra)
            self.assertEqual(response.json()['errors']['anchor'], 'not_allowed', extra)
            self.assertEqual(self.raw_session(), before_raw)
        self.assertEqual(self.stored(), before)

    def test_a_slot_the_engine_no_longer_offers_is_refused(self):
        case = self.ready()
        self.assertEqual(self.heir(case, 'father', anchor='root').status_code, 201)
        response = self.heir(case, 'father', anchor='root')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['errors']['anchor'], 'not_allowed')
