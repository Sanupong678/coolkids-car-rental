#!/bin/sh
# Daily database dump on the VPS, kept here for 14 days and copied to the private R2
# bucket (backups/db/, kept 30 days) so a dead server does not take the backups with it.
# The dumps hold customer data: files are created readable by root only. Install with:
#   sudo crontab -e   →   30 3 * * * /opt/coolkids/deploy/backup-db.sh >> /var/log/coolkids-backup.log 2>&1
# Restore:
#   gunzip -c backups/db-YYYY-MM-DD.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U coolkids -d car_rental
# Check that a dump restores (throwaway database, the live one is not touched):
#   sh deploy/restore-test.sh
set -eu
umask 077
cd "$(dirname "$0")/.."
mkdir -p backups
chmod 700 backups
name="db-$(date +%F).sql.gz"
out="backups/$name"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U coolkids -d car_rental --no-owner | gzip > "$out.tmp"
mv "$out.tmp" "$out"
chmod 600 backups/db-*.sql.gz
find backups -name 'db-*.sql.gz' -mtime +14 -delete
echo "$(date -Is) backup ok: $out ($(du -h "$out" | cut -f1))"
# off-site copy (a failure here is logged; the local dump above is still good)
if docker compose -f docker-compose.prod.yml exec -T api node src/scripts/backup-upload.js "$name" < "$out"; then
  echo "$(date -Is) off-site copy ok"
else
  echo "$(date -Is) OFF-SITE COPY FAILED for $name" >&2
fi
