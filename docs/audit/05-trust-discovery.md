# Deep Pass 05 — Trust, Safety, Moderation, Discovery & Location Privacy (Phases 5–6)

Companion to `docs/PRE_LAUNCH_AUDIT.md`. Every finding cites `file:line`.
Read-only pass on the working tree at branch
`chore/lint-cleanup-and-guest-empty-copy`. Method: direct reads of RPC/view
migration bodies, trigger functions, dialog wiring, and feed/filter state.

**Headline verdict: trust & safety posture is a ship strength — with ONE
latent location-privacy leak to close before launch.**
Trust-signal integrity and off-platform fraud control are enforced
server-side, and the *primary* browse path masks location correctly. But two
**legacy, anon-granted** read paths (`open_jobs_safe` view +
`get_ranked_open_jobs` RPC) bypass the mask and expose the raw `location`
column — into which the live post flow writes the **full street address**.
Verified live in prod (MCP `execute_sql`, read-only). Not yet *realized* in
current data (the 21 live open jobs are "City, ST ZIP" with no street), so
it's a latent leak, not an active breach — but it is anon-reachable today and
the next street-address post lands PII on an anonymous surface. → **🟠 High
F-DISC-01.** Fix is trivial (DROP the two unused objects, or REVOKE anon +
wrap in `mask_job_location`).

---

## A. Verified-clean / strengths (checked, found sound)

