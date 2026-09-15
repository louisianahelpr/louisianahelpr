# Hole hunt 2026-09-15 — LENS: authz-rls

The database's access boundary: RLS, grants, views, SECURITY DEFINER functions,
triggers, storage buckets and policies.

Method: replayed all 708 files in `supabase/migrations` in timestamp order into a
live-object model (latest definition wins), then verified the interesting parts
against **prod** (`fncmgoasalhdgfwzhsqa`) with the anon key only, and reproduced
two findings in real Postgres (PGlite) on the prod-shaped fixture
`scripts/probes/fixtures/dispute-table-door.live.sql` (generated read-only from
live prod 2026-09-14: every `jobs` column, its policies and grants verbatim, and
verbatim bodies of the lock triggers).

**27 prod requests** (10 PostgREST anon, 10 unauthenticated storage, 7 PostgREST
anon). Every write probe targeted `00000000-0000-4000-8000-00000000dead`, a UUID
that cannot exist, or was an insert that could not form a row. **Nothing on prod
was created, changed or deleted.** No sign-ups. Stripe was not called.

---

## 1. Coverage

### Inventory from source (replay of 708 migrations)

| Object | Live by replay | Checked |
| --- | --- | --- |
| Tables (`public`) | 76 | RLS-enabled flag on all 76; policies read on all; per-command/USING-vs-WITH-CHECK read on the money, job, profile, storage and trust tables |
| Views | 4 by replay; **2 actually on prod** | all 4 probed live |
| Functions | 264 | ACL replayed for all 264; bodies read for the 30 that are SECURITY DEFINER *and* take a caller-supplied id, plus every vault/secret and money/lifecycle function |
| Triggers | ~106, of which 13 on `public.jobs` | all `jobs` triggers read in full; `profiles` escalation guard read in full |
| Policies | 140 recovered by the parser (under-count — see gaps) | all 140 read; the 6 with no uid/role/owner reference examined individually |
| Storage buckets | 11 | 10 probed live for their `public` flag; policies read for all |
| Realtime publication | 8 tables | membership listed; `profiles` confirmed removed (20260423164103) |

### Checked live against prod

- **Views.** `public_profiles` and `open_jobs_safe` return `PGRST205` — they are
  **not on prod** (dropped; `public_profiles` by 20260312230251). Only
  `open_jobs_browse` and `jobs_helper_safe` exist. `jobs_helper_safe` is proven
  `security_invoker = on` live: an anon SELECT through it fails with *permission
  denied for table jobs*, i.e. it runs with the caller's rights.
- **`open_jobs_browse` write revoke is live and working.** `PATCH
  /rest/v1/open_jobs_browse?id=eq.<dead>` → `401 42501 permission denied for view
  open_jobs_browse`. The 20260915041247 fix (docs/OPEN.md) is deployed. Guest
  read still works (`GET …?select=id&limit=1` → `200`), so the fix did not cost
  the guest-browse feature.
- **Storage bucket `public` flags**, unauthenticated, via the
  `/object/public/<bucket>/<path-that-cannot-exist>` oracle (a public bucket
  answers `NoSuchKey`, a private one `NoSuchBucket`):
  - **PUBLIC:** `job-photos`, `avatars`, `profile-videos`, `marketing-media`
  - **PRIVATE:** `proof-photos`, `application-attachments`, `user-documents`,
    `message-attachments`, `id-documents`, `business-documents`
- **`public.jobs` anon posture.** anon has no SELECT (`GET` → 42501 with the
  *Grant SELECT* hint) but does hold INSERT: `POST /rest/v1/jobs` got past the
  table grant and died inside the RLS expression (`permission denied for function
  are_users_blocked`). See H-004.
- Reachability of `evacuation_pets`, `skill_endorsements`, `helper_skills`,
  `community_post_likes`, `partner_applications`, `reject_pending_job` — all
  `PGRST205`/`PGRST202`: **not on prod**. Their unscoped policies in the
  migrations (`WITH CHECK (true)` on `partner_applications`, `USING (true)` on
  the three read tables) are dead text, not live holes. Reported here only so the
  next lane does not re-chase them.

### Verified clean (looked, found nothing to report)

