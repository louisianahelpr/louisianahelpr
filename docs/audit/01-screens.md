# Deep Pass 01 — Screens, UX & Code Quality (Phases 1–3, 5–13)

Companion to `docs/PRE_LAUNCH_AUDIT.md`. Every finding cites `file:line`.
Verification method: direct reads + targeted scans on the working tree at
branch `chore/lint-cleanup-and-guest-empty-copy`. Gates green (typecheck 0,
lint 0, build 0).

---

## A. Verified-clean (claims that looked like risks but aren't)

These were checked and found sound — recorded so the final report doesn't
re-flag them and so a future pass doesn't re-investigate.

| Area | What was checked | Result |
|---|---|---|
| Account-state pages | `AccountBanned.tsx`, `AccountDenied.tsx`, `AccountPending.tsx` | Clean — semantic HSL tokens throughout, correct shell (`AuthShell` for banned/denied, `AppShell` for pending), redirect gates read shared `useCurrentUser` so they can't drift from app-wide ban/approval state |
| XSS — raw-HTML injection prop | `Index.tsx:179,183,187`; `PricingTiers.tsx:174` | Safe — Index injects static JSON-LD SEO schema via `JSON.stringify`; PricingTiers renders developer-authored strings from the static `TIERS` array (`PricingTiers.tsx:10`). No user input reaches either prop. |
| Auth-trace logging | `ProtectedRoute.tsx:105`, `useCurrentUser.ts:127`, `useAuthReady.ts:21`, `Jobs.tsx:151` | Clean — every site is gated behind `if (!DEBUG_AUTH) return;` / `if (DEBUG_AUTH)`. Disciplined flag-gated tracing, not production noise. |
| Supabase error-drop | `const { data } = await supabase…` pattern | 0 hits — the CLAUDE.md gotcha is being honored. |
| Raw error leakage to JSX | error objects rendered into user-facing copy | 0 hits. |
| Token discipline | arbitrary Tailwind color classes / legacy hex | 0 arbitrary color classes; the 48 raw hex literals are all legitimate (BrowseMap pin colors, BusinessReports PDF, OAuth brand buttons, confetti). |

---

## B. Findings (with severity)

### 🟡 F-SCR-01 — Two orphaned page files (dead code)
`src/pages/LocalPricingGuide.tsx` and `src/pages/VerifyHelper.tsx` have **0
references** anywhere in `src/` (not routed in `src/App.tsx`, not imported).
*(Note: `Community.tsx` (17 refs) and `JobHistory.tsx` (3 refs) were
initially suspected dead but are live — do not remove.)*
**Fix:** delete the two orphans, or wire them into a route if intended.

### 🟡 F-SCR-02 — Leaflet still ships despite Apple MapKit roadmap decision
Leaflet is imported in 7 modules: `BrowseMap.tsx`, `TrackingMap.tsx`,
`JobMapView.tsx`, `BrowseTasksFeed.tsx`, `BrowseTasksToolbar.tsx`,
`DashboardGuest.tsx` (+ `BrowseMap.test.tsx`). The roadmap decision
(2026-06-09) was to move to Apple MapKit. Leaflet adds ~153 kB to the chunk
budget (see exec-summary chunk table). This is a **roadmap gap, not a release
blocker** — the maps work today.
**Fix:** track as a post-launch migration; not gating this build.

### 🟡 F-SCR-03 — `:any` annotations (151 occurrences) erode type safety
151 `: any` annotations across pages/components weaken the TS guarantees the
stack is supposed to provide. Not a blocker; each is a small latent-bug
surface.
**Fix:** burn down opportunistically; prioritize any in money/payment and
auth paths first.

### 🟢 F-SCR-04 — Direct `supabase.from()` in 76 files — spot-check, not a blanket violation
The house rule is React Query + `unwrap()` for error safety. 76 files call
`supabase.from()` directly. **Most are legitimate** — inside React Query
`queryFn`s or hooks where that's exactly correct. The risk is only the subset
that call it in component bodies bypassing caching/error handling.
**Fix:** spot-check the non-hook callers; no broad refactor warranted.

### 🟢 F-SCR-05 — `env(safe-area-inset-*)` hand-rolled in several pages
Multiple pages set `paddingTop: "env(safe-area-inset-top, 0px)"` inline
(e.g. `AccountPending.tsx:205`) rather than going through `AppShell`'s inset
handling. This is **sanctioned** where the page owns a custom header outside
the standard shell (AccountPending documents exactly this at lines 199–202),
but worth a consistency pass to ensure none duplicate an inset `AppShell`
already applies (double-padding risk).
**Fix:** audit each inline `env(safe-area` against its shell; collapse any
that double up.

---

## C. Per-screen scorecard (account-state cluster)

Scale 1–5 (5 = ship-ready). Dimensions: Visual, Copy, States, A11y, Native-feel, Code.

| Screen | File | Visual | Copy | States | A11y | Native | Code | Notes |
|---|---|---|---|---|---|---|---|---|
| Account Banned | `AccountBanned.tsx` | 5 | 5 | 5 | 4 | 5 | 5 | Eyebrow tracks actual ban state (perm/temp/review); appeal mailto pre-filled |
| Account Denied | `AccountDenied.tsx` | 5 | 5 | 4 | 4 | 5 | 5 | Re-apply + appeal paths; denial_reason kept out of URL on purpose |
| Account Pending | `AccountPending.tsx` | 5 | 5 | 5 | 4 | 5 | 5 | Email-unverified vs verification-center variants; realtime + 15s poll; skeleton |

A11y scored 4 (not 5): icon-only status glyphs rely on adjacent text; verify
the decorative `Ban`/`XCircle`/`Clock` icons carry `aria-hidden` and the
status is announced as text (AccountPending's banner icon at line 326 already
has `aria-hidden`).

---

## C2. Per-screen scorecard (auth-entry cluster)

| Screen | File | Visual | Copy | States | A11y | Native | Code | Notes |
|---|---|---|---|---|---|---|---|---|
| Login | `Login.tsx` | 5 | 5 | 5 | 5 | 5 | 5 | Persisted anti-bruteforce soft-lockout (`:27-34`, survives force-quit); 15s timeout race (`:71-83`); post-login email-verification gate (`:158-164`); `friendlyAuthError` (no raw leakage); full native input attrs (`inputMode`/`autoCapitalize`/`enterKeyHint`); 44px password-toggle (`:300`); Terms/Privacy links (`:363-368`) |

**Store-readiness note:** Login is the first screen App Store review hits.
It carries Terms + Privacy links, email-verification enforcement, and rate
limiting — all review-positive. The greeting fetch at `Login.tsx:179` uses
`const { data: prof } = await supabase…` (the error-drop shape) but is
deliberately `try`/`catch`-wrapped with a generic-copy fallback for a
non-critical personalization — acceptable, reinforces F-SCR-04's nuance.

## D. Still-open in this pass (not yet read line-by-line)
Captured here so the final report's coverage table is honest about depth:
- Core-journey screens (Login, Signup, CompleteProfile, Dashboard, PostJob,
  Activity, PaymentSuccess, Profile, Messages, UserProfile, DashboardGuest)
  — inventoried (P-IDs in main report) but not all line-audited this pass.
- Persona parity (Phase 2) and end-to-end journeys (Phase 3) including
  Playwright e2e — pending.
- Phases 5–13 specialized passes — pending.
