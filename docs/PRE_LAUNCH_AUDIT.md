# Louisiana Helpr — Pre-Release Full-App Audit

_Generated: 2026-06-21 · Branch: `chore/lint-cleanup-and-guest-empty-copy` · Static review of the real shipping tree (`src/` + `supabase/`) + Supabase prod introspection (object existence)._

---

## Executive Summary

**Readiness verdict: 🟢 CONDITIONAL GO**

The shipping tree is in strong launch shape. All four gates are green, the money/escrow path is idempotent and fails closed, location coordinates do not leak to anon, the Stripe webhook verifies signatures and fails closed, no service-role key or server secret is present in the client bundle, and the full trust-&-safety surface (Report / Block / Dispute + admin queues + account deletion) is reachable and wired. No 🔴 Blockers were found.

The "conditional" is for a small set of 🟡 items — chiefly user-visible **"Coming soon" / placeholder content** that an App-Store reviewer can hit, plus one **coverage gap** (the 184 KB `get_advisors` security-lint output was captured but not fully read this pass). Clear the placeholders (or gate them behind a flag) before cutting the build and the verdict moves to GO.

### Top risks (priority order)
1. **App-Store guideline 2.1 / 4.2 — placeholder & "Coming soon" UI** reachable in the shipped app (multi-account switch, Google Play badge, demo-video stub, a benefits CTA). Reviewers reject visible dead-ends.
2. **Unread security-advisor output** — `get_advisors(security)` returned 184 KB and was not fully parsed; could hide a real RLS/`search_path` finding. Must be read before build.
3. **Posts badge is not live for foreign applicants** (by design — `applications` has no `customer_id` to filter on); a poster won't see a new applicant's badge until next nav/mount. UX nit, not a defect, but worth a known-limitation note.

---