- `public.profiles` — exactly one live SELECT policy, `auth.uid() = user_id`.
  Other users' data only via `get_safe_profiles`. `prevent_self_escalation`
  (20260914192035) pins `approval_status`, `ban_status`, `stripe_account_id`,
  every `idv_*`, `background_check_status`, `subscription_*`,
  `onboarding_fee_paid`, `email_verified` to OLD for any non-admin write. No
  self-verification path.
- `public.get_service_role_key()` / `get_supabase_url()` — SECURITY DEFINER over
  `vault.decrypted_secrets`, but `REVOKE ALL … FROM PUBLIC, anon, authenticated`
  (20260506150000:33-34) and never re-created since, so the ACL was never reset.
- `get_helper_earnings_export`, `respond_to_review`, `reject_pending_job` — all
  three carry a real `auth.uid()` party/ownership check despite being
  anon-EXECUTE-able; anon's NULL uid fails them.
- `user_roles`, `payout_transfers`, `instant_payouts`, `referral_credits`,
  `helper_credentials`, `applications` — every live policy is uid- or
  `has_role(admin)`-scoped. The UPDATE policies without `WITH CHECK` are not
  holes: Postgres applies the USING expression to the new row too, so none of
  them lets a row be moved to another owner.
- No live table has RLS disabled.

### Gaps — where this lens did NOT look, or could not

1. **Live function ACLs were not enumerated.** With only the anon key there is no
   read of `pg_proc.proacl`. The replay says up to 132 of 264 functions are
   anon/PUBLIC-executable, but that is an **upper bound and provably loose** —
   `are_users_blocked` is anon=Y in the replay and anon=N on prod. Treat that
   number as "needs a catalog read", not as a finding.
2. **The policy parser under-counts.** Its statement-boundary heuristic drops
   policies whose `CREATE POLICY` is followed by trailing text on the same line;
   several known-live storage policies (job-photos SELECT, avatars,
   message-attachments, proof-photos 20260831171658) are missing from the 140.
   So this report makes **no "there is no policy for X" claims** — every finding
   below rests on text that exists, not on text that is absent.
3. **No authenticated session.** Everything requiring a real user JWT (IDOR by
   token swap, cross-party reads, the helper/poster write paths in H-001/H-002)
   was reproduced in PGlite on the prod-shaped fixture rather than over HTTP.
4. Not covered by this lens: edge-function authorization (lh-edge-functions),
   Stripe-side authorization, and the branches listed as already-known.

---

## 2. Findings

### H-001 · HIGH · PROVEN — An assigned Helpr picks the *value* of `helper_completed_at`, so they can make a funded job instantly due for auto-release and delete the poster's entire 24-hour review window

**Where**

- `supabase/migrations/20260312010219_98c01e15-61a4-42b1-b482-6a592567cd6b.sql:3`
  — `"Helpers can update their assigned jobs"`, `USING/WITH CHECK (auth.uid() =
  helper_id)`, all columns.
- `supabase/migrations/20260703161000_helper_jobs_column_whitelist.sql:37` —
  `helper_completed_at` is on the helper's allowed-column list.
- `supabase/migrations/20260824235000_helper_completion_gates.sql:36-50,58` — the
  completion gate fires `BEFORE UPDATE OF helper_completed_at` and checks *that*
  photos exist and *that* 30 minutes have passed. It never constrains the value
  written. No trigger anywhere clamps a lifecycle stamp to `now()`.
- `supabase/functions/auto-release-payment/index.ts:86,104-124` — `cutoff =
  now - 24h`; a job is due when `status IN ('in_progress','revision_requested',
  'accepted') AND payment_status='escrow' AND revision_requested_at IS NULL AND
  (poster_completed_at <= cutoff OR helper_completed_at <= cutoff)`.

**Repro** — the assigned Helpr on a funded (`payment_status='escrow'`) job, doing
the real work: arrive, wait the 30 minutes, upload before and after photos. Then,
instead of the app's Done button (which writes `now()`), send the write directly:

```
PATCH /rest/v1/jobs?id=eq.<job>   Authorization: <helper JWT>
{ "helper_completed_at": "<now minus 25 hours>" }
```

