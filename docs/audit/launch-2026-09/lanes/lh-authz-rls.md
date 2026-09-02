# Lane report — lh-authz-rls (Authorization / RLS / IDOR / auth state machine)

**Wave:** C1 · **Phase:** SWEEP (report-only, no shipped files edited)
**Project audited:** PRODUCTION `fncmgoasalhdgfwzhsqa` for every conclusion below.
The Supabase **CLI** is linked to STAGING (`okpxtpfvwtmbuxugqsws`) — I did **not**
trust it. Every SQL query and every HTTP probe below ran against prod via the
Supabase MCP `execute_sql` with an explicit `project_id: fncmgoasalhdgfwzhsqa`,
or against `https://fncmgoasalhdgfwzhsqa.supabase.co` directly with the prod
publishable anon key. `list_projects` confirmed the two refs before I started.

Everything is verified against the **live database**, never from migration files.

---

## Completion overview

**One release-blocking authorization hole**, and the rest of the boundary is
genuinely strong.

- **AR-001 (BLOCKER):** `apply_consequence_ladder` — the shared consequence-ladder
  core — is `SECURITY DEFINER`, takes the *target* user as a parameter, and has
  **no authorization check**, yet `EXECUTE` is granted to `anon`. An
  unauthenticated caller with only the public anon key can **permanently ban any
  user by uuid** (including every admin, locking the team out of `/admin`), inject
  arbitrary `user_violations` / `user_bans` rows, and spam notifications.
  **Proven live end-to-end** and reverted. One-line fix (`REVOKE EXECUTE … FROM
  anon, authenticated`).
- **AR-002 (MEDIUM):** the server-side ban gate covers jobs/applications/messages
  but **not reviews or reports** — a banned user holding a valid JWT review-bombed
  and filed a report (both 201). Proven live.
- **AR-003 (LOW):** `approval_status='pending'` is not enforced on any write path
  (route-guard only) — a pending account posted/applied/messaged via PostgREST.
  Flagged as a **product decision**, since the app is role-less by design.
- **AR-004 / AR-005 (LOW):** the linter's one ERROR (`open_jobs_browse` definer
  view) and its 3 `search_path_mutable` WARNs — both **verified benign** and
  explained; recommend hygiene fixes for a clean linter.

**Headline numbers:** 1 HIGH/blocker · 1 MEDIUM · 3 LOW. Zero fixed (sweep phase).

**The load-bearing walls HELD under a hostile client** (all proven live, not read):
- **jobs is NOT client-writable for anything that matters.** Definitive answer to
  the standing question: RLS grants the poster/helper `UPDATE`, but **30 triggers**
  including four column-lock guards (`enforce_poster_jobs_money_lock`,
  `enforce_helper_jobs_column_whitelist`, `prevent_job_field_escalation`,
  `enforce_cancellation_requires_rpc`) block every money/fee/escrow/assignment/
  cancellation-fee write from a client. Token-swap PATCHes to budget, helper_id,
  payment_status, cancellation_fee all no-op'd.
- **IDOR: 37/37 attempts denied.** With account B's real JWT, every read and write
  of account A's profile, job, assigned-job address, message thread, payout,
  instant payout, gift card (pif_credit), referral credit, notification, push
  token, login history, W-9, disputes, reports, fraud flags — all returned 0 rows
  / 403. The only row B ever saw was B's own.
- **Self-escalation fully blocked** — `prevent_self_escalation` reverts all 40+
  privileged profile columns; every attempt persisted `OLD`.
- **Ban gate works server-side** on jobs/applications/messages (banned JWT → 403
  `account_restricted`), i.e. not merely a UI redirect.
- **Admin RPCs + edge functions reject non-admins** (`rpc_decide_dispute`,
  `admin_delete_review` → "admin only"; `admin-user-actions`, `admin-delete-user`,
  `admin-update-email`, `admin-resend-verification` → 403).
- **`create_business_api_key` does NOT exist in prod** (removed-B2B SI-005) — nor
  any `business_*` / `api_key` / `circle` / `community` RPC beyond three dead
  broadcast helpers. Nothing to file from the authz angle.

---

## Scope enumerated (before grading)

| Area | Measured (live, prod) |
|---|---|
| Public tables | **81**, every one RLS-enabled with ≥1 policy (0 RLS-off, 0 policy-less) |
| DB functions | **224** total; **202** `SECURITY DEFINER` |
| SECURITY DEFINER w/ unpinned search_path | **0** (all 202 pinned: 195 `=public`, plus `''`, `pg_temp`, `vault`, `pg_catalog`) |
| Views | 2 (`open_jobs_browse` definer/masked; `jobs_helper_safe` invoker) |
| Storage buckets | 10 (4 public: avatars/job-photos/profile-videos/social-posts; 6 private incl. id-documents, message-attachments, proof-photos) |
| Edge functions `verify_jwt=false` | ~30, each with a documented internal auth check (CRON_SECRET / HMAC / Stripe sig / `has_role`) |
| Security advisor lints | 199 (1 ERROR + 198 WARN) — see AR-004/AR-005 |

**Correction to the fleet-setup numbers:** the migration-parse said "254 functions,
218 SECURITY DEFINER." The **live** figures are **224 / 202** — the parse counted
since-dropped objects and must not be quoted as fact.

---

## Findings (all filed on the bus)

### AR-001 — BLOCKER — anon can permanently ban any user
`apply_consequence_ladder(p_user uuid, …)` is `SECURITY DEFINER`, `SET search_path
= public`, and its body has **no `has_role('admin')`, no `auth.uid()` gate, no
CRON/service-role check.** It `PERFORM set_config('app.trusted_ladder_write','on')`
to *deliberately* punch through `prevent_self_escalation`, then writes `ban_status`
(`final_warning` / `temp_banned` / `permanently_banned`), `user_bans`,
`user_violations`, and `notifications`, all keyed on the caller-supplied `p_user`.
`has_function_privilege('anon', …, 'EXECUTE') = true`.

