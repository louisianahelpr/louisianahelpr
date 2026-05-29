# Visual + copy audit findings — 2026-05-28

Pass over the React app surface listed in scope. Each finding cites
`file:line · what's wrong · why it matters · recommended fix`. Mechanical
fixes that landed in this PR (the "honest error copy", the dead Tailwind
class, the capitalization nits, the label pairings) are marked
**(fixed in this PR)**. Everything else is left for a follow-up — gathered
here so a future pass can pick them up without re-auditing.

## Shared primitives

### `src/components/ui/ErrorState.tsx:29`
- **What** — Default `body` was `"Check your connection and try again — this is usually a momentary hiccup."`
- **Why it matters** — Every uncustomized `<ErrorState />` call site inherited this string. The failures we actually see in `error_logs` are server-side (RLS regressions, RPC grant misses, edge-function timeouts — see PR #355, #357, #358), so this sent users hunting for a problem that wasn't theirs to fix.
- **Recommended fix** — **(fixed in this PR)** Replaced with `"Tap Try again. If it sticks, our end is having a hiccup — not yours."` to match the dashboard-specific copy adopted in PR #357.

### `src/components/ui/EmptyState.tsx`
- **What** — No behavior issues. Solid component.
- **Note for follow-up** — The `dock` variant's `paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1.5rem)"` is duplicated in `PageScaffold` (`bottomPad`) and `BrowseTasksFeed` (the virtualizer's `paddingBottom`). Worth extracting to a CSS custom property (`--dock-bottom-clearance`) so a change in one place propagates.

### `src/components/AppShell.tsx`
- **What** — Solid. Note: `bottomPad` uses `96px` literal; the `tailwind.config.ts` already exposes the same value as the `safe-nav` spacing utility. Not a bug — just a divergence worth noting if either ever changes.

### `src/components/ui/PageScaffold.tsx`
- **What** — No issues found.

## `src/App.tsx` (route inventory)

All `<Link to="…">` targets verified against the route table — no dead links in scope.

## Pages

### `src/pages/Login.tsx`
- **What** — Sign-in error toast on line 74 toasts `error.message` verbatim. Supabase auth errors can be terse ("Invalid login credentials") which is OK, but the password-show toggle (`aria-label={showPassword ? "Hide password" : "Show password"}`, line 171) is the correct pattern other pages should copy.
- **Why it matters** — One sub-tip: a stuck `loading` state in `signInWithTimeout` could leave the spinner indefinitely if the promise resolves between the timer reset and the rejection path. The current `try/finally` clears the timer correctly — no action needed.
- **Recommended fix** — No mechanical fixes. Just documenting the pattern.

### `src/pages/Signup.tsx`
- **What** — Step 1 / Step 2 / Step 3 validation uses `toast.error` for Step 1 only; Step 2 aggregates errors into `step2Errors` map and surfaces them inline (much better UX). Step 1 should be migrated to the same inline pattern.
- **Why it matters** — Step 1 has 6 possible errors (`Email required`, `Password ≥ 8 chars`, `Uppercase letter`, `Number`, `Passwords don't match`, `Accept policies`). Each shows as a toast on tap; the user can only see one at a time. Inline errors mirror Step 2.
- **Recommended fix** — Refactor `validateAccountStep` to populate a `step1Errors` map and pipe it through to `SignupStep1`. Behavior change — out of scope for this audit pass.

### `src/pages/SignupPending.tsx`
- **What** — Clean.

### `src/pages/Login.tsx` / `src/pages/Signup.tsx` capitalization
- **What** — Login button says "Sign in" (sentence case); the Signup-flow "Already have an account? Sign in" link matches. Consistent.

### `src/pages/CompleteProfile.tsx:510`
- **What** — `<Label>Government-issued ID *</Label>` had no `htmlFor`, even though the wrapping uploader `<label htmlFor="id-doc">` opens the actual file input.
- **Why it matters** — Screen readers announce the file input as "unlabeled". The visible heading and the input weren't programmatically associated.
- **Recommended fix** — **(fixed in this PR)** Added `htmlFor="id-doc"` to the heading `<Label>`.

### `src/pages/AccountPending.tsx:318`
- **What** — Primary CTA was `"Explore Jobs While You Wait"` (Title Case).
- **Why it matters** — Every other CTA in the app is sentence case ("Sign in", "Get notified", "Post a job"). One Title-Case button looks like an inconsistency, not a design choice.
- **Recommended fix** — **(fixed in this PR)** Changed to `"Explore jobs while you wait"`.

