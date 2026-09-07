# Database restore runbook

**Read the "What this does NOT restore" section before you start.** The dump is
good, but it is *partial in ways that do not announce themselves*. A restore
that follows only the happy path below will come up looking complete, serve
traffic, and be wrong in four specific places. Each one has a named step and a
verification query.

Status of this document, stated plainly because an untested backup is a
hypothesis and you deserve to know which parts are which:

| Claim | Evidence |
|---|---|
| The nightly dump runs and produces a real, non-empty, decryptable archive | **Tested.** Every night, in CI. The job decrypts its own artifact and asserts the contents before uploading. Last green run: 2026-09-06. |
| What the dump captures and omits | **Verified 2026-09-06** against `supabase db dump --dry-run` (which prints the exact `pg_dump` invocation) and against live prod catalogs. Numbers below are measured, not assumed. |
| A full restore into a new project produces a working app | **NEVER TESTED.** There is no staging project (retired 2026-09-06) and no rehearsal has ever been performed. The procedure below is derived from the dump's actual contents, not from a drill. |

Treat the ordering and the verification queries as the trustworthy part, and
budget time for surprises in the parts marked untested.

---

## 0. Facts you need at 3am

- **Project ref (prod):** `fncmgoasalhdgfwzhsqa`
- **Supabase plan:** free. **No automatic backups. No point-in-time recovery.**
  `supabase backups list --project-ref fncmgoasalhdgfwzhsqa --output json`
  returns an empty `backups` array and `pitr_enabled: false`. This is the
  owner's deliberate cost decision, not an oversight.
- **Therefore the artifact produced by `.github/workflows/db-backup.yml` is the
  only restore source that exists.**
- **Worst-case data loss: up to ~24 hours** (the dump runs 07:40 UTC ≈ 01:40
  America/Chicago). Anything written after the last successful nightly run is
  gone. There is no WAL to replay on this plan.
- **Database size:** 155 MB (2026-09-06). Encrypted artifact: ~827 KB.

> `pg_settings.archive_mode = on` and a large `pg_stat_archiver.archived_count`
> are **not** evidence that you can recover anything. That is Supabase's own
> platform WAL shipping, not a customer entitlement. Only a non-empty `backups`
> array and `pitr_enabled: true` mean a restore exists, and here both are
> negative.

---

## 1. What the backup captures

Three files, produced nightly, tarred and encrypted with GPG symmetric AES-256.

**`schema.sql`** — `pg_dump --schema-only`, restricted to the `public` schema.
`public` is the only non-platform schema in this database (verified: the full
schema list is `auth, cron, extensions, graphql, graphql_public, net, public,
realtime, storage, supabase_migrations, vault` — every one of the others is
platform-managed and excluded by the CLI). It contains:

- all `public` tables, views, sequences, constraints and indexes
- **204 RLS policies** on `public` tables
- **247 functions**, including their `GRANT`/`REVOKE` ACLs — *with the critical
  caveat in §2.1, which you must read*

**`data.sql`** — `pg_dump --data-only --schema '*'`, a much wider net than the
schema dump. It captures rows from `public`, **and also from `auth`, `storage`,
`cron`, `net`, `supabase_functions` and `pgmq`**. Specifically:

- `auth.users` (44 rows) and the rest of the `auth` tables — identities,
  sessions, refresh tokens. **This matters more than it looks:** restoring
  `public.profiles` without `auth.users` would give back every row of user data
  with no account able to log in and claim it.
- `storage.buckets` (11) and `storage.objects` (33) — the **metadata rows**,
  not the files. See §2.2.
- `cron.job` (47 scheduled jobs)
- 62 tables carrying data in total

The file opens with `SET session_replication_role = replica;`, so triggers are
disabled during load and foreign-key ordering does not matter.

**`roles.sql`** — `pg_dumpall --roles-only --no-role-passwords`. Small (297
bytes) and that is correct: it carries only non-reserved cluster roles. It does
**not** carry object grants (those live in `schema.sql`) and it does **not**
carry role passwords.

---

## 2. What this does NOT restore

