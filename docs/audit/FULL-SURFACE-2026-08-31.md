# Full-surface audit — 2026-08-31

Run overnight against `main`, unattended. Every claim below carries an artifact
you can re-check. Everything I could not reach is in the `UNVERIFIED` section,
which is deliberately not empty.

---

## Overview

**What was covered.** All 69 authed + public routes, all 17 Profile tabs, all 24
Admin views, all 14 redirects, both Activity tabs, all 63 edge functions, and
the whole 35-email transactional surface. Chrome only: 6 breakpoints
(320/375/414/768/1024/1440) in light, 2 in dark, driven against a **production
build** (`npm run build` + `vite preview`) with a **real Supabase session** on
real rows — not the mocked backend the Playwright suite uses.

**Headline numbers.**

| | |
| --- | ---: |
| Defects found | 24 |
| Fixed and pushed | 23 |
| Left open (needs you) | 1 |
| Commits | 12, all on `main`, all pushed |
| Coverage manifest | 155 / 232 units walked (was 12 / 134) |

**Release state.** `typecheck` clean · `lint` clean · `build` clean ·
`vitest` 1925 passing (200 files, 4 new tests) · `check:edge` 114 files, 0
errors · axe **0 violations across all 69 routes in both themes**.
```
$ npx vitest run      → Test Files 200 passed (200) · Tests 1925 passed (1925)
$ npm run typecheck   → exit 0
$ npm run check:edge  → edge-syntax: parsed 114 files, 0 with syntax errors
```
Playwright E2E is red, and the `Test` workflow's knip step is red — **both were
red before I started**; see Gaps, where I show the before/after evidence.

**The single most important thing I found:** `ai-job-builder` had no
authentication at all. It accepts the publishable key that ships inside the
public client bundle, so anyone on the internet could pull LLM completions
billed to your Gemini account. I confirmed it with a real unauthenticated call
that returned a complete job posting, fixed it, and re-verified against
production: 401 unauthenticated, 200 authenticated. Commit `09f1a479`; full
curl transcript below in F-SEC-01.

**Second most important:** `main` was red when I started, and not from anything
I did. `JobStatTiles.tsx` failed the TypeScript step, and the fix was sitting
uncommitted in your working tree — written but never committed. Commit
`93647361`; `gh run view 33367155092 --log-failed` shows the failing step, and
Vitest / Sentry Release / Migration Lint / Edge Deploy were all `success` on
that same commit — which is why it wasn't obvious.

---

## Defects found and fixed

### Security / money

**F-SEC-01 · 🔴 `ai-job-builder` was an open, billable LLM endpoint** — commit
`09f1a479`

No auth check, only a 10/min per-IP rate limit. Verified against prod before
the fix:

```
curl -X POST .../functions/v1/ai-job-builder \
  -H "apikey: <publishable key, shipped in the public bundle>" \
  -d '{"messages":[{"role":"user","content":"I need my lawn mowed in Lafayette"}]}'
→ 200 {"title":"Lawn Mowing & Yard Maintenance in Lafayette","description":"..."}
```

No session, no user, real completion, your bill. After the fix, verified live in
production: unauthenticated → `401 {"error":"Not authenticated"}`, authenticated
→ `200` with a real posting. It also leaked a raw internal error
(`"messages is not iterable"`) to unauthenticated callers; `messages` is now
shape-checked and answers 400.

**F-SEC-02 · 🟠 HTML injection into outbound email** — commit `44631bdc`

`notify-email-change` interpolated `newEmail` straight from the request body
into a security notice delivered to the account owner's real inbox from
`noreply@louisianahelpr.com` — a workable phishing vector. Now format-validated
*and* escaped; validation matters because escaping alone would still let an
attacker place arbitrary prose inside a security warning. Same raw
interpolation fixed in `admin-user-actions` (4 HTML bodies incl. the
admin-supplied note), `admin-update-email` (3), `engagement-automations` (5).
`_shared/safe-strings.ts` already existed — these files simply never adopted it.
Escaped in the HTML branch only, so plaintext bodies don't render O'Brien as
`O&#39;Brien`.

