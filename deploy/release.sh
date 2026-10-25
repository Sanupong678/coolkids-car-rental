#!/bin/sh
# Rebuilds and restarts the site from the code in /opt/coolkids, keeping the images that
# were running as :previous so `sh deploy/rollback.sh` can bring them back in seconds.
# After the restart it checks the site answers; if not, it rolls back on its own.
#   sh deploy/release.sh            (after unpacking coolkids.tgz, see docs/DEPLOY-VPS.md)
set -eu
cd "$(dirname "$0")/.."
compose="docker compose -f docker-compose.prod.yml"
stamp="$(date +%Y%m%d-%H%M)"

for img in coolkids-api coolkids-web; do
  if docker image inspect "$img:latest" >/dev/null 2>&1; then
    docker tag "$img:latest" "$img:previous"
    docker tag "$img:latest" "$img:$stamp-before"
  fi
done
echo "kept the running images as :previous ($stamp-before)"

$compose up -d --build api web

# smoke test: the API answers and the site serves its page
domain="$(grep -E '^SITE_DOMAIN=' .env | cut -d= -f2)"
ok=0
for _ in $(seq 1 20); do
  sleep 3
  if curl -fsS -o /dev/null "https://$domain/health" && curl -fsS -o /dev/null "https://$domain/api/v1/vehicles?pageSize=1"; then ok=1; break; fi
done
if [ "$ok" -ne 1 ]; then
  echo "SMOKE TEST FAILED: rolling back" >&2
  sh deploy/rollback.sh
  exit 1
fi
echo "release ok · site and API answer"

# keep the last 5 dated images of each, drop older ones
for img in coolkids-api coolkids-web; do
  docker images "$img" --format '{{.Tag}}' | grep -E -- '-before$' | sort -r | tail -n +6 | while read -r t; do docker rmi "$img:$t" >/dev/null 2>&1 || true; done
done
