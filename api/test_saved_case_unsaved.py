from unittest import mock

from django.contrib.auth import get_user_model
from django.db import OperationalError
from django.contrib.sessions.backends.db import SessionStore
from django.contrib.sessions.models import Session

from api import anonymous_case
from api.models import SavedCase
from api.tests import CASE_URL, HEIRS_URL, InterviewBase


class SavedCaseUnsavedTests(InterviewBase):
    url = '/api/v1/saved-cases/'

    def setUp(self):
        super().setUp()
        self.owner = get_user_model().objects.create_user(username='unsaved-owner', password='test')
        self.client.force_login(self.owner)

    def complete(self):
        case = self.ready()
        self.send('patch', CASE_URL, {'case_id': case['id'], 'madhab': 'hanafi'})
        self.heir(case, name='Family name')
        return self.live()

    def save(self, case):
        return self.send('post', self.url, {'case_id': case['id']})

    def open(self, row, body=None):
        return self.send('post', f'{self.url}{row.pk}/open/', {} if body is None else body)

    def saved_row(self):
        case = self.complete()
        self.assertEqual(self.save(case).status_code, 201)
        return SavedCase.objects.get()

    def test_fresh_open_and_save_hold_the_case_revision(self):
        row = self.saved_row()
        live = self.live()
        self.assertEqual(live['saved'], {'revision': live['revision']})
        opened = self.open(row).json()['case']
        self.assertEqual(opened['saved'], {'revision': opened['revision']})

    def test_an_edit_makes_the_revisions_differ_in_the_command_answer_too(self):
        self.saved_row()
        case = self.live()
        held = case['saved']['revision']
        self.assertEqual(held, case['revision'])
        answer = self.heir(case, 'wife').json()['case']
        self.assertEqual(answer['saved'], {'revision': held})
        self.assertGreater(answer['revision'], held)
        after = self.live()
        self.assertEqual(after['saved'], {'revision': held})
        self.assertEqual(after['revision'], answer['revision'])

    def test_a_refused_edit_changes_nothing(self):
        self.saved_row()
        case = self.live()
        self.assertEqual(self.heir(case, 'not_a_relationship').status_code, 400)
        self.assertEqual(self.live()['saved'], {'revision': case['revision']})
        stale = self.send('post', HEIRS_URL, {'case_id': case['id'], 'relationship': 'wife',
                                              'expected_revision': case['revision'] + 5})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.live()['saved'], {'revision': case['revision']})

    def test_saving_again_equalizes_and_a_refused_save_does_not(self):
        row = self.saved_row()
        self.heir(self.live(), 'wife')
        self.assertEqual(self.save(self.live()).status_code, 200)
        live = self.live()
        self.assertEqual(live['saved'], {'revision': live['revision']})
        # Another tab saved the row meanwhile: 409, still unsaved.
        self.heir(live, 'daughter')
        SavedCase.objects.filter(pk=row.pk).update(revision=99)
        self.assertEqual(self.save(self.live()).status_code, 409)
        behind = self.live()
        self.assertNotEqual(behind['saved']['revision'], behind['revision'])

    def test_never_saved_cases_have_no_link(self):
        self.assertIsNone(self.start()['saved'])
        case = self.ready()
        self.assertIsNone(self.live()['saved'])
        self.assertIsNone(self.heir(case, 'son').json()['case']['saved'])

    def test_an_old_link_has_a_null_revision_until_the_next_save(self):
        self.saved_row()
        case = self.live()
        session = Session.objects.get()
        data = session.get_decoded()
        data[anonymous_case.SAVED_LINK_KEY].pop('case_revision')
        session.session_data = SessionStore().encode(data)
        session.save()
        self.assertEqual(self.live()['saved'], {'revision': None})
        self.heir(case, 'wife')
        self.assertEqual(self.save(self.live()).status_code, 200)
        live = self.live()
        self.assertEqual(live['saved'], {'revision': live['revision']})

    def test_saved_is_not_stored_or_exported(self):
        self.saved_row()
        self.heir(self.live(), 'wife')
        self.assertNotIn('saved', self.stored())
        self.assertNotIn('saved', self.live()['snapshot'])
        self.assertNotIn('saved', SavedCase.objects.get().snapshot)

    def test_start_over_clears_the_link(self):
        self.saved_row()
        self.send('post', CASE_URL, {'replace': True})
        self.assertIsNone(self.live()['saved'])

    def test_open_with_an_empty_body_behaves_as_before(self):
        row = self.saved_row()
        self.heir(self.live(), 'wife')
        self.assertEqual(self.open(row, {}).status_code, 200)

    def test_open_with_a_matching_check_replaces_the_copy(self):
        row = self.saved_row()
        self.heir(self.live(), 'wife')
        live = self.live()
        self.assertEqual(len(live['heirs']), 2)
        response = self.open(row, {'case_id': live['id'], 'expected_revision': live['revision']})
        self.assertEqual(response.status_code, 200)
        answer = response.json()['case']
        self.assertNotEqual(answer['id'], live['id'])
        # The saved row's family, with the edit gone.
        self.assertEqual([h['relationship'] for h in answer['heirs']], ['son'])
        self.assertEqual(answer['saved'], {'revision': answer['revision']})
        again = self.live()
        self.assertEqual(again['id'], answer['id'])
        self.assertEqual(again['saved'], answer['saved'])
        self.assertEqual(len(again['heirs']), 1)

    def test_open_with_a_stale_check_replaces_nothing(self):
        row = self.saved_row()
        live = self.live()
        for body in ({'case_id': live['id'], 'expected_revision': live['revision'] + 1},
                     {'case_id': 'other', 'expected_revision': 1},
                     {'case_id': None}):
            with self.subTest(body=body):
                response = self.open(row, body)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json()['error'], 'conflict')
                self.assertEqual(response.json()['case']['id'], live['id'])
                self.assertEqual(self.live()['id'], live['id'])

    def test_open_with_a_null_case_id_and_no_case_opens(self):
        row = self.saved_row()
        self.send('post', CASE_URL, {'replace': True})
        Session.objects.all().delete()
        self.client.force_login(self.owner)
        self.assertIsNone(self.client.get(CASE_URL, secure=True).json()['case'])
        self.assertEqual(self.open(row, {'case_id': None}).status_code, 200)

    def test_open_refuses_a_malformed_check(self):
        row = self.saved_row()
        live = self.live()
        for body in ({'case_id': 5}, {'case_id': live['id'], 'expected_revision': 'x'}):
            with self.subTest(body=body):
                self.assertEqual(self.open(row, body).status_code, 400)
        self.assertEqual(self.live()['id'], live['id'])

    def test_an_undo_restore_leaves_the_state_unsaved(self):
        self.saved_row()
        before = self.live()
        held = before['saved']['revision']
        self.assertEqual(self.heir(before, 'wife').status_code, 201)
        restored = self.send('post', '/api/v1/case/restore/',
                             {'case_id': before['id'], 'snapshot': before['snapshot']})
        self.assertEqual(restored.status_code, 200)
        after = self.live()
        # Revision based: back to the saved family still reads as unsaved.
        self.assertEqual(after['saved'], {'revision': held})
        self.assertGreater(after['revision'], held)

    def test_a_save_that_answers_400_or_503_stays_unsaved(self):
        row = self.saved_row()
        case = self.live()
        self.heir(case, 'wife')
        behind = self.live()
        self.assertNotEqual(behind['saved']['revision'], behind['revision'])
        with mock.patch('api.views.ensure_writable', side_effect=ValueError('no')):
            self.assertEqual(self.save(behind).status_code, 400)
        self.assertEqual(self.live()['saved'], behind['saved'])
        # 503: the row lock times out.
        with mock.patch.object(SavedCase.objects, 'select_for_update', side_effect=OperationalError('lock')),                 mock.patch('api.views.is_lock_timeout', return_value=True):
            self.assertEqual(self.save(self.live()).status_code, 503)
        after = self.live()
        self.assertNotEqual(after['saved']['revision'], after['revision'])
        self.assertEqual(SavedCase.objects.get().pk, row.pk)

    def test_open_naming_a_case_when_there_is_none_answers_409_without_a_case(self):
        row = self.saved_row()
        self.send('post', CASE_URL, {'replace': True})
        Session.objects.all().delete()
        self.client.force_login(self.owner)
        for body in ({'case_id': 'gone', 'expected_revision': 2}, {'case_id': 'gone'}):
            with self.subTest(body=body):
                response = self.open(row, body)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json()['error'], 'conflict')
                self.assertIsNone(response.json()['case'])
        self.assertIsNone(self.client.get(CASE_URL, secure=True).json()['case'])

    def test_open_with_a_revision_but_no_case_id_conflicts_when_there_is_a_case(self):
        row = self.saved_row()
        live = self.live()
        response = self.open(row, {'expected_revision': live['revision']})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.live()['id'], live['id'])

    def test_open_with_a_revision_but_no_case_id_and_no_case_conflicts_not_crashes(self):
        row = self.saved_row()
        self.send('post', CASE_URL, {'replace': True})
        Session.objects.all().delete()
        self.client.force_login(self.owner)
        response = self.open(row, {'expected_revision': 1})
        self.assertEqual(response.status_code, 409)
        self.assertIsNone(response.json()['case'])

    def test_open_with_a_check_refuses_an_unreadable_working_copy(self):
        row = self.saved_row()
        live = self.live()
        self.plant(schema_version=3)
        for body in ({'case_id': None}, {'case_id': live['id']}, {'expected_revision': 1}):
            with self.subTest(body=body):
                response = self.open(row, body)
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()['code'], 'unsupported_version')
        self.assertEqual(self.stored()['id'], live['id'])
        self.assertEqual(self.stored()['schema_version'], 3)
        # Without a check the old behaviour stands: the open replaces the copy.
        self.assertEqual(self.open(row, {}).status_code, 200)
