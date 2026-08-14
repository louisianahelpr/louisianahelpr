# Exhaustive global audit — prompt

Paste everything below the line into a fresh session.

---

You are auditing **Louisiana Helpr** end to end. Your job is to find every
defect that a careful, sceptical engineer would find if they looked at every
screen on every surface — and to report nothing you have not verified.

## 0. Read this first: the stack is not what it looks like

This is a **Capacitor** app. The entire UI, navigation, state and business
logic is **React 18 + TypeScript + Vite** in `src/`, built to `dist/` and
shipped inside a native shell. `ios/App/App/AppDelegate.swift` is stock
boilerplate. **There is no meaningful native code.** Do not audit for SwiftUI,
`@State`, `@Observable`, or Swift concurrency — none exist. The React code in
`src/` *is* the iOS app.

- Backend: Supabase (Postgres, RLS, RPCs, ~61 edge functions in `supabase/functions/`)
- Payments: Stripe Connect (escrow)
- Checks: `npm run typecheck` · `npm run lint` · `npm run build` · `npx vitest run`

Read `CLAUDE.md` and `.claude/skills/lh-audit/SKILL.md` before starting. Every
rule in them is mandatory.

## 1. The prime directive: measure, never infer

Most bad audit findings come from a confident guess, not a missing check. The
last audit produced **four separate false-positive classes** before catching
itself. You are expected to do better, and the way you do that is:

> **Never report a finding you have not observed directly. If your tool says
> something is broken, verify the tool before believing it.**

Specific traps that have already produced wrong findings here:

| Trap | What went wrong | What to do |
|---|---|---|
| **`rgba()` alpha ignored** | A 4%-opacity wash read as solid colour → 67 phantom contrast failures on one page that were really 0 | Composite alpha over the parent chain, or don't compute contrast yourself at all (see §5) |
| **Gradient backgrounds** | Only `backgroundColor` was read; a gradient button reported as transparent | Read `backgroundImage` too, or use a real a11y tool |
| **Hidden elements counted** | A `0x0` desktop-only element was measured at 375px | Filter to `getBoundingClientRect().width/height > 0`, `visibility`, `opacity` |
| **Layered translucency** | Effective background computed lighter than reality; 4.99:1 reported as 4.04:1 | Composite every layer, bottom-up |
| **`baseRefOid` ≠ what CI built** | Concluded a PR contained a fix it didn't, then reported a nonexistent regression twice | Use the run's `headSha`; verify with `git merge-base --is-ancestor` |

**Before reporting any measured number, sanity-check it.** A result that is
impossible (0 matches for a pattern that must exist; 100% of anything failing;
a ratio of exactly 1.0) means your measurement is broken, not the app.

## 2. Tooling gotchas that silently produce wrong answers

- **zsh eats `grep --include=*.tsx`** and returns 0 matches for everything,
  including files that contain their own name. Never use `--include` here.
- **A reported exit code may belong to a trailing `echo` or `tail`**, not the
  command you care about. Verify by artifact or log content.
- **Never `2>/dev/null` on `git push`.** It has hidden rejected pushes and made
  a correct fix look broken for hours.
- **macOS has no `timeout` / `gtimeout`.** `timeout N cmd` exits 127 and your
  command never runs.
- **Duplicate `className` on a JSX tag silently drops the first one.** A
  line-based grep will NOT catch one sitting on a different line of the same
  tag. Only `tsc` (TS17001) finds it reliably — run `npm run typecheck` after
  any scripted JSX edit.
- **Theme is `data-theme` on `<html>`**, not `prefers-color-scheme`. Setting the
  browser's colour scheme tests nothing. Set the attribute.

## 3. The surface you must cover — all of it

There are **68 routes** (`grep -oE 'path="[^"]+"' src/App.tsx`). Enumerate them
from the router; do not work from a list you wrote from memory. For each route
record whether it renders, redirects, or requires auth.

Cover every one of these axes. A route is not audited until all apply:

- **375×812** (phone) — this is the same surface as the native app. The
  phone-sized website and the iOS app are ONE surface; never accept a
  divergence justified by `Capacitor.isNativePlatform()` unless it is a genuine
  native capability.
