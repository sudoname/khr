#!/usr/bin/env bash
# One-time setup: installs the nightly backup cron job on the server.
# Run from the repo root on the server: bash infrastructure/backup/install.sh
set -euo pipefail

install -m 755 infrastructure/backup/backup.sh /usr/local/bin/khr-backup

cat > /etc/cron.d/khr-backup <<'CRON'
# Nightly KHR database backup at 02:17 server time.
17 2 * * * root /usr/local/bin/khr-backup >> /var/log/khr-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/khr-backup

echo "Installed. Test with: /usr/local/bin/khr-backup"
