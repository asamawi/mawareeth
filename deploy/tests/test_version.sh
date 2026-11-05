#!/usr/bin/env bash
# Offline tests for deploy/version.sh. Git runs for real in a disposable
# repository with a local bare "origin"; nothing touches this checkout.
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/deploy/version.sh"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

bash -n "$script"
bash -n "$0"

tmp="$(mktemp -d)"
case "$tmp" in "$root"/*) fail 'temporary directory must be outside the checkout' ;; esac
trap 'rm -rf "$tmp"' EXIT

# Ignore the operator's git configuration (signing, autocrlf, default branch).
unset GIT_DIR GIT_WORK_TREE
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid

git init --quiet --bare "$tmp/origin.git"
git init --quiet -b master "$tmp/repo"
cd "$tmp/repo"
git remote add origin "$tmp/origin.git"

version() { bash "$script" "$@"; }
commit() { git commit --quiet --allow-empty -m "$1"; }
head_sha() { git rev-parse HEAD; }
expect_derive() {
  local actual
  actual="$(version derive "$2")" || fail "$3: derive failed"
  [[ "$actual" == "$1" ]] || fail "$3: expected $1, got $actual"
}
expect_refused() {
  local label="$1"; shift
  if version "$@" >/dev/null 2>"$tmp/err"; then fail "$label: expected a non-zero exit"; fi
  [[ -s "$tmp/err" ]] || fail "$label: refused without saying why"
}

# Master history without a VERSION file, as it is before the epics merge.
commit 'master one'
commit 'master two'
expect_refused 'no VERSION file' derive

# --- First release of a line: many branch commits, one merge, patch 0.
git switch --quiet -c development
commit 'product work one'
printf '3.0\n' > VERSION
git add VERSION
git commit --quiet -m 'set version'
commit 'product work two'
commit 'product work three'
git switch --quiet master
commit 'a fix on master while development waits'
git switch --quiet development
git merge --quiet --no-ff --no-edit master
commit 'product work four'
git switch --quiet master
git merge --quiet --no-ff --no-edit development
first_release="$(head_sha)"
expect_derive 3.0.0 HEAD 'first release of a line'

# --- Later releases: each first-parent commit is one patch.
commit 'fix one'
commit 'fix two'
commit 'fix three'
third="$(head_sha)"
expect_derive 3.0.3 HEAD 'later release'

# A merged branch adds one, however many commits it carries.
git switch --quiet -c feature
commit 'feature one'
commit 'feature two'
commit 'feature three'
git switch --quiet master
git merge --quiet --no-ff --no-edit feature
expect_derive 3.0.4 HEAD 'merged branch counts once'

# --- Rebuilding a commit gives the same number, whatever came after it.
expect_derive 3.0.0 "$first_release" 'rebuild of the first release'
expect_derive 3.0.3 "$third" 'rebuild of a later release'
[[ "$(version derive)" == "$(version derive HEAD)" ]] || fail 'derive must default to HEAD'

# --- A branch that changes VERSION again restarts the count at its merge.
git switch --quiet -c next-line
printf '3.1\n' > VERSION
git add VERSION
git commit --quiet -m 'bump minor'
commit 'next line work'
git switch --quiet master
commit 'fix before the bump lands'
expect_derive 3.0.5 HEAD 'a VERSION change on an unmerged branch is ignored'
git merge --quiet --no-ff --no-edit next-line
expect_derive 3.1.0 HEAD 'first release of the next line'
commit 'fix on the next line'
expect_derive 3.1.1 HEAD 'later release of the next line'

# --- Malformed VERSION fails, whatever the shape.
git switch --quiet -c malformed
malformed=('3' '3.0.0' 'v3.0' '3.x' '03.0' '3.00' ' 3.0' '3.0 ' '3.' '.0' $'3.0\n3.1' '')
# Git Bash strips carriage returns from command substitutions; publishing runs on Linux.
[[ "$OSTYPE" == msys* ]] || malformed+=($'3.0\r')
for bad in "${malformed[@]}"; do
  printf '%s\n' "$bad" > VERSION
  git add VERSION
  git commit --quiet --allow-empty -m 'malformed version'
  expect_refused "malformed VERSION [$bad]" derive
  grep -q 'VERSION must be major.minor' "$tmp/err" || fail "malformed VERSION [$bad]: refused for another reason"
done
git rm --quiet VERSION
git commit --quiet -m 'remove version'
expect_refused 'deleted VERSION' derive
git switch --quiet master

# --- A shallow clone would undercount, so it is refused.
cp -R "$tmp/repo" "$tmp/shallow"
head_sha > "$tmp/shallow/.git/shallow"
(cd "$tmp/shallow" && if bash "$script" derive >/dev/null 2>"$tmp/err"; then exit 1; fi) || fail 'shallow clone must be refused'
grep -q 'shallow' "$tmp/err" || fail 'shallow clone refused for another reason'

expect_refused 'unknown commit' derive 0000000000000000000000000000000000000000
expect_refused 'empty commit' derive ''
expect_refused 'no command'
expect_refused 'unknown command' publish

# --- Tags: created on origin, idempotent for the same commit.
tags() { git ls-remote --tags origin; }
sha="$(head_sha)"
other="$(git rev-parse HEAD~1)"
version check-tag 3.1.1 "$sha" || fail 'check-tag must pass when there is no tag'
[[ -z "$(tags)" ]] || fail 'check-tag must not create a tag'
version tag 3.1.1 "$sha" || fail 'first tag failed'
[[ "$(tags)" == "$sha"$'\t'refs/tags/v3.1.1 ]] || fail "tag must point at the published commit: $(tags)"
version check-tag 3.1.1 "$sha" || fail 'check-tag must pass for a rerun of the same commit'
version tag 3.1.1 "$sha" || fail 'rerun for the same commit must succeed'
[[ "$(tags | wc -l)" -eq 1 ]] || fail 'rerun must not create a second tag'

# A longer number sharing the prefix is a different tag.
version check-tag 3.1.11 "$other" || fail 'v3.1.1 must not satisfy a lookup of v3.1.11'

# The tag points elsewhere: both commands refuse and leave it alone.
expect_refused 'check-tag on a tag at another commit' check-tag 3.1.1 "$other"
expect_refused 'tag on a tag at another commit' tag 3.1.1 "$other"
[[ "$(tags)" == "$sha"$'\t'refs/tags/v3.1.1 ]] || fail 'a refused run must not move the tag'

# An annotated tag is compared by the commit it names, not the tag object.
git tag -a v9.9.9 -m annotated "$sha"
git push --quiet origin refs/tags/v9.9.9
version check-tag 9.9.9 "$sha" || fail 'annotated tag at the same commit must pass'
version tag 9.9.9 "$sha" || fail 'annotated tag rerun must succeed'
expect_refused 'annotated tag at another commit' tag 9.9.9 "$other"

# Malformed version arguments never reach the remote.
for bad in '3.0' 'v3.0.0' '3.0.0-dev' '3.0.0 ' ''; do
  expect_refused "tag argument [$bad]" tag "$bad" "$sha"
done

# The tag job checks out one commit: tagging must work from a shallow clone.
(cd "$tmp/shallow" && bash "$script" tag 7.0.0 "$sha") || fail 'tag must work from a shallow clone'
[[ "$(git ls-remote --tags origin refs/tags/v7.0.0 | cut -f 1)" == "$sha" ]] || fail 'shallow tag must point at the commit'

# A rejected push (no write access, a tag ruleset) must fail and leave no tag.
printf '#!/bin/sh\nexit 1\n' > "$tmp/origin.git/hooks/pre-receive"
chmod +x "$tmp/origin.git/hooks/pre-receive"
expect_refused 'a rejected push' tag 7.0.1 "$sha"
grep -q 'could not create tag' "$tmp/err" || fail 'a rejected push must say the tag was not created'
[[ -z "$(git ls-remote --tags origin refs/tags/v7.0.1)" ]] || fail 'a rejected push must leave no tag'
rm "$tmp/origin.git/hooks/pre-receive"

# A concurrent rerun wins the race: this push fails, yet the same-commit tag exists.
real_git="$(command -v git)"
mkdir "$tmp/stub"
cat > "$tmp/stub/git" <<STUB
#!/usr/bin/env bash
if [[ "\$1" == push ]]; then
  "$real_git" "\$@"
  exit 1
fi
exec "$real_git" "\$@"
STUB
chmod +x "$tmp/stub/git"
PATH="$tmp/stub:$PATH" bash "$script" tag 7.0.2 "$sha" || fail 'losing the race to the same commit must succeed'

# An unreachable origin is a failure, never "no tag yet".
git remote set-url origin "$tmp/does-not-exist.git"
expect_refused 'check-tag with origin unreachable' check-tag 7.0.3 "$sha"
expect_refused 'tag with origin unreachable' tag 7.0.3 "$sha"

printf 'PASS: deploy/version.sh\n'
