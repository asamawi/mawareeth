"""Django-free import, effects, state and dependency-direction gate."""
import ast
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
FORBIDDEN = frozenset('os io pathlib shutil tempfile glob time datetime random secrets socket subprocess threading multiprocessing asyncio logging sqlite3 urllib http gettext locale importlib builtins'.split())
CALLS = frozenset('open __import__ exec eval compile input print'.split())
MUTATORS = frozenset('append extend insert update setdefault pop popitem add discard remove clear'.split())


def files():
    return tuple(p for p in (ROOT / 'engine').rglob('*.py') if 'tests' not in p.parts)


def root_name(node):
    while isinstance(node, (ast.Attribute, ast.Subscript)):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def imported(node):
    if isinstance(node, ast.Import):
        return tuple(a.name for a in node.names)
    if isinstance(node, ast.ImportFrom):
        return (node.module or '',)
    return ()


def effects(source, depth=1):
    tree = ast.parse(source)
    aliases = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            aliases.update((a.asname or a.name.split('.')[0], a.name) for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            aliases.update((a.asname or a.name, (node.module or '') + '.' + a.name) for a in node.names)
    failures = []
    for node in ast.walk(tree):
        for name in imported(node):
            if name.split('.')[0] in FORBIDDEN:
                failures.append('forbidden import')
            if isinstance(node, ast.Import) or (isinstance(node, ast.ImportFrom) and node.level == 0):
                if nonstdlib([name.split('.')[0]]):
                    failures.append('nonstdlib import')
        if isinstance(node, ast.ImportFrom) and node.level > depth:
            failures.append('escaping relative import')
        if isinstance(node, ast.Call):
            name = node.func.id if isinstance(node.func, ast.Name) else None
            if name in CALLS or aliases.get(name, '').split('.')[-1] in CALLS:
                failures.append('effectful call')
    return failures


def state(source):
    tree = ast.parse(source)
    names = set()
    aliases = {}
    for node in tree.body:
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            for target in node.targets if isinstance(node, ast.Assign) else (node.target,):
                names.update(n.id for n in ast.walk(target) if isinstance(n, ast.Name))
        elif isinstance(node, ast.Import):
            for a in node.names:
                names.add(a.asname or a.name.split('.')[0])
                aliases[a.asname or a.name] = a.name
        elif isinstance(node, ast.ImportFrom):
            for a in node.names:
                names.add(a.asname or a.name)
                aliases[a.asname or a.name] = (node.module or '') + '.' + a.name
    failures = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Global, ast.Nonlocal)):
            failures.append('scope mutation')
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            local = {a.arg for a in (*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs)}
            local.update(a.arg for a in (node.args.vararg, node.args.kwarg) if a)
            local.update(n.id for n in ast.walk(node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store))
            globals_used = names - local
            for item in ast.walk(node):
                if isinstance(item, (ast.Attribute, ast.Subscript)) and isinstance(item.ctx, (ast.Store, ast.Del)):
                    if root_name(item) in globals_used:
                        failures.append('global write')
                if isinstance(item, ast.Call) and isinstance(item.func, ast.Attribute):
                    if item.func.attr in MUTATORS and root_name(item.func.value) in globals_used:
                        failures.append('global mutator')
        if isinstance(node, ast.Call):
            func = node.func
        else:
            func = node
        if isinstance(func, ast.Name):
            qualified = aliases.get(func.id, '')
        elif isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
            qualified = aliases.get(func.value.id, func.value.id) + '.' + func.attr
        else:
            qualified = ''
        if qualified in ('functools.cache', 'functools.lru_cache'):
            failures.append('cache')
    return failures


def forbidden_importer(source):
    return any(name == 'engine' or name.startswith('engine.') for n in ast.walk(ast.parse(source))
               for name in imported(n))


def nonstdlib(names):
    return set(names) - sys.stdlib_module_names - {'engine'}


class PurityTests(unittest.TestCase):
    def test_transitive_imports(self):
        modules = ['.'.join(p.relative_to(ROOT).with_suffix('').parts).removesuffix('.__init__') for p in files()]
        script = ("import sys, json, importlib; sys.path.insert(0, " + repr(str(ROOT)) + "); "
                  "before=set(sys.modules); "
                  + "; ".join("importlib.import_module(" + repr(m) + ")" for m in modules)
                  + "; print(json.dumps(sorted({n.split('.')[0] for n in set(sys.modules)-before})))")
        result = subprocess.run([sys.executable, '-I', '-c', script], capture_output=True, text=True, check=True)
        self.assertFalse(nonstdlib(json.loads(result.stdout)))
        self.assertTrue(nonstdlib(['django']))

    def test_effects(self):
        for p in files():
            depth = len(p.relative_to(ROOT).parts) - 1
            source = p.read_text(encoding='utf-8-sig')
            # Contract v1 uses datetime only for deterministic ISO date validation.
            # Contracts are frozen for this story; keep this exception exact.
            if p == ROOT / 'engine/contracts/values.py':
                source = source.replace('import datetime\n', '')
                self.assertNotIn('datetime.now', source)
                self.assertNotIn('datetime.today', source)
                self.assertEqual(source.count('datetime.'), 1)
                self.assertIn('datetime.date.fromisoformat(value)', source)
                self.assertEqual([n.id for n in ast.walk(ast.parse(source))
                                  if isinstance(n, ast.Name) and n.id == 'datetime'], ['datetime'])
            self.assertEqual(effects(source, depth), [], str(p))
        for name in FORBIDDEN:
            self.assertTrue(effects('import ' + name), name)
            self.assertTrue(effects('from ' + name + ' import thing'), name)
        for name in CALLS:
            self.assertTrue(effects(name + '()'), name)
        for source in ('import pathlib', 'from datetime import datetime', 'open("x")',
                       '__import__("x")', 'from ... import x',
                       'def f():\n import django', 'def f():\n from django.conf import settings'):
            self.assertTrue(effects(source), source)

    def test_state(self):
        for p in files():
            self.assertEqual(state(p.read_text(encoding='utf-8-sig')), [], str(p))
        for method in MUTATORS:
            self.assertTrue(state('x={}\ndef f():\n x.' + method + '()'), method)
        for source in ('x={}\ndef f():\n x["a"]=1', 'x=[]\ndef f():\n x.append(1)',
                       'x={}\ndef f():\n del x["a"]', 'x=0\ndef f():\n global x',
                       'from functools import lru_cache as memo\n@memo()\ndef f(): pass',
                       'import functools as f\n@f.cache\ndef g(): pass',
                       'x={}\ndef f():\n x.a += 1',
                       'def f():\n x=1\n def g():\n  nonlocal x'):
            self.assertTrue(state(source), source)

    def test_forbidden_importers(self):
        for directory in ('support', 'metrics'):
            for p in (ROOT / directory).rglob('*.py'):
                self.assertFalse(forbidden_importer(p.read_text(encoding='utf-8-sig')), str(p))
        self.assertTrue(forbidden_importer('from engine.queries import refusal'))
        self.assertTrue(forbidden_importer('import engine'))
