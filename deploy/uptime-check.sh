#!/bin/sh
# Every minute (cron): does the site answer? Writes one line per failure, with what the
# containers and the machine looked like at that moment, plus an "ok" line once an hour,
# so "the site was down at 14:05" can be told apart from a network problem on the
# visitor's side. The check goes to the public address from the server itself, so it
# covers Caddy, the site and the API but not the internet path to the visitor.
#   * * * * * /opt/coolkids/deploy/uptime-check.sh
#   log: /var/log/coolkids-uptime.log
set -u
log=/var/log/coolkids-uptime.log
domain="$(grep -E '^SITE_DOMAIN=' "$(dirname "$0")/../.env" 2>/dev/null | cut -d= -f2)"
domain="${domain:-coolkidscar.com}"
now="$(date '+%Y-%m-%d %H:%M:%S')"
[ -f "$log" ] || echo "$now started watching https://$domain/health" > "$log"

result="$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --connect-timeout 5 --max-time 15 "https://$domain/health")"
code="${result%% *}"

if [ "$code" != "200" ]; then
  {
    echo "$now DOWN code=$code time=${result#* }s load=$(cut -d' ' -f1-3 /proc/loadavg)"
    docker ps -a --filter name=coolkids --format '    {{.Names}} {{.Status}}'
  } >> "$log"
elif [ "$(date +%M)" = "00" ]; then
  echo "$now ok ${result#* }s" >> "$log"
fi

# keep the log small: the last 2000 lines
if [ "$(wc -l < "$log" 2>/dev/null || echo 0)" -gt 4000 ]; then
  tail -n 2000 "$log" > "$log.tmp" && mv "$log.tmp" "$log"
fi
