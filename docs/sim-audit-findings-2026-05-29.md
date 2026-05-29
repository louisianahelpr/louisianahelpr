# Sim audit — 2026-05-29 (post-rebuild)

Hand-driven iPhone 17 Pro simulator audit after merging today's polish +
observability PRs (#356, #359, #360, #361, #362, #363) and the four
backend-fix PRs (#355, #358, #364, #365, #366). Build hash on the sim:
`b846e9d6`. Seeded 4 `[TEST]` jobs via the REST API as `Lexilombas05`
to populate the customer-side surfaces; deleted at the end of the audit.

This is the artifact you get to read; the screenshots that back each
finding live at `/tmp/sim-audit/*.png` on the audit machine.

---

## What this audit caught that's already fixed (or in a PR)

The previous "couldn't load" symptom turned out to be **five overlapping
backend regressions**, not one. All five shipped today:

| PR | What it fixed | Why it bricked the app |
| --- | --- | --- |
| #355 | `GRANT EXECUTE has_role(...) TO authenticated` | RLS on `profiles` / `user_roles` invokes `has_role` — without EXECUTE, `useCurrentUser` exhausted retries → `ProtectedRoute` bounced every signed-in user to `/login` |
| #358 | grants on `is_business_member`, `is_business_owner`, `mask_job_location` | Once sign-in worked, the jobs view + RLS path still failed for the same advisor-strip reason |
| #364 | grants on 12 client-RPC functions (`get_safe_profiles`, `are_users_blocked`, etc.) | After #358, Profile stats / Reviews / Messages / Activity all still errored — `get_safe_profiles` is the high-reach culprit |
| **#365** | `SECURITY DEFINER` helper to break a `jobs↔applications` RLS cycle | **The actual root cause.** `PG 42P17 infinite recursion`. Latent for ~3 weeks; only surfaced after the bouncer fixes let users reach a surface that queries `jobs` |
| #366 | `ALTER VIEW open_jobs_browse SET (security_invoker = false)` + grant `get_public_open_jobs` to anon | Guest browse surface bricked because the view was flipped to invoker-mode but anon has no SELECT on `jobs`; landing-page RPC also missing anon grant |

The cumulative pattern: **the Supabase advisor pass has stripped PUBLIC
EXECUTE / SELECT from 17+ database objects so far**. Every grant we
restored is replay-safe and the project's migration history is
self-healing on a from-scratch rebuild, but production keeps diverging
silently. The defense-in-depth fix is in PR #356's documented Supabase
GitHub integration (auto-deploy on merge + preview-branch verification
on every PR) — *enabling that toggle on the Supabase dashboard is the
single most impactful follow-up*.

---

## Live-on-sim findings

### S1 — `Posts` action row truncates "Cancel" to "Cance" *(high visibility)*

On a `PostedJobCard` with the four action buttons (Boost, Edit, Share,
Cancel), the row overflows the card width and the last button label
gets cropped mid-letter. Affects every post the user looks at; it is the
first thing you see on the Posts tab.

- File: `src/components/activity/PostedJobCard.tsx` (action button row,
  around the Boost / Edit / Share / Cancel buttons)
- Fix shape: collapse the row into a 3-action surface + "more" menu on
  the iPhone width, or shorten the labels (icon-only for narrow
  viewports), or reduce horizontal padding inside the action chips.

### S2 — Profile "Finish your profile" stuck at 0% on a populated profile *(stat calculation bug)*

The Profile page renders "Finish your profile 0%" + "Next: ZIP code"
even though the signed-in user has full_name, bio, phone, city, ZIP,
DOB, and the avatar populated.

- The percentage calculation probably hasn't accounted for one or more of
  the populated fields, OR the stat query is hitting one of the dropped-
  error sites from PR #360 and silently defaulting to 0.
- Worth pairing with the "Couldn't load your profile stats" symptom we
  saw earlier today (now resolved by #365 + #366) — once stats *do* load,
  the calculation that uses them needs to be re-checked against the
  current `profiles` row shape.
- File: likely `src/components/profile/ProfileLanding.tsx` or wherever
  the completion-percent prop is computed; `PROFILE_GATE_FIELDS` in
  `src/components/ProtectedRoute.tsx:56-64` is the source of truth for
  what counts as "complete".

### S3 — Profile card city + member-since truncate aggressively *(layout)*

`Delcambre` → `Delca…` and `New member` → `New me…` in the user's name
card on Profile. The truncation triggers well before the available
horizontal space is filled — there's empty headroom to the right of the
text.

- File: `src/components/profile/*` — the name-card subcomponent
- Fix: relax the `truncate` / max-width constraint on the city/member
  badges, or reflow onto two lines on narrow viewports.

### S4 — Posts card title truncation also looks aggressive

Even short titles (`"[TEST] Mow my lawn this Satur…"`) hit the ellipsis
on a card that's the full width of the surface. The `[TEST]` prefix is
4 chars + space; remove the bracket prefix and the body would still
truncate.

- File: `src/components/activity/PostedJobCard.tsx`
- Fix: allow 2 lines of title before truncating, or bump the font's
  available width.

### S5 — Notification bell tap does nothing *(unverified — may be a missed tap)*

Tapping the bell icon (top right of dashboard) didn't open any panel /
sheet / route. Could be a missed tap on my side (icons are small, my
cliclick coords are approximate) — flagging as "verify on real device"
rather than as a confirmed regression.

- File: `src/components/dashboard/DashboardHeader.tsx` (the bell button)

### S6 — Post a Job templates picker looks great *(positive finding)*

`/post-job` opens to a beautifully-designed 8-template picker (mow a
lawn, mount a TV, deep clean, IKEA dresser, move a couch, walk a dog,
grocery run, paint a bedroom). Each template carries a "typical $" +
"~Xhr" line that calibrates user expectation before they enter the form.
No findings — this is one of the polished surfaces in the app.

### S7 — Bottom-nav stays highlighted across navigations into non-tab routes

After tapping a Posts card → Posted-jobs-history route, the Profile tab
indicator was still highlighted in the bottom nav. Same for tapping
Profile → Edit profile. Minor: the indicator should track the active
*navigation* not the originating tab. Lots of bottom-nav patterns handle
this by going inactive when in a non-tab route, or by remembering the
last tab to highlight on return.

- File: `src/components/MobileNav.tsx`

---

## Surfaces I didn't reach via tap automation

Tap automation via `cliclick` is approximate — small icon-only buttons
(bell, shield, edit pill) are hit-or-miss. The following surfaces
weren't reached on this pass and should be in the next audit cycle:

- **Job detail dialog** — tap into a job card; verify the `JobDetailDialog`
  layout, the apply confirmation flow, and the "Where" tile (which
  conditionally renders precise location only for the directly-offered
  helper, per the view contract).
- **Apply flow** — `ApplyConfirmDialog` triggers on a non-own job; payout
  setup gate + IDV gate live in the page handlers per `Activity.tsx`.
- **Edit profile inline** — couldn't reliably hit the Edit pill on the
  profile card. The route is `/profile?tab=edit` (or similar) and is
  worth a deeplink-driven audit.
- **Subscription / Account Security / Help & Support / Legal tabs**
  inside `/profile` — scrolling and tapping not reliable from outside.
- **Notification panel** — see S5; the panel UI is `NotificationPanel.tsx`.
- **Admin** — `/admin`, gated on `is_admin` from the user's `user_roles`
  row. Per the polish PR's findings doc, `Admin` uses `min-h-screen`
  without being in `DOCUMENT_SCROLL_ROUTES` — that's already filed.

---

## Hardening recommendations (priority order)

### H1 — Enable Supabase GitHub integration *(closes the meta-bug)*

Per `docs/SUPABASE_AUTO_DEPLOY_MIGRATIONS.md` (PR #356). One toggle in
the Supabase dashboard, and the entire class of advisor-strip
regressions (#355 / #358 / #364 / #366) starts catching itself on the
PR. Preview-branch checks run every migration from scratch on a fresh
database, so a stripped grant or recursive policy reds the PR instead
of bricking production.

This is the single most impactful follow-up from the entire audit. It
costs nothing and removes the failure mode that ate the day.

### H2 — Wire the Sentry alert rules from PR #360 §G1

The four alert rules from the observability audit doc that we'd need to
add in the Sentry dashboard to catch the next regression of this class
within minutes instead of hours:

| Rule | Filter | Tier |
| --- | --- | --- |
| Postgres permission denied | `message contains "permission denied for"` | P0 |
| ProtectedRoute silent bounce | `tags.source equals "ProtectedRoute.profileFetchError"` >2/5min | P0 |
| Dashboard data error burst | `tags.source startsWith "dashboard."` >3/5min | P0 |
| Post-job fee fetch failure | `tags.source equals "usePostJobForm.platformFeeFetch"` | P1 |

The instrumentation that feeds these rules already shipped in PR #363
(severity bumps in `useDashboardData` + `ProtectedRoute` instrumentation
+ post-job fee fetch error report). The rules themselves are a dashboard
config change, not a code change.

### H3 — Sweep the 47 dropped-error supabase call sites *(per PR #360)*

Per the inventory in `docs/observability-audit-2026-05-28.md`. Highest-
reach first:
- `src/hooks/useActivityData.ts` (4 sites — every Activity tab)
- `src/pages/Signup.tsx:200,390` (phone-dedupe + business invite)
- `src/pages/Messages.tsx:546,564,584` (admin-notify fanouts)

Each is a future `#355`-shape silent regression. The mechanical fix is
`unwrap()` from `src/lib/supabaseResult.ts` for `queryFn` sites; the
manual fix is `if (error) { report(error, ...); return; }` for
imperative call sites. Suggested cadence: one small PR per file or per
feature area — the total surface is ~24 files, breaking it up keeps
diff sizes reviewable.

### H4 — CI guard against the next stripped grant *(prevents recurrence)*

Per PR #361's "Defense-in-depth follow-up" — a Supabase Preview check
that fails the migration if any `CREATE FUNCTION public.<name>(...)`
lands without an explicit `GRANT` or `REVOKE`. Converts the trap into
a build-time error so the next person adding a function can't
accidentally rely on the default PUBLIC grant that keeps disappearing.

### H5 — Fix the S2 "Finish your profile 0%" stat bug *(visible to every user)*

Cosmetic but it's the first thing a returning user sees on Profile. The
fix is small and self-contained — just needs the completion-percent
calculation to read from the populated profile fields, not from a
silently-failed stats query that defaults to 0.

### H6 — Add the polish-PR follow-ups to the issue tracker

From `docs/audit-findings-2026-05-28.md` (PR #362), the items called out
as needing product judgment (not mechanical):
- `/admin` uses `min-h-screen` without being in `DOCUMENT_SCROLL_ROUTES`
- `SecurityTab` uses native `prompt()` for email change (off-brand)
- `NotFound`'s `window.history.back()` no-ops on direct landings
- Signup Step 1 still toasts errors one-by-one
- This audit's S1–S5 above

---

## Confidence

- Sim build verified live (build hash `b846e9d6 • May 29`)
- 4 backend fix PRs verified post-push via direct REST queries (anon + authenticated)
- Sim cold-launch verified guest dashboard now serves (after #366 push)
- Customer-side flow tested with 4 seeded `[TEST]` jobs; cleaned up at end
- Helper-side browse (jobs from *other* users) not tested — would require a second account
- Apply / accept / complete / review / dispute flows not exercised
- Push notifications, deep links, OAuth (Apple/Google) — not exercised on this pass
