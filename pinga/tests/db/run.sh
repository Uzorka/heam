#!/usr/bin/env bash
# Runs the database rule tests on a throwaway local PostgreSQL.
# Usage: tests/db/run.sh            (needs PostgreSQL 15+ installed)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[ -x "$bin/initdb" ] || bin="$(dirname "$(command -v initdb)")"

data="$(mktemp -d)"
port=$((54000 + RANDOM % 1000))
as=()
if [ "$(id -u)" = 0 ]; then chown postgres "$data"; as=(runuser -u postgres --); fi

cleanup() { "${as[@]}" "$bin/pg_ctl" -D "$data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$data"; }
trap cleanup EXIT

"${as[@]}" "$bin/initdb" -D "$data" -U postgres --auth=trust >/dev/null
"${as[@]}" "$bin/pg_ctl" -D "$data" -o "-p $port -k $data -c listen_addresses=''" -w start >/dev/null

run() { "${as[@]}" psql -X -q -v ON_ERROR_STOP=1 -h "$data" -p "$port" -U postgres -d postgres "$@"; }

run -f "$here/supabase_shim.sql" >/dev/null
for m in "$root"/supabase/migrations/*.sql; do run -f "$m" >/dev/null; done
run -f "$here/helpers.sql" >/dev/null
for t in "$here"/test_*.sql; do
  echo "── $(basename "$t")"
  run -o /dev/null -f "$t" 2>&1 | sed -e 's/^psql:[^:]*:[0-9]*: //' -e 's/^NOTICE:  /  /'
done
