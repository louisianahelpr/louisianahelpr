# lh-account-lifecycle — launch audit, sweep phase

**Worktree:** `~/.lh-audit/lh-account-lifecycle` @ `origin/main` `b170609a`
**Live target:** prod `fncmgoasalhdgfwzhsqa`, read-only except one cleaned-up synthetic probe (below)
**Findings:** AL-001 … AL-012 · 2 launch blockers · **what I fixed: nothing yet — I am in plan mode and the orchestrator has not released me. Fix plan sent to `team-lead`.**

---

## 1. What I fixed

**Nothing.** Not a scope decision — the harness blocks `src/`, `supabase/` and `ios/`
edits during the sweep, and PROTOCOL §1 holds a fix plan until `VERDICT.md` exists.
The plan is with the orchestrator; priority order is AL-001, AL-009, AL-012/AL-010,
AL-003. AL-002 and AL-011 are other lanes' territory and I will not touch them.
AL-004 and AL-008 need an owner decision, not a patch.

---

## 2. Headline

Deletion in this app is **much** better built than the lane brief implied. The
`_shared/accountPurge.ts` module, the transactional `purge_user_data()` RPC and the
`findActiveWork` guard are careful, well-reasoned work with the failure history
written into the comments. Three things I expected to find were already fixed, each
read at `file:line` in the worktree: storage purging **recurses**
(`_shared/accountPurge.ts:363` `listAllObjects`, with an explicit throw at `:398`
rather than a silent truncation at the 1000-object page cap); message attachments are
collected **before** the rows that name them are deleted
(`_shared/accountPurge.ts:539` `collectMessageAttachments`, ordered ahead of the
purge at `:640-644`), with an out-of-scope-path check at `:598` that stops account
deletion being used to destroy another party's dispute evidence; and the Stripe
cancel is a **hard gate**, not best-effort (`:645` `stripeOk`, consumed by the
refusal condition at `:659`).

What is still open is the **blast radius**, which is exactly the thing the lane exists
for. Two blockers:

- **AL-001** — `purge_user_data` covers 23 tables and misses 11 more, four carrying
  literal PII. Proven, not inferred: I seeded a synthetic user into each and ran the
  real production RPC. **11 of 11 survived.**
- **AL-004** — a **banned** user cannot delete their account in-app at all, and the
  deletion endpoint has no ban check, so the same gap is simultaneously an Apple
  5.1.1(v) compliance failure and a ban-evasion route.

And one question the brief asked that has a clean answer: **there is no stranded
escrow, and no path to it.** `findActiveWork` refuses deletion while the user is party
to a live job *or* holds money. Live prod: zero jobs with `customer_id IS NULL` and
`payment_status IN ('escrow','payout_pending')`.

---

## 3. Findings

| id | sev | blocker | surface |
|---|---|---|---|
| AL-001 | HIGH | ✅ | `purge_user_data()` — 11 no-FK pairs survive deletion, 4 with literal PII |
| AL-002 | HIGH | | `/admin?view=payouts` — whole ledger 400s when any helper deletes |
| AL-003 | MEDIUM | | `/admin?view=people` — one deleted reviewer blanks every name on the panel |
| AL-004 | HIGH | ✅ | banned user has no in-app deletion + endpoint has no ban check |
| AL-005 | HIGH | | direct offer to a deleted helper strands the job permanently (latent, 0 today) |
| AL-006 | MEDIUM | | `anonymized_at` is written by the purge and read by nothing |
| AL-007 | MEDIUM | | dispute lockout — `opener_id` NULL makes the row un-updatable by RLS |
| AL-008 | MEDIUM | | **RW-005 resolved** — the approval gate does not gate; the copy claims a review that never happens |
| AL-009 | MEDIUM | | 4 dead Message links / dead Review action, each with a guarded sibling |
| AL-010 | LOW | | `'[removed at account deletion]'` is user-visible copy |
| AL-011 | MEDIUM | | cron notification inserts on ownerless jobs retry forever / silently drop |
| AL-012 | LOW | | 16 fallback strings for one state; gift card reads "from A"; raw UUID as a name |