Four gaps. Every one of them produces an app that boots and looks healthy.

### 2.1 Function ACLs will silently revert to anon-executable — the dangerous one

This is the trap that most deserves your attention, because the backup *does*
contain the ACL statements and still gets the wrong answer.

On prod today, **197 of 247 `public` functions have `anon` EXECUTE revoked**
(50 are intentionally anon-callable). That hardening will not survive a naive
restore, for a reason specific to Supabase:

`pg_default_acl` has **two** entries granting `anon=X` on new `public`
functions — one from `postgres`, one from `supabase_admin`. So in any Supabase
project, every `CREATE FUNCTION public.…` **immediately grants `anon` EXECUTE**.
`pg_dump` then emits `REVOKE ALL ON FUNCTION … FROM PUBLIC;` — and, as this
project has learned the hard way, **`REVOKE … FROM PUBLIC` does not revoke
`anon`**. It removes only the implicit world grant, leaving the explicit
`anon=X` from default privileges fully intact. `pg_dump` never emits
`REVOKE … FROM anon`, because in the *source* database anon simply had no
grant to describe.

Net effect: restore `schema.sql` into a fresh project and all 247 functions
become anon-executable, including every `admin_*` function. Nothing errors.

**Mitigation — mandatory, do not skip:**

```sql
-- Run AFTER schema.sql, BEFORE pointing any client at the new project.
SELECT count(*) FILTER (WHERE array_to_string(proacl,',') LIKE '%anon=X%') AS anon_can_execute,
       count(*) FILTER (WHERE array_to_string(proacl,',') NOT LIKE '%anon=X%') AS anon_revoked
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f';
```

Expected on a healthy prod: `anon_can_execute = 50`, `anon_revoked = 197`.
Immediately after a raw restore expect roughly `247 / 0`. If you see that, the
revocations were lost — re-apply them by replaying the migrations that perform
them, and **always name the roles explicitly**: `REVOKE … FROM PUBLIC, anon;`.

### 2.2 Storage files — the bytes are gone, the rows are not

`data.sql` restores `storage.objects`, so the database will confidently list
**33 files across 11 buckets (19 MB)** that do not exist. Avatars break;
`id-documents`, `user-documents` and `proof-photos` are unrecoverable and, being
identity and dispute evidence, are exactly the files you cannot ask users to
re-supply.

| Bucket | Public | Objects |
|---|---|---|
| `avatars` | yes | 16 |
| `proof-photos` | no | 7 |
| `user-documents` | no | 7 |
| `application-attachments` | no | 2 |
| `id-documents` | no | 1 |
| 6 others (`message-attachments`, `business-documents`, `job-photos`, `social-posts`, `profile-videos`, `marketing-media`) | mixed | 0 |

**Nothing currently backs these up.** See §5 for the recommendation.

Also missing: the **42 RLS policies on `storage.objects`/`storage.buckets`**.
The `storage` schema is excluded from `schema.sql`, so a restored project gets
Supabase's stock storage policies, not ours. Private buckets may be
misprotected until those are re-applied from migrations.

### 2.3 Realtime, event triggers, and the migration ledger

The Supabase CLI's dump deliberately comments these out of `schema.sql`:

- **The `supabase_realtime` publication** and its **10 member tables.**
  Restored app = no realtime. Chat and notification subscriptions go quiet with
  no error, which is the worst possible failure shape here.
- **7 event triggers.**
- **`supabase_migrations.schema_migrations` (644 rows)** is excluded from *both*
  the schema and data dumps. The restored project has an **empty migration
  ledger**, so the next `supabase db push` will try to re-apply all 644
  migrations onto a schema that already has them. Handle this explicitly in
  step 3.6 — do not let it happen by accident.

### 2.4 Things that never lived in Postgres

- **`vault.secrets` (3 secrets)** — the `vault` schema is excluded from both
  dumps. Re-create from the source of truth.
- **Edge-function secrets** (`supabase secrets list`) — not in the database at
  all.
