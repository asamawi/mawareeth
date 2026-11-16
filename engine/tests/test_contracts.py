"""Contract tests: unittest only, no Django. Fixtures live in the top-level contracts/ folder."""
import ast
import hashlib
import json
import unittest
from pathlib import Path

from engine import contracts as c
from engine.contracts import codes
from engine.contracts.basis import CompareBasis, CountryBasis, SchoolBasis

ROOT = Path(__file__).resolve().parent.parent.parent
CONTRACTS = ROOT / 'contracts'
FIXTURES = CONTRACTS / 'fixtures'

PARSERS = {
    'family': (c.parse_family, c.dump_family),
    'basis': (c.parse_basis, c.dump_basis),
    'result': (c.parse_result, c.dump_result),
    'comparison': (c.parse_comparison, c.dump_comparison),
    'presented_result': (c.parse_presented_result, c.dump_presented_result),
    'preset': (c.parse_preset, c.dump_preset),
    'catalog': (c.parse_catalog, c.dump_catalog),
}


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def presets_of(case):
    return {tuple(key.split('@')): school for key, school in case['presets'].items()}


class FixtureTests(unittest.TestCase):
    def test_every_contract_has_valid_fixtures(self):
        for name in PARSERS:
            self.assertTrue(list((FIXTURES / name).glob('*.json')), name)

    def test_valid_fixtures_round_trip(self):
        for name, (parse, dump) in PARSERS.items():
            for path in sorted((FIXTURES / name).glob('*.json')):
                with self.subTest(fixture=f'{name}/{path.name}'):
                    document = load(path)
                    self.assertEqual(dump(parse(document)), document)

    def test_invalid_fixtures_raise_their_exact_code(self):
        for name, (parse, _dump) in PARSERS.items():
            for case in load(FIXTURES / 'invalid' / f'{name}.json'):
                with self.subTest(contract=name, case=case['name']):
                    with self.assertRaises(c.ContractError) as raised:
                        if 'presets' in case:
                            c.resolve_basis(case['input'], presets_of(case))
                        else:
                            parse(case['input'])
                    self.assertEqual(raised.exception.code, case['error'])
                    body = raised.exception.to_dict()
                    self.assertEqual(set(body), {'error', 'detail'})
                    self.assertIsInstance(body['detail'], str)

    def test_every_error_row_of_the_matrix_has_a_fixture(self):
        names = {name: {case['name'] for case in load(FIXTURES / 'invalid' / f'{name}.json')} for name in PARSERS}
        self.assertIn('unsupported version', names['family'])
        self.assertIn('duplicate person id', names['family'])
        self.assertIn('country unavailable', names['basis'])
        self.assertIn('unreduced fraction', names['result'])


class FractionTests(unittest.TestCase):
    def share(self, value):
        document = load(FIXTURES / 'result' / 'blocked.json')
        document['allocations'][0]['share'] = value
        return document

    def test_golden(self):
        result = c.parse_result(self.share({'numerator': 1, 'denominator': 6}))
        self.assertEqual(str(result.allocations[0].share), '1/6')

    def test_rejects_float_and_integral_float(self):
        for value in (0.5, {'numerator': 1.0, 'denominator': 6}, {'numerator': 1, 'denominator': 6.0},
                      {'numerator': True, 'denominator': 6}, {'numerator': 2 ** 53, 'denominator': 1},
                      {'numerator': 2, 'denominator': 4}, {'numerator': 1, 'denominator': 0},
                      {'numerator': 1, 'denominator': -6}, {'numerator': -1, 'denominator': 6}):
            with self.subTest(value=value), self.assertRaises(c.ContractError) as raised:
                c.parse_result(self.share(value))
            self.assertEqual(raised.exception.code, 'invalid_contract')


