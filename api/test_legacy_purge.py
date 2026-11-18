from io import StringIO
from queue import Queue
from threading import Event, Thread
from time import monotonic, sleep
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection, connections, transaction
from django.test import TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from api.legacy_cases import convert
from api.models import SavedCase, ShareInvite, ShareLink
from calc.models import Calculation, Deceased, Heir, Person, Son
from calc.tests import build_case, build_layer


class LegacyPurgeTests(TestCase):
    def setUp(self):
        self.good, (son,) = build_case('M', [Son])
        self.user = self.good.user
        self.empty = Calculation.objects.create(user=self.user, name='Secret')
        Son.objects.create(calc=self.empty, first_name='Layla', sex='M')
        self.layer, _ = build_layer(self.empty, son, 'M', [Son])
        self.empty2 = Calculation.objects.create(user=self.user, name='Secret')
        self.no_heirs, _ = build_case('M', [])
        self.empty_anomaly, _ = build_case('M', [])
        Deceased.objects.create(calc=self.empty_anomaly, sex='M', estate=1)
        self.anomaly, _ = build_case('M', [Son])
        Deceased.objects.create(calc=self.anomaly, sex='M', estate=1)
        self.ownerless = Calculation.objects.create(name='Secret')
        # Empty child layers are not independently selected.
        self.child = Calculation.objects.create(parent=self.anomaly, user=self.user, name='Secret')
        build_case('', [Son])
        unknown, _ = build_case('M', [])
        Heir.objects.create(calc=unknown)
        invalid_name, (heir,) = build_case('M', [Son])
        heir.first_name = 'bad\u202ename'
        heir.save()
        build_case('M', [Son] * 51)  # Not representable.
        saved = SavedCase.objects.create(owner=self.user, snapshot={'private': 'Secret'})
        ShareLink.objects.create(saved_case=saved, token_hash='link', expires_at=timezone.now())
        ShareInvite.objects.create(saved_case=saved, email='private@example.com',
                                   token_hash='invite', expires_at=timezone.now())

    def rows(self):
        result = {}
        for model in (Calculation, Person, Heir, Deceased, Son, SavedCase,
                      ShareLink, ShareInvite, get_user_model()):
            rows = model.objects.all()
            if hasattr(rows, 'non_polymorphic'):
                rows = rows.non_polymorphic()
            result[model.__name__] = list(rows.order_by('pk').values())
        return result

    def run_command(self, *args):
        output = StringIO()
        call_command('purge_empty_legacy_drafts', *args, stdout=output)
        return output.getvalue().splitlines()

    def expected(self):
        return ['no_deceased=2 no_heirs=2 total=4',
                f'no_deceased_ids={self.empty.pk},{self.empty2.pk}',
                f'no_heirs_ids={self.no_heirs.pk},{self.empty_anomaly.pk}']

    def test_dry_run_and_expect(self):
        before = self.rows()
        output = self.run_command('--dry-run', '--expect', '4')
        self.assertEqual(output, self.expected())
        for name in ('Secret', 'Layla'):
            self.assertNotIn(name, '\n'.join(output))
        self.assertEqual(self.rows(), before)

    def test_delete_cascades_preserves_everything_else_and_rerun(self):
        before = self.rows()
        calcs = {self.empty.pk, self.empty2.pk, self.no_heirs.pk, self.empty_anomaly.pk, self.layer.pk}
        people = {row['person_ptr_id'] for kind in ('Heir', 'Deceased')
                  for row in before[kind] if row['calc_id'] in calcs}
        expected = {}
        for kind, rows in before.items():
            if kind == 'Calculation':
                rows = [row for row in rows if row['id'] not in calcs]
            elif kind == 'Person':
                rows = [row for row in rows if row['id'] not in people]
            elif kind in ('Heir', 'Deceased'):
                rows = [row for row in rows if row['person_ptr_id'] not in people]
            elif kind == 'Son':
                rows = [row for row in rows if row['heir_ptr_id'] not in people]
            expected[kind] = rows
        self.assertEqual(self.run_command('--expect', '4'), self.expected() + ['deleted=4'])
        self.assertEqual(self.rows(), expected)
        self.assertEqual(self.run_command(), ['no_deceased=0 no_heirs=0 total=0',
                                             'no_deceased_ids=', 'no_heirs_ids=', 'deleted=0'])

    def test_expect_mismatch_prints_counts_and_changes_nothing(self):
        before = self.rows()
        for args in ((), ('--dry-run',)):
            output = StringIO()
            with self.assertRaisesRegex(CommandError, '^expected=5 actual=4$'):
                call_command('purge_empty_legacy_drafts', *args, expect=5, stdout=output)
            self.assertEqual(output.getvalue().splitlines(), self.expected())
            self.assertEqual(self.rows(), before)

    def test_populated_root_with_broken_layer_is_preserved(self):
        Calculation.objects.create(parent=self.good, user=self.user, name='Secret')
        before = self.rows()
        self.assertEqual(self.run_command('--dry-run'), self.expected())
        self.assertEqual(self.rows(), before)
        self.run_command()
        after = self.rows()
        # Every row belonging to this populated tree survives byte-identically.
        tree = {self.good.pk, *self.good.layers.values_list('pk', flat=True)}
        people = {row['person_ptr_id'] for kind in ('Heir', 'Deceased')
                  for row in before[kind] if row['calc_id'] in tree}
        for kind, key, ids in (('Calculation', 'id', tree),
                               ('Heir', 'person_ptr_id', people),
                               ('Deceased', 'person_ptr_id', people),
                               ('Son', 'heir_ptr_id', people),
                               ('Person', 'id', people)):
            self.assertEqual([r for r in after[kind] if r[key] in ids],
                             [r for r in before[kind] if r[key] in ids])
        self.assertTrue(Calculation.objects.filter(parent=self.good).exists())

    def test_reclassification_under_lock_excludes_changed_candidate(self):
        calls = 0

        def classify(calc, *args):
            nonlocal calls
            if calc.pk == self.empty2.pk:
                calls += 1
                if calls == 2:
                    self.assertTrue(connection.in_atomic_block)
                    return {}  # Became convertible while waiting for the lock.
            return convert(calc, *args)

        with CaptureQueriesContext(connection) as queries, patch(
                'api.management.commands.purge_empty_legacy_drafts.convert', classify):
            output = self.run_command()
        self.assertTrue(any('FOR UPDATE' in query['sql'] for query in queries))
        self.assertEqual(output[0], 'no_deceased=1 no_heirs=2 total=3')
        self.assertEqual(output[-1], 'deleted=3')
        self.assertTrue(Calculation.objects.filter(pk=self.empty2.pk).exists())

    def test_delete_failure_rolls_back(self):
        from django.db.models.query import QuerySet

        original = QuerySet.delete
        before = self.rows()

        def fail_after_delete(rows):
            original(rows)
            raise RuntimeError('delete failed')

        with patch.object(QuerySet, 'delete', fail_after_delete):
            with self.assertRaisesRegex(RuntimeError, 'delete failed'):
                self.run_command()
        self.assertEqual(self.rows(), before)