### `src/pages/AccountPending.tsx:241`
- **What** — Email-verification body uses `text-ds-11 text-muted-foreground` (tiny, gray). On the first screen a new user lands on after signing up, the support text is hard to read on iOS dim screens.
- **Recommended fix** — Bump to `text-ds-13` or raise the foreground contrast. Behavior change to type scale — out of scope.

### `src/pages/AccountDenied.tsx`
- **What** — "Re-apply now" button and "Email support" — both visible from the start. The denial reason renders in a card if present. Solid.
- **Sub-note** — The "Reason" heading is `text-[0.7rem] uppercase tracking-[0.18em]`. Inconsistent with the rest of the app's `text-display-eyebrow` utility (which is the canonical eyebrow class). Many other pages similarly inline this exact rule — would be a worthwhile sweep one day.

### `src/pages/AccountBanned.tsx`
- **What** — Same inline eyebrow pattern. No copy bugs.

### `src/pages/ForgotPassword.tsx`
- **What** — Excellent. Loading state, success state, resend cooldown, all done well.

### `src/pages/ResetPassword.tsx`
- **What** — `usePageTitle` instead of `usePageMeta` (missing OG tags). The link is one-use, so OG tags aren't visited by people other than the user. Low priority.

### `src/pages/Dashboard.tsx:824, 832`
- **What** — Dismiss-job dialog was `"Not Interested?"` / `"Keep It"` (Title Case).
- **Why it matters** — Same capitalization-consistency miss.
- **Recommended fix** — **(fixed in this PR)** Sentence case.

### `src/pages/Dashboard.tsx:504-510`
- **What** — Banned-user fallback block uses `text-ds-24` on `<h1>` — a hard-coded type-scale that diverges from the new `text-page-title` utility used elsewhere. Same goes for the denied-profile block at line 539. Cosmetic.

### `src/pages/Dashboard.tsx:597`
- **What** — Greeting uses `new Date().getHours() < 12 ? "Good morning" : ...` — re-instantiates Date twice for the two checks. Trivial; not a bug.

### `src/pages/DashboardGuest.tsx:523`
- **What** — Error state title was `"We couldn't load nearby jobs."` — identical mislead as the authed-Dashboard bug fixed in PR #357 (the `open_jobs_browse` feed is not location-gated).
- **Recommended fix** — **(fixed in this PR)** Updated to `"We couldn't load jobs."` and inherits the new honest default body.

### `src/pages/DashboardGuest.tsx:530`
- **What** — Empty-state body `"Try clearing filters or check back later — new tasks land throughout the day."` is good. Action `"Clear filters"` only shows when `hasFilters`. Solid.

### `src/pages/Activity.tsx`
- **What** — Looks clean. `ActivityEmptyState` (separate file) handles the empty branches.

### `src/pages/Messages.tsx`
- **What** — Conversations list and `ChatView` cover loading + empty + error states. The chat-load error in `ChatView` had the same "Check your connection" mislead — fixed in this PR.

### `src/pages/Profile.tsx`
- **What** — Heavy file (823 lines) but the loaded paths are clean. Each tab has a `sectionErrors.X` recoverable error chip via `<ProfileSectionError />`, which is the right pattern. The landing tab's logout dialog (line 794) uses sentence case `"Log out?"` / `"Stay signed in"` — good.

### `src/pages/UserProfile.tsx:189, 220, 238`
- **What** — Title is `"Profile Review"` for self-view, `"Profile"` for others. The Title-Case `"Profile Review"` matches a deliberate label-style header. OK in context.
- **Sub-note (line 482)** — `{stats.reviewCount} Review{stats.reviewCount !== 1 ? "s" : ""}` capitalizes `Review` mid-sentence. Could be `review`; minor.

### `src/pages/PostJob.tsx`
- **What** — Looks clean.

### `src/pages/PaymentSuccess.tsx`
- **What** — Excellent flow — the four-stage lifecycle preview is a great example of turning anxious "did it go through?" into "here's what comes next". No issues.

### `src/pages/NotFound.tsx:78`
- **What** — `"Go back"` calls `window.history.back()`. If the user landed on a 404 directly (push notification, shared link), there's nothing to go back to and the browser does nothing. Soft dead-end.
- **Recommended fix** — Track `document.referrer` or use `if (window.history.length > 1) { history.back() } else { navigate("/") }`. Behavior change — out of scope.

