# Database restore runbook (moved)

Superseded on 2026-09-23 by [docs/runbooks/restore-from-backup.md](runbooks/restore-from-backup.md),
which is measured against a weekly restore drill (`.github/workflows/db-restore-drill.yml`).
This file said the project had no platform backups and that a restore would
bring back the cron schedules; both were wrong when the drill first ran.
