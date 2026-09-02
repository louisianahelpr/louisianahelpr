# lh-data-recovery — could this app survive losing its database?

**Answer: no.** Not "it would lose N hours" — there is no artifact from which any
prior state of this database could be reconstructed, at all.

Worktree `~/.lh-audit/lh-data-recovery` @ `origin/main` b170609a. Every claim
below is a live fact against prod `fncmgoasalhdgfwzhsqa` — the Management API,
the authenticated CLI, or read-only `execute_sql`. **No destructive path was
exercised against prod.** Nothing was deleted, truncated, restored or purged.

## What I fixed

**Nothing — by design, and this is the one lane where that is the right answer.**
Five of the six findings are not code defects: DR-001 is a plan entitlement,
DR-005 is a missing procedure, DR-004 is a property of where three stores live,
DR-006 is a schema-shape consequence. The two that *are* repo changes —
DR-002 (migration-lint has no destructive-DDL rule; the db-deploy approval gate
is commented out) and DR-003 (the `jobs` DELETE policy) — sit in
orchestrator-only and other-lane territory: CI workflows are orchestrator-only
per PROTOCOL §1, and an RLS policy on `jobs` belongs to `lh-authz-rls` with
`lh-money-escrow` as reviewer. Both were filed and relayed to the orchestrator
rather than edited. I also remained in `permissionMode: plan` throughout.

---

## 1. What backup actually exists

**None.** The prod project has no restorable backup and no PITR.

```
$ supabase backups list --project-ref fncmgoasalhdgfwzhsqa --output json
{ "backups": [], "physical_backup_data": {},
  "pitr_enabled": false, "region": "us-east-1", "walg_enabled": true }
```

Table form prints `EARLIEST TIMESTAMP 0 | LATEST TIMESTAMP 0`. Org plan
confirmed `free` via the Management API — `get_organization(lwcxeakvfcuxlvcgxvdn)`
returned `{"id":"lwcxeakvfcuxlvcgxvdn","name":"Helpr","plan":"free",...}`. Staging
(`supabase backups list --project-ref okpxtpfvwtmbuxugqsws --output json`) returns
the byte-identical payload.

**Worst-case data-loss window: total.** Not hours. There is no snapshot, no
retention window, and no point in time to recover to.

### The trap in this answer

`walg_enabled: true` looks like a backup and is not. Live prod agrees it is
running:

| probe | value |
|---|---|
| `pg_settings.archive_mode` | `on` |
| `pg_settings.archive_command` | `/usr/bin/admin-mgr wal-push %p` |
| `pg_stat_archiver.archived_count` | 87,037 |
| `pg_stat_archiver.failed_count` | 0 |
| `pg_stat_archiver.last_archived_time` | 2026-09-02 21:29:48+00 |

WAL is genuinely being shipped, continuously, with zero failures. That is
Supabase's own platform infrastructure. With `pitr_enabled: false` and both
restore timestamps at `0`, **the owner cannot invoke a restore against it.**
Anyone checking `archive_mode` alone would conclude this project is protected.

### Who can trigger a restore

Nobody. `supabase backups restore` exists in the CLI and has no window to
target. There is no dashboard restore on this plan.

### The cost, stated plainly

Per the standing instruction to flag paid-plan costs up front, and *not* as a
demand to spend: Supabase's restore capability is a Pro-plan feature, with PITR
as a further paid add-on above that. This is the owner's accepted free-tier
decision and I am not re-litigating it. The point of this section is that the
decision should be made knowing the answer is **zero**, not "a few days".

---

## 2. What a restore would NOT bring back — DR-004

Three stores live outside Postgres. A restore that resurrects rows pointing at
them is a partial recovery that reads as a total one.

**Storage — 10 buckets, 24 live objects, ~19 MB:**