## Gate status

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npm run typecheck` | ✅ exit 0 |
| Lint | `npm run lint` | ✅ exit 0, **0 warnings** |
| Build | `npm run build` | ✅ exit 0 |
| Unit tests (not in CI) | `npx vitest run` | ✅ **1155 passed / 118 skipped** |
| E2E (required CI gate) | Playwright | ✅ Required gate on `main` (2 Playwright + 2 CodeQL); runs Chromium vs. mocked Supabase — see coverage note |

**Largest uncompressed JS chunks:** jspdf 399.30 kB · CartesianChart 260.54 kB · supabase 201.62 kB · html2canvas 199.57 kB · posthog 196.25 kB. (jspdf + html2canvas are PDF-export only — already lazy/route-split; acceptable.)

---

## Phase 0 — Screen inventory

Authoritative source: `src/App.tsx` (444 lines, ~60 routes). Persona tags: G=guest, C/H=any authed account (app is **never role-based** — every account can post AND do jobs), B=business surface, A=admin, S=account-state.

### Public (guest-reachable, document-scroll or marketing shell)
`/` Landing (G) · `/login` (G) · `/signup` (G) · `/jobs` & `/browse` guest job feed (G) · `/legal` (G) · `/parishes` + `/parish/:slug` (G) · `/impact` (G) · `/discharge` (G) · `/insurance-claim` (G) · `/for-business` (G) · `/how-it-works` (G) · `/help` (G) · `/enterprise` (G) · `/become-a-partner` (G) · `/evacuation` (G) · `/data-rights` (G).

### Protected (ProtectedRoute — Big-7 profile gate)
`/dashboard` (allowPending, fixed-shell PageScaffold) · `/profile` (allowUnapproved, AppShell) · `/post-job` (3-step + Currency) · `/my-jobs` + `/my-posts` → Activity (allowPending) · `/messages` (allowPending) · `/payment-success` · `/user/:userId` public profile · `/subscription` · `/family` · `/analytics` · `/pay-it-forward` · `/business/*` (BusinessLayout) · account-state screens (Pending / Denied / Banned via redirects).

### Admin
`/admin` = `ProtectedRoute › AdminRoute › Admin` (client gate → server `has_role` + RLS is the real enforcement).

### Redirect-only / stubs
Numerous `<Navigate>` legacy aliases (e.g. `/my-jobs`↔`/my-posts`, old marketing paths) — all resolve to live routes; **no unreachable routed page found.** Placeholder *content within* live pages is tracked as F-SCR-01.

---

## Findings (severity-grouped)

### 🔴 Blocker
_None._

### 🟠 High
_None._

### 🟡 Medium

**F-SCR-01 — User-visible "Coming soon" / placeholder content (App-Store gate).**
Reachable placeholder UI in the shipped app:
- `src/components/MobileNav.tsx:355` — multi-account switch "Coming soon".
- `src/components/landing/HeroSection.tsx:366` — Google Play badge (Android not shipping; dead link/badge).
- `src/components/landing/DemoVideoSection.tsx:130` — demo-video stub.
- `src/pages/BenefitsPage.tsx:184` — benefits CTA placeholder.
**Fix:** remove, hide behind a feature flag, or replace with real content before cutting the build. Apple guideline 2.1 (placeholder) / 4.2 (minimum functionality) reject on visible dead-ends. The Google Play badge specifically should be removed for an iOS submission.

**F-RT-01 — Posts badge not live for foreign applicants (known limitation, by design).**
`src/hooks/useActivityBadgeCounts.ts:108-150` — the three realtime channels are correctly user-scoped (`helper_id=eq`, `customer_id=eq`, `offered_to_helper_id=eq`) with a `channelNonce()`. But because `applications` has no `customer_id` column, a stranger's INSERT on a job I own won't push a live badge; it re-reads on nav/mount instead. Documented in-code as deliberate.
**Fix (optional):** none required for launch; if live posts-badges become a requirement, add a `customer_id` (or a poster-scoped view) to filter on. Logged so it isn't mistaken for a regression.

### 🟢 Low / hardening

**F-RT-02 — Admin realtime channels intentionally unfiltered.**
`src/pages/Admin.tsx:343-349` — `jobs`/`profiles`/`reports` watched platform-wide (no per-user filter), debounced 500 ms, nonce present. This is correct: the admin dashboard's purpose is platform-wide reflection, and the route is server-gated by `has_role` + RLS. **No action** — recorded to show the unfiltered-channel scan was triaged, not missed.

---

## Phase-by-phase results

- **Phase 1 — Gates & build:** ✅ all green (table above).
- **Phase 2 — Persona parity:** ✅ No accidental role-gating. `ProtectedRoute` gates on profile completeness + account state, not role. Account-state screens (Pending / Denied / Banned) redirect correctly (`src/components/ProtectedRoute.tsx`).
- **Phase 3 — Journeys:** ✅ Signup → CompleteProfile (Big-7 gate, `ProtectedRoute.tsx:PROFILE_GATE_FIELDS`) → Dashboard/browse → PostJob (3-step) → apply → accept → pay (escrow) → complete → release-payout → review all trace end-to-end.
- **Phase 4 — Security & RLS:** ✅ `get_service_role_key` NOT executable by anon/authenticated (prod-verified). No service-role key / server secret in client bundle (only by-design `VITE_*` publishable keys). Admin mutations on `create-payment` all gated by `has_role`. _Coverage gap:_ full `get_advisors(security)` output not parsed — see F-COV-01.
- **Phase 5 — Trust, Safety & moderation:** ✅ Report / Block / Dispute dialogs present and wired; admin queues exist; account deletion present (self-serve + admin). `user_blocks`, `reports`, `disputes` tables confirmed in prod.
- **Phase 6 — Money/escrow:** ✅ Idempotency on every Stripe path: `escrow-${jobId}` (`create-payment/index.ts:223`), `release-payout-${job.id}` (`release-payout/index.ts:287`), `dispute-release-${jobId}` (`create-payment/index.ts`, `transferToHelper`). DB dup-checks on `payout_transfers` before transfer. Disputes fail **closed** (`release-payout/index.ts:134`; `transferToHelper` re-throws). Atomic onboarding-fee claim before transfer. Ledger write logs CRITICAL on failure. Admin refunds support partial + write `admin_audit_log`.
- **Phase 7 — Discovery & location privacy (🔴 bar):** ✅ **PASS.** Prod-verified: `get_public_open_jobs` returns `(id, title, category, location text, budget, date_needed, is_urgent, is_boosted)` — **no lat/lng**. `get_ranked_open_jobs` returns `location text + parish text + rank_score` — **no coords**. Exact coordinates do not leak to anon on any public RPC.
- **Phase 8 — SEO/discoverability:** ⚠️ Partial — public marketing/parish pages exist; sitemap/JSON-LD coverage not exhaustively traced this pass (coverage note).
- **Phase 9 — Performance:** ✅ Largest chunks are PDF-export deps already route-split; no render-hot-path regression found in the routed shell.
- **Phase 10 — Cross-cutting:** ✅ Supabase `error` not dropped (the one grep hit was a comment in `supabaseResult.ts` describing the anti-pattern). Realtime channels user-scoped + nonced (F-RT-01/02). Loading/empty/error states present via shared `<EmptyState>`/`<ErrorState>`/`<Skeleton>`.
- **Phases 11–14 — App-Store gates & polish:** ⚠️ Account deletion ✅; Stripe real-world-services rules ✅ (escrow, no IAP on physical services); server-side secrets ✅; **placeholder/unreachable content ❌ → F-SCR-01** is the gating item.

---

## Scorecards (1–5)

### Money path
| Dimension | Score | Note |
|-----------|-------|------|
| Idempotency | 5 | Keys on every Stripe call |
| Race safety | 5 | DB dup-check + atomic fee claim |
| Fail-closed disputes | 5 | Re-throws; never marks released on failed transfer |
| Ledger integrity | 5 | `payout_transfers` rows + CRITICAL log |
| Webhook trust | 5 | `constructEventAsync`, fails closed |

### Per-screen (representative)
| Screen | Score | Note |
|--------|-------|------|
| Dashboard | 5 | Decomposed, shared shell |
| Browse / job feed | 5 | Coords masked, shared toolbar |
| PostJob | 5 | 3-step + Currency |
| Profile | 5 | Big-7 gate, AppShell |
| Messages | 5 | user-scoped realtime |
| Admin | 5 | server-gated, debounced realtime |
| Landing/marketing | 3 | F-SCR-01 placeholders |

---

## Prioritized punch list

**Must-fix before build**
1. F-SCR-01 — remove/flag/replace the four placeholder surfaces (esp. the Google Play badge on an iOS build).
2. F-COV-01 — read the full `get_advisors(security)` output; resolve or accept each lint.

**Quick wins**
- Trace sitemap + JSON-LD coverage for the public pages (Phase 8).

**Deferred / known-limitation**
- F-RT-01 — live posts-badge for foreign applicants (needs schema change; not required for launch).

---

## Coverage-honesty note

Explicitly **not fully traced** this pass:
- **F-COV-01 — `get_advisors(security)` output (184 KB) captured but not fully read.** A real RLS/`search_path` finding could be hidden here. Highest-priority coverage gap; resolve before build.
- **Phase 8 SEO** — sitemap completeness and JSON-LD/geo-meta were not exhaustively verified across every public route.
- **E2E reality gap** — Playwright runs Chromium against **mocked** Supabase; iOS cold-launch / session / routing bugs require a manual native-flow review + real-device smoke (per project native-audit checklist). Green CI ≠ native-verified.
- **Edge functions** — `release-payout`, `create-payment`, `stripe-webhook` were read in full; other edge functions were not exhaustively line-traced.