### `src/pages/Legal.tsx`, `src/pages/DataRights.tsx`, `src/pages/Jobs.tsx`, `src/pages/JobHistory.tsx`, `src/pages/BusinessTeam.tsx`, `src/pages/ForBusiness.tsx`
- **What** — All use `min-h-screen bg-premium-page pb-safe-nav` (or `min-h-screen page-warmth`) and all are correctly listed in `DOCUMENT_SCROLL_ROUTES` (`/legal`, `/data-rights`, `/jobs`, `/job-history`, `/business`, `/for-business`). Layout choice agrees with the route classification.

### `src/pages/Admin.tsx`
- **What** — Uses `min-h-screen bg-premium-page` but `/admin` is NOT in `DOCUMENT_SCROLL_ROUTES`. This means `html.app-shell` clips the page at viewport height. The admin user list is long — content past 100dvh is silently inaccessible on iOS.
- **Why it matters** — Critical for admin staff. They literally can't reach the bottom of the user list.
- **Recommended fix** — Two paths: (a) add `/admin` to `DOCUMENT_SCROLL_ROUTES` in `src/hooks/useAppShellViewport.ts`, or (b) restructure Admin to use AppShell with an internal scroll surface. Option (a) is one-line and matches the intent. **Out of scope for this audit pass** because it's a real behavior change (alters viewport lock for that route). Flagged here so a follow-up can pick it up.

## Components — `src/components/dashboard/*`

### `src/components/dashboard/ApplyConfirmDialog.tsx:159`
- **What** — `<label>` for the "Certs or previous work — optional" group with no `htmlFor` and no associated input (the real input is wrapped by a different `<label>` below).
- **Why it matters** — Bare unattached `<label>` elements break the form-control association rule. AT users hear "label" announced with nothing to act on.
- **Recommended fix** — **(fixed in this PR)** Replaced with `<p>` — it's a section heading, not an input label.

### `src/components/dashboard/BrowseTasksFeed.tsx`
- **What** — Looks great — the error / empty / loading branches all live here and were partly already fixed in PR #357. Recommended-jobs animation correctly honors `prefers-reduced-motion`.

### `src/components/dashboard/BrowseTasksToolbar.tsx`
- **What** — Aria-labels on the icon buttons (search, filters) are present and include the active-count when filters are applied. Solid.

### `src/components/dashboard/DashboardHeader.tsx`
- **What** — All icon buttons (Admin, NotificationPanel, Menu, Logout) have aria-labels. Solid.

### `src/components/dashboard/JobCard.tsx:173`
- **What** — Poster-avatar `<a>` has `aria-label={`View ${job.posterName}'s profile`}` — good. The card root `interactiveProps` (line 105) injects `aria-label={`View ${job.title} — $${job.budget}`}` — good. Truly clean.

### `src/components/dashboard/JobDetailDialog.tsx`
- **What** — Every footer icon button has an explicit `aria-label`. Solid.

### `src/components/dashboard/JobFilters.tsx`, `JobPosterCard.tsx`, `PhotoLightbox.tsx`, `SwipeableJobCard.tsx`, `VirtualizedJobList.tsx`, `YourHelpersRow.tsx`, `prefetchJobDialog.ts`, `types.ts`
- **What** — Skimmed for the per-component issues; nothing surfaced that wasn't already in scope above.

## Components — `src/components/auth/*`

### `src/components/auth/AuthShell.tsx`
- **What** — Solid. `compactHeader` and `hideHeader` props well-documented. The Helpr·LA wordmark has `aria-label="Helpr LA home"` only on the compact variant — the full-header variant's wordmark `<Link to="/">` has no aria-label (line 102), so AT users hear the literal text content of the spans ("Helpr · LA"), which is fine.

### `src/components/auth/GoogleSignInButton.tsx`, `AppleSignInButton.tsx`
- **What** — Solid. Both have `aria-hidden` on the inline brand SVG and the button text serves as the accessible name.

## Components — `src/components/profile/*`

### `src/components/profile/SubscriptionTab.tsx:281`
- **What** — `bg-burnt-sienna-soft` — non-existent Tailwind class. Brand tokens aren't extended in `tailwind.config.ts`.
- **Why it matters** — Per the CLAUDE.md "Tailwind brand-token bug" footgun, classes like `bg-burnt-sienna-*` silently compile to no CSS. The inline `style` for the inactive state already supplies the background, so this is dead class debt.
- **Recommended fix** — **(fixed in this PR)** Dropped the dead class.