- **Stripe** — Stripe is its own system of record and is *not* restored or
  rewound. This is the reconciliation problem: after restoring to yesterday,
  Stripe knows about every charge, transfer and refund from the lost window,
  and the platform no longer does. Escrow holds, payout ledger rows and dispute
  outcomes from that window exist on Stripe's side with no local counterpart.
  **`money-reconciliation` has never completed a run**, so nothing would detect
  the divergence automatically. Budget for a manual Stripe-to-database
  reconciliation of the lost window as part of any restore.
- **Resend** — sent-email history and suppression list.
- **Cron *schedules* are captured as `cron.job` rows** (47), but the jobs call
  back into project-specific URLs and secrets; verify them rather than assuming.

---

## 3. Restore procedure

> **Restore into a NEW project first and diff it.** Never restore over a
> database that still has anything you have not copied out. The old project is
> your only remaining evidence of what was there.

### 3.1 Get the archive

```bash
gh run list --workflow=db-backup.yml --limit 10
gh run download <run-id> -n db-backup-<YYYY-MM-DD>
```

Artifacts are retained **90 days** (the GitHub free-tier maximum). Pick the
newest run *that predates the damage* — if a bad migration ran at 09:00 and the
backup runs at 07:40, today's artifact is good; if the damage is older than you
think, you may need an earlier one, which is exactly what 90 days buys.

### 3.2 Decrypt

```bash
gpg --decrypt --batch --passphrase "$BACKUP_PASSPHRASE" \
    backup-<date>.tar.gz.gpg > backup.tar.gz
tar xzf backup.tar.gz    # -> roles.sql schema.sql data.sql
```

`BACKUP_PASSPHRASE` is a GitHub Actions secret. **If it is only in GitHub and
GitHub is what you lost, you cannot read your backups.** It must also exist in
a password manager outside this repo and outside GitHub.

### 3.3 Create the target project

New Supabase project, same region (`us-east-1`). Note its ref and DB password.

### 3.4 Load, in this order

```bash
export TARGET="postgresql://postgres:<pw>@db.<new-ref>.supabase.co:5432/postgres"
psql "$TARGET" -v ON_ERROR_STOP=1 -f roles.sql
psql "$TARGET" -v ON_ERROR_STOP=1 -f schema.sql
psql "$TARGET" -v ON_ERROR_STOP=1 -f data.sql
```

Order is not optional: `data.sql` cannot create the schema, and `schema.sql`
needs the roles its GRANTs reference. Expect some noise from `roles.sql` about
reserved roles — that is normal. Do not use `ON_ERROR_STOP` as a reason to stop
on the first reserved-role complaint; read what actually failed.

### 3.5 Re-apply everything in §2

In order of how quietly they fail:

1. **Function ACLs** (§2.1) — run the verification query. Expect `50 / 197`.
2. **Storage RLS policies** (§2.2) — re-apply from migrations.
3. **Realtime publication** (§2.3) — re-add the 10 tables.
4. **Event triggers** (§2.3) — 7 of them.
5. **Vault secrets and edge-function secrets** (§2.4).
6. **Storage files** — from whatever copy you have. If none exists, this is
   permanent; record which users are affected before anyone asks.

### 3.6 Reconcile the migration ledger

The restored schema is current but the ledger is empty. Do **not** run
`supabase db push` against it until you have fixed that, or it will replay 644
migrations. Mark them applied instead:

```bash
supabase migration repair --status applied <version> --project-ref <new-ref>
```

Then confirm `supabase migration list --linked` shows both sides in agreement —
zero drift is the standing requirement in this project.

### 3.7 Reconcile money against Stripe

Manual, and the most consequential step. For the window between the backup
timestamp and the incident, pull Stripe's record of charges, transfers, refunds
and disputes and compare against the restored escrow and payout tables. The
database is the only record of what the platform *promised*; Stripe is the only
record of what actually *moved*. Neither is complete alone.

### 3.8 Cut over

