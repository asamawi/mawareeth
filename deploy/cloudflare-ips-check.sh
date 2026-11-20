#!/usr/bin/env bash
# Compares deploy/cloudflare-ips.txt with Cloudflare's published ranges.
# Read-only: it changes nothing. Run by the "Cloudflare IP Drift" workflow
# weekly; an operator can run it by hand:
#   bash deploy/cloudflare-ips-check.sh [ranges-file]
# Exit codes: 0 the file matches, 1 drift (differences listed on stdout),
# 2 a fetch or parse failure (never reported as drift or as a match).
# CLOUDFLARE_IPS_V4_URL / CLOUDFLARE_IPS_V6_URL override the sources (tests).
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
file="${1:-$root/deploy/cloudflare-ips.txt}"
v4_url="${CLOUDFLARE_IPS_V4_URL:-https://www.cloudflare.com/ips-v4}"
v6_url="${CLOUDFLARE_IPS_V6_URL:-https://www.cloudflare.com/ips-v6}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 2; }

# Prints the CIDRs of a "# comment / one range per line" text on stdin, or exits 2.
parse_ranges() { # $1 = label
  local line count=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line//$'\r'/}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "$line" ]] || continue
    if [[ "$line" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$ ]] \
      || [[ "$line" =~ ^[0-9A-Fa-f:]*:[0-9A-Fa-f:]*/([0-9]{1,2}|1[01][0-9]|12[0-8])$ ]]; then
      printf '%s\n' "${line,,}"
      count=$((count + 1))
    else
      printf 'ERROR: %s: not an IPv4 or IPv6 CIDR: %s\n' "$1" "$line" >&2
      return 2
    fi
  done
  ((count > 0)) || { printf 'ERROR: %s: no ranges found\n' "$1" >&2; return 2; }
}

fetch_ranges() { # $1 = URL
  local body
  body="$(curl -fsSL --retry 3 --retry-delay 2 --max-time 30 "$1")" \
    || die "could not fetch $1"
  parse_ranges "$1" <<<"$body" || exit 2
}

[[ -r "$file" ]] || die "cannot read $file"
file_ranges="$(exec 3<"$file" && parse_ranges "$file" <&3)" || exit 2
published="$( { fetch_ranges "$v4_url"; fetch_ranges "$v6_url"; } )" || exit 2

file_set="$(sort -u <<<"$file_ranges")"
pub_set="$(sort -u <<<"$published")"
missing="$(comm -13 <(cat <<<"$file_set") <(cat <<<"$pub_set"))"
retired="$(comm -23 <(cat <<<"$file_set") <(cat <<<"$pub_set"))"

if [[ -z "$missing" && -z "$retired" ]]; then
  printf 'OK: %s matches the published Cloudflare ranges (%s ranges)\n' \
    "${file#"$root"/}" "$(wc -l <<<"$pub_set" | tr -d '[:space:]')"
  exit 0
fi
while IFS= read -r range; do
  [[ -z "$range" ]] || printf 'published but missing from the file: %s\n' "$range"
done <<<"$missing"
while IFS= read -r range; do
  [[ -z "$range" ]] || printf 'in the file but no longer published: %s\n' "$range"
done <<<"$retired"
exit 1