| bucket | public | objects | size |
|---|---|---|---|
| `user-documents` | no | 7 | 8,919 kB |
| `avatars` | **yes** | 13 | 5,771 kB |
| `application-attachments` | no | 2 | 3,501 kB |
| `id-documents` | no | 1 | 791 kB |
| `proof-photos` | no | 1 | 784 B |
| `job-photos`, `message-attachments`, `profile-videos`, `social-posts`, `business-documents` | — | 0 | — |

`id-documents` holds a government ID; `user-documents` holds licence and
insurance credentials. `_shared/accountPurge.ts` (≈335–465) deletes every object
under `<userId>/` across the identity buckets and re-lists to verify — correct
behaviour, and **irreversible**. Restore `profiles` after such a purge and you
get rows pointing at objects that no longer exist.

**Edge-function secrets — 37, none in Postgres.** `supabase secrets list` returns
`STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `APNS_AUTH_KEY`, `SEND_EMAIL_HOOK_SECRET`,
`CRON_SECRET`, `STRIPE_IDV_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `SLACK_WEBHOOK_URL`,
`APPLE_MAPKIT_*`, and 22 `STRIPE_PRICE_*` ids. `SELECT name FROM vault.secrets`
returns **3** rows (`supabase_url`, `service_role_key`, `legacy_service_role_key`).
Nothing in the repo records the other 37 — the `STRIPE_PRICE_*` ids in particular
are not derivable from the codebase.

**Cron — 44 active schedules** in `cron.job`. Survives a physical restore; does
not survive a rebuild-from-migrations. Nothing reconciles the two.

---

## 3. Has a restore ever been tested — DR-005

No, and there is nowhere to test one.

- `grep -rn "pg_dump|pg_restore|point-in-time|PITR|database restore" docs/ scripts/ .github/`
  → 2 hits, both incidental ledger prose. **Zero in `scripts/`, zero in `.github/`.**
- 24 workflows; none performs a dump or export.
- `docs/qa/CRASH_RECOVERY.md` is an *app* force-quit plan, not a database one.
- Staging cannot be the rehearsal venue: per SI-007 it is 65 migrations behind
  prod and holds nine tables dropped from prod, and it reports the same
  `{backups:[], pitr_enabled:false}` — it has nothing to restore from either.

**"No procedure" is the finding.** Here there is neither the backup, nor the
test, nor a venue for one.

---

## 4. Destructive paths and blast radius

### DR-003 — a poster can delete a job holding escrow, and it cascades 21 ways

The largest single-call blast radius I found, and it is reachable by any
ordinary authenticated user:

```
pg_policy on jobs, polcmd='d':
  "Customers can delete their own jobs"  USING ((SELECT auth.uid()) = customer_id)
```

No status predicate. No `payment_status` predicate. `authenticated` holds the
`DELETE` grant (`information_schema.role_table_grants`), and the
`BEFORE DELETE` trigger scan on `jobs` returns **empty** — nothing guards it.

One `DELETE` cascades to 21 children including **`tips`** (Stripe-charged money),
**`disputes` + `job_disputes`** (the outcome — who won, `decided_by`, resolution),
**`reviews`** (both directions), **`messages`** → `message_reactions` (two
levels), `applications`, `job_tracking`, `job_checkins`, `group_job_helpers`,
`job_revisions`, `recurring_visit_releases`.

The asymmetry is what makes this unintended rather than a design choice:
`payment_refunds.job_id` and `helper_w9_records.job_id` were deliberately given
`ON DELETE SET NULL` so those money records *survive*. Someone reasoned about
record survival for some money tables. `tips` was not one of them.

**28 jobs are in `payment_status='escrow'` in prod right now.** Reversible: no
(DR-001). Logged: no.

### DR-002 — the migration path has no destructive gate

`migration-lint.yml` has exactly four rules (lines 189, 202, 209, 215). Rule 3,
the only one about DROP, is annotated in the file itself:

```
# Rule 3: DROP TABLE/COLUMN should use IF EXISTS
  echo "  ⚠️  DROP without IF EXISTS — may fail on re-run"
  # Warning only, not a fail
```