class LegacyPurgeConcurrencyTests(TransactionTestCase):
    def test_concurrent_edit_is_reclassified_after_root_lock(self):
        self.assertEqual(connection.vendor, 'postgresql')
        user = get_user_model().objects.create_user(username='concurrent-owner')
        root = Calculation.objects.create(user=user)
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_backend_pid()')
            purge_pid = cursor.fetchone()[0]
        ready = Event()
        errors = Queue()

        def edit_root():
            editor = connections['default']  # Thread-local, separate connection.
            try:
                with transaction.atomic():
                    Calculation.objects.select_for_update().get(pk=root.pk)
                    with editor.cursor() as cursor:
                        cursor.execute('SELECT pg_backend_pid()')
                        editor_pid = cursor.fetchone()[0]
                        self.assertNotEqual(editor_pid, purge_pid)
                        ready.set()
                        deadline = monotonic() + 10
                        while True:
                            cursor.execute('SELECT pg_stat_clear_snapshot()')
                            cursor.execute(
                                "SELECT %s = ANY(pg_blocking_pids(pid)) "
                                "AND query LIKE '%%FOR UPDATE%%' "
                                "FROM pg_stat_activity WHERE pid = %s",
                                [editor_pid, purge_pid])
                            if cursor.fetchone() == (True,):
                                break
                            if monotonic() >= deadline:
                                raise AssertionError('Purge did not wait on the root SELECT FOR UPDATE')
                            sleep(0.01)
                    Deceased.objects.create(calc_id=root.pk, sex='M', estate=1)
                    Son.objects.create(calc_id=root.pk, sex='M')
                # Commit releases the lock only after both people exist.
            except BaseException as error:
                errors.put(error)
            finally:
                ready.set()
                editor.close()

        thread = Thread(target=edit_root, daemon=True)
        thread.start()
        try:
            self.assertTrue(ready.wait(10), 'Editor did not acquire the root lock')
            if not errors.empty():
                raise errors.get()
            output = StringIO()
            call_command('purge_empty_legacy_drafts', stdout=output)
        finally:
            thread.join(15)
        self.assertFalse(thread.is_alive(), 'Editor connection did not finish')
        if not errors.empty():
            raise errors.get()
        self.assertEqual(output.getvalue().splitlines(), [
            'no_deceased=0 no_heirs=0 total=0',
            'no_deceased_ids=', 'no_heirs_ids=', 'deleted=0'])
        self.assertTrue(Calculation.objects.filter(pk=root.pk).exists())
        self.assertEqual(Deceased.objects.filter(calc_id=root.pk).count(), 1)
        self.assertEqual(Heir.objects.filter(calc_id=root.pk).count(), 1)