Full claim / repro / evidence for each is in `findings.jsonl` — not restated here.

---

## 4. The AL-001 probe, in full (the method matters)

The previous census (`20260902014651`) was built empirically: delete one test account,
see what survives. Its own comment concedes the flaw — *"blind by construction to any
table the test account happened to hold no rows in."* So I inverted it: **seed first,
then purge.**

```
synthetic ids: deadbeef-0000-4000-8000-0000000000a1 / ...b2
               (deliberately NOT auth.users rows — these tables have no FK,
                so no auth row is needed and no real user is touched)

1. INSERT 1 row each into 10 tables (11 pairs)
2. SELECT public.purge_user_data('deadbeef-…a1')     ← the REAL production RPC
3. re-count                                          → survived = 1 for ALL ELEVEN
4. DELETE every probe row; verify 0 residual; confirm
   pre-existing totals unchanged (19 before, 19 after)
```

Surviving content, read back verbatim **after** a "successful" deletion:

| table | column | what survived |
|---|---|---|
| `helper_w9_records` | `helper_id` | `AUDIT PROBE Jane Q Helper / ip=203.0.113.7` — a **W-9 legal signature + signing IP** |
| `email_tracking` | `user_id` | `203.0.113.7 / AUDIT PROBE UA` — IP + user-agent, the same PII class as `login_history`, which *is* purged |
| `saved_searches` | `user_id` | `123 Elm St` — a street address in `location_keyword` |
| `admin_user_notes` | `user_id` | `AUDIT PROBE note about this person` — free-text staff notes |
| `user_bans` | `user_id` | row survives keyed to a dead uuid → see AL-004 |
| `user_violations` | `user_id` | strike history, unattachable |
| `helper_shadowbans` | `helper_id` | " |
| `user_blocks` | `blocker_id`, `blocked_id` | both directions |
| `helper_preferred_parishes` | `helper_id` | " |
| `instant_payouts` | `helper_id` | money row with no `helper_redacted_at` analogue |

`tips.helper_id` and `job_checkins.user_id` are the same shape and I did **not**
seed them — both require a real `job_id` (FK to `jobs`) and I was not willing to
attach probe rows to a real job. Evidence for those two is live but weaker:
no FK (`pg_constraint`) + absent from `pg_get_functiondef(purge_user_data)`.
Stated as a gap, not folded into the proven count.

---

## 5. Coverage manifest

### Verified — with the artifact

| cell | method | artifact |
|---|---|---|
| Every FK to `auth.users` and its `ON DELETE` action | live SQL | `pg_constraint` — 61 constraints enumerated; 20 `SET NULL`, the rest CASCADE |
| Every user-shaped uuid column with **no** FK | live SQL | 39 columns / 35 tables |
| Which of those the live purge actually handles | live SQL | `pg_get_functiondef(purge_user_data)` diffed against the census → 25 pairs unhandled |
| **Do unhandled rows actually survive a real deletion** | **live seed + real RPC + cleanup** | **11/11 survived; 0 residual after cleanup** |
| Current orphan census in prod | live SQL | only `admin_audit_log.admin_id` (126 rows, deliberate) and `reports.reported_id` (2, deliberate) |
| SI-006's five original tables | live SQL | all five now present in the live function body (steps 4i–4k) |
| `in.(uuid,null)` really 400s | **live HTTP** | `HTTP 400 {"code":"22P02"}` vs `HTTP 200 []` control |
| `get_safe_profiles` filters anonymised rows? | live SQL | **false** |
| `open_jobs_browse` excludes ownerless jobs | live SQL | `pg_get_viewdef` contains `customer_id IS NOT NULL` ✅ |
| Direct-offer predicate is live | live SQL | `pg_get_viewdef` contains `offered_to_helper_id` ✅ |
| `disputes` UPDATE RLS policy | live SQL | `USING (auth.uid() = opener_id AND status='open')` |
| Stranded escrow on ownerless jobs | live SQL | **zero rows** |
| Stranded direct offers today | live SQL | `dead_target=0, pending_no_expiry=0, any_offer=1` |
| `approval_status` default vs reality | live SQL | default `'pending'`; 36 approved / 3 pending; every confirmed customer approved |
| The three auto-approval triggers | live SQL | bodies + `pg_trigger tgenabled='O'` for all three |
| Deletion path source | file read | `_shared/accountPurge.ts` (705 ln), `delete-own-account`, `admin-delete-user`, `cleanup-abandoned-accounts` |
| Every `src/` surface rendering an anonymised record | source sweep (fan-out agent) + spot re-read of all 8 claimed defects at `file:line` | every line I filed I opened myself |
| Account-state screens + `ProtectedRoute` gate order | source read | route props in `App.tsx:164-179`, gate order `ProtectedRoute.tsx:180-345` |

