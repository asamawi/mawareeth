#!/usr/bin/env bash
# Offline tests for deploy/cloudflare-ips-check.sh: the published lists are
# file:// fixtures, nothing touches the network.
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/deploy/cloudflare-ips-check.sh"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

bash -n "$script"
bash -n "$0"

tmp="$(mktemp -d)"
case "$tmp" in "$root"/*) fail 'temporary directory must be outside the checkout' ;; esac
trap 'rm -rf "$tmp"' EXIT
# A native Windows curl needs a Windows path in file:// URLs (Git Bash only).
urlbase="$tmp"
! command -v cygpath >/dev/null 2>&1 || urlbase="$(cygpath -m "$tmp")"

printf '173.245.48.0/20\n103.21.244.0/22\n' >"$tmp/v4"
printf '2400:cb00::/32\n2606:4700::/32\n' >"$tmp/v6"
printf '# header\n103.21.244.0/22 # x\n173.245.48.0/20\n\n2606:4700::/32\n2400:cb00::/32\n' >"$tmp/ranges"

out=""
rc=0
run() { # $1 = v4 url, $2 = v6 url, $3 = ranges file
  rc=0
  out="$(CLOUDFLARE_IPS_V4_URL="$1" CLOUDFLARE_IPS_V6_URL="$2" bash "$script" "$3" 2>&1)" || rc=$?
}
expect() { # $1 = exit code, $2 = case, rest = strings the output must contain
  local want="$1" name="$2" s
  shift 2
  [[ "$rc" == "$want" ]] || fail "$name: exit $rc, want $want: $out"
  for s in "$@"; do [[ "$out" == *"$s"* ]] || fail "$name: output lacks '$s': $out"; done
}

# Match: reordered, CRLF, duplicates, no trailing newline.
run "file://$urlbase/v4" "file://$urlbase/v6" "$tmp/ranges"
expect 0 'match (reordered)' 'OK'
printf '173.245.48.0/20\r\n103.21.244.0/22\r\n173.245.48.0/20' >"$tmp/v4crlf"
printf '2400:cb00::/32\r\n2606:4700::/32' >"$tmp/v6crlf"
run "file://$urlbase/v4crlf" "file://$urlbase/v6crlf" "$tmp/ranges"
expect 0 'match (CRLF, duplicate, no newline)' 'OK'
printf '103.21.244.0/22\r\n173.245.48.0/20\r\n# c\r\n2606:4700::/32\r\n2400:cb00::/32' >"$tmp/ranges_crlf"
run "file://$urlbase/v4" "file://$urlbase/v6" "$tmp/ranges_crlf"
expect 0 'match (CRLF file)' 'OK'

# New published range.
printf '173.245.48.0/20\n103.21.244.0/22\n198.41.128.0/17\n' >"$tmp/v4new"
run "file://$urlbase/v4new" "file://$urlbase/v6" "$tmp/ranges"
expect 1 'new range' 'published but missing from the file: 198.41.128.0/17'

# Retired range.
printf '173.245.48.0/20\n' >"$tmp/v4less"
run "file://$urlbase/v4less" "file://$urlbase/v6" "$tmp/ranges"
expect 1 'retired range' 'in the file but no longer published: 103.21.244.0/22'

# New IPv6 range.
printf '2400:cb00::/32\n2606:4700::/32\n2a06:98c0::/29\n' >"$tmp/v6new"
run "file://$urlbase/v4" "file://$urlbase/v6new" "$tmp/ranges"
expect 1 'new IPv6 range' 'published but missing from the file: 2a06:98c0::/29'

# Fetch failure: unreachable URL.
run "file://$urlbase/absent" "file://$urlbase/v6" "$tmp/ranges"
expect 2 'unreachable' "file://$urlbase/absent"

# Empty body.
: >"$tmp/empty"
run "file://$urlbase/empty" "file://$urlbase/v6" "$tmp/ranges"
expect 2 'empty body' 'no ranges'

# Malformed body.
printf '<html>\n<body>Just a moment...</body>\n</html>\n' >"$tmp/html"
run "file://$urlbase/html" "file://$urlbase/v6" "$tmp/ranges"
expect 2 'malformed body' '<html>'

# Malformed prefix.
printf '1.2.3.0/33
' >"$tmp/badprefix"
run "file://$urlbase/badprefix" "file://$urlbase/v6" "$tmp/ranges"
expect 2 'bad prefix' '1.2.3.0/33'

printf 'ok: cloudflare-ips-check\n'