Every guard passes — the row has both photo arrays, arrival was over 30 minutes
ago, and `helper_completed_at` is a whitelisted column. The row now satisfies the
due predicate on the spot, and `auto-release-payment` (expected every ~3h,
20260901030926:128) captures and pays on its next run.

**Proof** — reproduced in real Postgres on the prod-shaped fixture, with
`20260824235000` and `20260915033734` additionally applied verbatim so the helper
faced *more* guards than prod, not fewer. Both controls fired first, so the probe
can fail:

```
ok  CONTROL: helper cannot set jobs.budget  (Helpers may not modify jobs.budget)
ok  CONTROL: completion gate fires without after-photos (completion_requires_proof_photos)
ok  helper's BACKDATED helper_completed_at is accepted            <- the hole
ok  the job is IMMEDIATELY due for auto-release (matched rows: 1)
    stored helper_completed_at age: 1 day 01:00:00
```

**Impact** — the 24 hours in which the poster reviews the work, asks for a
revision or opens a dispute is the poster's only protection, and it is erased by
one field the Helpr controls. Worse, it is one-way: once auto-release flips the
job to `completed`, `open_dispute_as` refuses with `job_already_completed`
(`20260915025607:135`), so the poster cannot dispute afterwards either. Escrow
uses **immediate capture** (`supabase/functions/create-payment/index.ts:123`), so
the poster's card is already charged — the money moves to the Helpr and there is
no in-app route back. One user takes another user's money early; HIGH.

**Fix direction** — lifecycle stamps are server time, not client input. In
`enforce_helper_completion_gates` (and the equivalent poster path), overwrite
rather than validate: `NEW.helper_completed_at := now()` whenever a
helper-initiated write sets it from NULL, and refuse any change once it is set.
The same applies to `helper_on_the_way_at`, `helper_arrived_at`,
`helper_confirmed_at` — all client-written, all feeding time-based sweeps, none
clamped. (`enforce_jobs_insert_column_lock`, `20260904031217:117`, already NULLs
these on INSERT; this is the missing UPDATE half.)

**Class check** — *no client-written timestamp column on `jobs` may carry a value
the server did not stamp.* Enumerate `jobs`' `*_at` columns from the live catalog,
subtract the ones only service_role can write, and for each remaining one assert
in a PGlite probe on the live shape that a party write of `now() - interval '25
hours'` is either refused or silently replaced with `now()`. Inventory-driven, so
a new lifecycle column joins the check automatically. Shown red on this finding
before the fix.

---

### H-002 · HIGH · PROVEN — A poster can strand a funded job's escrow permanently with one direct PATCH: `status = 'completed'` removes it from every auto-release sweep and simultaneously shuts the dispute door

**Where**

- `supabase/migrations/20260828020000_cancellation_requires_rpc.sql:532,558` —
  `enforce_job_status_transition` allows `in_progress -> completed` and does not
  look at *who* is making the transition (only admins are given a bypass).
- `supabase/migrations/20260905215201_allow_no_show_rpc_to_unassign_helper.sql:52,61`
  — `enforce_poster_jobs_money_lock`'s `locked_always` and `locked_when_funded`
  lists. `status` is on neither, so a poster's write of it is unconstrained.
- `supabase/migrations/20260915033734_dispute_markers_server_owned.sql:135-137` —
  the newest jobs guard covers `status` only when `'disputed'` is one of the two
  sides. `in_progress -> completed` is untouched.
- `supabase/functions/auto-release-payment/index.ts:104,141,218,502` — all four
  candidate queries require `status` to be `in_progress`/`revision_requested`/
  `accepted` with `payment_status='escrow'`, or `completed` with
  `payment_status='payout_pending'`.
- `supabase/migrations/20260915025607_block_disputes_on_completed_jobs.sql:135` —
  `IF NOT _system AND _status = 'completed' THEN RAISE 'job_already_completed'`.

**Repro** — poster, on their own funded job the Helpr is working:

```
PATCH /rest/v1/jobs?id=eq.<job>   Authorization: <poster JWT>
{ "status": "completed" }
```

`payment_status` stays `escrow` (the money lock correctly refuses to let the
poster touch it). The job now matches **none** of the four auto-release
candidate sets, so no sweep will ever settle it. The Helpr's only escape,
`rpc_open_dispute`, now raises `job_already_completed`.