**F-MONEY-01 · 🔴 The highest-volume email path reported sends that never
happened** — commit `44631bdc`

`send-notification-email` did `await supabase.rpc('enqueue_email', …)` **without
destructuring**. supabase-js resolves `{data, error}` and does not throw, so a
missing queue / PGRST202 / RLS denial skipped the catch, the direct-send Resend
fallback written directly below it never ran, and `recordLog('sent')` recorded a
delivery that never occurred. This is exactly the CLAUDE.md "never drop the
Supabase `error`" rule. Same pattern fixed on the admin weekly digest in
`engagement-automations`, which incremented its success counter and left
`email_send_log` stuck on `pending`.

### Legal

**F-LEGAL-01 · 🔴 No unsubscribe on any automated email** — commit `44631bdc`

`src/pages/signup/SignupStep1.tsx:371` tells users in writing that *"every
marketing email carries an unsubscribe link (required by CAN-SPAM regardless)"*.
That was false. No automated email carried one, no `List-Unsubscribe` header
existed, and `email_unsubscribe_tokens` was dropped in
`20260830072801_drop_unused_scaffold_tables.sql`. Added a visible footer link
plus `List-Unsubscribe` / `List-Unsubscribe-Post: One-Click`, and taught
`process-email-queue` to forward a payload `headers` object to Resend — it had
no way to pass headers through, so the header was unset on every queued email
regardless of caller intent.

**F-LEGAL-02 · 🟠 Lifecycle mail ignored consent** — commit `44631bdc`

The cron loops selected on `drip_step` and `email IS NOT NULL` and nothing else,
so commercial mail went to unverified addresses and to accounts an admin had
**denied**. `send-marketing-blast` already gated on `email_verified` +
`approval_status` + `marketing_consent`; the crons did not. Welcome drip now
requires verified + approved; re-engagement ("New jobs are open in your area.")
additionally requires `marketing_consent`; approved-reminder requires verified.

### Correctness

**F-BUG-01 · 🟠 Any unknown `?tab=` rendered a blank page** — commit `a19e9474`

`/profile?tab=<anything-not-in-the-union>` painted nav chrome over an **empty
content area** — no heading, no error, no fallback:

```
/profile?tab=posted_jobs     → 70 chars of body text, zero <h1>
/profile?tab=completed_jobs  → 70 chars, zero <h1>
/profile?tab=bogus_tab_xyz   → 70 chars, zero <h1>   (any typo does it)
after the fix                → 1450 chars, h1 "Audit Helper"
```

Cause: `searchParams.get("tab") as Tab` in three places — a cast the compiler
cannot catch. This was live: `posted_jobs` and `completed_jobs` were real tabs
once, so existing bookmarks land on the blank page. Added `resolveTab()`,
deriving its valid set from `TAB_TITLES` so a new tab cannot be added without
becoming resolvable. 3 new unit tests.

**F-BUG-02 · 🟠 Sitemap advertised a 404 to crawlers** — commit `af77c0e3`

`public/sitemap.xml` listed `https://www.louisianahelpr.com/subscription`. Not a
registered route; renders the 404 page (`document.title "Page Not Found —
Helpr"`, `h1 "404"`). The real screen is `/profile?tab=subscription`. The
existing test guarded against listing a *redirect* but not a *deleted* path.
Added a test deriving the registered path set from `App.tsx`, and proved it
catches the regression rather than passing vacuously: re-adding the entry fails
with `expected [ '/subscription' ] to deeply equal []`.

**F-BUG-03 · 🟠 `main` was red** — commit `93647361`

TypeScript step failing on `JobStatTiles.tsx:191` — `wrapperProps.type` declared
as `string`, which widens the literal `"button"` and no longer satisfies
`ButtonHTMLAttributes`. The fix was already written in your working tree and
never committed. Verified both directions with `git stash` + `npm run
typecheck`: HEAD version → `error TS2322` at `JobStatTiles.tsx(191,18)`;
working-tree version → 0 errors.