It is an **internal core**, called only by sibling definer wrappers
(`report_helper_no_show`, the reliability ladders) — no `src/` code calls it
directly — so the default `GRANT EXECUTE TO public` at creation was simply never
revoked.

**Live PoC (reverted):** anon key only, no user session →
`{"action":"permanent","prior_count":0}`; victim `profiles.ban_status =
permanently_banned`, `user_bans` row, `user_violations` row.

**Fix:** `REVOKE EXECUTE ON FUNCTION public.apply_consequence_ladder(...) FROM anon,
authenticated;` — the nested definer callers keep access as the function owner, so
the ladder keeps working. (Same treatment warranted for any other
internal-core definer with an incidental public grant; `block_user_and_settle`
and `report_helper_no_show` return jsonb but derive the actor from `auth.uid()`
and are the legitimate user-facing block/report flows, so they are NOT part of
this finding — the trigger-returning ones can't be meaningfully RPC-invoked.)

### AR-002 — MEDIUM — banned user can still review-bomb and report
`enforce_ban_gate` triggers exist on jobs (INSERT+UPDATE), applications (INSERT),
messages (INSERT) — but **not on reviews or reports**. A user banned mid-relationship
with a still-valid JWT inserted a 1-star review on a completed job it was party to
(201) and filed a report (201), while the same token was 403'd on jobs/applications/
messages. Fix: add `enforce_ban_gate` BEFORE INSERT to `reviews` and `reports` (or
fold `is_caller_banned()` into their INSERT policies).

### AR-003 — LOW (product decision) — pending users write via PostgREST
No RLS policy or write-path function references `approval_status`; the pending→approved
gate lives only in discovery RPCs and the client `ProtectedRoute`. A pending account
(UI-redirected to `/account-pending`) POSTed a job, an application, and a message,
all 201. Likely by-design (role-less app; approval gates helper discovery/quality),
so decide intent — if 'pending' should block participation, enforce it server-side.

### AR-004 — LOW (verified benign) — `open_jobs_browse` definer view
The linter's only ERROR. Verified intentional and safe: it's the public guest browse
feed, already applies `mask_job_location()` (street → "City, LA"), withholds
lat/long/zip/parish/payment-intent/all fee columns, filters to open+funded past
`early_access_cutoff()`, and the exposed `customer_id` is inert (profiles has no anon
SELECT policy). Recommend `security_invoker=on` as defence-in-depth + clean linter.

### AR-005 — LOW (verified benign) — 3 `search_path_mutable` functions
`set_profile_view_hour_bucket`, `redact_audit_snapshot`, `profiles_locked_update_columns`
— all `SECURITY INVOKER` (not definer), so lower-risk; pin their search_path for
hygiene. This is also the proof that the 202 *definer* functions are clean.

---

## Coverage manifest (what I actually operated)

| Check | Method | Result |
|---|---|---|
| RLS enabled on all 81 tables | `pg_class`/`pg_policies` live | ✅ clean |
| jobs client-writable? | 30-trigger read + live token-swap PATCH matrix | ✅ money-safe (guards hold) |
| 202 SECURITY DEFINER search_path | `pg_proc.proconfig` live | ✅ all pinned |
| `create_business_api_key` exists? | `pg_proc` live | ✅ absent (removed) |
| IDOR read+write, 2 real JWTs | 37 live HTTP probes vs PostgREST | ✅ 37/37 denied |
| Self-escalation (profile) | 12 live PATCHes + persisted-state check | ✅ all reverted |
| Banned user writes | live, banned JWT, 8 write paths | ⚠️ AR-002 (reviews/reports) |
| Pending user writes | live, pending JWT | ⚠️ AR-003 |
| Admin RPCs / edge fns vs non-admin | live calls | ✅ rejected |
| 53 anon-callable definer RPCs | live anon probes + body reads | ⚠️ AR-001 (1 exploitable) |
| Storage bucket policies | `storage.buckets`+`objects` policies; dispute-evidence bucket | ✅ scoped (proof-photos private) |
| Security advisor (199 lints) | full extract | AR-004/AR-005; no rls_disabled / exposed_auth_users / extension_in_public |

## UNVERIFIED — could not reach, and why
- **Rate-limiting deep-drive** (apply 10/min·50/hr·200/day) — read the guards live
  in `apply_to_job` / `enforce_message_rate` / `enforce_open_job_limit` (server-side,
  present), but did not fire each ceiling to exhaustion. Owned jointly with
  `lh-trust-safety`.
- **Realtime channel authorization** (postgres_changes filters) — table RLS is the
  backstop and holds; per-channel filter correctness is `lh-concurrency-cache`'s.
- **Signed-URL TTL exposure** — dispute/proof media use 1-year signed URLs from a
  private bucket (`DisputeDialog.tsx:102`); flagged for `lh-edge-functions`, not
  re-tested here.

## Out-of-scope conclusions (§6)
- **No role-gating findings filed.** The app is role-less by design; per-record
  authorization was the whole focus and it holds (except AR-001/002).
- **Certificate pinning / RASP** — not an RLS/authz concern; deferred to
  `lh-build-release` / `lh-compliance-store`.

## Test-data hygiene
Created two prod test accounts (`helpr-authz-idor-{a,b}-1788320451@mailinator.com`,
marked `is_seed=true`) under the standing test-account authorization. All seeded
rows (jobs, messages, payouts, credits, notifications, reviews, reports, bans,
violations, push tokens) were **deleted** at the end; the AR-001 PoC ban was
reverted immediately. The two auth users remain (clearly-marked seed accounts).
