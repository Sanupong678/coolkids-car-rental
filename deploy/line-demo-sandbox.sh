#!/bin/sh
# A throwaway copy of the API for the LINE look-alike demo (/line-demo): developer mode,
# its own empty database filled by db/setup.js, no LINE / Stripe / e-mail keys (so
# nothing can reach real customers), published on the VPS's 127.0.0.1 only.
#   sh deploy/line-demo-sandbox.sh up      → then from your PC: ssh -N -L 5055:127.0.0.1:5055 coolkids-vps
#   sh deploy/line-demo-sandbox.sh down    → removes the containers, database and network
set -eu
cd "$(dirname "$0")/.."
net=ck-demo-net
case "${1:-up}" in
  down)
    docker rm -f ck-demo-api ck-demo-db >/dev/null 2>&1 || true
    docker network rm "$net" >/dev/null 2>&1 || true
    rm -f /root/.coolkids-demo-keys
    echo "demo sandbox removed"
    ;;
  up)
    docker network inspect "$net" >/dev/null 2>&1 || docker network create "$net" >/dev/null
    docker rm -f ck-demo-api >/dev/null 2>&1 || true
    # the demo database survives a restart of the API (`down` removes it)
    docker inspect ck-demo-db >/dev/null 2>&1 || docker run -d --name ck-demo-db --network "$net" \
      -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=demo -e POSTGRES_DB=car_rental_demo postgres:16-alpine >/dev/null
    for _ in $(seq 1 60); do docker exec ck-demo-db pg_isready -h 127.0.0.1 -U demo -d car_rental_demo >/dev/null 2>&1 && break; sleep 1; done
    # demo-only keys, kept so a restart can still read the demo's encrypted test data and sessions
    keys=/root/.coolkids-demo-keys
    if [ ! -f "$keys" ]; then
      (umask 077; secret() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }
       printf 'COOKIE_SECRET=%s\nPII_ENCRYPTION_KEY=%s\nPII_HMAC_KEY=%s\n' "$(secret 48)" "$(secret 32)" "$(secret 48)" > "$keys")
    fi
    docker run -d --name ck-demo-api --network "$net" -p 127.0.0.1:5055:5000 \
      -e NODE_ENV=development -e PORT=5000 \
      -e APP_URL=http://localhost:5055 -e FRONTEND_URL=http://localhost:5175 \
      -e DB_HOST=ck-demo-db -e DB_USER=demo -e DB_PASSWORD=demo -e DB_NAME=car_rental_demo \
      --env-file "$keys" \
      -e PAYMENT_PROVIDER=mock -e PROMPTPAY_ID=0115569024211 -e PROMPTPAY_NAME="Coolkids (demo)" \
      --user root coolkids-api:latest sh -c       'npm i --no-save --no-audit --no-fund --loglevel=error pino-pretty@13 && node src/db/setup.js && ADMIN_PASSWORD="$(head -c 18 /dev/urandom | base64)" node src/db/seed-admin.js && node src/server.js' >/dev/null
    # developer mode logs through pino-pretty, which the production image leaves out: added in this container only
    for _ in $(seq 1 120); do curl -fsS -o /dev/null http://127.0.0.1:5055/health 2>/dev/null && break; sleep 1; done
    curl -fsS -o /dev/null http://127.0.0.1:5055/health && echo "demo API ready on the VPS at 127.0.0.1:5055" || { docker logs --tail 30 ck-demo-api; exit 1; }
    ;;
esac
