# lh-schema-integrity — lane report (2026-09-06)

## What I fixed

**Two, committed in `98a485cb3`** (the orchestrator released SI-031 to me and
granted the typecheck gate after the sweep below was written).

- **SI-031 — the admin money badge had no colour in 5 of 10 payment states.**
  `jobs_payment_status_check` admits ten values; `PAYMENT_TONE` defined five, and
  both call sites read `paymentColors[status] || ""`. So cancelled / abandoned /
  failed / chargeback / cancelling rendered an uncoloured pill on the screen an
  operator uses when money looks wrong. It hid because the *text* was always
  correct (`paymentStatusLabel` humanises anything) — only the colour map lacked
  a fallback. **There is a live example in prod: one job at
  `payment_status='abandoned'`.** Guard: `src/test/adminJobsPaymentTone.test.ts`
  parses the `ARRAY[...]` out of the migration that last defined the constraint
  and asserts coverage in both directions — it does not compare the map to a
  hand-written list, because a registry checked against itself cannot fail for a
  missing member. 13/13, and **proven to bite**: deleting one entry turns it red
  naming that status.
- **SI-034 — `types.ts` was stale by 6 deployed columns**, and that staleness was
  the only thing hiding a build break. Regenerated; fixed the one error it
  exposed (`useActivityData.ts:389`, synthetic direct-offer literal missing
  `applications.flag_reason` / `flagged_hidden`).

`npx tsc -b --noEmit` clean on both.

### Not fixed, with reasons

- **SI-032** (unindexed RLS predicates) — mine to fix; not yet released for a
  migration. Deferred, not dropped.
- **SI-033** (B2B column residue) — cosmetic; filed so the next census reads it
  as measured-and-decided rather than re-deriving it.

### UNVERIFIED — the eyeball on SI-031

I could not screenshot the admin jobs list, and this is a genuine hard stop
rather than a skipped step. Three independent guards refuse an admin grant:
`prevent_admin_role_self_grant` (service_role only),
`enforce_no_admin_for_disposable_email` (blocks `mailinator.com` **by name** —
the domain every audit account uses), and the auto-mode classifier on a
service-role script. The only two admin rows in prod are the owner's real
accounts, which the blanket testing approval explicitly excludes. Elevating the
shared `eli.test.helper` account would have changed its nav mid-sweep for other
lanes. **Routing around three deliberate guards to take a screenshot is not work
I may do**, so I stopped and am declaring the gap.

What bounds the risk: the fix introduces **no new CSS**. All five states reuse
`toneBadgeClasses` entries already rendering on that same screen (`neutral` =
unpaid, `warning` = escrow, `danger` = refunded). The change is data in a
`Record<string, Tone>`, not a style. **Asking the owner to open
`/admin?view=jobs` and confirm the `abandoned` job's badge is now a grey pill is
a ten-second check** and would close this cell.

---

## Original sweep findings

**Nothing fixed at sweep time.** All four findings are either outside my territory or report-only by
the orchestrator's own brief. Stated per PROTOCOL §8.6:

- **SI-031** (payment_status colour map) — admin surface territory. Filed + relayed.
- **SI-034** (stale `types.ts`) — the brief said *"regenerate and report (do not
  fix) every type error it exposes."* Reported.
- **SI-032** (unindexed RLS predicates) — a schema fix I own and would ship, but
  I am still in `permissionMode: plan`; not released. Deferred, not dropped.
- **SI-033** (B2B column residue) — cosmetic; filed so the next census reads it
  as measured-and-decided rather than re-deriving it.

## Verified working (each with its artifact)

| Claim | Evidence |
|---|---|
| **Zero migration drift** | repo `git ls-tree origin/main` and prod `schema_migrations` both `5a6126655e1dd3c9e32c644b10ddb67d` / **650** |
| **Replay-safe, proven by execution** | PGlite 3× consecutive apply, identical md5 across all three: `20260907051306` → `3907f8a4…` ×3 (720 rows, `ON CONFLICT DO UPDATE`), `20260907053425` → `f5081716…` ×3 |
| **No float money columns** | every money column is `numeric` or `int4` (`pg_attribute` × `pg_type`, 49 columns) |
| **Money CHECKs are real** (SI-010 re-verify) | `ck_jobs_fee_amounts_nonneg`, `ck_instant_payouts_net_is_gross_minus_fee`, `ck_applications_stake_amount_nonneg` all COALESCE/NULL-guarded correctly |
| **Account deletion purges correctly** | `purge_user_data` reaches every no-FK user column except 5 deliberate retains, each carrying its reasoning in `COMMENT ON TABLE` |
| **No residual user PII** | 479 orphan `login_history` rows, **0** with a non-null `ip_address`; `profiles.anonymized_at IS NOT NULL` = **0**, so the product's deletion path has never run — orphans are test-purge debris |
| **B2B removal complete** | 0 `business*` tables, 0 `business*` functions, `to_regprocedure('create_business_api_key')` IS NULL |
| **`job_status` is a real enum** | 8 labels in `pg_enum`, not a text CHECK |
| **db-smoke is live** | runs on main pushes via `db-deploy.yml` `needs:`; green 2026-09-06 (run 34029565124) |

## Defects (4 filed)

| id | sev | claim |
|---|---|---|
| SI-031 | MEDIUM | `jobs.payment_status` allows 10 values; admin colour map defines 5 — money badge renders with no tone in 5 states |
| SI-034 | MEDIUM | `types.ts` stale vs prod; regenerating it breaks the build (1 error, `useActivityData.ts:389`) |
| SI-032 | LOW | 8 RLS predicate columns unindexed — latent, all tables near-empty |
| SI-033 | LOW | 3 orphan B2B columns + 3 indexes; cosmetic, no attack surface |

## Retracted before filing (the point of the evidence bar)

1. **"`purge_user_data` misses 5 no-FK user columns — GDPR blocker."** All five
   are documented retains (`helper_w9_records` = ESIGN/IRS obligation, `user_bans`
   = `retain_ban_on_deletion` coupling, `tips`/`instant_payouts` = settled
   payments, `broadcast_messages.created_by` = admin-action class). Disproved by
   `obj_description()`, which the author wrote *specifically* to stop this re-filing.
2. **"479 orphan `login_history` rows leak IPs."** Every one has `ip_address IS NULL`,
   and `anonymized_at` count = 0 proves the deletion path never ran.
3. **"~20 migrations have unguarded DDL."** A `grep -o` bug — the `IF NOT EXISTS`
   filter was matching the captured substring, not the line. All guarded.
4. **"db-smoke is PR-only and dormant."** It runs on main via `db-deploy.yml`.

## Coverage

Enumerated before grading: 92 FK constraints (all `confdeltype`), 80 CHECK
constraints, 7 enums, 49 money columns, all `pg_policies` quals × `pg_index`,
44 orphan-scan (table,column) pairs, all 30 migrations in the 14-day window,
4 migration CI workflows, full `business*`/removed-feature object sweep.

**NOT covered:** PGlite 3× replay of all 30 recent migrations — I proved 2
(the two with real data semantics: a 720-row seed+backfill and a `DROP COLUMN`).
The other 28 are `CREATE OR REPLACE` function bodies or guarded DDL, verified
statically; `db-smoke` proves single-apply for the whole 650 chain. Stated as a
sampling strategy, not a silent gap.

## Out-of-scope conclusions (§6)

No Realm/CoreData/SQLite — no local DB exists; the analogue (corrupt Supabase
session token) is `lh-concurrency-cache`. No offline sync store. Role-gating is
not a defect class here (no role system; `app_role` exists but every account
both posts and does jobs).