**Proof** — same PGlite harness, prod-shaped fixture, both controls firing first:

```
ok  CONTROL: poster cannot set payment_status (Posters may not modify jobs.payment_status)
ok  CONTROL: in_progress -> pending_approval refused (Invalid job status transition)
ok  poster's direct PATCH status in_progress -> completed accepted     <- the hole
ok  row is now status=completed, payment_status=escrow (escrow stranded)
ok  matches no auto-release sweep: main=false instant=false revision=false payout=false
```

**Impact** — the Helpr does the work and is never paid; the poster does not get
the money back either (it was captured at checkout), so it sits on the platform
balance indefinitely. The Helpr cannot dispute, because the guard that makes
"done is final" true for posters also makes it true for this forgery. Recovery
needs a human admin noticing — `detect_stuck_payments` alerts ops, which is a
smoke alarm, not a lock. One user denies another user their earned money; HIGH.

**Fix direction** — `status` is a lifecycle field owned by the RPCs, exactly like
the dispute markers were before 20260915033734. Add `status` to the poster money
lock (refuse any poster-initiated `status` change on a funded job that is not
already covered by a sanctioned-RPC transaction flag, the way
`enforce_cancellation_requires_rpc` and `app.trusted_ladder_write` already do),
and make `enforce_job_status_transition` actor-aware rather than actor-blind: the
matrix should encode *who* may make each transition, not just which pairs exist.

**Class check** — *every `jobs` status transition in the matrix names the actors
allowed to make it, and a direct client PATCH that is not one of them is
refused.* Build the case list from the matrix itself (source of truth, so a new
row cannot slip in unguarded) and, in a PGlite probe on the live shape, drive
each `(from, to)` pair as poster, as helper and as a stranger, asserting the
refusal for every combination the matrix does not sanction. Shown red on
`in_progress -> completed` as poster before the fix.

---

### H-003 · MEDIUM · PROVEN (exposure) — `job-photos` is a public bucket with no size cap and no MIME allow-list, and its INSERT policy lets any signed-in user write to `job-photos/<their-own-uid>/…`

**Where**

- `supabase/migrations/20260311000404_f8e7eb29-742a-409a-a3a3-a493232415e6.sql:220`
  — created as `(id, name, public) VALUES ('job-photos','job-photos', true)`: no
  `file_size_limit`, no `allowed_mime_types`. No later migration adds either.
- `supabase/migrations/20260419032937_0545c72d-dca1-4907-9074-bef737965015.sql:2`
  set it private ("Lock down sensitive storage buckets"); eight days later
  `supabase/migrations/20260427011417_04c72f50-f865-4caf-9c18-e47eb37d7339.sql:2`
  set it back to `public = true` to make old `/object/public/` URLs resolve, and
  it has stayed public since.
- `supabase/migrations/20260429194624_181aa95d-8739-42c7-88e5-6d0b2332f6f1.sql:27`
  — the INSERT policy's first branch is `(storage.foldername(name))[1] =
  auth.uid()::text`, with no job relationship required. Its comment still calls
  this "Avatar uploads", but avatars moved to their own bucket on 2026-05-05.
- `supabase/migrations/20260426223249_41d60220-6a43-4141-bac7-3333bd7bb803.sql`
  — the UPDATE and DELETE policies match only `j.id::text =
  (storage.foldername(name))[1]`, i.e. a *job* id, so objects written under the
  `<uid>/…` branch cannot be removed by the person who uploaded them.

**Repro** — (a) exposure, proven unauthenticated: `GET
https://<project>.supabase.co/storage/v1/object/public/job-photos/<path>` returns
the object with no key and no session — the probe got `NoSuchKey` for a
non-existent path, which is the public-bucket answer, while `proof-photos`,
`application-attachments`, `user-documents`, `message-attachments`,
`id-documents` and `business-documents` all answered `NoSuchBucket`. Every
authenticated-only SELECT policy on `job-photos` is therefore decorative for
reads. (b) write door: any approved account uploads any file, of any type and
any size, to `job-photos/<own uid>/anything`, and it is then world-readable at a
`supabase.co` URL belonging to Louisiana Helpr — and not deletable by its
uploader.