### UNVERIFIED — and why

| cell | why |
|---|---|
| **The four account-state screens rendered** (`/signup-pending`, `/account-pending` ×2 variants, `/account-denied`, `/account-banned`) at 375/1440, web + WKWebView | Verified **statically only** — route props, gate order, redirect conditions, copy strings. I did not render them: plan mode blocks a dev server and I judged an approval round mid-sweep worse value than finishing the DB work. This is a real gap; I offered the orchestrator to drive all four if a preview server is approved. |
| An **end-to-end** two-account deletion (post → apply → delete → screenshot each surface before/after) | Same reason. The DB half is proven far more precisely by the seed-and-purge probe than a single walkthrough would have managed; the *rendering* half is the part this would have added. |
| `tips.helper_id`, `job_checkins.user_id` leak | Not seeded — both need a real `job_id`, and I would not attach probe rows to a real job. Evidence is no-FK + absent-from-function, not a survival test. |
| Storage purge (`IDENTITY_BUCKETS`, recursion, the 1000-object page cap) | Read closely; not exercised. Needs a real account with nested uploads. `lh-compliance-store` may already own this. |
| Stripe subscription cancel on delete | Read; not driven. Test-mode only per standing constraints, and no test subscription existed. |
| Whether a deleted user's email genuinely frees for re-signup | Inferred from `auth.admin.deleteUser` semantics + `profiles` CASCADE, **not** driven. |
| Native/WKWebView behaviour of any of the above | Out of reach this pass. |

---

## 6. Out-of-scope conclusions (PROTOCOL §6)

- **Realm / CoreData / offline sync / IAP receipts / RASP / cert pinning** — none apply;
  no local store, payments are Stripe Connect. Filed nothing.
- **Role-gating** — correctly *not* a defect here, and it turned out to be
  load-bearing in the opposite direction: because `handle_new_user` gives **every**
  account the `'customer'` role, the `has_role(…,'customer')` test inside
  `sync_email_verified` is always true and its "helpers keep their status" branch is
  dead code. That is AL-008. The absence of a role system is the *mechanism* of the
  finding, not an excuse to skip it.
- **`worker_protection_credits`** — did not touch it; PROTOCOL records it as dropped
  and my own no-FK census over live prod does not list it, which independently agrees.

---

## 7. What a future pass should not re-derive

- SI-006's five named tables are **fixed**. Do not re-file them.
- `open_jobs_browse`, `get_ranked_open_jobs`, `get_open_jobs_for_map` and
  `get_public_open_jobs` **all** exclude ownerless jobs. Verified live. Do not re-file.
- The escrow-strand hypothesis is **false** — `findActiveWork` blocks it. Verified live.
- `admin_audit_log.admin_id` orphans (126 rows) are **deliberate** and documented.
  So are `reports.reported_id` orphans. Not findings.
