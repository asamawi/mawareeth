"""Rewrite contracts/fixtures.lock.json.

New fixture files are added. A locked fixture may change or disappear only when its contract's version in
contracts/manifest.json is greater than the highest version recorded in the lock for that contract; otherwise this script refuses, because a
change of meaning needs a version bump.

Run from anywhere: python scripts/contract_fixtures_lock.py
"""
import hashlib
import json
import sys
from pathlib import Path

CONTRACTS = Path(__file__).resolve().parent.parent / 'contracts'
LOCK = CONTRACTS / 'fixtures.lock.json'


def contract_of(path):
    """`fixtures/<contract>/x.json` or `fixtures/invalid/<contract>.json` belongs to <contract>."""
    parts = path.split('/')
    return Path(parts[2]).stem if parts[1] == 'invalid' else parts[1]


def digest(file):
    return hashlib.sha256(file.read_bytes().replace(b'\r\n', b'\n')).hexdigest()


def current():
    return {f.relative_to(CONTRACTS).as_posix(): digest(f) for f in sorted((CONTRACTS / 'fixtures').rglob('*.json'))}


def main():
    manifest = json.loads((CONTRACTS / 'manifest.json').read_text(encoding='utf-8'))
    old = json.loads(LOCK.read_text(encoding='utf-8')) if LOCK.exists() else {}
    files = current()
    highest = {}
    for entry in old.values():
        highest[entry['contract']] = max(highest.get(entry['contract'], 0), entry['version'])
    new, problems = {}, []
    for path, sha in files.items():
        contract = contract_of(path)
        if contract not in manifest:
            problems.append(f'{path}: {contract!r} is not a contract in manifest.json')
            continue
        entry = old.get(path)
        if entry is None or entry['sha256'] == sha:
            new[path] = entry or {'contract': contract, 'version': manifest[contract], 'sha256': sha}
        elif manifest[contract] > highest[contract]:
            new[path] = {'contract': contract, 'version': manifest[contract], 'sha256': sha}
        else:
            problems.append(f'{path}: changed but the {contract} contract is still version {highest[contract]}')
    for path, entry in old.items():
        if path not in files and manifest.get(entry['contract'], 0) <= highest[entry['contract']]:
            problems.append(f'{path}: removed but the {entry["contract"]} contract is still version '
                            f'{highest[entry["contract"]]}')
    if problems:
        print('\n'.join(problems), file=sys.stderr)
        print('Raise the version in contracts/manifest.json (and engine/web codes) first.', file=sys.stderr)
        return 1
    LOCK.write_text(json.dumps(new, indent=2, sort_keys=True) + '\n', encoding='utf-8', newline='\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
