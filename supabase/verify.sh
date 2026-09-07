#!/usr/bin/env bash
# Applies supabase/migrations/*.sql to a throwaway supabase/postgres container and runs verify.sql.
# Needs Docker. Usage: supabase/verify.sh
set -euo pipefail
cd "$(dirname "$0")"
IMAGE="supabase/postgres:${SUPABASE_PG_TAG:-17.6.1.168}"
NAME=citrinia-pg-verify
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
psql() { docker exec -i -e PGPASSWORD=postgres "$NAME" psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
for _ in $(seq 1 120); do
  if [ "$(psql -tAc "select count(*) from pg_publication where pubname='supabase_realtime'" 2>/dev/null)" = 1 ] \
     && [ "$(psql -tAc "select count(*) from pg_roles where rolname in ('anon','authenticated')" 2>/dev/null)" = 2 ]; then
    break
  fi
  sleep 2
done
# Keep the default privileges Supabase gives new tables. They are what a real
# project has (anon and authenticated get ALL on every new table in public), so
# a container without them is more restrictive than production and cannot catch
# a grant that is wider than intended -- which is exactly what it missed once:
# `grant update (col)` on top of a table-level UPDATE narrows nothing.
psql -c "create table public._probe(); do \$\$ begin if not has_table_privilege('anon','public._probe','select') then raise exception 'default privileges are not active; this container is not like production'; end if; end \$\$; drop table public._probe;"
for f in migrations/*.sql; do echo "applying $f"; psql < "$f"; done
psql < verify.sql