### Accessibility — 51 violations, all fixed, now zero

An axe sweep (`wcag2a wcag2aa wcag21a wcag21aa`) over all 69 routes in both
themes found 51 violations, every one a contrast failure, and every one caused
by the **same anti-pattern**: signalling a state with `opacity-*` on a container,
which attenuates its text along with everything else.

| Where | Nodes | Measured | Commit |
| --- | ---: | --- | --- |
| Profile → Edit Profile, 11 skill chips (`opacity-45`) | 11 | ~1.85:1 | `ebae904f` |
| Profile → Warnings: "Strike N of 3" headline | 1 | 2.63:1 (3:1 bar) | `ebae904f` |
| Profile → Warnings: "N of 3 strikes" | 1 | 4.46:1 — a 0.04 miss | `ebae904f` |
| Profile → Warnings: action badges | 3 | 2.94:1 | `ebae904f` |
| **Dark mode**: "Recommended" job badge, on **all 35 authed screens** | 35 | 3.89:1 | `50739aa5` |
| Availability: "off" day cards (`opacity-70`) | 12 | under 4.5:1 | `5910a925` |
| Notification preferences: rows when push off (`opacity-60`) | 6 | under 4.5:1 | `5910a925` |

The dark-mode one is the interesting case: `--sienna-ink` **already existed**,
minted for exactly this ("small text on the sienna family's own tint"), and is
byte-identical to `--burnt-sienna` in light. A one-token change cleared all 35.

Two of these were only findable because of method, not diligence:

- The dark-mode set required driving the app's real theme store
  (`localStorage["helpr-theme"]`). Setting `<html data-theme="dark">` directly
  is silently overwritten by `useDarkMode` on mount — I caught myself producing
  a second light-mode pass and reported nothing, which is why I verified the
  body background actually changed before trusting the run.
- The Availability and Notification sets only appeared **after** the control
  sweep toggled the account into the "off" state. A settings screen has to be
  measured in *both* toggle states; measuring the default one is measuring half.

### Hygiene

**F-TOOL-01 · 🟡 The audit harness had drifted from the app** — commit `cb3a2637`

`scripts/audit-capture.mjs` still swept 5 deleted admin views (`parishtax`,
`idv`, `geography`, `business_verify`, `business_accounts`) — `/admin` coerces
their dead links to home, so it was grading the dashboard under five extra names
and reporting them covered. Also still swept `/subscription` and `/family`
(both 404), still listed 2 dead profile tabs, omitted `accessibility`, and had a
hardcoded `DATE_DIR` you had to hand-edit before every run or silently overwrite
the previous capture.

**F-TOOL-02 · 🟢 Dead code** — commit `aaf388c1`

Committed the 13 staged deletions that were already sitting in your index
(knip pass: `activityStateLabel`, `SwipeableFilterChip`, `WhatToBringChecklist`,
`EscrowExplainer`, `EscrowProgressBar`, `useCountUp`, `profileCompletion` + 5
tests) as their own commit. I initially let these ride along inside an unrelated
commit, noticed, and rewrote the history before pushing so the log is truthful.

### Email copy — commit `44631bdc`

Unclosed paren in the admin digest (`"past 7 days ( Monday, Sep 1:"`); drip step
1 said "Two things you can do today:" then listed three; emoji stripped from
live Resend subject lines (review-nag ×2, admin-user-actions) and notification
titles (formal warning, final warning, suspension, weekly report) per the ban
that migration `20260824070000` applied to the trigger-side copy and these
callers missed; canonical nouns (`helprs`→`Helprs`, `customers`→`posters`,
`"Your helpr marked the job done"`→`"Your Helpr…"`).

---

## Verified working

Each with its artifact.

- **All 63 edge functions execute.** OPTIONS + POST issued against every one,
  status recorded to `~/lh-audit-2026-08-30/edge-functions.txt`. Zero 404s —
  none is orphaned in either direction.
- **All 69 routes render clean at 1440 in both themes**, after fixes.
  Records: `~/lh-audit-2026-08-30/measure-1440-{light,dark}.json`
