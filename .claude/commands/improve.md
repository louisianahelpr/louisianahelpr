---
description: Design-improvement pass — lock one canonical design system, then propose per-screen improvements that all cite it. Writes docs/SCREEN_IMPROVEMENT_PLAN.md
argument-hint: "[optional scope, e.g. 'just the activity flow' or 'business persona screens']"
---

# Louisiana Helpr — Screen-by-Screen Design Improvement Pass

You are running a **design-improvement pass** on **Louisiana Helpr** — NOT a ship-readiness audit.
(`/audit` finds and grades problems; this command proposes concrete improvements and drives the whole
app toward **one consistent, well-organized design system**.) Even good screens get "here's what would
make this excellent." No sampling — **every screen**.

Stack reminder: Capacitor app, **React 18 + TS + Vite in `src/`** (this *is* the iOS/Android/web app);
shared UI primitives in `src/components/ui/`; the only fixed-viewport primitive is `AppShell`
(`src/components/AppShell.tsx`), with `PageScaffold` as its two-card wrapper. The app is **never
role-based** — every account can post AND do jobs. Don't propose role-gating.

$ARGUMENTS

## The key move: establish the canon FIRST, then make every suggestion cite it

Consistency is **enforced, not hoped for** — because every per-screen suggestion must reference the
single standard defined in Phase 0. Work the phases in order.

### Phase 0 — Lock the canon → `DESIGN_SYSTEM_REFERENCE`

Before touching any screen, read the codebase and define the one true system. Where the code currently
**contradicts itself, pick the canonical choice and justify it.** Produce:

- **Token scale** — the blessed color/spacing/radius/typography/elevation tokens. Note: brand tokens
  must be referenced as `hsl(var(--token))` utilities (e.g. `from-[hsl(var(--parchment))]`), NOT bare
  Tailwind names like `from-parchment` (those silently produce no styles).
- **Blessed component versions** — for each recurring UI pattern (button, chip, card, dialog, input,
  skeleton, toast, empty state), name the single canonical `src/components/ui/` component and flag any
  hand-rolled duplicates to retire.
- **Standard states** — the canonical loading, empty, error, and success treatments.
- **Data display standards** — how money, dates/times, and status badges are rendered everywhere.
- Standard touch-target minimums and safe-area handling (`AppShell` owns the 100dvh lock + insets).

### Phase 1 — Screen inventory

Enumerate every routed page (`src/App.tsx`), overlay/sheet/dialog, and account-state screen. Tag
persona (guest/customer/helper/business/family/admin/account-state) and shell archetype. This is the
checklist Phase 2 must cover in full.

### Phase 2 — Per-screen improvement cards (every screen, fixed template)

For each screen produce one card:

```
### <ID> — <Screen> (<route>) — persona / shell
**Current state:** <what's there now, file:line anchors>
**Suggestions:**
  - Hierarchy:    <visual hierarchy / emphasis>
  - Consistency:  <cite the Phase-0 canon it should match>
  - Usability:    <interaction, affordance, feedback>
  - Organization: <grouping, layout, IA within the screen>
  - Copy:         <microcopy, labels, empty/error text>
  - Polish:       <motion, spacing, native feel>
**Improved layout (text wireframe):** <ASCII sketch of the better layout>
**Priority:** P1 (do first) / P2 / P3 — for THIS screen
```

Every "Consistency" line must point at a specific Phase-0 standard.

### Phase 3 — Cross-screen consistency sweep

- **Find/replace map** for off-token colors/spacing → the canonical token.
- **Component-consolidation list:** every duplicated/hand-rolled pattern → the one blessed component.
- **Inconsistency heatmap:** which flows/personas are most inconsistent today.

### Phase 4 — IA / organization pass (the "organized" half)

- Nav structure per persona; flatten overly deep flows; merge overlapping/redundant screens; fix
  naming inconsistencies. Produce a **current → proposed nav map**.

### Roadmap — sequenced so foundations land first

Order the work: **(1) foundations** (tokens + shared components) → **(2) consistency sweep** →
**(3) per-screen polish** → **(4) structural/IA reorg**. Later steps build on the standardized pieces
instead of fighting them.

## Output

- Write the full plan to **`docs/SCREEN_IMPROVEMENT_PLAN.md`** (Phase 0 reference, screen cards,
  consistency sweep, IA pass, sequenced roadmap).
- **Append the roadmap** to `TODO.md`.

This is a planning/proposal pass — it writes docs, it does not refactor code. When the user later picks
items to implement: commit directly to `main` (per CLAUDE.md — this file used to say "branch + PR,
never commit to main", which was the opposite of the repo rule), respect the "never guess UI targets" rule
(fix the exact element named, confirm before editing visuals), rebuild + sync the iOS simulator after
UI changes, and end commits with the required `Co-Authored-By` trailer.
