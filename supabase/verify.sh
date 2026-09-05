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
# Drop the default privileges Supabase gives new tables, so the migration's own grants are what's tested.
psql -c "alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role; alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;"
psql -c "create table public._probe(); do \$\$ begin if has_table_privilege('anon','public._probe','select') then raise exception 'default privileges still active; grant test is meaningless'; end if; end \$\$; drop table public._probe;"
for f in migrations/*.sql; do echo "applying $f"; psql < "$f"; done
psql < verify.sql