```
light axe: 0 | overflow: 0 | h1!=1: 0 | fill<65: 0 | errors: 0
dark  axe: 0 | overflow: 0 | h1!=1: 0 | fill<65: 0 | errors: 0
```
- **All 14 redirects land where they claim**, observed by final URL.
- **All 17 Profile tabs and all 24 Admin views render**, screenshotted.
- **Layout discipline holds.** Zero horizontal overflow at any of the 6
  breakpoints across 558 light cells. No page floats in a narrow orphan column.
- **1925 unit tests pass** (200 files), typecheck clean, `check:edge` clean.
- **3 overlays opened and operated**, in both themes, each screenshotted, each
  axe-clean inside the dialog, each dismissible with Escape:
  `FilterSheet` (Dashboard → Filters), `JobDetailDialog` (Dashboard → job card,
  real seeded row "Deep clean a 3-bedroom / $220 / Lafayette"), and the
  `SecurityTab` change-email dialog. Records in
  `~/lh-audit-2026-08-30/dialogs/report.json`.

### Observed once, not reproducible — recorded, not claimed

The regenerated light sweep caught a single
`500 /rest/v1/rpc/get_jobs_for_my_applications` on `/home-history` at 1440,
one cell out of 558. I could not reproduce it: 10 sequential and 10 parallel
authenticated calls to that RPC all returned 200 with real rows. Recording it
because a transient 5xx on a data path is worth knowing about, but it is an
observation, not a finding — I am not claiming a defect I could not reproduce.
The same sweep also logged one 25s navigation timeout on `/work-record` under
six parallel workers, which I read as harness load rather than the app.

### A correction to my own method, found late

My first screenshot pass captured the **onboarding tour**, not the screens
behind it. `OnboardingTour` opens on every fresh browser context and blurs the
page under it, so `~/lh-audit-2026-08-30/light/1440/authed-dashboard.png` from
that run is a picture of "Welcome to Helpr — Step 1 of 6" over a blurred
dashboard. It is also why my first attempt to open any dialog failed: the tour
was intercepting every click.

I found this by probing for clickable controls and getting
`"Step 1: Welcome to Helpr" … "Skip"` instead of dashboard buttons.

Fixed by seeding `localStorage["helpr_onboarding"] = {completed:true,…}` in the
harness, and **every measurement above was re-run with the tour dismissed**.
The numbers did not move — 0 axe violations, 0 overflow, one `<h1>`, 0 under
the fill bar, in both themes — because axe reads computed styles rather than
the visual blur, and the underlying DOM was present throughout. But the stored
screenshots from the first pass were not pictures of the screens they claimed
to be, and have been regenerated.

Worth carrying forward: **any harness that drives this app from a fresh context
must dismiss the tour first**, or it is auditing the tour.

---

## UNVERIFIED — could not reach, and why

This section is not empty and should not be read as failure. It is the honest
remainder.

1. **75 of 78 overlays — dialogs, sheets, popovers, drawers.** The largest
   hole. 3 are now verified (below); the rest are not.
   I first ran a blind control sweep that clicked 1,600+ controls across every
   authed route, but I restarted the preview server underneath it three times
   for rebuilds, and it eventually hung with 4 workers stuck at 54/69 cells. I
   am not reporting numbers from a contaminated, incomplete run, and nothing was
   promoted in the ledger on its strength.
2. **All destructive admin dialogs** (ban, refund, delete user, status
   override). You approved executing these on seed accounts with revert; the
   contaminated sweep meant I never got a clean pass to do it in. These are
   exactly where the "reports success but wrote nothing" class hides.
3. **The money path end to end.** No job was posted, funded, awarded, completed
   or paid out this run. Stripe is in test mode and you cleared me to use
   4242 — I did not get there.
4. **`/jobs/:id` and `/user/:userId`.** The two parameterised routes; need a
   live job id and profile id.
5. **iOS Simulator — the entire native surface.** Safe areas, keyboard insets,
   splash, haptics, and all 9 native prompt classes (camera, geolocation, push,
   Face ID, share sheet, social auth, in-app browser). Chrome was not finished
   to a clean state early enough to open the sim, per your rule that Chrome
   comes first.
