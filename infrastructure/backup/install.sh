#!/usr/bin/env bash
# One-time setup: installs the nightly backup cron job on the server.
# Run from the repo root on the server: bash infrastructure/backup/install.sh
set -euo pipefail
umask 077

command -v gpg >/dev/null || { echo "gpg is required: apt install gnupg" >&2; exit 1; }

install -m 755 infrastructure/backup/backup.sh /usr/local/bin/khr-backup

# Backup config with the encryption key. Generated once; NEVER overwritten.
# Copy BACKUP_ENCRYPTION_KEY somewhere safe off the server — without it the
# encrypted backups are unreadable.
if [ ! -f /etc/khr-backup.env ]; then
  cat > /etc/khr-backup.env <<EOF
# khr-backup configuration (read by /usr/local/bin/khr-backup).
BACKUP_ENCRYPTION_KEY=$(openssl rand -hex 32)
# Optional offsite copy, run as: \$OFFSITE_CMD <backup-file>
#OFFSITE_CMD=
EOF
  chmod 600 /etc/khr-backup.env
  echo "Generated /etc/khr-backup.env — store BACKUP_ENCRYPTION_KEY off-server NOW."
fi

cat > /etc/cron.d/khr-backup <<'CRON'
# Nightly KHR database backup at 02:17 server time; weekly scratch-restore
# verification on Sundays at 03:05.
17 2 * * * root /usr/local/bin/khr-backup >> /var/log/khr-backup.log 2>&1
5 3 * * 0 root /usr/local/bin/khr-backup --verify >> /var/log/khr-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/khr-backup

echo "Installed. Test with: /usr/local/bin/khr-backup && /usr/local/bin/khr-backup --verify"
