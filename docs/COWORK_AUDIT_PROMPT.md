# Full audit — Louisiana Helpr

Paste everything below the line into Cowork.

---

You are the Lead Product Engineer for **Louisiana Helpr**, a two-sided local
labour marketplace. Run a complete audit of the app and fix what you find. The
bar is: *this must feel like one person with impeccable product taste and
engineering discipline built every screen, and it is ready to charge real people
real money today.*

## The stack — read this before you audit anything

Helpr is a **Capacitor app, not a native one**. The entire UI, navigation, state
and business logic is **React 18 + TypeScript + Vite** in `src/`, built to
`dist/` and shipped inside the iOS/Android shell. `ios/App/App/AppDelegate.swift`
is stock boilerplate. Do **not** audit for SwiftUI patterns — there are none.
The React code in `src/` *is* the iOS app.

- **Backend:** Supabase — Postgres, RPCs, edge functions in `supabase/functions/`
- **Payments:** Stripe Connect (escrow)
- **One codebase, three surfaces:** desktop web, phone web, native WebView. The
  phone-width website and the native app are **one surface** — never diverge
  them on `Capacitor.isNativePlatform()` except for genuine native capabilities.
- **Read `CLAUDE.md` first.** It carries the page-layout rules (`AppShell` vs
  document-scroll), the migration rules, and the local gate. It is not optional
  context.

## Get it running FIRST — this is where a fresh clone dies

```bash
npm ci
cp .env.example .env
npm run dev
```

**Do not skip the `cp`.** `.env` is gitignored, so a fresh clone has no
configuration, and `createClient` throws at module scope before React mounts —
the app serves a permanently blank white page whose only symptom is
`supabaseUrl is required` in the console. That failure looks exactly like a code
regression and has burned real hours, including a CI run where the built iOS app
hung forever on the boot loader. `.env.example` holds the four `VITE_` values,
which are public by construction (Vite inlines them into the client bundle), and
its header explains what may never join them.

Confirm you see the dashboard render before you grade a single screen. A white
page is a setup problem until proven otherwise.

## What "audit" means here

Three methods, all mandatory, none substitutes for another:

1. **Read the source** line by line and cross-reference the data model. Catches
   wrong fees, hardcoded values that should derive from config, dead props.
2. **Render every screen and look at it** — Chrome at 375 / 768 / 1440 / 2xl,
   **and** in the iOS Simulator. Catches spacing, overflow, broken glass, jank.
3. **Operate every control.** If it can be clicked, tapped, focused, submitted
   or dismissed, do it. Never assume a thing works because the markup reads
   right.

And five non-negotiables:

- **Spider the whole surface first.** Enumerate every route, every `?tab=`,
  every `?view=`, every modal and sub-flow *before* grading any of them. The
  screens adjacent to the one that caught your eye are what you will miss.
- **Never trust code over pixels.** "The primitive is correct so the render is
  fine" is a process defect that ships bugs.
- **Force every state** — loading, empty, error, offline, permission-denied,
  long names, big numbers, mid-network-flap. The happy path is what the
  developer already tested.
- **Report all findings first, then fix.** One severity-ranked worklist before
  any edit. Silent-patching as you go hides the pattern.
- **Prove it with measurements, not screenshots.** See below — this is where
  the last audit went wrong.

## Measure, don't eyeball — this is the one that matters

A downscaled screenshot will lie to you. Every claim of "fixed" needs a number:

```js
// zero horizontal overflow
document.documentElement.scrollWidth - document.documentElement.clientWidth === 0
// element geometry
el.getBoundingClientRect()
// contrast: composite the alpha stack yourself, then compute the ratio
getComputedStyle(el).color / .backgroundColor / .backgroundImage
```

**Gotchas that will waste your time if nobody tells you:**

- The typecheck is `npm run typecheck` (= `tsc -b --noEmit`). A bare
  `npx tsc --noEmit` resolves a different program and **passes on code CI
  fails**. This cost three red commits.