**Impact** — an unbounded, permanent, publicly-served file host inside prod,
usable for phishing pages or malware attributable to the app's own domain, and
for storage/egress cost on a free-tier project that has already been knocked over
once by usage limits (docs/OPEN.md, Vercel 2026-09-14). The asymmetry is the
tell: `avatars` is capped at 5 MB and four image types, `profile-videos` at 30 MB
and three video types — `job-photos`, the one with an uid-scoped open write
branch, is capped at nothing.

**Fix direction** — set `file_size_limit` and `allowed_mime_types` on
`job-photos` to match `avatars`; delete the stale `[1] = auth.uid()::text` branch
from the INSERT policy (or scope it to `<uid>/reviews/…`, the only caller left —
`src/components/reviewPanel/ReviewForm.tsx:144`); give the uploader a matching
DELETE branch. Decide deliberately whether the bucket stays public, and if it
does, delete the SELECT policies that pretend otherwise so the next reader is not
misled.

**Class check** — *every public bucket declares a `file_size_limit` and an
`allowed_mime_types`, and no bucket carries a client-reachable INSERT policy
branch that is not scoped to a path the app actually writes.* Read
`storage.buckets` and the `storage.objects` policies from the live catalog (not
migration text — a bucket's `public` flag has already been flipped back and forth
three times here), cross-check each bucket's policy branches against the upload
paths grepped from `src/`, and fail on any public bucket with a null limit. Wire
it into `db-drift-detect.yml` beside `check-updatable-views.mjs`; shown red on
`job-photos` before the fix.

---

### H-004 · MEDIUM · PROVEN — anon holds INSERT/UPDATE/DELETE/REFERENCES on `public.jobs`, and the jobs lock triggers all step aside for `auth.uid() IS NULL`

**Where**

- `scripts/probes/fixtures/dispute-table-door.live.sql:211` — read from live prod
  2026-09-14: `GRANT UPDATE, INSERT, REFERENCES, DELETE ON public.jobs TO anon;`
  (note the absent SELECT).