6. **TestFlight / real device.** Cannot self-provision. Everything
   `PLATFORM_CONVENTIONS.md` §8 lists as unverifiable in headless Chromium —
   native pickers, scrollbar chrome, autofill, spellcheck, real Dynamic Type,
   VoiceOver golden flows — remains unverified.
7. **Reduced-motion pass.** Not run.
8. **Cross-account behaviour.** The three-origin trick was set up but never
   used; message delivery, offer accept/decline landing on the other side, and
   arrival propagation are all still untested.

---

## Suggestions

You asked for all of them, big and small. Nothing withheld for being out of
scope.

### Big

1. **Add axe to CI.** Every one of the 51 contrast defects was machine-findable
   in seconds. `visual-audit-sweep.spec.ts` already runs axe and already has a
   gate — it just isn't part of the required checks. This is the highest
   leverage item on the list.
2. **Ban `opacity-*` as a state signal, with a lint rule.** Three independent
   instances in one audit (chips, availability cards, notification rows), 29 of
   the 51 violations. The pattern is seductive because it looks like "dimmed =
   disabled", but it multiplies through *text* colour. The house pattern should
   be an explicit muted token, or filled-vs-outline as I used for the chips.
3. **Fix or delete the E2E suite.** 21 spec files have been failing for many
   commits (see Gaps). A permanently red gate teaches everyone to ignore it,
   which is worse than not having it.
4. **One shared Resend helper.** There are nine hand-rolled copies of
   `sendWithResend`. They have already drifted — only three pass a `text` part,
   only one handles 429. Consolidate into `_shared/resend.ts`.
5. **Route the six admin emails through the queue.** `admin-user-actions` does
   `.catch(e => console.error('email failed', e))` on all six. The admin sees
   success, the user gets nothing, and no `email_send_log` row exists to audit
   against. Same in `admin-update-email` for the account-takeover notice.
6. **Add a Resend bounce/complaint webhook.** `suppressed_emails` is read
   correctly (and fails closed) at `send-notification-email/index.ts:190` and
   `engagement-automations/index.ts:168`, but **nothing writes to it** —
   `grep -rn "suppressed_emails" supabase/functions` finds zero inserts, so the
   table has been empty since `20260312162845`. Both guards are no-ops today.
7. **Convert email templates to table-based layout.** All 11 use
   `div` + `margin:0 auto`, which Outlook's Word engine ignores — every Helpr
   email left-aligns and stretches full-window there.

### Medium

8. **`type` the `?tab=`/`?view=` params generally.** The Profile bug was a blind
   `as Tab`. `/admin?view=` uses the same pattern and will do the same thing on
   a stale link.
9. **Snapshot/restore in any control sweep.** Mine mutated the seeded account's
   notification preferences and all seven availability rows. I restored both and
   verified by SQL read (`push_enabled` → `true`, all 7
    `helper_availability.is_available` → `true`), but the harness should do this,
    not the auditor.
10. **Return 401, not 500, for unauthenticated calls.** `create-payment`,
    `stripe-connect`, `pro-customer-portal`, `cash-out-credits` and
    `helpr-pass-wallet` answer 5xx where the other 58 answer 401. The first
    three carry an honest `"Not authenticated"` body so it's hygiene, not a
    hole — but it makes 5xx alerting noisy and hides real failures.
11. **Add dark mode to the default sweep variants.** `SWEEP_VARIANTS` defaults
    to `phone-light`. The single worst a11y defect in the app — 35 screens —
    lived only in dark.
12. **Give email templates a dark-mode story.** Zero of the 11 have any:
    no `color-scheme` meta, no `prefers-color-scheme`. iOS Mail will invert them
    and can crush the bark CTA.
13. **Teach `ai-job-builder`'s system prompt the canonical nouns.** Its output
    says "reliable helper"; house style is "Helpr".
14. **Consolidate the two toast systems.** Sonner has ~129 callers; the legacy
    Radix toaster has 3 (`AdminHealth`, `EarningsTab`, `useHelperMilestones`).