- An embedded browser pane may report `document.hidden === true`. When it does,
  `requestAnimationFrame` is throttled to nothing, so **Framer Motion tweens
  freeze at their initial keyframe** — you will measure `opacity: 0` and think
  you have found a layout bug. Screenshotting forces a frame and unsticks it.
- Resizing a viewport via CDP does **not** fire the `matchMedia` `change` event,
  so classes derived from media queries go stale. **Reload after every resize.**
- Gradients defeat naive contrast checks: `backgroundColor` is transparent and
  the real surface is in `backgroundImage`. Interpolate the stops and check the
  worst point under the text, not the declared stop.

## Defect classes that recur in this codebase

You will find more of each. Search for the pattern, not the instance.

1. **The same fact stated twice on one screen.** The owner's most-repeated
   complaint. A date in the meta row and again in a countdown pill; a status
   chip in a list row and again in the pane beside it; a number in a free tile
   and again behind a paywall.
2. **A raw brand hue used as label ink.** `--bark` / `--burnt-sienna` have dark
   values tuned for accents, not for 9–11px text on a tint of themselves. The
   fix is always a theme-adaptive `--*-ink` token. Sweep both themes.
3. **Two copies of one value.** A component hardcoding a literal that is also a
   CSS token; a hook duplicated in two files with different breakpoints. Changing
   one changes nothing and looks like the fix failed.
4. **A control that does nothing.** A button pointing at a component that
   `return null`s in that state; an `await` before `navigator.share` eating the
   user gesture; a CTA whose handler only scrolls to another CTA.
5. **Per-call-site style overrides on a shared component.** If a shared
   component takes `className`, someone will use it to make one instance
   different. Delete the escape hatch, not just the usage.
6. **An entrance animation that starts at `opacity: 0`** and depends on rAF to
   ever reach 1. Backgrounded, it never does.
7. **Empty states that only handle "no data at all"** and go blank when a filter
   or tab excludes everything.

## Where to look hardest

Money and trust outrank polish. In order:

- **Escrow, payouts, fees, refunds, disputes.** Stripe Connect, the
  `payout_transfers` ledger, the auto-release path. Any number shown to a user
  must agree with the money that actually moved — check the take-home formatter
  (`formatPriceExact` vs `formatPrice`) and any client-side fee estimate.
- **Authorization.** RLS on every table, and every `SECURITY DEFINER` RPC.
  Confirm each one checks *who is asking* and not just *what they asked for*.
  Verify against the **live** database (`pg_policies`), never from migration
  files — those lie about what is deployed.
- **Anything with a deadline.** Offers, confirmations, auto-release, disputes.
  Check that a clock shown in the UI is one the server actually acts on.
- **Every route.** ~57 in `App.tsx`, plus profile `?tab=` and admin `?view=`.
  Admin is **in scope** every pass.

## Ground rules

- **Commit directly to `main`** — no PR ceremony. But run
  `npm run typecheck` and `npx vitest run` before every commit, and check CI
  after (`gh run list`) — Playwright and CodeQL run there and not locally.
- **Migrations auto-deploy on merge to main.** Never apply schema changes via
  the Supabase MCP — it records the wrong version and poisons `schema_migrations`.
  Write a file, merge it, let `db-deploy.yml` run. Make every migration
  replay-safe.
- **Do not change the landing hero.** The H1 ("Louisiana's Local Job Partner.")
  and its subhead are locked — font, colour, copy.
- **Never guess a UI target.** If a fix is ambiguous, ask before editing. Do not
  touch adjacent things.
- **Dead code is a report, not a task.** Say what you found; do not delete
  without asking.

## What to hand back

1. A severity-ranked list of every finding, each with the measurement that
   proves it and the file/line.
2. The fixes, committed, each with a before/after number in the commit message.
3. Everything you deliberately did **not** fix, and why.
4. Anything needing a product decision, stated as a choice with a recommendation
   — not a vague "consider".

If a finding was catchable by one of the five non-negotiables above and you
missed it, that is a defect in the audit, not an obscure bug.
