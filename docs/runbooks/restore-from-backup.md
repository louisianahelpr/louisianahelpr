# Restore the database from backup

Read this top to bottom before you touch anything. Every number here is dated
and says how it was measured. The procedure in §3 is not reasoning: it is
exactly what `scripts/db-restore-drill.sh` does, and
`.github/workflows/db-restore-drill.yml` runs that script every week against
the newest backup. If the drill is green, this procedure worked that week.

## 0. Facts (measured 2026-09-23)

| Fact | Value | How measured |
|---|---|---|
| Prod project | `fncmgoasalhdgfwzhsqa` (us-east-1), Postgres 17.6 | `select version()` |
| Org plan | **`pro`** (the docs and workflows said "free tier" until today) | Supabase `get_organization` → `plan: "pro"` |
| Platform backups | **7 daily physical backups** (2026-09-16 … 2026-09-22, about 09:37 UTC each) plus 3 extra on 2026-09-22 | `supabase backups list --project-ref fncmgoasalhdgfwzhsqa -o json` |
| Point-in-time recovery | **off** (`pitr_enabled: false`) | same |
| Our own backup | `db-backup.yml`, daily, GPG-encrypted artifact, kept **14 days** (the workflow asks for 90; the repo caps artifacts at 14) | `gh api repos/louisianahelpr/louisianahelpr/actions/permissions/artifact-and-log-retention` → `{"days":14,"maximum_allowed_days":90}`; the upload step logs "Using 14 instead" |
| Its real start times | cron says 07:17 UTC; scheduled runs actually started 11:55–14:06 UTC (09-15 … 09-22) | `gh run list -w db-backup.yml` |
| Longest gap between good backups, last 10 days | **about 36 h** (09-21 14:06 → 09-23 02:23; the 09-22 run hit a pooler timeout) | same; now retried 3× |
| Restore time | **4 s** to load roles + schema + data + cron + policies; **about 100 s** to start a blank local stack; drill job 1 min 55 s end to end | drill run 35837914689 |
| Database size | 68 MB | `pg_database_size` |
| Backup archive | about 2 MB encrypted (`data.sql` 14.3 MB, `schema.sql` 1.1 MB) | backup run 35837078677 |

**Worst-case data loss** (the RPO) is the time since the last good backup.
From the platform's backup that is up to about 24 h. From our artifact it is
up to 24 h plus GitHub's scheduling delay (measured up to about 7 h), and
longer if a run fails. That was 36 h once in the last 10 days, before the
retry. There is no PITR, so nothing between two backups can be recovered.

## 1. Pick the restore path

| | Platform daily backup | Our artifact (this runbook) |
|---|---|---|
| Where | Dashboard → Database → Backups | `gh run download` of `db-backup.yml` |
| How far back | 7 days | 14 days (repo artifact retention; see §0) |
| Restores into | the same project, in place (the project is down while it runs); Supabase documents a separate restore-to-new-project flow, not tried here | any Postgres, e.g. a **new** project |
| Scope | the whole database, including `supabase_migrations`, vault, storage and cron catalogs | see §2 |
| Storage files | **not included** (Supabase docs: storage objects are not in database backups) | not included |
| Proven here | **never exercised** (you cannot rehearse an in-place restore on the only database) | **weekly drill** |
| Needs | dashboard access (owner) | `BACKUP_PASSPHRASE`, `gh` access |

Use the platform backup when the project itself is healthy and you want the
whole database back to a day in the last week, for example after a bad
migration. Use this runbook when the project is gone, the damage is older than
7 days, or you need to look at old data without rolling prod back. For a bad
migration you can also restore our artifact into a new project, copy the lost
rows back, and leave prod up.

## 2. What the backup contains

`backup-<date>.tar.gz.gpg` from `db-backup.yml` holds five files:

| File | Contents (2026-09-23) |
|---|---|
| `roles.sql` | non-reserved cluster roles (297 bytes; no passwords) |
| `schema.sql` | the `public` schema: 82 tables, 198 RLS policies, 321 functions with their ACLs, the realtime publication, default privileges |
| `data.sql` | rows for 61 `public` tables, 7 `auth` tables (users, identities, sessions, refresh tokens, MFA, flow state), `storage.buckets` and `storage.objects` (the metadata rows only), and the 2 pgmq dead-letter archives |
| `cron.sql` | all 55 `pg_cron` schedules as `cron.schedule()` calls. The data dump has none. Added 2026-09-23. |
| `storage-policies.sql` | the 36 RLS policies on `storage.objects`. `schema.sql` is `public` only. Added 2026-09-23. |