`grep -c TRUNCATE migration-lint.yml` → **0**. No rule matches an unqualified
`DELETE FROM` or a `WHERE`-less `UPDATE`. So `TRUNCATE payout_transfers;` or
`DROP TABLE IF EXISTS jobs;` lints clean, merges, and `db-deploy.yml` runs
`supabase db push --linked --include-all` straight at prod — with the
`environment: production-db` required-reviewer gate **commented out**, so no
human sees it, and no backup behind it.

### Paths that are correctly bounded — checked, not defects

- **`purge_user_data`** (SECURITY DEFINER, 22.6 kB) deletes from 14 tables. Its
  job deletion is scoped to `customer_id` only, gated on an **allowlist**
  (`payment_status = 'unpaid'`) plus `helper_id IS NULL`, and runs per-row with
  an FK-violation handler that *retains* the job. Default-retain is the right
  direction for a destructive predicate. Not a finding.
- **`cleanupOrphanJob`** (`src/pages/postjob/useJobSubmit.ts:46`) deletes one just-created job whose payment setup failed; line 46 reads
  `const { data, error } = await supabase.from("jobs").delete().eq("id", jobId).select("id");`
  — scoped to a single id, with `.select("id")` and a zero-row `report()` at
  lines 51-57. Correct.
- **The prune/sweep crons** (`sweep_old_notifications`, `sweep_old_error_logs`,
  `prune_cron_run_log`, `prune_edge_rate_limit_log`, `cleanup_observability_tables`,
  `cleanup_stripe_webhook_events`) target observability/log tables only.

### SI-006 — verified FIXED, not re-filed

Both fix migrations are live in prod (`schema_migrations` contains
`20260902014651` and `20260902051631`; 580 rows, newest `20260902173900`).
`purge_user_data`'s current definition now deletes from `favorite_helpers`,
`helper_availability` and `job_tracking`, and declares `v_consent_an` /
`v_reports_an` anonymisation counters. The five survivors SI-006 proved are
handled. Co-owned with `lh-account-lifecycle`; I did not re-file.

### Deletion is irreversible, and that is not what the user is told

Account deletion anonymises (`20260901033011`): `description` becomes
`'[removed at account deletion]'`, `customer_id`/`helper_id`/`location`/
`latitude`/`longitude`/`reviews.reviewer_id`/`disputes.opener_id` go NULL,
`status` is preserved. There is **no undo** — no soft-delete column, no
retention shadow table, and (DR-001) no backup to recover the pre-anonymisation
values from. That matches the *intent* of a right-to-be-forgotten flow. Whether
the deletion copy tells the user it is permanent and immediate is
`lh-account-lifecycle` / `lh-copy-content` territory; I have relayed it rather
than grading their surface.

---

## 5. The money-record question — DR-006

Restored to yesterday, here is what would be wrong versus Stripe.

**Reconstructible** (carries a Stripe id): `jobs.stripe_payment_intent_id`,
`tips.stripe_payment_intent_id`, `payout_transfers.stripe_transfer_id`,
`pif_credits.stripe_payment_intent_id`.

**Not reconstructible:**

- **`referral_credits` has no Stripe column of any kind.** Pure platform
  currency, zero external record. A rolled-back referral credit is gone, or
  duplicated, with nothing to reconcile against.
- **Dispute outcomes.** `disputes` carries only `execution_transfer_id`. Stripe
  records that a transfer happened, not who won, who decided it, or why. A
  restore silently reopens settled disputes with the money already moved.
- **Escrow state.** 28 `escrow` / 11 `released`. Stripe would still show the
  release; the restored row would not.
- `job_disputes`, `helper_w9_records`, `user_strikes` — no Stripe linkage.

**Would anyone notice?** `money-reconciliation` is scheduled `20 8 * * *` and has
**8** `job_run_details` rows ever (last 2026-09-02 08:20). Already filed by
another lane as never having completed a run; I did not re-file, but it is the
control that would have to catch every divergence above.