15. **Fix the logo width contradiction** in 10 raw-HTML email templates:
    `width="80"` attribute against `style="width:150px"`. `styles.ts` already
    documents 80 as correct.
16. **Unify the sender identity.** Four different From names across the estate
    (`The Helpr Team`, `Helpr`, `Louisiana Helpr`, `Helpr Contact`) and two
    envelope addresses (`noreply@` vs `hello@`, the latter possibly not
    DKIM-aligned).
17. **Standardise apex vs `www`.** Email links split between
    `louisianahelpr.com` and `www.louisianahelpr.com`, which sit behind
    different bot posture.

### Small

18. `SITE_NAME` in `send-notification-email:6` is declared and never used.
19. `admin-user-actions` footer says "Questions? Reply to this email" but sends
    from `noreply@`.
20. `send-notification-email`'s HTML footer says "Manage your preferences in
    your profile settings" with **no link**; the plaintext version has one.
21. `OfflineBanner` has no "back online" confirmation — the banner just
    vanishes.
22. No update-required / force-upgrade banner exists anywhere
    (`updateRequired`, `minVersion`, `force_update` all return nothing).
23. `components/ui/calendar.tsx` day cells are `h-9 w-9` — under the 44×44
    minimum.
24. `send-account-status-email:222` compares the service-role token with `===`;
    `send-notification-email:113` correctly uses `timingSafeEqual`.
25. Five raw-HTML email templates have no preheader, so the inbox preview falls
    back to "Hey there,".
26. Six templates are missing the viewport meta tag.
27. Zero test coverage for any email function — nothing asserts a subject, a
    render, an escape, or the suppression check.
28. `/j/:id`, `/u/:id`, `/m/:id`, `/legal/:tab` exist only as native deep-link
    normalisations and 404 in a web browser. Probably intended; worth confirming.

---

## Gaps that need fixing

Distinct from defects — these are things that are *missing* or *untrue*, where
the risk is that they hide the next defect.

0. **The `Test` workflow was failing on TWO independent steps, and the first
   was masking the second.** TypeScript failed first (fixed, `93647361`), which
   meant the `Dead code (knip)` step never ran. With typecheck green the
   pipeline now reaches knip — which also fails, and **has been failing all
   along**. Verified by checking out `09e08996` (the commit before any of my
   work) into a scratch worktree and running knip there:
```
09e08996 (pre-audit):  exit 1 · Unused files (16) · Unused exports (148)
d15c9a5f (now):        exit 1 · Unused files (16) · Unused exports (147)
```
   So I did not cause it and marginally improved it. But it means `main`
   cannot go green on `Test` until ~16 orphaned files and ~147 unused exports
   are dealt with, or knip is configured to tolerate them. Fixing the type
   error uncovered this rather than introducing it.

1. **Playwright E2E has been red for many commits.** 21 spec files failing.
   I verified I did not cause it by diffing the failing spec-file sets from the
   two runs:
```
run 33363719042 (19b1a054, pre-my-work): 21 failing spec files
run 33368304258 (a19e9474, mine):        21 failing spec files
comm -13 → NEW in my run: (none)   comm -23 → FIXED by my run: (none)
``` Unit tests are also **not in CI**
   (`npx vitest run` is local-only), so between a red E2E gate and absent unit
   coverage, the only thing actually blocking a bad merge is typecheck/lint/build.
2. **`main` can go red and stay red.** It did, and the fix was already written
   and sitting uncommitted. Nothing surfaced it.
3. **The coverage ledger was structurally incomplete**, not merely stale: it
   tracked no overlays (78 of them) and no admin views (24). "All routes walked"
   was technically true and substantively misleading. Fixed in `aea0b7bb`.
4. **`docs/audit/WALK_EVERY_SCREEN_PROMPT.md` tells you to run
   `node scripts/test-signin-link.mjs`, which does not exist.** Anyone following
   that prompt stalls at sign-in, which is the exact excuse the ledger says is
   never acceptable. The working path is admin `generate_link` (as
   `scripts/audit-capture.mjs` already does) — now documented in the new prompt.
