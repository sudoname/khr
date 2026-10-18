#!/usr/bin/env bash
# Nightly Postgres backup for khr.ng.
#
# Installed on the server as a cron job (see infrastructure/backup/install.sh).
# Dumps the database in pg_dump custom format and keeps RETENTION_DAYS of
# history locally. Copy /var/backups/khr off-server (e.g. DO Spaces/rclone)
# for real disaster recovery.
#
# Restore:
#   docker compose -f docker-compose.prod.yml exec -T postgres \
#     pg_restore -U peopleflow -d peopleflow --clean --if-exists < khr-<stamp>.dump
set -euo pipefail

REPO_DIR=/var/www/khr
BACKUP_DIR=/var/backups/khr
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/khr-$STAMP.dump"

cd "$REPO_DIR"
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U peopleflow -d peopleflow --format=custom > "$OUT"

# A dump that is suspiciously small is worse than a loud failure.
if [ "$(stat -c%s "$OUT")" -lt 1024 ]; then
  echo "backup looks too small: $OUT" >&2
  exit 1
fi

find "$BACKUP_DIR" -name 'khr-*.dump' -mtime +"$RETENTION_DAYS" -delete
echo "backup ok: $OUT ($(stat -c%s "$OUT") bytes)"
