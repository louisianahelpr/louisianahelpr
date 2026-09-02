# lh-state-matrix — launch-audit 2026-09-02

Mandate: force every screen state (empty / loading / error / offline / max-content /
long-string / keyboard-open / interrupted) on every route and prove each is
designed, not blank. This is a MUTATING lane; account state was verified clean
before and after (see "Account state" below) — in practice this run made zero
server writes, so no snapshot/restore round-trip was needed.

## Scope note — read this first

`empty-state-sweep.spec.ts` and `error-state-sweep.spec.ts` already give the
route catalog (`e2e/happy-path/auditRoutes.ts`, already current with all 7
relocated Profile tabs, the guest-preview change at `/jobs?job=`, and
`/gift-card`) systematic, assertion-backed coverage of **empty / loading /
error** across every route via mocked Supabase responses. `zz-runtime-probe.spec.ts`
already covers **offline** (cold-start and mid-session) with real assertions.
Re-deriving that coverage would have been waste, so this lane's actual budget
went to the four states those sweeps structurally cannot reach because they
never drive a real interaction: **keyboard-open, interrupted (multi-step form
backgrounding), long-string on real user content, and the fixed-position
overlay containment trap** named in the brief. Given the size of the full
matrix (27 routes × 23 Profile tabs × 8 states × 2 auth states) against this
lane's time budget, coverage here is a **targeted, evidence-backed sample**,
not exhaustive — see the honest gaps below.

Everything below was run against **live prod** (`https://www.louisianahelpr.com`)
with the seeded test account `eli.test.helper@louisianahelpr.com`, per
PROTOCOL's "reproduce against live state" rule — nothing here is filed from a
migration read or a code guess.

## Verified working (runtime-executed, with evidence)

1. **Keyboard-open — Post-a-Job step 1 correctly lifts the focused field.**
   `useKeyboardInset` (`src/hooks/useKeyboardInset.ts`) + the `scrollIntoView`
   effect in `PostJob.tsx:22-33` was driven for real: focused the Job Title
   input at 375×812, then shrunk **only** `visualViewport.height` (not
   `window.innerHeight` — see "probe bug I caught and fixed" below) to 476px
   and fired `resize` on it. Field moved from `top:608/bottom:656` to
   `top:382/bottom:430`, staying inside the new 476px visible area.
   Screenshot: `~/lh-audit-shots/state-matrix-2026-09-02/kb-02-postjob-keyboard-open.png`.

