from contextlib import redirect_stdout
from importlib import import_module
from io import StringIO
from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase

from api import anonymous_case
from api.legacy_cases import Unconvertible, convert, import_all
from api.models import SavedCase
from api.tests import InterviewHelpers
from calc.models import Calculation, Deceased, Heir, Person, Wife, Son, Mother, Brother
from calc.tests import build_case, build_layer


class LegacyCaseTests(InterviewHelpers, TestCase):
    def convert(self, calc):
        return convert(calc, ContentType, Heir, Deceased)

    def import_all(self):
        return import_all(Calculation, ContentType, Heir, Deceased, SavedCase)

    def legacy_rows(self):
        return {model.__name__: list(model.objects.non_polymorphic().order_by('pk').values())
                if hasattr(model.objects, 'non_polymorphic') else list(model.objects.order_by('pk').values())
                for model in (Calculation, Person, Heir, Deceased, Wife, Son, Mother, Brother)}

    def test_simple_and_owner_surface_and_engine(self):
        calc, heirs = build_case('M', [Wife, Son], estate=120000)
        heirs[0].first_name = ''
        heirs[0].sex = 'M'  # Relationship, rather than this field, determines gender.
        heirs[0].save()
        heirs[1].first_name, heirs[1].last_name = 'Ali', 'Hasan'
        heirs[1].save()
        expected = {'madhab': 'hanbali', 'deceased': {'gender': 'male', 'estate': '120000'},
                    'heirs': [{'id': 'h1', 'relationship': 'wife', 'gender': 'female', 'name': None},
                              {'id': 'h2', 'relationship': 'son', 'gender': 'male', 'name': 'Ali Hasan'}],
                    'deaths': []}
        before = self.legacy_rows()
        self.assertEqual(self.convert(calc), expected)
        self.assertEqual(self.import_all(), (1, [], 0))
        self.assertEqual(self.legacy_rows(), before)
        saved = SavedCase.objects.get()
        self.assertEqual(saved.owner_id, calc.user_id)
        self.assertEqual(saved.schema_version, 1)
        self.assertEqual(saved.snapshot, expected)
        self.client.force_login(calc.user)
        url = '/api/v1/saved-cases/'
        listed = self.client.get(url, secure=True).json()['cases']
        self.assertEqual(len(listed), 1)
        self.assertEqual((listed[0]['madhab'], listed[0]['heir_count']), ('hanbali', 2))
        opened = self.send('post', f'{url}{saved.pk}/open/', {})
        self.assertEqual(opened.status_code, 200)
        case = opened.json()['case']
        self.assertEqual(anonymous_case.export_snapshot(case), expected)
        preview = self.client.get(f'/api/v1/case/preview/?case_id={case["id"]}', secure=True)
        self.assertEqual(preview.status_code, 200)
        final = calc.compute(madhab='hanbali')
        for share, heir in zip(preview.json()['shares'], heirs):
            self.assertEqual((share['numerator'], share['denominator']),
                             (final[heir.pk].numerator, final[heir.pk].denominator))
        other = get_user_model().objects.create_user(username='other')
        self.client.force_login(other)
        self.assertEqual(self.client.get(url, secure=True).json()['cases'], [])
        self.assertEqual(self.send('post', f'{url}{saved.pk}/open/', {}).status_code, 404)

    def test_nonpositive_estates(self):
        for estate in (0, -1):
            calc, _ = build_case('F', [Son], estate=estate)
            self.assertEqual(self.convert(calc)['deceased'], {'gender': 'female', 'estate': None})

    def test_layers_and_canonical_death_target(self):
        root, (wife, son, brother) = build_case('M', [Wife, Son, Brother])
        second, later = build_layer(root, son, 'M', [Mother, Brother], [(0, wife), (1, brother)])
        build_layer(second, later[0], 'F', [Son], order=3)
        snapshot = self.convert(root)
        self.assertEqual([row['id'] for row in snapshot['heirs']], ['h1', 'h2', 'h3'])
        self.assertEqual([d['heir_id'] for d in snapshot['deaths']], ['h2', 'h1'])
        self.assertEqual(snapshot['deaths'][0]['heirs'][1]['same_as'], 'h3')
        self.assertEqual(snapshot['deaths'][1]['heirs'][0]['id'], 'h6')
        self.assertEqual(anonymous_case.export_snapshot(
            anonymous_case.read_snapshot(snapshot, 'id', 'time')), snapshot)
        self.assertEqual(self.import_all(), (1, [], 0))
        self.client.force_login(root.user)
        opened = self.send('post', f'/api/v1/saved-cases/{SavedCase.objects.get().pk}/open/', {})
        self.assertEqual(anonymous_case.export_snapshot(opened.json()['case']), snapshot)

    def test_chained_link_and_later_death_gender(self):
        root, (wife, son, brother) = build_case('M', [Wife, Son, Brother])
        second, later = build_layer(root, son, 'M', [Mother, Brother], [(0, wife), (1, brother)])
        # The third layer links through the second layer's row, and its deceased's stale sex is ignored.
        build_layer(second, later[0], 'M', [Son, Brother], [(1, later[1])], order=3)
        snapshot = self.convert(root)
        third = snapshot['deaths'][1]
        self.assertEqual((third['heir_id'], third['gender']), ('h1', 'female'))
        self.assertEqual(third['heirs'][1]['same_as'], 'h3')
        self.assertEqual(self.import_all(), (1, [], 0))

    def test_unconvertible_matrix_and_unchanged_rows(self):
        cases = []
        calc, _ = build_case('M', [])
        cases.append((calc, 'no heirs'))
        calc, _ = build_case('M', [Son])
        calc.deceased_set.all().delete()
        cases.append((calc, 'no deceased'))
        calc, _ = build_case('M', [Son])
        Deceased.objects.create(calc=calc, sex='M', estate=1)
        cases.append((calc, 'multiple deceased'))
        calc, _ = build_case('', [Son])
        cases.append((calc, 'invalid deceased sex'))
        calc, _ = build_case('M', [])
        Heir.objects.create(calc=calc)
        cases.append((calc, 'unknown relationship'))
        for name in ('x' * 101, 'bad\u202ename'):
            calc, (heir,) = build_case('M', [Son])
            heir.first_name, heir.last_name = name[:100], name[100:]
            heir.save()
            cases.append((calc, 'invalid name'))
        calc, _ = build_case('M', [Son] * 51)
        cases.append((calc, 'not representable'))
        calc, (son,) = build_case('M', [Son])
        build_layer(calc, son, 'M', [Son], order=3)
        cases.append((calc, 'not representable'))
        calc, (son,) = build_case('M', [Son])
        layer, later = build_layer(calc, son, 'M', [Son])
        layer, later = build_layer(layer, later[0], 'M', [Son], order=3)
        build_layer(layer, later[0], 'M', [Son], order=4)
        cases.append((calc, 'not representable'))
        calc, (son,) = build_case('M', [Son])
        build_layer(calc, son, 'M', [Son], [(0, son)])  # Link to someone already dead.
        cases.append((calc, 'not representable'))
        ownerless, _ = build_case('M', [Son])
        ownerless.user = None
        ownerless.save()
        before = self.legacy_rows()
        for calc, reason in cases:
            with self.subTest(calc=calc.pk), self.assertRaisesRegex(Unconvertible, reason):
                self.convert(calc)
        converted, reports, count = self.import_all()
        self.assertEqual((converted, count, len(reports)), (0, 1, len(cases)))
        for (calc, reason), line in zip(cases, reports):
            self.assertIn(f'calculation {calc.pk}, owner {calc.user_id}: {reason}', line)
        self.assertFalse(SavedCase.objects.exists())
        self.assertEqual(self.legacy_rows(), before)

    def test_migration_historical_models_and_output(self):
        migration = import_module('api.migrations.0004_import_legacy_calculations')
        apps = MigrationExecutor(connection).loader.project_state([
            ('api', '0003_invites'), ('calc', '0028_manasikhat')]).apps
        output = StringIO()
        with redirect_stdout(output):
            migration.forwards(apps, SimpleNamespace(connection=connection))
        self.assertEqual(output.getvalue(), '')
        calc, _ = build_case('M', [Wife, Son])
        bad, _ = build_case('M', [])
        ownerless, _ = build_case('M', [Son])
        ownerless.user = None
        ownerless.save()
        before = self.legacy_rows()
        with redirect_stdout(output):
            migration.forwards(apps, SimpleNamespace(connection=connection))
        self.assertEqual(output.getvalue().splitlines(), [
            f'Legacy calculation {bad.pk}, owner {bad.user_id}: no heirs',
            'Legacy calculations: converted=1, reported=1, ownerless=1'])
        self.assertEqual(SavedCase.objects.get().snapshot, self.convert(calc))
        self.assertEqual(self.legacy_rows(), before)
