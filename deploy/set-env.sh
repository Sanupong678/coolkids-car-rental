#!/bin/sh
# Sets one secret in backend/.env without it ever appearing on screen or in shell history,
# then restarts the API so it takes effect.
#   /opt/coolkids/deploy/set-env.sh STRIPE_SECRET_KEY
set -eu
cd "$(dirname "$0")/.."
key="${1:-}"
case "$key" in
  ''|*[!A-Z0-9_]*) echo "usage: $0 NAME   (e.g. STRIPE_SECRET_KEY)"; exit 1 ;;
esac
printf "Paste the value for %s (it stays hidden), then press Enter: " "$key"
stty -echo 2>/dev/null || true
IFS= read -r value
stty echo 2>/dev/null || true
echo
value=$(printf %s "$value" | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
[ -n "$value" ] || { echo "nothing entered, no change"; exit 1; }
KEY="$key" VALUE="$value" python3 - <<'PY'
import os, re
p = "backend/.env"
s = open(p).read()
k, v = os.environ["KEY"], os.environ["VALUE"]
if re.search(rf"(?m)^{k}=", s):
    s = re.sub(rf"(?m)^{k}=.*$", lambda m: f"{k}={v}", s)
else:
    s = s.rstrip("\n") + f"\n{k}={v}\n"
open(p, "w").write(s)
PY
chmod 600 backend/.env
masked=$(printf %s "$value" | cut -c1-8)
echo "saved $key (${masked}…, ${#value} characters) — restarting the API"
docker compose -f docker-compose.prod.yml up -d --force-recreate api >/dev/null 2>&1
sleep 4
docker compose -f docker-compose.prod.yml logs --tail=6 api | grep -E "payment gateway|Refusing|Invalid|error" || true
echo "done"