Only after §3.5–§3.7. Update `SUPABASE_PROJECT_REF`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY` and the anon/service keys everywhere they are
set: GitHub Actions secrets, Vercel environment variables, and `.env` for local
work. Re-deploy edge functions.

---

## 4. Verifying a restore actually worked

Run all of these against the restored project. Numbers are prod as of
2026-09-06; they will drift, so compare against the *source* where you can.

```sql
-- Function ACLs survived (the §2.1 trap). Expect 50 / 197, NOT 247 / 0.
SELECT count(*) FILTER (WHERE array_to_string(proacl,',') LIKE '%anon=X%'),
       count(*) FILTER (WHERE array_to_string(proacl,',') NOT LIKE '%anon=X%')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prokind='f';

-- RLS policies. Expect 204 public, 42 storage.
SELECT n.nspname, count(*) FROM pg_policy p
JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','storage') GROUP BY 1;

-- Realtime publication. Expect 10; a fresh restore gives 0.
SELECT count(*) FROM pg_publication_rel pr
JOIN pg_publication pb ON pb.oid=pr.prpubid WHERE pb.pubname='supabase_realtime';

-- Event triggers. Expect 7.
SELECT count(*) FROM pg_event_trigger;

-- Core data.
SELECT (SELECT count(*) FROM auth.users)        AS auth_users,
       (SELECT count(*) FROM public.profiles)   AS profiles,
       (SELECT count(*) FROM public.jobs)       AS jobs,
       (SELECT count(*) FROM cron.job)          AS cron_jobs;

-- Orphaned storage rows: files the DB believes in. Expect 33 rows, 0 files.
SELECT bucket_id, count(*) FROM storage.objects GROUP BY 1;
```

Then a human check that no query can do: log in as a real user, open a job with
escrow held, and confirm the money figures match Stripe.

---

## 5. Known gaps in the backup itself

Listed so they are decisions rather than surprises.

1. **Storage files are not backed up at all** (19 MB, 33 objects). Adding this
   is cheap in bytes but requires a **new `SUPABASE_SERVICE_ROLE_KEY` secret**
   in Actions to download private buckets, and would place ID documents into a
   GitHub artifact (encrypted, but present). That is a real privacy trade-off
   and an owner decision, not one to make silently. Recommended, with the
   trade-off stated.
2. **The restore has never been rehearsed**, and with staging retired there is
   no free venue to rehearse in. The cheapest honest drill is to restore into a
   throwaway Supabase project once, walk §3, record what broke, and delete it.
   Until that happens, §3 is reasoning, not experience.
3. **`BACKUP_PASSPHRASE` off-GitHub storage is unverified.** If it lives only in
   Actions secrets, the backup does not survive the loss of the GitHub account.

---

## 6. Operational notes

**Does the dump harm the live database?** No. `pg_dump` takes only `ACCESS
SHARE` locks, which do not block reads, inserts, updates or deletes. It *does*
conflict with `ACCESS EXCLUSIVE` operations (`ALTER TABLE`, `DROP`, `TRUNCATE`),
so a migration deploy landing mid-dump would queue behind it. The job completes
in about 2 minutes, and 07:40 UTC was chosen to sit clear of the other scheduled
workflows and the daily sweeps.

**Will it fail loudly?** Yes, by design — this is the failure mode the workflow
is built against. It hard-fails on a missing secret (including
`BACKUP_PASSPHRASE`, rather than falling back to an unencrypted upload), on a
dump below a size floor, on any of six load-bearing tables missing from the
schema, on zero rows for `auth.users`/`profiles`/`jobs`/`applications`/
`messages`, on fewer than 30 tables carrying data, and on the encrypted archive
failing to decrypt and list its own contents. A green run means all of that
passed. `if-no-files-found: error` covers the last gap.

**When does it stop fitting?** Not soon. The artifact is 827 KB against a
GitHub artifact limit measured in gigabytes; the binding constraint is the free
tier's 500 MB *database* limit, and the database is at 155 MB — of which
roughly 117 MB is reclaimable bloat in `cron.job_run_details` and
`net._http_response`, not real data. The dump would need to grow by three
orders of magnitude to be inconvenient. If the job ever does start failing on
size, it fails red rather than truncating.