### `src/components/profile/SecurityTab.tsx:49`
- **What** — Email change opens with `prompt("Enter new email address:")` — a browser-native modal. On iOS native this is an OS-level prompt that looks foreign to the design system.
- **Why it matters** — UX disconnect. Every other input in the app is a styled `<Input>` inside a brand dialog.
- **Recommended fix** — Replace with a `BrandConfirmDialog` (or equivalent) hosting an `<Input>`. Behavior change — out of scope.

### `src/components/profile/ProfileLanding.tsx`
- **What** — 846 lines. Skimmed key sections: completion checklist, hero, badges all look correct. The `memberSinceLabel` ternary handles the new-account edge nicely.

### `src/components/profile/ProfileSectionError.tsx`
- **What** — Excellent component. The sub-section recoverable-error pattern is exactly right.

### `src/components/profile/ProfileTabHeader.tsx`
- **What** — Clean primitive.

### `src/components/profile/HelperTierBadge.tsx`
- **What** — Strong. Tap → popover → progression hint is great UX.

### `src/components/profile/JobListTab.tsx`
- **What** — Solid empty states. CTAs are conditional on `isPosted`. Good copy.

### `src/components/profile/CredentialsTab.tsx`
- **What** — Skimmed icon buttons (lines 322, 418) — both have aria-labels. The "Remove uploaded license" / "Remove uploaded insurance certificate" buttons are properly labeled.

### `src/components/profile/AvailabilityTab.tsx`, `WarningsTab.tsx`, `ReviewsTab.tsx`, `LegalTab.tsx`, `SavedHelpersTab.tsx`, `ScheduleTab.tsx`, `SupportInline.tsx`, `EarningsTab.tsx`, `EarningsForecastCard.tsx`, `HelperScheduleStrip.tsx`, `HelperStreakBadge.tsx`, `DeleteAccountDialog.tsx`, `PublicReviewWall.tsx`, `ProfileEditForm.tsx`
- **What** — Surveyed for layout / capitalization / brand-token bugs; no flagged issues. These are mature components.

## Things outside this PR's mechanical scope

These are real findings but require behavior changes / structural moves, so they're documented here for a follow-up PR rather than included with mechanical fixes:

1. **`/admin` viewport clipping** — `src/pages/Admin.tsx` uses `min-h-screen` but `/admin` isn't in `DOCUMENT_SCROLL_ROUTES`. Long admin lists are clipped past 100dvh on iOS. One-line fix in `src/hooks/useAppShellViewport.ts`; flagged separately because it's a viewport behavior change.
2. **Signup Step 1 inline errors** — Migrate from `toast.error` to the `step1Errors` map pattern Step 2 already uses.
3. **`SecurityTab` email-change prompt** — Replace native `prompt()` with a branded `BrandConfirmDialog`.
4. **`NotFound` Go back dead-end** — `window.history.back()` does nothing for deep-link landings; fall back to `/`.
5. **Dock-clearance padding deduplication** — Three call sites duplicate `calc(env(safe-area-inset-bottom, 0px) + 96px + …)`. Extract to a CSS custom property or new `pb-safe-dock` utility.
6. **Account hero text scaling** — `Dashboard`'s ban/deny fallback heros use `text-ds-24` instead of the `text-page-title` utility (visual drift, not a bug).

## What this PR changed mechanically

| Concern | File | Commit |
| --- | --- | --- |
| Honest error copy | `src/components/ui/ErrorState.tsx`, `src/components/messages/ChatView.tsx`, `src/pages/DashboardGuest.tsx` | `polish(copy): honest error copy …` |
| Dead Tailwind class | `src/components/profile/SubscriptionTab.tsx` | `polish(tailwind): drop dead bg-burnt-sienna-soft …` |
| Sentence-case button + dialog labels | `src/pages/Dashboard.tsx`, `src/pages/AccountPending.tsx` | `polish(copy): sentence-case button + dialog labels` |
| Form label/input pairing | `src/pages/CompleteProfile.tsx`, `src/components/dashboard/ApplyConfirmDialog.tsx` | `polish(a11y): pair form labels with their inputs` |

No behavior changes. No new features. No new dependencies. All three checks
(`npm run typecheck && npm run lint && npm run build`) pass.
