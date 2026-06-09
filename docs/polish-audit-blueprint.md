# Louisiana Helpr — Polish Audit Blueprint

_Branch: `polish/guest-dashboard-pass2` · PR #403 · 2026-06-07_

Consolidated findings from five audit passes (Growth/UX friction, Principal-Designer
visual system, performance/rendering, App Store compliance, network-resilience QA).
Each item is tagged **DONE** (landed on this branch), **SAFE-NEXT** (low-risk, scoped,
ready to implement), or **NEEDS-CARE** (touches shared state, query lifecycle, or
broad surfaces — implement deliberately, not in a batch).

> Architecture note: this is a Capacitor app — React 18 + TS + Vite in `src/` _is_ the
> iOS/Android app. Every "haptic / retain-cycle / Combine" concept from the source
> prompts is mapped to its React/Capacitor equivalent. The account model is unified —
> every account can post jobs **and** do jobs; nothing below role-gates or splits signup.

---

## 1. Action friction & smart defaults (Growth/UX)

**DONE**
- Smart input hints across the highest-friction forms (`d600fce6`):
  - `autoCapitalize="words"` on first/last name + city (CompleteProfile, SignupStep2)
    and street address (LogisticsSection) — stops lower-case "john / baton rouge".
  - `inputMode="tel"` + `maxLength={14}` on the CompleteProfile phone field — numeric
    keypad, no overtyping past a formatted US number.
- Estimated-hours quick-pick chips already steer posters to common durations
  (LogisticsSection) — kept, validated as the right pattern.

**SAFE-NEXT**
- CompleteProfile bio: surface the 20-char minimum as a live counter rather than only
  on submit-failure (the guard copy now explains it, but the requirement is invisible
  until you trip it).
- Post-job budget: prefill a sensible suggested value from estimated hours × a default
  rate so the field is rarely empty on first paint.

**NEEDS-CARE**
- Inline per-field error map in CompleteProfile (replace the single top toast with
  field-anchored messages). Worth doing, but it reshapes the form's validation flow and
  should be its own focused change, not folded into the smart-defaults batch.

---

## 2. Physicality & multi-sensory feedback (haptics)

Mapped to `src/lib/haptics.ts` (`hapticLight/Medium/Heavy/Success/Warning/Error`).

**DONE** (`d600fce6`)
- CompleteProfile: `hapticError()` on every validation guard via a `fail()` helper;
  `hapticSuccess()` before the save-success toast.
- Post-job (`usePostJobForm.ts`): `hapticError()` on both payment-failure branches.
- Message composer already fires `hapticLight()` on send and `hapticError()` on a
  content-scan violation (RichMessageInput) — confirmed, no change needed.

**NEEDS-CARE**
- ~17 per-field haptics on the review/rating surfaces (star taps, criteria toggles).
  Deferred deliberately: high call-count, easy to over-buzz; needs a tuned light/medium
  policy rather than a blanket add, or it degrades into noise.

---

## 3. State handling & edge-case delight

**DONE**
- Warmer, recovery-oriented error copy across CompleteProfile / post-job
  ("We couldn't save your profile just yet — give it another try." vs a bare error).
  Post-job catch-block copy corrected — that path **deletes** the orphaned job, so any
  "your job is saved" wording would have been wrong.

**SAFE-NEXT**
- Active empty states: BrowseTasksFeed empty state could offer a "broaden your radius"
  or "post the first job" action rather than a static message.

---

## 4. Visual design system (Principal Designer)

**DONE** (`1e6176bb`)
- Replaced undefined `text-ds-*` steps with defined ones. The type scale only defines
  9/10/11/13/15/17/20/24/32/40 (`tailwind.config.ts`); `text-ds-12/18/22/26` were silent
  no-ops rendering at the browser default. Fixed in BusinessCTASection, HelperStreakBadge,
  ProfileLanding (×2), EarningsForecastCard, PublicReviewWall (×3), Admin.

**NEEDS-CARE**
- Corner-radius & padding normalization to the `rounded-ds-*` / `ds-*` spacing scales
  across cards. Broad visual surface — needs a screen-by-screen pass with sim review per
  change, not a find-replace.
- Pressed/active-state coverage on tappable cards (many have hover but no `:active`
  scale/opacity, which reads flat on touch). Systematic, worth a dedicated pass.

> Token reminder for any follow-up work: brand colors only resolve via
> `hsl(var(--token))` arbitrary values (`text-[hsl(var(--burnt-sienna))]`). Bare classes
> like `text-burnt-sienna` produce **no** styles.

---

## 5. Performance & rendering

**DONE** (`16055405`)
- BrowseTasksFeed "Everything else" derivation moved into a `useMemo` keyed on its real
  inputs — was recomputed every render inside an IIFE.
- NotificationPanel AudioContext leak (this branch, pending commit): a fresh
  `AudioContext` was created per notification and never closed. Browsers cap concurrent
  contexts (~6), after which the chime silently dies. Now released via
  `osc.onended = () => ctx.close()`.

**NEEDS-CARE**
- Browse-feed query has no client timeout; on a stalled network it spins indefinitely
  instead of surfacing a retry. A `withTimeout` wrapper (pattern exists in
  `useCurrentUser.ts` / `useAuthReady.ts`) plus a retry affordance is the fix — but it
  intersects React Query's retry/persisted-cache behavior, so it needs careful handling
  (a plain timeout Error has no HTTP status and will retry 2× before surfacing).

---

## 6. App Store compliance

**DONE / ALREADY PRESENT**
- **5.1.1(v) account deletion**: `delete-own-account` edge function + DataRights screen,
  now passing the required `confirmation: "DELETE MY ACCOUNT"` body behind a confirm
  dialog (`b33f610e`). Reachable in-app.
- **4.8 Sign in with Apple**: `nativeAppleSignIn` (`src/lib/socialLogin.ts`) is wired —
  parity present.
- **Info.plist privacy disclosures**: `NSCameraUsageDescription`,
  `NSLocationWhenInUseUsageDescription`, `NSPhotoLibraryUsageDescription`,
  `NSPhotoLibraryAddUsageDescription` all present.

**NEEDS-CARE**
- Legal/privacy copy alignment: verify the in-app Legal/Privacy text matches the actual
  data practices (delete-account behavior, payment processor, location use) — a content
  review, not a code change.

---

## 7. Network resilience & data integrity (QA)

**DONE / VERIFIED-OK**
- Message double-tap: guarded — `handleSend` early-returns while `uploading`, and
  `setText("")` clears synchronously after `onSend`, so a second fire hits the empty-text
  guard. Optimistic `sendStatus` shows the in-flight state. No change needed.

**SAFE-NEXT**
- Audit primary submit buttons (post-job pay, profile save) for an explicit
  `disabled`-while-pending state to make double-submit protection obvious rather than
  incidental.

**NEEDS-CARE**
- Offline-mode UX: no global offline banner / queue. Capacitor `Network` plugin + a
  thin online/offline indicator is the right shape; deferred as a feature, not a fix.
- Slow-network timeouts: same `withTimeout` work as the feed query in §5.

---

## Landed this pass

| Commit | Scope |
|--------|-------|
| `ea63e793` | Profile: security, haptics, typography, SE polish |
| `46419dac` | Auth: timeout leak, error drop, hydration safety |
| `b33f610e` | Compliance: delete-account confirmation body |
| `1e6176bb` | Design system: undefined `text-ds-*` → defined steps |
| `16055405` | Perf: memoize Everything-else feed derivation |
| `d600fce6` | UX: smart input defaults + haptics + warm copy |
| _pending_ | Perf: release NotificationPanel AudioContext |
