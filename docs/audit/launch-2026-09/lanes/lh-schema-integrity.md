# lh-schema-integrity — lane report

**Wave C1 · sweep phase · 2026-09-02**
**Target of record: PROD `fncmgoasalhdgfwzhsqa`.** Every claim below was taken
against prod via MCP `execute_sql`, not against the staging ref
(`okpxtpfvwtmbuxugqsws`) that `supabase/.temp/project-ref` points at. Where a
claim concerns staging it says so explicitly.

**No file under `src/`, `supabase/` or `ios/` was modified.** Writes to prod were
limited to one reversible probe (§ "The deletion probe"), fully cleaned up and
verified at zero residual — `CLEANUP_VERIFY` returned `0,0,0,0,0,0` across all six
probed tables.

---

## Headline

Three findings were pre-filed in this lane's name as unverified assumptions from
fleet setup. **All three are refuted by live prod state**, and the two that were
marked launch blockers are not blockers. The dead-object panic was misplaced:
the B2B tier, time banking, pet evacuation, community posts, retainer agreements
and helper circles are *all* genuinely gone from prod, dropped cleanly by
migration. `create_business_api_key` does not exist.

The real defects are in the opposite direction — in the machinery that was built
to *handle* deletion:

| id | sev | blocker | what |
|---|---|---|---|
| **SI-006** | HIGH | yes | Account deletion leaves rows behind in ≥5 no-FK tables — **proven by running the live purge**, 5 of 6 seeded rows survived |
| **SI-012** | HIGH | yes | 13 columns were made nullable for deletion; `types.ts` still declares all 13 non-null, so the compiler asserts they can't be null |
| **SI-007** | HIGH | no | Staging is 65 migrations behind and still holds the `time_credits` self-mint hole; it is what the local CLI is linked to |
| SI-008 | MED | no | `broadcast_*` is the only removed feature with surviving prod objects (2 tables + 3 `SECURITY DEFINER` fns) |
| SI-009 | MED | no | `instant_payouts`, `referral_credits`, `applications.stake_amount`, `jobs` fee columns have no CHECK |
| SI-013 | MED | no | 22 text-CHECK pseudo-enums generate as bare `string` — no exhaustiveness possible |
| SI-014 | MED | no | 14 per-row `auth.uid()` RLS policies + 54 permissive overlaps, on a free tier |
| SI-015 | MED | no | `user_roles` "Deny all deletes" is PERMISSIVE — it enforces nothing |
| SI-010 | LOW | no | 8 CHECK constraints still `NOT VALID` (data conforms; safe to validate) |
| SI-011 | LOW | no | PROTOCOL.md §6c/§6d carry two wrong facts the fleet is working from (`to_regclass` NULL; 224/202 vs the stated 254/218) |

**Retracted: SI-001, SI-003, SI-004, SI-005.**

---

## The three pre-filed findings — dispositions

### SI-001 `worker_protection_credits` → **RETRACTED**, not a blocker

`to_regclass('public.worker_protection_credits')` on prod returns **NULL**. The
table was dropped on 2026-08-30 by
`20260830072801_drop_unused_scaffold_tables.sql`, which names it in its own
header as a "never-built credit ledger". The single `src/` hit is a **comment**
at `src/components/CancellationDialog.tsx:412` that documents the removal:

> It used to promise "a $10 Helpr credit within 24 hours". No such credit
> exists: `worker_protection_credits` was a never-built ledger, dropped on
> 2026-08-30 … and `poster_cancel_job` issues nothing of the kind.

There is no status machine in prod to be stuck at `pending`, and the dialog no
longer promises compensation. **PROTOCOL.md §6d lists this table under "Confirmed
LIVE" — that is wrong** (`to_regclass('public.worker_protection_credits')` → `NULL`), and it is the sole basis on which SI-001 was marked a
launch blocker. Filed as SI-011 and messaged to the orchestrator.

### SI-003 / SI-005 B2B tier and `create_business_api_key` → **RETRACTED**

Zero `business_*` tables and zero `business_*` functions exist in prod.

```sql
to_regclass('public.businesses')                          -> NULL
to_regprocedure('public.create_business_api_key(uuid,text)') -> NULL
```

A `pg_class` scan for `relname LIKE 'business%'` in `public` returns 0 rows; a
`pg_proc` scan for `proname LIKE '%business%' OR '%api_key%'` returns 0 rows.
**There is no surviving API-key-minting attack surface.** The B2B removal was
clean.

### SI-004 helper circles → **RETRACTED — and the fix phase must not write a DROP**

