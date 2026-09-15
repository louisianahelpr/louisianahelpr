# Hole hunt — Authorization & RLS lens — 2026-09-15

Lens: authorization / RLS against the LIVE database (prod `fncmgoasalhdgfwzhsqa`).
Read-only. Live probes with the anon key only (`select … limit 1`, RPC POSTs with a
real or dead id). No writes, no sign-ups. ~28 prod requests used.

DB object source of truth: latest migration by timestamp per object, corroborated
with live anon probes where possible.

## Method

- Enumerated every table/view in `src/integrations/supabase/types.ts` (79) and every
  `SECURITY DEFINER` function / client-callable RPC / view from the migration history.
- Parsed all 403 `SECURITY DEFINER` definitions for a missing pinned `search_path`,
  then reconciled against `ALTER FUNCTION … SET search_path` migrations.
- Traced the full policy history (all CREATE/DROP POLICY) for the crown-jewel tables
  (`user_roles`, `profiles`, `notifications`, `messages`, `reviews`, `applications`,
  `disputes`, `jobs`, `job_tracking`, `job_checkins`) to the LATEST live policy.
- Probed anon read exposure live on 24 tables/views and the kept anon RPC surface
  (`open_jobs_browse`, `get_safe_profiles`, `get_open_jobs_for_map`).

## Coverage

| Area | Checked | Verdict |
|---|---|---|
| Anon table reads (profiles, jobs, disputes, messages, payout_transfers, instant_payouts, gift_cards, helper_verifications, fraud_flags, user_bans, reports, admin_audit_log, login_history, referral_codes, tips, reviews, job_tracking, helper_availability, pet_profiles, analytics_events, error_logs, saved_searches, push_tokens, applications) | LIVE probe | `jobs`/`disputes` → 401 (no anon grant). All others → 200 `[]` (RLS returns 0 rows to anon). See AUTHZ-02 on the SELECT *grant*. |
| Updatable views bypassing RLS (`security_invoker=false` + client-writable) | migration + view enum | Only `open_jobs_browse` (KNOWN, fixed 20260915041247). `jobs_helper_safe` is `security_invoker=on`, SELECT-only to authenticated — safe. `open_jobs_safe`/`public_profiles` dropped. |
| `SECURITY DEFINER` without pinned `search_path` | parsed 403 defs | The 8 unpinned-in-header ones are either dropped (time-credits, bidding, endorsements, community feed) or pinned via `ALTER FUNCTION` (20260618140000): `record_job_view`, `get_job_view_counts`, `get_fill_rate_stats`. No live unpinned definer. |
| Anon-executable RPC surface | migration allowlist + live | Deliberately locked (20260907034811 revoked 22 anon RPCs). Kept anon RPCs verified safe: `get_open_jobs_for_map` rounds coords to 2dp (~1.1km) + masks location; `get_safe_profiles` returns only public profile fields (name/avatar/bio/city/trust badges), no email/phone/exact addr/stripe. |
| Self-escalation to admin (`user_roles`) | full policy + trigger trace | Locked: INSERT requires `has_role(admin)`; `prevent_admin_role_self_grant` BEFORE INSERT/UPDATE trigger blocks `role='admin'` off service_role; UPDATE denied RESTRICTIVE (20260902053531); DELETE admin-only; no ordinary-user SELECT policy. |
| Profile privileged-column writes | grant model + triggers | No table-level UPDATE; 91-column allowlist grant; `prevent_self_escalation` + trust-column INSERT pins + IAP-anchor lock. Mature, heavily audited. |
| Notification spoofing (cross-user INSERT) | full policy trace | Closed: final state is service_role-only INSERT. The permissive `TO authenticated WITH CHECK(true)`/job-participant variants were all dropped (20260412001009→011520→180149). |
| Message sender-spoofing / thread injection | policy + wrappers | `is_party_to_job` arbitrary-uuid probe closed 20260914210443; send policy binds sender to `auth.uid()`, validates receiver, ban/block/rate gates. |
| Review forgery | latest INSERT policy | Tight: `reviewer_id=auth.uid()`, job completed+released, caller is a party, reviewee is the counterparty, no active dispute, ≤30d. |
| Application / rival-bid privacy | all SELECT policies | Helper sees only own; job owner sees their job's; admin all. No rival-bid leak. Writes self-scoped + column-lock trigger. |
| Helper-location IDOR (`get_helper_distances_from_job`) | latest def | Ownership-gated (`j.customer_id=auth.uid()`), returns distance BANDS only. Safe. |
| Job-scoped write policies verify assignment (`job_tracking`, `job_checkins`) | policy + client read path | **GAP — AUTHZ-01 / AUTHZ-03.** |