---

## Findings

| id | sev | blocker | surface |
|---|---|---|---|
| DR-001 | HIGH | ✔ | Zero restorable backups, PITR disabled, `backups: []` |
| DR-002 | HIGH | ✔ | Migration auto-deploy: no destructive-DDL gate, approval commented out |
| DR-003 | HIGH | | `jobs` DELETE policy has no state predicate; 21-table CASCADE |
| DR-004 | HIGH | | Storage + 37 edge secrets + 44 crons outside any DB backup |
| DR-005 | MEDIUM | | No restore procedure, never rehearsed, nowhere to rehearse |
| DR-006 | MEDIUM | | `referral_credits` and dispute outcomes unreconstructible |

## Coverage manifest

**Operated (live artifacts):** Management API `get_organization` +
`get_project` + `list_projects`; `supabase backups list` prod **and** staging
(json + table); `supabase secrets list` prod; `supabase projects list`;
`gh workflow list --all`; `gh secret list`. Prod read-only SQL: `pg_settings`,
`pg_stat_archiver`, `pg_constraint` (full FK/CASCADE scan), `pg_policy` on
`jobs`, `pg_trigger` on `jobs`, `information_schema.role_table_grants`,
`information_schema.columns` (Stripe-linkage scan), `pg_proc` DELETE-statement
scan across all `public` functions, `pg_get_functiondef(purge_user_data)`,
`storage.buckets`⋈`storage.objects`, `vault.secrets`, `cron.job`,
`cron.job_run_details`, `supabase_migrations.schema_migrations`, row counts on
14 money/trust tables.

**Files read:** `.github/workflows/db-deploy.yml`, `migration-lint.yml`,
`docs/qa/CRASH_RECOVERY.md`, `supabase/functions/_shared/accountPurge.ts`,
`_shared/storageKeys.ts`, `src/pages/postjob/useJobSubmit.ts`,
`docs/audit/launch-2026-09/PROTOCOL.md`, findings `SI-006` / `SI-007` / `SI-010`.

### UNVERIFIED — could not reach, and why

1. **Whether a restore would actually succeed.** Untestable by construction:
   there is no backup to restore (DR-001) and exercising one against prod is
   forbidden by the standing constraint. This gap *is* DR-001.
2. **Whether Supabase retains an internal, support-only physical backup** for
   free projects behind the empty `backups: []`. The customer-facing API says
   there is nothing; only Supabase support could confirm what exists on their
   side. Not resolvable from this machine.
3. **DR-003's end-to-end reproduction.** I proved the policy, the grant and the
   absence of a guard trigger — I did **not** issue the `DELETE` against prod, so
   I have not observed the cascade fire. Doing so would destroy a real escrow
   row with no backup, which is precisely the thing this lane exists to prevent.
   Reproducible safely on a scratch project or a seeded row in a non-prod
   environment; I had neither.
4. **Storage object durability across a hypothetical restore.** I enumerated the
   buckets and the purge path; I did not delete an object to observe the
   dangling-row state, for the same reason.

## Out-of-scope conclusions (PROTOCOL §6)

- **Realm/CoreData/SQLite recovery, offline-sync conflict resolution** — no
  local database exists; nothing to recover. Correctly out of scope.
- **Certificate pinning / RASP** — not data-recovery concerns; other lanes.
- I filed **no** finding against `worker_protection_credits`, `business_*`,
  `helper_circles` or `time_credits`. My `pg_constraint`, `pg_proc` and
  `information_schema` scans were run against **live prod** and none of those
  objects appeared, which independently corroborates the 2026-09-02 retractions
  of SI-001/003/004/005. The only removed-feature CASCADE still present in prod
  is `broadcast_dismissals → broadcast_messages`, consistent with the protocol's
  note that the two `broadcast_*` tables survive.