## 3. Procedure (what the drill runs)

Target: a **new** Supabase project in us-east-1, never the damaged one. Its
connection string is the Session pooler or direct URL from the dashboard;
below it is `$TARGET`.

```bash
# 3.1  Get and decrypt the archive (pick the newest run from BEFORE the damage)
gh run list -w db-backup.yml --status success -L 20
gh run download <run-id> -D bk
gpg --batch --decrypt --passphrase "$BACKUP_PASSPHRASE" \
    -o b.tar.gz bk/db-backup-*/backup-*.tar.gz.gpg
mkdir sql && tar xzf b.tar.gz -C sql && rm b.tar.gz

# 3.2  Load it: the drill's own script, pointed at the new project.
#      It refuses any *.supabase.co target by design, so a human runs its
#      steps by hand against a hosted project, in this order:
```

1. `psql "$TARGET" -f sql/roles.sql`. "Role already exists" is harmless.
2. **Close the default-privileges trap before loading the schema.** Without
   this step every function comes back callable by anyone (drill 2026-09-23:
   306 of 306 anon-executable; prod has 17 of 321):
   ```sql
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
   ```
   `schema.sql` then grants exactly what prod granted, and its own trailing
   `ALTER DEFAULT PRIVILEGES` puts prod's defaults back.
3. `psql "$TARGET" -f sql/schema.sql`
4. pgmq queues: `CREATE EXTENSION IF NOT EXISTS pgmq;` then
   `SELECT pgmq.create(q)` for `auth_emails`, `auth_emails_dlq`,
   `transactional_emails` and `transactional_emails_dlq`. Without them the
   dead-letter rows and queue positions fail to load.
5. The `ensure_rls` event trigger, which turns on RLS for every new public
   table. It was created from the dashboard and is in no migration and no dump:
   ```sql
   CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
     WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
     EXECUTE FUNCTION public.rls_auto_enable();
   ```
6. `psql "$TARGET" -c 'SET session_replication_role = replica' -f sql/data.sql`.
   Triggers and foreign keys are off during the load, so order does not matter.
7. `psql "$TARGET" -1 -f sql/cron.sql -c 'SELECT cron.alter_job(jobid, active := false) FROM cron.job'`.
   This loads all 55 schedules **switched off**. See §4 before switching them on.
8. `psql "$TARGET" -f sql/storage-policies.sql`

The drill runs this against a local `supabase start` stack. Two steps differ
there, and both are local-only. First, the storage-owned statements run as the
local `supabase_admin`. Second, the CLI's auth and storage images are older
than hosted Supabase, so before the data load the drill adds prod's columns
to every auth/storage table the dump fills. On 2026-09-23 those images lacked
`storage.buckets.lifecycle_configuration`, `lifecycle_configuration_generation`
and `auth.one_time_tokens.expires_at`, and each table's rows failed to load
without them. A hosted target is at least as new as prod, so skip this step
there. If a hosted restore does print "column ... does not exist", this is
the cause, and the fix is the same `ALTER TABLE ... ADD COLUMN`.

### 3.3 Verify, before anything points at it

The drill checks all of these. Compare each with the backup, or with prod if
prod is still readable.

```sql
-- anon EXECUTE: must equal the number of GRANT ... TO "anon" in schema.sql (17 on 2026-09-23)
SELECT count(*) FILTER (WHERE array_to_string(proacl, ',') LIKE '%anon=X%'), count(*)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f';
SELECT count(*) FROM pg_tables   WHERE schemaname = 'public';      -- 82
SELECT count(*) FROM pg_policies WHERE schemaname = 'public';      -- 198
SELECT count(*) FROM pg_policies WHERE schemaname = 'storage';     -- 36
SELECT count(*) FROM pg_event_trigger;                             -- 7, incl. ensure_rls
SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime';  -- 10
SELECT (SELECT count(*) FROM auth.users) users, (SELECT count(*) FROM public.jobs) jobs,
       (SELECT count(*) FROM cron.job) cron_jobs, (SELECT count(*) FROM storage.buckets) buckets;
```

## 4. After the load: what a restore does NOT bring back