## Findings (most severe first)

---

### AUTHZ-01 — `job_tracking` writes don't verify the caller is the job's assigned helper (live-location spoof)
- **Severity:** MEDIUM
- **Status:** PLAUSIBLE (policy + client read path verified in code and live-read; the mutating insert was not run — no sign-ups / authed session available under prod rules)
- **Where:** RLS policies on `public.job_tracking`, `supabase/migrations/20260311041556_63c5df41-4bf2-4ddf-ab6c-ca49309551cb.sql:20-21` (never tightened since — confirmed no later policy migration, no BEFORE INSERT trigger). Read path: `src/hooks/useActivityData.ts:524-529` (`fetchTracking`, order `created_at desc`, keep latest per job_id, no helper filter) and `src/components/JobTracking.tsx:638-655` (`loadTracking`, `order created_at desc limit 1`).
- **Repro:** who: any authenticated user (call them M). what:
  1. M records an open job's `id` from `open_jobs_browse` (anon-readable; exposes `id` + `customer_id`). The job is later assigned to a real helper H and tracking begins.
  2. M sends `POST /rest/v1/job_tracking` with `{ job_id: <that job>, helper_id: <M's own id>, status: 'on_the_way', latitude: <fake>, longitude: <fake>, eta_minutes: <fake> }`. The INSERT policy `WITH CHECK (auth.uid() = helper_id)` passes — it never checks that M is the job's `helper_id`. There is no `UNIQUE(job_id[,helper_id])`, so M's row co-exists with H's, and its `created_at` is newest.
  - bad result: the poster's tracking card / map reads the LATEST row for that `job_id` (no assigned-helper filter) and renders M's spoofed status, coordinates and ETA — the poster is shown a false real-time location and arrival time for their helper.
- **Impact:** One user can feed false live-location + ETA + status into another user's active job — directly undermining the on-the-way / arrival safety feature (poster believes the helper is at/near a location or minutes away when they are not). No money movement or account takeover; bounded by needing the target `job_id` (trivially discoverable for any job while it was open). M can only add/override with M's own row; M cannot alter H's row (UPDATE `USING auth.uid()=helper_id`).
- **Fix direction:** Bind the write to job membership, not just self-identity. Replace the INSERT/UPDATE `WITH CHECK` with one that also requires the caller to be the job's assigned (or offered/roster) helper, e.g. `EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_tracking.job_id AND j.helper_id = auth.uid())` — the same membership shape the legit `helper_mark_on_the_way_atomic` RPC already enforces (it checks `helper_confirmed_at` etc.). Consider a `UNIQUE(job_id, helper_id)` and driving all writes through the SECURITY DEFINER RPC. Keep the read path robust by filtering rendered rows to the job's assigned helper.
- **Class-check:** a guard that fails on ANY RLS policy on a table with a `job_id` column whose INSERT/UPDATE `WITH CHECK` references `auth.uid()` only through the row's own actor column (`helper_id`/`user_id`) without a `jobs`-membership `EXISTS` for that `job_id`. Built from the live catalog (`pg_policy` join `pg_attribute` for `job_id`), shown red on `job_tracking` today, self-test on a fixture policy. Catches AUTHZ-03 and any future job-scoped table added with the same shape.

---

