#!/bin/sh
# Runs the backend test suite on the VPS against its own throwaway PostgreSQL, on an
# internal Docker network that cannot reach the live database (or the internet).
# The tests wipe their database, so it must never be the real one: no production
# .env is copied, and the test container only sees the test database.
#   sh deploy/run-tests.sh
set -eu
cd "$(dirname "$0")/.."
id="ck-test-$$"
net="$id-net"
vol="$id-work"
cleanup() {
  docker rm -f "$id-db" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  docker volume rm "$vol" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

image=coolkids-api # the production image: same Node, Chromium and Thai fonts as live
docker network create --internal "$net" >/dev/null
docker volume create "$vol" >/dev/null

echo "1/3 copying the code (without any .env) and installing dev dependencies…"
docker run --rm --user root -v "$PWD/backend:/src:ro" -v "$vol:/w" "$image" sh -c \
  'cp -r /src/. /w && rm -f /w/.env /w/.env.backup* /w/.env.local* /w/.env.prod* && rm -rf /w/uploads /w/storage && cd /w && npm ci --include=dev --no-audit --no-fund --loglevel=error'

echo "2/3 starting a throwaway database on an internal network…"
docker run -d --rm --name "$id-db" --network "$net" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=test -e POSTGRES_DB=car_rental_test postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do
  docker exec "$id-db" pg_isready -U postgres -d car_rental_test >/dev/null 2>&1 && break
  sleep 1
done

echo "3/3 running the tests…"
secret() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }
docker run --rm --user root --network "$net" -v "$vol:/w" -w /w \
  -e DB_HOST="$id-db" -e DB_PORT=5432 -e DB_USER=postgres -e DB_PASSWORD=test \
  -e COOKIE_SECRET="$(secret 48)" -e PII_ENCRYPTION_KEY="$(secret 32)" -e PII_HMAC_KEY="$(secret 48)" \
  "$image" sh -c 'npm test > /tmp/test.log 2>&1; s=$?; grep -E "^(not ok|✖ |ℹ (tests|suites|pass|fail|cancelled|skipped|duration_ms))" /tmp/test.log; [ $s -eq 0 ] || tail -n 80 /tmp/test.log; exit $s'
