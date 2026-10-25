#!/bin/sh
# Proves the newest backup restores: loads it into a throwaway PostgreSQL container with
# no network, then compares per-table row counts with the live database. The live
# database is only read (counts), never written. The container is removed at the end.
#   sh deploy/restore-test.sh [backups/db-YYYY-MM-DD.sql.gz]
set -eu
cd "$(dirname "$0")/.."
dump="${1:-$(ls -1 backups/db-*.sql.gz | sort | tail -1)}"
[ -f "$dump" ] || { echo "no backup found"; exit 1; }
name="ck-restore-test-$$"
pass="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

echo "restoring $dump into a throwaway database ($name, no network)…"
docker run -d --rm --name "$name" --network none \
  -e POSTGRES_USER=coolkids -e POSTGRES_PASSWORD="$pass" -e POSTGRES_DB=car_rental postgres:16-alpine >/dev/null
# the first start runs setup on a socket-only server, then restarts: wait for TCP
for _ in $(seq 1 60); do
  docker exec "$name" pg_isready -h 127.0.0.1 -U coolkids -d car_rental >/dev/null 2>&1 && break
  sleep 1
done
start=$(date +%s)
gunzip -c "$dump" | docker exec -i "$name" psql -q -v ON_ERROR_STOP=1 -U coolkids -d car_rental >/dev/null
echo "restore finished without errors in $(( $(date +%s) - start )) s"

COUNTS="SELECT relname || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, relname), false, true, '')))[1]::text
          FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY relname"
docker exec "$name" psql -At -U coolkids -d car_rental -c "$COUNTS" > /tmp/$name.restored
docker compose -f docker-compose.prod.yml exec -T db psql -At -U coolkids -d car_rental -c "$COUNTS" > /tmp/$name.live

restored_tables=$(wc -l < /tmp/$name.restored)
live_tables=$(wc -l < /tmp/$name.live)
echo "tables: restored $restored_tables · live $live_tables"
# rows written after the dump was taken show up as "live > restored"; fewer live rows would be odd
awk -F= 'NR==FNR { r[$1] = $2; next } { l = $2; d = (($1 in r) ? r[$1] : "MISSING"); flag = (d == "MISSING" || d + 0 > l + 0) ? "  <-- check" : ""; if (d != l) printf "  %-32s restored %-7s live %s%s\n", $1, d, l, flag; total += l }
     END { printf "  (all other tables identical) · live rows in total: %d\n", total }' /tmp/$name.restored /tmp/$name.live
rm -f /tmp/$name.restored /tmp/$name.live
[ "$restored_tables" -eq "$live_tables" ] && echo "RESTORE TEST PASSED" || { echo "RESTORE TEST FAILED: table count differs"; exit 1; }