### AUTHZ-02 — `anon` holds table-level `SELECT` on admin / money / trust tables (RLS is the only gate)
- **Severity:** LOW (defense-in-depth; no live exposure today)
- **Status:** PROVEN (live: 200, not 401, = privilege present)
- **Where:** live anon `GET /rest/v1/<t>?select=id&limit=1` returned HTTP 200 `[]` (privilege granted, RLS filtered) — not 401 — for at least: `admin_audit_log`, `fraud_flags`, `user_bans`, `payout_transfers`, `instant_payouts`, `reports`, `login_history`, `helper_verifications`, `gift_cards`, `referral_codes`, `tips`, `push_tokens`, `error_logs`, `analytics_events`. Contrast `jobs`/`disputes` → 401 (`permission denied for table`), which have had the anon grant properly removed.
- **Repro:** who: anon → what: `GET /rest/v1/admin_audit_log?select=*&limit=1` → result: HTTP 200 with `[]` (RLS returns 0 rows). The point is the *privilege* exists: these tables are protected by their RLS policy alone. A single future policy regression (a `USING(true)`, a `TO public` SELECT added for one column, a `security_invoker=false` view over one of them) becomes full anonymous exposure of moderation, fraud, payout and login data — exactly the failure mode the `open_jobs_browse` incident (KNOWN) was.
- **Impact:** No data exposed today. Removes the second line of defence on the highest-sensitivity tables in the schema. These tables have no legitimate anon read path (admin-only, service-only, or self-only surfaces).
- **Fix direction:** `REVOKE SELECT ON public.<t> FROM PUBLIC, anon;` for every admin/service/self-only table (name `anon` explicitly — `FROM PUBLIC` alone leaves Supabase's explicit `anon=r`, per the house rule). Reserve anon SELECT for the handful of genuinely public tables/views. Consider revoking the public default-privilege write/read grant so table recreations can't silently re-open the grant (the same follow-up already noted for `open_jobs_browse` in `docs/OPEN.md`).
- **Class-check:** extend `scripts/check-updatable-views.mjs`'s catalog approach to also fail on ANY table in an exposed schema that (a) carries an `anon`/`PUBLIC` `SELECT` privilege AND (b) is on an admin/service/self allowlist-negative list, checked in `db-drift-detect.yml`. Shown red on the tables above; self-test proves it fails.

---

### AUTHZ-03 — `job_checkins` INSERT allows a non-party to inject check-in rows (latent; table currently unconsumed)
- **Severity:** LOW
- **Status:** PLAUSIBLE (policy verified; impact currently nil because the app neither writes nor reads the table)
- **Where:** `public.job_checkins` INSERT policy `supabase/migrations/20260311040450_eeaba6d0-7675-4890-89d3-33b3c715fa59.sql:98-100` — `WITH CHECK (auth.uid() = user_id)`, with a party-scoped SELECT (job's customer/helper/admin). No assignment check.
- **Repro:** who: any authenticated user → what: `POST /rest/v1/job_checkins {job_id: <any>, user_id: <self>, type, latitude, longitude, note}` → the row is accepted and is then visible to the job's real customer and helper (SELECT keys off the *viewer's* relationship to `job_id`, not the row's `user_id`). Same shape as AUTHZ-01. Impact today is nil: per `src/hooks/useActivityData.ts:138-140` and `src/lib/arrivalGate.ts:8`, "nothing in this app has ever inserted a `job_checkins` row" and the read fallbacks were removed — the table has zero rows and no rendering surface.
- **Impact:** No live impact while the table is unconsumed. It is a pre-wired spoofing surface: if any future feature starts reading `job_checkins`, non-party injection (fake GPS/notes into another user's job timeline) ships with it.
- **Fix direction:** either drop the dead table (it is a candidate for the `drop_proven_dead_objects` line of work), or apply the AUTHZ-01 membership fix to its INSERT/UPDATE policy before any consumer is added.
- **Class-check:** covered by the AUTHZ-01 class-check (job-scoped write policy without a `jobs`-membership `EXISTS`), which flags `job_checkins` today.

## Notes (not findings)

- `get_recent_public_payouts` is effectively uncallable via PostgREST right now:
  `POST /rpc/get_recent_public_payouts {"p_limit":1}` → `PGRST202` (param name mismatch;
  the arg is positional `int`, no `p_limit`). Documented as dead/uncalled public-ticker
  code in 20260907034811 — informational, not a security issue.
- Anon `open_jobs_browse` read confirmed: exposes `customer_id` (by design, for guest
  job cards → `get_safe_profiles`) and a city/state-masked `location`; no exact address
  or precise coordinates. Correct.
