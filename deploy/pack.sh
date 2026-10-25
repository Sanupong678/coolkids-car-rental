#!/bin/sh
# Packs the code for the VPS (no node_modules, builds, .env files, uploads or source videos).
# Run from Git Bash on this PC:   sh deploy/pack.sh
# Then:                           scp coolkids.tgz <user>@14.207.142.106:/opt/coolkids/
set -eu
cd "$(dirname "$0")/.."
tar -czf coolkids.tgz \
  --exclude=node_modules --exclude=dist --exclude=uploads --exclude=storage --exclude=backups \
  --exclude='.env' --exclude='.env.backup*' --exclude='.env.local*' --exclude='.env.prod*' \
  docker-compose.prod.yml deploy backend frontend
# Secrets must never leave this PC: only .env.example files may be inside.
if tar -tzf coolkids.tgz | grep -E '(^|/)\.env' | grep -vE '\.env\.example$'; then
  rm coolkids.tgz; echo "refusing: the files above hold secrets"; exit 1
fi
echo "coolkids.tgz $(du -h coolkids.tgz | cut -f1)"