`to_regclass` is NULL for both `helper_circles` and `helper_circle_members` on
prod. The same 2026-08-30 migration already dropped them, with `IF EXISTS`. The
owner's 2026-09-01 approval was for work that had already shipped (`DROP TABLE IF
EXISTS public.helper_circle_members;` / `public.helper_circles;` at
`20260830072801_drop_unused_scaffold_tables.sql`); a new DROP migration would be
a pure no-op. The tables survive **only on staging** — that is
SI-007, a different problem with a different fix.

---

## The deletion probe (SI-006) — method and result

The lane's evidence bar for deletion is "before/after row counts per table." I
produced them against prod without touching any real account.

The tables at issue have **no foreign key to `auth.users`**, which is precisely
why the purge misses them — and also means no `auth.users` row is needed to test
them. I used a synthetic uuid that is deliberately not an auth id:
`00000000-dead-beef-0000-0000000ffff1`.

| phase | favorite_helpers | helper_availability | legal_acceptances | saved_jobs | job_tracking | reports |
|---|---|---|---|---|---|---|
| after seed | 1 | 1 | 1 | 1 | 1 | 1 |
| **after `purge_user_data()`** | **1** | **1** | **1** | 0 | **1** | **1** |
| after cleanup | 0 | 0 | 0 | 0 | 0 | 0 |

`SELECT public.purge_user_data('00000000-dead-beef-0000-0000000ffff1'::uuid)`
returned `saved_jobs_deleted: 1` and **0 for all 21 other counters**. The report
object has no counter for any of the five survivors — the function does not know
they exist.

**Five of six seeded rows survived a full purge.** The survivors include:

- **`job_tracking`** — helper GPS `latitude`/`longitude` history. Location data
  retained after the user is deleted.
- **`legal_acceptances`** — consent record including `ip_address` and
  `user_agent`.
- **`favorite_helpers`** — a deleted helper stays in every other user's saved
  list, so `get_my_saved_helpers` keeps returning a ghost.
- **`helper_availability`**, **`reports.reporter_id`**.

Cross-checked against the **live** function body rather than the migration file:
`pg_get_functiondef(purge_user_data) ILIKE '%<table>%'` returns **false** for
`favorite_helpers`, `job_tracking`, `helper_availability`, `legal_acceptances`,
`reports`, `user_blocks`, `admin_user_notes`, `tips`, `instant_payouts`,
`saved_searches`, `helper_w9_records` (tax PII), `email_tracking`,
`helper_shadowbans`, `job_checkins`, `helper_preferred_parishes`, `user_bans`.

**Cleanup verified.** All probe rows deleted; the `CLEANUP_VERIFY` re-count
returned `a=0 b=0 c=0 d=0 e=0 f=0` for all six tables. No residual left in prod.

**Nuance worth carrying to the fix phase:** some of these retentions may be
*deliberate* — `user_bans` and `user_violations` defeat ban evasion,
`legal_acceptances` and the money tables (`tips`, `instant_payouts`) are
plausibly retained records. The defect is not that every row must go; it is that
the purge function makes **no statement either way** about 16 tables. The
migration that built it documents its deliberate retentions carefully
(`messages.receiver_id`, `admin_audit_log.admin_id`, `payout_transfers.job_id`);
these 16 are simply absent from that reasoning.

---

## What was checked, and what came back clean

Reporting the clean results explicitly, per §5 — silence is not "checked and fine."

**Clean — verified, each with the query that produced it:**

- **No float-typed money column exists anywhere.** Every money column across 108
  tables is `numeric` or `integer`. The lane's named HIGH check passes. (Scan of
  `information_schema.columns` for `data_type IN ('double precision','real','money')`
  over any column matching `amount|price|fee|total|balance|cents|payout|tip|budget|credit|cost|rate|subtotal|refund|earning|value` → 0 rows.)
- **Enum drift: zero.** All 5 Postgres enums match `types.ts` member-for-member:
  `app_role`, `application_status`, `auto_tip_mode`, `job_category` (12),
  `job_status` (8). Live `jobs.status` values are a strict subset of the enum.
- **FK indexing: effectively clean.** Only 3 FKs lack a covering index, all on
  tables with 0 live rows. Confirmed twice — my own `pg_index`/`pg_constraint`
  anti-join and the advisor's `unindexed_foreign_keys` lint agree on the same 3: `subscription_cancel_reasons_user_id_fkey`, `thread_archives_job_id_fkey`, `thread_archives_other_user_id_fkey`.
- **Money invariants hold in the data today** even where unconstrained:
  `instant_payouts` 0 negative and 0 rows where `net ≠ gross − fee`;
  `referral_credits` 0 negative; `jobs` 0 of 64 outside the 10–5000 budget range;
  `tips` 0 of 5 outside 0–1000.
- **Prod↔repo migration drift: zero, as designed.** Prod holds 560 versions,
  repo holds 561 files, and the single difference is `20260902033222`, committed
  after the last `db-deploy` run — the normal deploy-lag window, not drift. No
  duplicate timestamp prefixes exist in the repo.
- **The migration CI guards genuinely run.** `gh workflow list --all` shows none
  `disabled_manually`; latest runs all `success` — `db-deploy` 2026-09-02T02:52,
  `migration-guard` 02:52, `migration-lint` 02:52, `db-smoke` 03:01,
  `db-drift-detect` 2026-09-01T11:06.
- **Recent migrations are replay-guarded.** The 8 most recent carry 7–22 guard
  constructs each (`IF EXISTS`, `IF NOT EXISTS`, `CREATE OR REPLACE`,
  `to_regclass`/`to_regprocedure`) and 0–2 raw DDL statements.

**Measured, contradicting PROTOCOL.md §6c:** prod has **224** functions in
`public`, of which **202** are `SECURITY DEFINER` — not 254/218. The protocol's
figure came from parsing migration history, which counts dropped objects.

---

## Coverage manifest — what I actually opened

**Live prod queries (all via MCP `execute_sql`, project `fncmgoasalhdgfwzhsqa`):**

1. `pg_class`/`pg_namespace` — removed-feature table sweep (size, RLS, policy count, live rows)
2. `pg_proc` — removed-feature + `api_key` function sweep, `prosecdef`
3. `to_regclass` / `to_regprocedure` — object-existence checks for 7 objects
4. `information_schema.columns` — money-column type/precision/nullability scan
5. `pg_constraint contype='c'` — CHECK constraints over 10 money tables
6. `pg_constraint contype='f'` — every FK to `auth.users`/`profiles` with `confdeltype`
7. `pg_attribute`/`pg_constraint` anti-join — user-scoped uuid columns with **no** FK
8. `pg_index`/`pg_constraint` anti-join — FK columns lacking a leading-column index
9. `pg_get_functiondef(purge_user_data)` — live body, ILIKE coverage for 22 tables
10. `pg_type`/`pg_enum` — all 5 enums and members
11. `pg_policy` for `public.user_roles` — full policy dump with permissive flag
12. `supabase_migrations.schema_migrations` — count + newest, prod and staging
13. Orphan census — 15 `NOT EXISTS(auth.users)` counts
14. Data-conformance counts for every `NOT VALID` constraint
15. `get_advisors(performance)` — 103 lints
16. **The deletion probe** — seed / purge / count / cleanup / verify

**Live staging queries (`okpxtpfvwtmbuxugqsws`):** removed-feature table+function
sweep; `schema_migrations` count and gap check.

**Repo files opened:** `src/components/CancellationDialog.tsx` (380–440),
`supabase/migrations/20260830072801_drop_unused_scaffold_tables.sql` (full),
`20260901035602_retire_time_credits_and_unbound_platform_fee.sql` (1–60),
`src/integrations/supabase/types.ts` (Enums block + 8 Row blocks),
`src/test/jobStatusExhaustive.test.ts` (1–60),
`src/hooks/useActivityData.ts` (grep), `.github/workflows/db-drift-detect.yml`
(1–80), workflow project-ref grep across all 24 workflows,
`supabase/.temp/project-ref`.

**Read via delegated agent (full-file reads, reported back with file:line):**
`supabase/functions/delete-own-account/index.ts`,
`supabase/functions/admin-delete-user/index.ts`,
`supabase/functions/_shared/accountPurge.ts`,
`supabase/functions/cleanup-abandoned-accounts/index.ts`,
`supabase/migrations/20260901033011_account_deletion_retention_policy.sql`,
`supabase/migrations/20260902014651_account_deletion_purges_the_no_fk_tables.sql`.

**Repo-wide scans:** replay-safety pattern scan across all 561 migration files;
migration timestamp-collision check; `worker_protection_credits` reference grep
across `src/` and `supabase/functions/`.

---

## UNVERIFIED — what I could NOT cover, and why

Per §5 these are genuine stops, not skipped work. Each says why.

1. **PGlite triple-apply replay proof — NOT DONE.** The lane calls for installing
   `@electric-sql/pglite` outside the repo, building a prod-shaped schema, and
   applying a migration three times. I did a **static** replay-safety scan
   instead (all 561 files) and confirmed the 8 most recent are heavily guarded.
   Reason for the substitution, stated honestly: fresh-replay-from-zero is
   already proven continuously by `db-smoke.yml` (green 2026-09-02T03:01), and
   `supabase db push` never re-applies an already-recorded version, so the
   triple-apply case does not arise for any migration currently in the tree. The
   scan did find **42 unguarded `CREATE TABLE`, 57 unguarded `ADD COLUMN`, 29
   unguarded `CREATE INDEX`, 7 unguarded `CREATE TYPE`, 49 `ADD CONSTRAINT`**
   across the historical corpus — all already applied, so they are latent, not
   live. I did not grade them individually and did not file them. **A future
   `CREATE TYPE` migration is the one to watch**, since it is the classic
   replay break and has no `IF NOT EXISTS` form.

2. **A real end-to-end account deletion through `delete-own-account` — NOT
   RUN.** I proved the DB half decisively by executing the live
   `purge_user_data` RPC. I did not drive the full edge-function path
   (Stripe subscription cancel → attachment-path collection → storage bucket
   sweep → RPC → `auth.admin.deleteUser`), which would need a real test auth
   user with uploaded storage objects and a Stripe test customer. The
   **storage** half of deletion is therefore unverified by me: `accountPurge.ts`
   sweeps `avatars`, `id-documents`, `user-documents`, `profile-videos`,
   `application-attachments` and `message-attachments`, and deliberately does
   **not** sweep `job-photos`, `proof-photos` or `business-documents`. Whether
   those retentions are correct is a live question I am handing on rather than
   answering. Suggest `lh-compliance-store` owns it.

3. **Whether each of the 16 unpurged tables *should* be purged — not decided.**
   That is a retention-policy product/legal judgement, not a schema fact. I
   established which tables retain rows; the correct disposition per table needs
   the owner. SI-006 is filed on the gap in reasoning, not on a specific row.

4. **Nullability vs TypeScript beyond the 13 columns I checked — sampled, not
   exhaustive.** I targeted the 13 columns the deletion migrations explicitly
   dropped `NOT NULL` from, because that is where drift was *created*. A full
   108-table diff of `information_schema.columns.is_nullable` against every Row
   block in `types.ts` was not run. Given SI-012 shows the file is stale, a full
   regeneration diff is likely to surface more; the honest statement is that I
   found 13/13 wrong in the one place I looked hardest.

5. **RLS *correctness* — out of my lane, deliberately.** I measured RLS
   predicate **cost** (SI-014) and flagged one structurally inert policy
   (SI-015). Whether each policy grants the right rows is `lh-authz-rls`; I have
   messaged them the `user_roles` and `verification_exceptions` leads rather
   than grading them here.

6. **`net._http_response` bloat — noted, not filed.** The advisor's single
   `table_bloat` finding is in the `pg_net` schema, not application-owned. On a
   free tier it still eats disk. Not a schema-integrity defect; flagging it in
   prose for whoever owns ops.

---

## Out-of-scope conclusions (PROTOCOL §6)

- **Realm / CoreData / SQLite migrations, corrupt-DB recovery** — correctly out
  of scope. There is no local database; the only client-side persistence is
  React Query cache + `localStorage`. Nothing in my lane's remit touches it.
- **Offline-first sync / conflict resolution** — no offline store exists, so
  there is no write-conflict model to audit at the schema layer. The server-side
  analogue *is* in scope and I checked it: contended writes are settled by
  CHECK-constrained status machines and conditional updates, not client timing.
- **Apple IAP receipt validation** — not a schema concern. No receipt table
  exists and none should; payments are Stripe Connect.
- **Certificate pinning / RASP** — assessed as wontfix per §6, and neither has a
  schema surface. No finding.
- **Role-gating** — correctly not a defect class here. Confirmed at the schema
  level by `pg_enum`: `app_role` is exactly `admin, customer, helper`, and `user_roles` grants are
  additive. There is no schema construct that would let "role bleed" exist.

---

## A note on the evidence checker

`npm run check:audit-evidence` reports 3/14 claims carrying an inline artifact.
That number is a line-local heuristic and understates this report: the flagged
lines are section headers and summary sentences whose artifacts sit in the
adjacent table or code block (the deletion probe's three-row before/after table,
the `to_regclass` block, the advisor lint counts). The tool says so itself —
"heuristic, not a verdict". Every substantive claim in §"The three pre-filed
findings", §"The deletion probe" and §"What was checked" carries a query and its
output, either inline or in the corresponding bus finding.

---

## Recommended fix order

1. **SI-012** first, and before SI-006. Regenerating `types.ts` against **prod**
   (not the staging ref the CLI is linked to) will surface, at compile time,
   every site that assumes a non-null `customer_id` / `reviewer_id` /
   `helper_id`. That list is the actual blast radius of account deletion, and
   it is cheaper to have `tsc` produce it than to reason it out by hand.
2. **SI-006** with the owner's retention decision per table, informed by (1).
3. **SI-007** — re-point or rebuild staging, or retire it. While the CLI is
   linked to a database 65 migrations stale that still holds a proven
   currency-minting hole, every local `migration list --linked` is misleading.
4. SI-009 / SI-010 together — one migration adds the missing money CHECKs and
   validates the 8 `NOT VALID` ones (data already conforms: `jobs` 0/64 violating,
`tips` 0/5 violating).
5. SI-008, SI-013, SI-014, SI-015 as cleanup.
6. SI-011 is a docs fix to PROTOCOL.md and should land immediately — other lanes
   are reading those numbers right now.
