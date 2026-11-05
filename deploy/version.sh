#!/usr/bin/env bash
# Release numbers for .github/workflows/deploy.yml. See "Release version numbers"
# in deploy/README.md.
#
#   deploy/version.sh derive [COMMIT]          print major.minor.patch
#   deploy/version.sh check-tag VERSION COMMIT fail if vVERSION names another commit
#   deploy/version.sh tag VERSION COMMIT       create vVERSION on origin (idempotent)
#
# major.minor comes from COMMIT's VERSION file. patch counts the first-parent
# commits since the first-parent commit that last changed that file, so history
# merged in from a branch never inflates it. The result depends only on COMMIT's
# history, so rebuilding a commit gives the same number.
set -Eeuo pipefail

die() { printf 'version.sh: %s\n' "$*" >&2; exit 1; }

resolve_commit() {
  git rev-parse --quiet --verify "$1^{commit}" || die "not a commit: $1"
}

derive() {
  local commit base anchor patch
  commit="$(resolve_commit "${1:-HEAD}")"
  # A shallow history would silently undercount the patch.
  [[ "$(git rev-parse --is-shallow-repository)" == false ]] || die 'full git history is required, this clone is shallow'
  base="$(git show "$commit:VERSION" 2>/dev/null)" || die "VERSION is missing at $commit"
  [[ "$base" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || die "VERSION must be major.minor, got: $base"
  anchor="$(git log --first-parent -1 --format=%H "$commit" -- VERSION)"
  [[ -n "$anchor" ]] || die "VERSION never changed on the first-parent history of $commit"
  patch="$(git rev-list --first-parent --count "$anchor..$commit")"
  printf '%s.%s\n' "$base" "$patch"
}

check_version() {
  [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || die "version must be major.minor.patch, got: $1"
}

# Prints the commit origin's vVERSION points at, or nothing. A peeled annotated
# tag is listed after the tag itself, so the last line is always the commit.
remote_tag_commit() {
  git ls-remote --tags origin "refs/tags/v$1" "refs/tags/v$1^{}" | tail -n 1 | cut -f 1
}

check_tag() {
  local version="$1" commit existing
  check_version "$version"
  commit="$(resolve_commit "$2")"
  existing="$(remote_tag_commit "$version")"
  [[ -z "$existing" || "$existing" == "$commit" ]] || die "tag v$version points at $existing, not $commit"
}

tag() {
  local version="$1" commit existing
  check_tag "$version" "$2"
  commit="$(resolve_commit "$2")"
  # Assigned on its own line so a failed lookup stops here instead of reading as "no tag".
  existing="$(remote_tag_commit "$version")"
  [[ -z "$existing" ]] || return 0
  git push --quiet origin "$commit:refs/tags/v$version" && return 0
  # A concurrent rerun may have created the same tag first.
  [[ "$(remote_tag_commit "$version")" == "$commit" ]] || die "could not create tag v$version at $commit"
}

case "${1:-}:$#" in
  derive:1) derive ;;
  derive:2)
    [[ -n "$2" ]] || die 'COMMIT must not be empty'
    derive "$2"
    ;;
  check-tag:3) check_tag "$2" "$3" ;;
  tag:3) tag "$2" "$3" ;;
  *) die 'usage: version.sh derive [COMMIT] | check-tag VERSION COMMIT | tag VERSION COMMIT' ;;
esac