| Area | What was checked | Result |
|---|---|---|
| **Location privacy — public map** | `get_open_jobs_for_map()` RPC body (`migrations/20260608120000_coarsen_open_jobs_map_precision.sql:33-45`) | **GREEN.** Coords rounded to 2 decimals (`ROUND(j.latitude,2)` ≈ 1.1 km grid) before they ever leave the DB. Exact `jobs.latitude/longitude` stay RLS-protected. The earlier 3-decimal version (`20260506204833_get_open_jobs_for_map_rpc.sql:38`) was deliberately coarsened further. Anon-granted but bounded, rounded, no PII. |
| **Location privacy — primary browse feed** | live feed queries the **masked** `open_jobs_browse` view (`useDashboardData.ts:206`, comment `:175,208`) | GREEN. The view runs `mask_job_location(location)` → "City, ST" for everyone except the directly-offered helper, and exposes **no** latitude/longitude (`:208`). This is the path the app actually uses. |
| **Location privacy — coordinates everywhere** | `get_ranked_open_jobs` RETURNS list (`20260506020000_…parish.sql:14`); `open_jobs_safe` view; `open_jobs_browse` view | GREEN. **No** RPC/view in the open-jobs surface returns `latitude`/`longitude`; the only coords path is the map RPC, which is coarsened. Exact lat/lng never leaves the RLS-protected `jobs` row. (The prompt's 🔴 bar — "exact lat/lng leaks to anon" — is NOT tripped.) |
| **Address reveal gating** | `open_jobs_browse` view + `mask_job_location()` (`migrations/20260426123151_*.sql:1-51`) | **GREEN.** Street is masked to `"City, State"` for everyone **except** `offered_to_helper_id = auth.uid()` (`:49-50`). Exact doorstep is revealed only to the directly-offered/accepted helper. |
| **Trust signals — server-sourced** | `useDashboardData.ts:251,271-296` | **GREEN, not client-spoofable.** `is_id_verified` comes from the `get_safe_profiles` RPC (`:251,289`); `applicant_count` from the `open_jobs_browse` view (`:271-296`). The client only renders these — it never computes or trusts a client-supplied value. |
| **Off-platform scan — server enforced** | `scan_message_content()` trigger (`migrations/20260510033612_scan_message_offplatform_phrases.sql:24-60`) | **GREEN, defense-in-depth.** DB trigger flags phone/email/payment-app/off-platform phrasing, sets `flagged_hidden := true` (hides from recipient), logs to `fraud_flags`, and **auto-suspends after 2 flags in 24 h**. Client `messageScanner.ts` is only a pre-send UX warning; the server is the real gate. |
| **Report / Block / Dispute — reachable & wired** | `ReportDialog.tsx:90-91`, `BlockUserDialog.tsx:16`, `DisputeDialog.tsx:85-96` | GREEN. Report inserts a `reports` row (with a friendly case # from the UUID). Block calls `blockUser()` (`@/lib/userBlocks`). Dispute prefers `rpc_open_dispute` with an explicit PGRST202 graceful fallback (honors the "migrations don't auto-deploy" house rule). All three are imported into live screens (UserProfile, Activity, Messages, Dashboard, PostJob). |
| **Discovery states** | `BrowseTasksFeed.tsx:273-280,357-371` | GREEN. `<EmptyState>` with **geo-aware copy** ("widen radius" vs "no jobs match filters"), `<JobCardSkeleton>`/`RecommendedJobCardSkeleton` loading, and an error-state guard. Empty feed offers a cross-tab flip affordance. |
| **Filter persistence** | `useDashboardFilters.ts:8-29` | GREEN. Browse sort key persisted to `localStorage` with a try/catch for Safari private-mode throw — survives reload without crashing. |
| **Map clustering / denied-location** | `BrowseMap.tsx:16,78-100,172` | GREEN. `MarkerClusterGroup` (react-leaflet-cluster) with a custom branded cluster bubble; per-bucket color capping so one hot ZIP doesn't dominate. |
| **Parish fallback** | `get_ranked_open_jobs()` viewer_parishes CTE | GREEN. Falls back to `profiles.parish` when `helper_preferred_parishes` is empty, so new helpers (the common case) still get a +500 location ranking signal. |

---

## B. Findings (with severity)

### 🟠 F-DISC-01 — Legacy anon-granted paths expose the UNMASKED `location` (full street address), bypassing `mask_job_location`
The location-privacy model is enforced by `mask_job_location()`
(`migrations/20260426123151_*.sql:1-19`), applied in the **primary** browse
view `open_jobs_browse` (the only path the live app queries —
`useDashboardData.ts:206`). But **two older objects still exist in prod and
still expose the raw `location` column**, granted to `anon`:

- `open_jobs_safe` **view** — `CREATE OR REPLACE VIEW … SELECT … location …`
  (`migrations/20260403180249_*.sql:56-66`), `GRANT SELECT … TO anon` (`:69`).
  No `mask_job_location`.
- `get_ranked_open_jobs` **RPC** — returns `location text` raw
  (`migrations/20260506020000_…parish.sql:14,40`), `GRANT EXECUTE … TO anon`.
  No `mask_job_location`. (It correctly returns no coords — but the *text*
  address is unmasked.)

The live post flow writes the **full street address** into `jobs.location`:
`buildJobInsertPayload()` →
`location: \`${streetAddress.trim()}, ${city.trim()}, ${addrState.trim()} ${zipCode.trim()}\``
(`src/pages/postjob/jobSubmitHelpers.ts:156`; `buildJobInsertPayload` is the
live insert builder, called from `usePostJobForm.ts:689`). So any open job
posted with a street address is readable, unmasked, by a logged-out client via
`GET /rest/v1/open_jobs_safe?select=location` or
`POST /rest/v1/rpc/get_ranked_open_jobs`.

**Verified live (prod, read-only MCP `execute_sql`):** both objects exist,
neither references `mask_job_location`, both expose `location`; `open_jobs_safe`
is `SELECT`-granted to `anon` + `authenticated`. Current data does **not** yet
contain street addresses — all 21 live open jobs are "City, ST ZIP" (2
comma-parts, no leading street number) — so this is a **latent** leak, not an
active breach. But the write path is live and the surface is anon-reachable
today; the next full-address post realizes it.

**Why it matters:** the whole point of `mask_job_location` + coarsened map pins
is that "a stranger can't tell which house." A second, unmasked, anon-readable
projection of the same column quietly defeats that — and it's invisible in the
UI, so it won't be caught by manual QA.

**Fix (pre-launch, trivial):** the app uses neither object (only a code comment
at `App.tsx:173` and auto-generated FK metadata in `types.ts` reference them).
Either **`DROP VIEW public.open_jobs_safe` + `DROP FUNCTION
public.get_ranked_open_jobs(integer,integer)`**, or if you want to keep them,
`REVOKE … FROM anon, authenticated` and wrap their `location` projection in
`public.mask_job_location(location)` (matching `open_jobs_browse`). Add a
regression test asserting no anon-readable open-jobs surface returns a street
number.

### 🟢 F-DISC-02 — Over-broad default grants on `open_jobs_safe`
`open_jobs_safe` carries `INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER`
grants for **both** `anon` and `authenticated` (verified in prod via
`information_schema.role_table_grants`) — the default `GRANT ALL` Supabase
applies, never tightened. The view isn't auto-updatable (multi-predicate
`WHERE`), so these are likely inert, but they're untidy attack surface. **Fix:**
folded into F-DISC-01's DROP; if kept, `REVOKE ALL` then `GRANT SELECT` only.

### 🟡 F-TRUST-01 — Dual message-scan regex must be kept in sync by hand
The off-platform scanner exists in **two places**: client `src/lib/messageScanner.ts:2-5` and server `scan_message_content()` (`migrations/20260510033612_*.sql:31-44`). The migration's own header documents a *past* drift incident — the client caught phrases (`text me`, `whatsapp`, `dm me`, `send money to`…) the server initially missed, so users could ignore the client warning and send them without a `fraud_flag`. That specific gap was hotfixed, but the **two copies remain independent** with no shared source of truth. **Why it matters:** the server copy is the real enforcement; any future edit to one regex silently weakens or diverges from the other. **Fix:** add a test asserting the two pattern sets stay equivalent, or generate both from one shared list. Not a launch blocker — server currently covers the client set.

### 🟢 F-TRUST-02 — Contact regexes miss spelled-out evasion
Both client (`messageScanner.ts:2`) and server (`scan_message_content():31`) phone patterns match only digit forms. Spelled-out numbers ("five oh four…") and unicode-digit homoglyphs slip past. **Why it matters:** a determined off-platform actor evades the digit regex; the auto-suspend never trips. **Fix:** low priority — add a spelled-number heuristic if abuse data shows it. The fraud_flags + manual report path still backstops.

### 🟢 F-TRUST-03 — Auto-suspend threshold is fixed (2 flags / 24 h)
`scan_message_content()` auto-suspends after `v_recent_flag_count >= 2` in a rolling 24 h. Reasonable, but hard-coded — a single false-positive pair (e.g. a helper legitimately quoting "$50 cash" twice) could suspend a good user. **Why it matters:** false-positive suspension is a worse first-impression than a missed flag. **Fix:** confirm `cash only / in cash` (server-only token, `:43`) isn't over-firing on legitimate price talk; consider a softer first-strike (warn) before suspend. Low.

---

## C. Coverage notes / not-yet-traced

- **Runtime journeys** (actually submitting a report, hitting the 2-flag
  suspend, accepting a job and watching the street un-mask) are **static-read
  only** here — they belong to the Phase 3 Playwright/Vitest pass.
- **JIT verify gates** (`JitVerifySheet.tsx`, `IDVPromptDialog.tsx`) are
  present and imported but their trigger conditions (first-apply vs
  first-payout) weren't traced line-by-line in this pass.
- **`user_blocks` filtering of the feed**: `useDashboardData.ts:79-80` reads
  `user_blocks` — confirmed the block list is fetched, but whether blocked
  posters are filtered out of *every* discovery surface (map RPC included)
  wasn't exhaustively traced. The public map RPC has no viewer context, so
  blocked-poster jobs would still appear as anonymized pins — likely
  acceptable (no identity shown) but worth a confirm.

---

## D. Summary

**Location privacy:** coordinates are safe everywhere — the map RPC coarsens
lat/lng to ~1.1 km (`coarsen_open_jobs_map_precision.sql:33-45`) and no
open-jobs view/RPC returns raw coords. The **primary** feed masks the address
via `open_jobs_browse` + `mask_job_location` → "City, ST"
(`useDashboardData.ts:206`). **But** two legacy anon-granted paths,
`open_jobs_safe` (view) and `get_ranked_open_jobs` (RPC), expose the *unmasked*
`location` — into which the live post flow writes the full street address
(`jobSubmitHelpers.ts:156`). Verified live in prod; currently unrealized (the 21
live jobs are "City, ST ZIP", no street) so it's a **latent 🟠 High leak**, not
an active breach. Trivial pre-launch fix: DROP the two unused objects (or revoke
anon + mask).

**Report / Block / Dispute:** all reachable and wired (UserProfile, Messages,
Activity, ReviewPanel, Dashboard); Dispute has a PGRST202 fallback. ✅

**Worst trust-signal spoofability:** none — `is_id_verified` and
`applicant_count` are server-sourced (`get_safe_profiles` RPC + `open_jobs_browse`
view); the client only renders them. ✅

**Discovery empty states:** solid — geo-aware empty copy, skeleton loaders,
error guard, persisted sort, cross-tab flip affordance. No gaps.