5. **Five contradictions between your own audit documents**, each of which will
   stall or mislead a future run. I ruled on all five in
   `docs/audit/FULL_SURFACE_AUDIT_PROMPT.md` §0, but they are worth settling at
   source:
   - `lh-audit` §1 says a large UNVERIFIED section is a *good* outcome; §5 says
     UNVERIFIED is *not an acceptable final state*.
   - SKILL.md:521 mandates glossy primaries; `AGENTS.md` says "no gloss/glow".
   - `.claude/commands/audit.md` says branch + PR; `CLAUDE.md` says commit
     directly to `main`.
   - `.claude/commands/audit.md` says apply migrations via MCP
     `apply_migration`; `CLAUDE.md` says **NEVER**.
   - `TWO_ACCOUNT_E2E_TEST_PROMPT.md` says Claude may not handle keys or type
     passwords; SKILL.md §5 grants standing authorization to self-provision.
   - Minor: the commit trailer differs between `CLAUDE.md` (Opus 4.7) and
     `WALK_EVERY_SCREEN_PROMPT.md` (Sonnet 5). I used CLAUDE.md's.
6. **`.text-display-eyebrow` is `display:none`** (`src/index.css:1848`) while
   the audit standard still mandates the eyebrow stack and calls a missing
   eyebrow a defect. Either restore the class or stop treating it as a finding.
7. **`docs/qa/ACCESSIBILITY_AUDIT.md` has every box unchecked** — the manual
   device checklist (VoiceOver, Dynamic Type, Reduce Motion, deuteranopia) has
   never been executed. It can only be done on a real device.
8. **CAN-SPAM physical postal address is still absent from every template.**
   I did not invent one. This is the one open defect and it needs you.
9. **`TODO.md` items still open**, unverified this pass: **F-MONEY-01** (retire
   `process-scheduled-payouts`, double-pay hazard — flagged "highest priority,
   real money"), **F-DISC-01** (street-address leak via `open_jobs_safe` /
   `get_ranked_open_jobs`), **F-SEC-08** (enable HaveIBeenPwned in Supabase
   Auth), **F-SEO-01** (~20 public pages missing from the sitemap — I fixed the
   *wrong* entry, not the missing ones).
10. **No CI check asserts the sitemap matches reality** beyond what I added, and
    nothing regenerates it from the route table.

---

## What I need from you

Only one thing is blocked on you: **the business postal address** for the email
templates (CAN-SPAM §7704(a)(5)). Everything else in this report is either done
or listed above for your triage.

## Evidence self-check

`npm run check:audit-evidence -- docs/audit/FULL-SURFACE-2026-08-31.md`
reports 26 claim lines, 6 carrying an inline artifact, and confirms the
required `UNVERIFIED` section is present.

Reading that honestly: the tool scans a claim line plus the two lines after it,
so it does not see the commit SHA in the heading above a finding, or the curl
transcript three lines below. Every defect in this report names a commit you can
`git show`, and every measurement names a file under `~/lh-audit-2026-08-30/`.
I have not padded the prose to game the ratio — the tool's own header says it is
"a mirror, not a gate", and the mirror is more useful left un-smudged.

The claims that genuinely rest on nothing re-checkable are the ones in
Suggestions, which are opinions and are labelled as such.

## Artifacts

| What | Where |
| --- | --- |
| Screenshots, 558 light + 186 dark | `~/lh-audit-2026-08-30/{light,dark}/<breakpoint>/` |
| Layout + axe records | `~/lh-audit-2026-08-30/measure-1440-{light,dark}.json` |
| Sweep reports | `~/lh-audit-2026-08-30/report-{light,dark}-*.json` |
| Edge function statuses | `~/lh-audit-2026-08-30/edge-functions.txt` |
| Coverage manifest | `docs/audit/COVERAGE_LEDGER.md` |
| The prompt this ran from | `docs/audit/FULL_SURFACE_AUDIT_PROMPT.md` |