2. **Interrupted — Post-a-Job survives backgrounding AND a cold reload.**
   Filled the Job Title field, fired `visibilitychange→hidden` +
   `blur` + a `pause` custom event (mirrors Capacitor's lifecycle), waited
   1.5s, then fired the foreground sequence back. Typed value
   (`STATE-MATRIX-INTERRUPT-PROBE`) survived intact. Then did a hard
   `page.reload()` (a genuinely new navigation, not just a tab
   foreground) and the app offered to resume the draft. Draft persistence is
   entirely client-side (`safeStorage` in `src/hooks/useDraftJob.ts`, no
   server table) — so this required no cleanup.
   Screenshots: `int-01-before-background.png`, `int-02-after-foreground.png`,
   `int-03-after-reload.png` in the same directory.

3. **Long-string / max-content on real user-generated content.** DOM-injected
   a 200+ char string (long run, no-space token, emoji/multibyte) into short
   text nodes on `/dashboard`, `/my-jobs`, `/messages`, `/profile?tab=profile`
   at 375px. Job titles, thread previews, and the About-you bio all truncate
   cleanly with an ellipsis inside their containers; zero page-level
   horizontal overflow (`documentElement.scrollWidth <= clientWidth`) on any
   of the four surfaces across two runs. Screenshots: `long-dashboard.png`,
   `long-messages.png`, `long-profile-edit.png`, `long-my-jobs.png`.

   One thing my own heuristic flagged and I retracted after reading source:
   the "Recommended" pill on a job card (`JobCard.tsx:414`) doesn't truncate
   a 200-char string — by design. It's `shrink-0 whitespace-nowrap`
   deliberately, per the comment at `JobCard.tsx:359-368`: it's a
   closed-vocabulary system label ("Recommended" / "Just in"), never
   user-controlled text, so an ellipsised version would carry no information
   and the category label is the one designed to give width instead. Stuffing
   arbitrary text into it tests a state the product can never actually be in.
   Not a defect — recorded here so the next lane doesn't re-discover it from
   the same screenshot.

4. **Fixed-position overlay containment (source-verified, not yet
   runtime-verified — see gaps).** All three of the portal-based overlays
   named in the brief (`PhotoLightbox.tsx`, `MessageAttachment.tsx`'s inline
   lightbox, `ApplicantsPanel.tsx`) already `createPortal(..., document.body)`
   with detailed engineering comments describing the EXACT trap the brief
   warned about (a `backdrop-filter`/transform ancestor becomes the fixed
   containing block) and stating it was previously broken and is now fixed
   this way. `AppLockGate` and `ForceUpdateGate` are mounted at the top of
   the component tree in `App.tsx` (outside/just inside `BrowserRouter`, above
   everything else that could apply a transform), so they don't need a portal.
   This is Method-1 (code review) evidence only — I could not open a live
   instance of any of the three portal overlays (see gap #2 below).

## Probe bug I caught and fixed (worth recording so it isn't re-discovered)

My first keyboard-open pass shrank **both** `window.innerHeight` and
`visualViewport.height` to simulate the keyboard, and got a false negative
(inset computed to 0, field never moved). `useKeyboardInset.ts` computes
`inset = window.innerHeight - vv.height - vv.offsetTop` — in real iOS Safari,
`innerHeight` is the LAYOUT viewport and stays full-size; only the VISUAL
viewport (`visualViewport.height`) shrinks under the keyboard. Shrinking both
cancels the diff to zero and looks exactly like "the hook is broken" when it
is actually the harness that's wrong. Fixed by only touching
`visualViewport.height`/`offsetTop` before firing `resize`.

## Gaps — honestly unreachable this pass, with the reason

1. **Post-job entry deep-link initially looked broken — it wasn't (harness
   bug, not a product bug).** A first pass minted the auth session for the
   Playwright context with `user: { id: TEST_USER_ID }` only (copying
   `scripts/audit-capture.mjs`'s shape). A cold `/post-job` load then bounced
   through `/account-pending` → `/dashboard`, losing the deep-link target —
   which looked exactly like the "deep-link cold start" defect class the
   `lh-audit` standard calls out. It reproduced 100% of the time. Traced it
   to `useAuthReady.ts`'s `getSession()`, which trusts whatever `user` object
   is sitting in `localStorage` **without a network round-trip** — so my
   minimal user object left `email_confirmed_at` permanently `undefined`,
   which trips `ProtectedRoute.tsx`'s Stage-1 "email unconfirmed" gate on any
   route that isn't `allowPending` (`/post-job` isn't; `/dashboard`,
   `/my-jobs`, `/my-posts` are, which is why `audit-capture.mjs`'s existing
   routes never exposed this). Confirmed the real account's
   `email_confirmed_at` has been set since 2026-08-24 via
   `GET /auth/v1/admin/users/<id>`. **Fix applied to this lane's own probe
   script** (`scripts/probe-state-matrix.mjs`): `mintSession()` now fetches
   the real GoTrue user object via the admin API and uses that as the
   injected session's `user`, instead of a bare `{ id }`. Re-ran with the fix:
   `/post-job` loads directly, no bounce. **This is a live gotcha for any
   future harness that mints a session and hits a non-`allowPending` route —
   worth propagating to `audit-capture.mjs` and any other lane's script that
   copies its session-mint pattern.**
2. **PhotoLightbox / ApplicantsPanel / MessageAttachment — no seed data to
   open a live instance.** `eli.test.helper`'s posted jobs all already have a
   confirmed helper (no pending-applicants queue to open `ApplicantsPanel`
   from), no job card has an attached photo (no `PhotoLightbox` trigger), and
   both existing message threads are text-only (no attachment to open
   `MessageAttachment`'s lightbox from). Filed as **SM-001** (LOW,
   non-blocker) rather than silently skipped — this is a standing gap for
   every future state-matrix-shaped sweep against this account, not just this
   run. To close it: seed one job photo, one pending applicant on an open
   posted job, and one image message attachment on the test account (or a
   second clearly-marked test account), then re-run
   `scripts/probe-state-matrix.mjs`'s overlay section.
3. **AppLockGate — the `?app_lock_demo=1` harness didn't surface the lock in
   headless Chromium.** `measureFixedOverlay()` found only the bottom nav
   (`z-50`) as the topmost fixed element after loading
   `/dashboard?app_lock_demo=1`; the lock's own `z-[100]` panel never
   rendered. `AppLockGate.tsx` gates on `isAppLockSupported()` and
   `requireBiometric()` (`src/lib/biometricGate.ts`) — plausible that the demo
   path still probes for a real WebAuthn/biometric capability that headless
   Chromium doesn't expose, so the "supported" check fails closed and the
   gate renders nothing (same as a guest — by design). Did not chase this
   further given the time budget; needs either reading
   `isAppLockSupported()`/`APP_LOCK_DEMO` more closely or driving it from the
   iOS Simulator, where the real biometric prompt exists. UNVERIFIED, not
   claimed clean.
4. **The 24 admin `?view=` variants** — not attempted this pass. No admin
   test account was elevated in this lane's run (`is_admin=true` requires a
   deliberate `execute_sql` write against a clearly-marked test row per the
   standing BLANKET TESTING APPROVAL, and I did not want to duplicate
   `lane-admin`'s territory without checking first). Flagged to `team-lead`
   for de-duplication rather than silently skipped or silently re-done.
5. **The remaining ~19 of 23 Profile tabs, and most of the 27-route table,
   were not individually driven through this lane's four target states.**
   The empty/error/loading dimension is already covered systematically by
   the existing Playwright sweeps (see Scope note above); what's specifically
   NOT covered anywhere I found is keyboard-open / interrupted / long-string
   for the tabs beyond the four surfaces above (`profile`, plus the 4 route
   samples). Given this lane's remaining time budget, deeper coverage would
   need either a follow-up run of `scripts/probe-state-matrix.mjs` extended
   to more routes, or a dedicated Playwright spec added alongside
   `empty-state-sweep.spec.ts` for these specific interaction-driven states.

## Account state

`eli.test.helper`'s tracked mutable state (`notification_preferences`,
`helper_availability` — the two tables `scripts/audit-capture.mjs` tracks) was
spot-checked before writing this report and is unchanged: `push_enabled: true`,
all 7 `helper_availability.is_available: true`. This run made **zero** writes
to any Supabase table — every state forced above was either a pure
client-side DOM/event injection (`page.evaluate`) or an unsubmitted form fill
that was never persisted server-side, so `snapshotAccountState()` /
`restoreAccountState()` were not needed (verified this reasoning is sound
before skipping them, not assumed).

## Findings filed

- **SM-001** (LOW, non-blocker) — seed-data gap blocking overlay verification.
  See "Gaps" #2 above.

## Artifacts

- Probe script: `scripts/probe-state-matrix.mjs` (this worktree,
  `~/.lh-audit/lh-state-matrix/scripts/probe-state-matrix.mjs`)
- Screenshots + machine-readable results:
  `~/lh-audit-shots/state-matrix-2026-09-02/` (13 probe checks,
  `results.json`) and `~/lh-audit-shots/state-matrix-2026-09-02/debug-surfaces/`
  (my-posts / messages / thread debug screenshots referenced above).
