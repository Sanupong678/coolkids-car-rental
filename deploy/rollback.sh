#!/bin/sh
# Puts back the web and API images that ran before the last release (deploy/release.sh
# keeps them as :previous, plus dated tags). The database is not touched: a release whose
# migration changed tables needs that migration undone by hand first.
#   sh deploy/rollback.sh                 → the images before the last release
#   sh deploy/rollback.sh 20261025-1230   → the images kept as <stamp>-before
set -eu
cd "$(dirname "$0")/.."
tag="${1:+$1-before}"
tag="${tag:-previous}"
for img in coolkids-api coolkids-web; do
  docker image inspect "$img:$tag" >/dev/null 2>&1 || { echo "no $img:$tag image to go back to"; exit 1; }
done
for img in coolkids-api coolkids-web; do docker tag "$img:$tag" "$img:latest"; done
docker compose -f docker-compose.prod.yml up -d --no-build api web
echo "rolled back to $tag"
