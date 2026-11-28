"""Rerun every e2e spec an epic added or changed, on a fresh build, before the epic is marked done.

Epic 11 retro, action item 5: stories 11.6 and 11.7 ran only their own e2e files, so a failure in a spec
11.4 added (web/e2e/accessibility.spec.ts:179) was still failing when the epic closed, and the local
static export (web/out) was older than the last commit.

The epic's commits are the ones whose subject names one of its stories ("story 11.4", "stories 10.0 and
10.1"). Every web/e2e/*.spec.ts file they touched, and that still exists, is run in chromium after
`npm run build`. Exit code 0 means every spec passed (or the epic touched none); 1 means a spec failed or
the build failed; 2 means bad arguments or no such epic.

    uv run python scripts/epic_e2e_gate.py --epic 11            # build and run
    uv run python scripts/epic_e2e_gate.py --epic 11 --dry-run  # list the specs only
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPRINT = ROOT / '_bmad-output' / 'implementation-artifacts' / 'sprint-status.yaml'
WEB = ROOT / 'web'
NPX = 'npx.cmd' if sys.platform == 'win32' else 'npx'
NPM = 'npm.cmd' if sys.platform == 'win32' else 'npm'


def story_numbers(epic):
    """`11.4`, `9.1b`... for every `<epic>-<n>-...` story key in sprint-status.yaml."""
    numbers = []
    for line in SPRINT.read_text(encoding='utf-8').splitlines():
        match = re.match(rf'^\s+({epic})-(\d+[a-z]?)-[\w-]+:', line)
        if match:
            numbers.append(f'{match[1]}.{match[2]}')
    return numbers


def names_story(subject, numbers):
    """Whether a commit subject names one of the stories, as "story 11.4" or "stories 10.0 and 10.1"."""
    if not re.search(r'\bstor(y|ies)\b', subject, re.IGNORECASE):
        return False
    return any(re.search(rf'(?<![\d.]){re.escape(n)}(?![\da-z]|\.\d)', subject) for n in numbers)


def epic_specs(epic):
    numbers = story_numbers(epic)
    if not numbers:
        return None, []
    log = subprocess.run(['git', 'log', '--format=%H %s'], cwd=ROOT, check=True, capture_output=True, text=True,
                         encoding='utf-8').stdout
    commits = [line.split(' ', 1)[0] for line in log.splitlines() if ' ' in line and names_story(line.split(' ', 1)[1], numbers)]
    specs = set()
    for sha in commits:
        files = subprocess.run(['git', 'show', '--format=', '--name-only', sha], cwd=ROOT, check=True,
                               capture_output=True, text=True, encoding='utf-8').stdout.split()
        specs.update(f for f in files if re.fullmatch(r'web/e2e/[^/]+\.spec\.ts', f))
    return commits, sorted(s for s in specs if (ROOT / s).exists())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--epic', required=True, type=int)
    parser.add_argument('--dry-run', action='store_true', help='list the specs without building or running them')
    args = parser.parse_args(argv)

    commits, specs = epic_specs(args.epic)
    if commits is None:
        print(f'epic {args.epic}: no stories in {SPRINT.relative_to(ROOT)}', file=sys.stderr)
        return 2
    print(f'epic {args.epic}: {len(commits)} story commits, {len(specs)} e2e specs')
    for spec in specs:
        print(f'  {spec}')
    if args.dry_run or not specs:
        return 0

    print('building web (npm run build)...', flush=True)
    if subprocess.run([NPM, 'run', 'build'], cwd=WEB).returncode != 0:
        print(f'epic {args.epic}: FAILED - npm run build', file=sys.stderr)
        return 1
    # Forward slashes: Playwright reads its file arguments as regular expressions, so `e2e\x` matches nothing.
    relative = [s.removeprefix('web/') for s in specs]
    print(f'running {len(relative)} specs in chromium...', flush=True)
    result = subprocess.run([NPX, 'playwright', 'test', *relative, '--project=chromium', '--reporter=line'], cwd=WEB)
    if result.returncode != 0:
        print(f'epic {args.epic}: FAILED - e2e specs did not all pass', file=sys.stderr)
        return 1
    print(f'epic {args.epic}: passed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