| Gap | Size (2026-09-23) | What to do |
|---|---|---|
| **Storage files** | 152 objects, about 10 MB, in 8 buckets: proof-photos 64, job-photos 61, message-attachments 18, avatars 4, user-documents 4 (8.9 MB), id-documents 1 | **Nothing backs these up.** The rows restore and point at files that do not exist. Record which users are affected. The platform backup does not include them either. |
| **Vault secrets** | 4: `supabase_url`, `service_role_key`, `legacy_service_role_key`, `ban_fingerprint_salt` | Re-create in the new project. The first three are the NEW project's URL and keys. **`ban_fingerprint_salt` cannot be re-derived**: without the original, stored ban fingerprints can no longer match, so banned devices get back in. It is in no backup. |
| **Cron schedules** | 55, loaded switched off (step 7); 26 call edge functions through the vault secrets | Switch them on (`cron.alter_job(jobid, active := true)`) only after the vault secrets exist and §5 is done. |
| **Edge-function secrets** | 41 names (`supabase secrets list`) | Re-set from their sources (Stripe, Resend, Meta, ...). Edge-function code is in git: deploy it with `functions-deploy.yml`. |
| **Migration ledger** | `supabase_migrations.schema_migrations` is in no dump | Before any `supabase db push` at the new project, mark every migration applied (`supabase migration repair --status applied <version>`), or db-deploy will try to replay them all. |
| **Auth config** | providers, redirect URLs, SMTP, JWT settings live in the project config, not the database | Re-enter them in the dashboard. Users' password hashes and identities do restore (`auth.users`, `auth.identities`). |
| **Stripe / Resend** | their own systems of record, never rewound | §5 |

## 5. Money: reconcile before switching payouts back on

The database is the only record of what the platform promised: escrow state,
the payout ledger, dispute outcomes, refunds. Stripe only records what moved.
After a restore to time T, every charge, transfer, refund and dispute Stripe
processed after T is missing from the database:

- Jobs paid after T look unpaid. Payouts made after T have no
  `payout_transfers` row.
- **Double-payout risk.** `process-scheduled-payouts` and
  `auto-release-payment` would find those jobs still owing and transfer
  again. Their Stripe idempotency keys replay only inside Stripe's roughly 24 h
  window (see the comment at `supabase/functions/process-scheduled-payouts/index.ts:860`).
  A restore to a backup older than that can send the same money twice.
- Keep every money cron switched off until the lost window is reconciled. At
  minimum that means auto-release-payment, process-scheduled-payouts,
  auto-tip-charge, charge-recurring-visits, void-cancelled-payments,
  subscription-reconciliation and money-reconciliation. Pull Stripe's
  charges, transfers, refunds and disputes created after T and bring the
  database into line first.
- `money-reconciliation` is the job that would notice a divergence. It has not
  completed a run (already on the open list), so do not count on it here.

## 6. Cut over

Only after §3.3, §4 and §5: update `SUPABASE_PROJECT_REF`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and the service keys
everywhere they live (GitHub Actions secrets, Vercel env, local `.env`, the iOS
build), re-deploy the edge functions, switch the crons on, and log in as a
real user to check an escrow-held job against Stripe.

## 7. Drill record

| Date | Run | Result | What it found |
|---|---|---|---|
| 2026-09-23 | 35836045277 | red | first ever restore: all public data restored, but 306/306 functions anon-executable, 0/55 cron jobs, 0 buckets (local image), pgmq queues missing, `ensure_rls` missing |
| 2026-09-23 | 35837914689 | **green** | after steps 2, 4, 5, 7: 0 restore errors; 17/321 anon (= backup); 82 tables, 198 policies, 7 event triggers, 10 realtime tables; auth.users 60/60, jobs 303 vs 309 live (6 created since the backup), every money-ledger table exact |
| 2026-09-23 | 35838927109 | red | a newer backup held `auth.one_time_tokens` rows, and the local auth image lacked `expires_at` (see the venue note in §3) |
| 2026-09-23 | 35839296119 | **green** | all 8 steps, 0 restore errors; storage policies 36/36, cron 55/55, buckets 8/8, objects 152/152 (rows only), anon 17/321; restore 3 s |

Weekly after that: Tuesdays 14:17 UTC. A red run opens a `nightly-red` issue
titled `db-restore-drill` and closes it on the next green run. #1659 did
exactly that during the runs above.