- **1440×900** (desktop, left rail present)
- **Light and dark** (`document.documentElement.setAttribute('data-theme', …)`)
- **Logged out and logged in.** Most routes are auth-gated. Public-only coverage
  is roughly 11 of 68 — if you audit only what loads without a session, you have
  audited a sixth of the app. Say so explicitly if you cannot log in.
- **Empty, loading, error, and populated states.** Force them.

## 4. What to check on every screen

**Layout** — the largest and least forgiving section. Every item is measurable;
measure it, don't eyeball it.

*Overflow and fit*
- `documentElement.scrollWidth <= clientWidth` — zero horizontal overflow. If it
  overflows, name the widest offending element and its computed width.
- No single element wider than the viewport. Walk `#root *` and compare each
  `getBoundingClientRect().width` against `clientWidth`.
- Check at **320, 375, 414, 768, 1024, 1440** — the same ladder
  `mobile-viewports.yml` uses. 320 is where truncation and wrapping break first;
  most overflow bugs here have been decorative elements bleeding past a parent
  (`-inset-16` style halos widening the scroll area).
- Long-content stress: a 40-character unbroken word, a very long job title, a
  long email address in a narrow card. Confirm it wraps or truncates rather
  than pushing the layout wide.

*The desktop rail — this has broken twice*
- The rail inset is applied in exactly ONE layer, globally. Fixed-shell pages
  clear it via `.app-shell-frame { left: var(--desktop-sidebar-w) }`;
  document-scroll pages via the global `html.web-desktop.desktop-rail:not(.app-shell) #root`
  padding rule in `index.css`.
- **A page must never re-inset itself** — no per-page `paddingLeft: var(--desktop-sidebar-w)`,
  no `lg:pl-[248px]`, no extra flex spacer. Doing so pushes content right by a
  *second* rail width. This exact bug shipped on PostJob: `#root` padded 248px
  AND the page padded 248px, so the form sat at x≈496 with a dead 250px gutter.
- After the single inset, assert the content column is centred in the
  *post-rail* area: its visual centre should be `(rail_width + viewport) / 2`,
  not the raw viewport centre. Measure it; a lopsided column with a blank band
  is a failure, not a nicety.

*One width ladder*
- The canonical content ladder is `max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]`.
  At 1440 every content page should resolve to the **same** column width
  (currently 1280px). Navigate several routes in one pass and assert the width
  does not change between them — a column that jumps as you navigate is the
  defect, and it is invisible if you only ever look at one page.
- Forms are allowed to be narrower on purpose (PostJob is, and says so in a
  comment). A deviation is only a finding if nothing explains it.

*Shell choice*
- Fixed-shell vs document-scroll must agree with `DOCUMENT_SCROLL_ROUTES` in
  `src/hooks/useAppShellViewport.ts`. Assert the `app-shell` class on `<html>`
  matches the list for every route.
- `AppShell` owns the ONLY implementation of the 100dvh lock, the internal
  scroll container, the safe-area top inset and bottom-nav clearance. Any page
  re-implementing those is a finding.
- Getting this wrong is not cosmetic: if a tall AppShell-based page is missing
  from the list, `html.app-shell { overflow: hidden }` clips everything below
  the fold and the user cannot reach it. Scroll to the bottom of every
  fixed-shell page and confirm the last actionable control is reachable.

*Vertical space and insets*
- Safe-area insets: top (notch) and bottom (home indicator) respected. Content
  must not sit under the status bar, and the last element must clear the home
  indicator and the bottom nav.
- Bottom-nav clearance (`pb-safe-nav`) present on pages that show the dock, and
  **absent** where the dock does not render — an unconditional clearance is a
  visible dead band under the footer.
- No dead bands generally: an empty gutter above or below content, or a page
  whose content floats mid-viewport with nothing anchoring it.
- Short-viewport / landscape: at **375×500**, confirm auth and form pages still
  scroll to their submit button. Login has stranded users this way before.

*Dynamic layout*
- Sticky and fixed elements: scroll each page and confirm headers stick where
  intended, do not overlap content, and do not double up (a sticky page header
  under a fixed nav).
- Modals, sheets and dialogs: open each one; confirm it fits the viewport, its
  own content scrolls if tall, the page behind does not scroll, and it is not
  clipped by an ancestor.
- Keyboard: focus a text input at 375 and confirm the field is not covered.
- Layout shift: watch for content jumping as images and async data land. Images
  should reserve space (explicit dimensions or aspect ratio).