- `supabase/migrations/20260907034811_lock_anon_rpc_surface_and_restore_guest_browse.sql:377-392`
  — §4 revoked exactly these grants from nine tables ("client write grants that
  RLS already denies outright"). `jobs` is not on the list.
- Every jobs lock trigger opens with `IF auth.uid() IS NULL … RETURN NEW` —
  `enforce_helper_jobs_column_whitelist` (20260703161000:79),
  `enforce_poster_jobs_money_lock` (20260905215201), `prevent_job_field_escalation`,
  `enforce_jobs_insert_column_lock` (20260904031217:82). That branch exists for
  service_role, but **anon's uid is NULL too**, so for an anonymous writer the
  whole lock ladder is a no-op and RLS is the only remaining layer.

**Repro** — `POST /rest/v1/jobs` with the anon key returned `401 42501 permission
denied for **function** are_users_blocked`. Read that carefully: the table grant
let the request in, and it died inside the RLS `WITH CHECK` expression at
expression-initialisation time — on a missing function EXECUTE grant, not on the
`auth.uid() = customer_id` test the policy was written to enforce. (This is the
same `init_fcache()` trap that 20260907034811 §1 documented when it took guest
browse down.) No row was created.

**Impact** — not exploitable today: the INSERT policy would also have failed on
`auth.uid() = customer_id`, and an anon UPDATE/DELETE cannot express a PostgREST
filter without SELECT. But this is the precise shape that produced the CRITICAL
`open_jobs_browse` hole closed hours ago — an excess grant on the highest-value
table, with the trigger ladder disarmed for the caller, held shut by one policy
whose evaluation order is load-bearing. The margin is a single future `GRANT
EXECUTE … TO anon`, or one new permissive policy, wide.

**Fix direction** — `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON
public.jobs FROM anon`, verified afterwards by `has_table_privilege`, not by the
migration landing. Separately, make the trigger ladder's service-role hatch
explicit — test `current_user`/`auth.role() = 'service_role'` rather than `uid IS
NULL`, so "no session" stops meaning "trusted".

**Class check** — *no client role holds a write grant on a table where no
policy grants that command to that role.* Read `role_table_grants` and
`pg_policies` from the live catalog, join them, and fail on any
(role, table, command) with a grant and no matching policy — the same
catalog-driven shape as `check-updatable-views.mjs`, covering the table half of
the class that check covers for views. `jobs` is the offender it goes red on
today; prod's default privileges mean any future `CREATE TABLE` re-opens it, so
a one-off REVOKE cannot replace the check.

---

### H-005 · LOW · PLAUSIBLE — the function half of the "default privileges re-open a recreated object" class has no live guard

**Where** — `scripts/check-updatable-views.mjs` (added 2026-09-15) reads the live
catalog and fails on any exposed-schema view that is owner-run and
client-writable, precisely because a `DROP`+`CREATE` silently restores prod's
default grants. The identical mechanism applies to functions: `CREATE OR REPLACE
FUNCTION` preserves the ACL, but a `DROP FUNCTION` followed by `CREATE FUNCTION`
resets it, and Postgres grants `EXECUTE` to `PUBLIC` by default while Supabase's
`ALTER DEFAULT PRIVILEGES` adds anon and authenticated explicitly. There is no
equivalent live check.

**Repro** — the ACL replay over all 708 migrations finds two functions that were
revoked and later re-created without a following revoke: `get_open_jobs_for_map`
and `reject_pending_job`. Both are benign on inspection (the first is
deliberately granted to anon; the second is not on prod at all — `PGRST202`).
That is the honest result: **this finding is the missing guard, not an open
function today.** It is filed because the same class has already cost this repo
one CRITICAL (`open_jobs_browse`) and one manual clean-up of 22 anon-executable
functions (20260907034811 §2), and because the live ACL could not be enumerated
from this lens's anon-key-only budget — so nobody has actually looked since
2026-09-07.

**Impact** — a money or lifecycle RPC could be silently re-opened to anon by an
ordinary `DROP`+`CREATE` in a future migration, with nothing red anywhere.

**Fix direction** — extend the existing live-catalog check, or add a sibling, to
read `pg_proc.proacl` for every function in `public` and fail on `EXECUTE` held
by `PUBLIC` or `anon` unless the function is on an explicit allow-list checked
into the repo (the guest-browse RPCs). An allow-list makes each anon-executable
function a deliberate, reviewed decision instead of a default.

**Class check** — that check *is* the class check. Prove it can fail by pointing
it at a synthetic `DROP`+`CREATE`d function, the way `check-updatable-views.mjs`
proves itself with `--self-test`.

---

## 3. Probe log (27 prod requests, all zero-effect)

| # | Request | Result |
| --- | --- | --- |
| 1-4 | `GET` evacuation_pets / skill_endorsements / helper_skills / community_post_likes | `PGRST205` — not on prod |
| 5-7 | `GET` / `PATCH` / `DELETE` public_profiles | `PGRST205` — not on prod |
| 8 | `PATCH open_jobs_browse?id=eq.<dead>` | `401 42501 permission denied for view` — 20260915041247 confirmed live |
| 9 | `PATCH jobs?id=eq.<dead>` | `401 42501 permission denied for table jobs` |
| 10 | `POST partner_applications {}` | `PGRST205` — not on prod |
| 11-20 | `GET /storage/v1/object/public/<bucket>/<nonexistent>` × 10, no auth | public: job-photos, avatars, profile-videos, marketing-media; private: the other six |
| 21 | `POST jobs` (anon, `return=minimal`, customer_id=`<dead>`) | `401 42501 permission denied for function are_users_blocked` — H-004 |
| 22 | `GET jobs?select=id&limit=1` | `401 42501` — anon has no SELECT |
| 23 | `GET open_jobs_safe?select=id&limit=1` | `PGRST205` — not on prod |
| 24 | `GET jobs_helper_safe?select=id&limit=1` | `401 42501 permission denied for table jobs` — proves `security_invoker = on` |
| 25 | `PATCH jobs_helper_safe?id=eq.<dead>` | `401 42501 permission denied for view` |
| 26 | `POST rpc/reject_pending_job {p_job_id:<dead>}` | `PGRST202` — not on prod |
| 27 | `GET open_jobs_browse?select=id&limit=1` | `200` — guest browse healthy |