class BasisTests(unittest.TestCase):
    PRESETS = {('zz', '2026-01-01'): 'hanbali'}

    def test_compare_and_school(self):
        self.assertEqual(c.resolve_basis({'kind': 'compare'}, {}), c.ResolvedBasis(CompareBasis(), None))
        self.assertEqual(c.resolve_basis({'kind': 'school', 'school': 'maliki'}, {}),
                         c.ResolvedBasis(SchoolBasis('maliki'), 'maliki'))

    def test_country_derives_its_school(self):
        resolved = c.resolve_basis({'kind': 'country', 'preset_id': 'zz', 'preset_version': '2026-01-01'},
                                   self.PRESETS)
        self.assertEqual(resolved, c.ResolvedBasis(CountryBasis('zz', '2026-01-01'), 'hanbali'))

    def test_country_unavailable(self):
        with self.assertRaises(c.ContractError) as raised:
            c.resolve_basis({'kind': 'country', 'preset_id': 'zz', 'preset_version': '2026-01-01'}, {})
        self.assertEqual(raised.exception.code, 'preset_unavailable')

    def test_legacy_snapshot_without_basis(self):
        cases = [('shafii', SchoolBasis('shafii'), 'shafii'), ('jafari', SchoolBasis('jafari'), 'jafari'),
                 (None, CompareBasis(), None), ('x', CompareBasis(), None), (5, CompareBasis(), None)]
        for madhab, basis, school in cases:
            with self.subTest(madhab=madhab):
                resolved = c.basis_for_snapshot({'madhab': madhab}, self.PRESETS)
                self.assertEqual(resolved, c.ResolvedBasis(basis, school))
        self.assertEqual(c.basis_for_snapshot({}, {}).basis, CompareBasis())

    def test_snapshot_with_basis_key_is_strict(self):
        for value in (None, 'compare', {'kind': 'school'}, {}):
            with self.subTest(basis=value), self.assertRaises(c.ContractError) as raised:
                c.basis_for_snapshot({'madhab': 'hanafi', 'basis': value}, self.PRESETS)
            self.assertEqual(raised.exception.code, 'invalid_basis')
        resolved = c.basis_for_snapshot({'madhab': 'hanafi', 'basis': {'kind': 'compare'}}, {})
        self.assertEqual(resolved.basis, CompareBasis())

    def test_legacy_never_yields_country(self):
        for madhab in (*codes.SCHOOLS, None, 'x', 'country'):
            self.assertNotIsInstance(c.basis_for_snapshot({'madhab': madhab}, self.PRESETS).basis, CountryBasis)


class ManifestTests(unittest.TestCase):
    def test_codes_py_equals_codes_json(self):
        document = load(CONTRACTS / 'codes.json')
        for name, values in document.items():
            self.assertEqual(list(getattr(codes, name.upper())), values, name)
        self.assertEqual({name.upper() for name in document},
                         {n for n in dir(codes) if n.isupper() and n != 'CONTRACT_VERSIONS'})

    def test_codes_are_snake_case_and_unique(self):
        import re
        for name, values in load(CONTRACTS / 'codes.json').items():
            self.assertEqual(len(values), len(set(values)), name)
            for value in values:
                self.assertRegex(value, re.compile(r'^[a-z][a-z0-9_]*$'))

    def test_manifest_equals_contract_versions(self):
        self.assertEqual(load(CONTRACTS / 'manifest.json'), c.CONTRACT_VERSIONS)

    def test_lock_matches_the_files(self):
        lock = load(CONTRACTS / 'fixtures.lock.json')
        manifest = load(CONTRACTS / 'manifest.json')
        files = {p.relative_to(CONTRACTS).as_posix() for p in FIXTURES.rglob('*.json')}
        for path in sorted(files | set(lock)):
            entry = lock.get(path)
            contract = entry['contract'] if entry else None
            self.assertIn(path, lock, f'{path} is not locked: run scripts/contract_fixtures_lock.py')
            parts = path.split('/')
            self.assertEqual(entry['contract'], Path(parts[2]).stem if parts[1] == 'invalid' else parts[1], path)
            self.assertLessEqual(entry['version'], manifest[contract], f'{path} ({contract}) is locked ahead of the manifest')
            self.assertTrue((CONTRACTS / path).exists(), f'{path} ({contract}) was removed from a locked contract')
            digest = hashlib.sha256((CONTRACTS / path).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
            self.assertEqual(digest, entry['sha256'],
                             f'{path} changed but the {contract} contract version was not raised in manifest.json')


class PurityTests(unittest.TestCase):
    def test_engine_imports_only_stdlib_and_itself(self):
        engine = ROOT / 'engine'
        allowed = set(__import__('sys').stdlib_module_names) | {'engine'}
        checked = 0
        for path in engine.rglob('*.py'):
            if 'tests' in path.relative_to(engine).parts:
                continue
            checked += 1
            for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
                if isinstance(node, ast.Import):
                    modules = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom):
                    if node.level:
                        continue
                    modules = [node.module]
                else:
                    continue
                for module in modules:
                    self.assertIn(module.split('.')[0], allowed, f'{path.name} imports {module}')
        self.assertGreater(checked, 5)


if __name__ == '__main__':
    unittest.main()