- Web only: at 200% browser zoom (WCAG 1.4.4) the page must remain usable
  without horizontal scrolling. Native disables pinch-zoom deliberately — do
  not "fix" that.

**Typography**
- Every size is a `ds-*` token. No arbitrary `text-[13px]`, no inline
  `style={{ fontSize }}`. ESLint enforces this with a shrinking legacy ledger in
  `eslint.config.js` — the ledger must only get smaller.
- Nothing below the 9px floor (`ds-9`).

**Interaction**
- Every tappable target ≥44px. Note that the global rule in `index.css` covers
  `button`, `[role=button]` and native inputs but **NOT `<a>`** — links styled
  as buttons are below the floor by construction. Use the `.tap-44` utility.
- Exactly one `<h1>` per page; heading levels don't skip.

**Correctness**
- Zero console errors, warnings, or unhandled rejections per route.
- No Supabase `error` dropped on the floor. `const { data } = await supabase…`
  swallows failures into a blank screen. In a React Query `queryFn` use
  `unwrap()` (`src/lib/supabaseResult.ts`); elsewhere check `error`.
- Every `postgres_changes` channel has a user-scoped server-side `filter` and a
  unique name via `channelNonce()`.

**Content**
- Sentence case in UI copy, and the same casing in Stripe line items and email
  templates — those are the same product surface and have drifted before.
- No placeholder or lorem text; no claims about features that don't exist.

## 5. Accessibility: use the real tool

**Do not hand-roll a contrast checker.** The repo already runs axe inside
Playwright (`e2e/happy-path/`). Use that, or Lighthouse. A bespoke sampler has
already produced four classes of false positive here and cost hours.

If axe reports a violation, note that the harness prints only the rule and node
count — to get the offending selector you must reproduce locally.

## 6. Dead code and comment rot

**Comment rot is this repo's recurring bug class.** It has caused at least five
real defects: a `--ease-spring` token defined as `var(--ease-spring)` (silently
disabling every spring) while the comment above described it working; a "show
amber pill" comment above code painting gold; a `hideHomeLink` prop documented
across six files after the link it controlled had become unreachable.

So:
- When a comment asserts behaviour, **verify the behaviour**. A confident
  comment is evidence of intent, not of current fact.
- Look for UI gated on conditions that can never be true (a prop every call site
  disables). Check call sites, don't assume.
- **Report dead code; do not delete it unprompted.** Deleting something that
  looks unused but isn't is worse than leaving it.

## 7. How to work

- **Screen by screen, and actually look.** Do not substitute a code-grep sweep
  for viewing the page. Screenshot each screen; inspect what rendered.
- **Sweep systematically, not by screenshot.** When you find a defect, find
  every other instance of it in one pass. Most findings here follow the pattern
  *"a rule existed, was applied to two or three places, then never swept"* —
  one route sweep found 10 orphaned bells and 9 stray props.
- **Parallelise across disjoint files.** Split the route surface and fan out.
  Two constraints, both learned the hard way: agents must not share files (they
  leak commits into each other and into the shared repo — verify every diff
  before you trust it), and each agent should `git checkout origin/main` first,
  because worktrees fork from local HEAD, which may be stale.
- Run the gate before every commit: `npm run typecheck`, plus `npx vitest run`
  when touching tested code. Lint runs on commit; CI runs the rest.
- Commit directly to `main`. End messages with:
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

## 8. Reporting

**Report first, then fix.** For every finding give:

1. **Route and viewport** where you saw it
2. **The measurement** — the actual number, selector, or screenshot; not "looks off"
3. **Severity** — blocker / should-fix / polish
4. **Whether you verified it**, and if not, say so plainly

Separate three buckets and never blur them:
- **Verified defects** — you observed them
- **Suspected** — needs a check you couldn't run (e.g. auth-gated)
- **Decisions** — things that are the owner's call, not bugs

State your coverage honestly at the end: which routes you reached, which you
could not, and why. **An audit that claims completeness it does not have is
worse than a short one that names its gaps.** If you could not log in, the
headline is "I audited 11 of 68 routes", not a list of eleven clean screens.

Missing a real finding is worse than reporting cost. But reporting a finding
that dissolves under inspection is worse than both — it burns trust and hours.
Verify, then report.
