# AGENTS.md — project-level conventions for AI agents working on Helpr

This is what to know before touching the codebase. Keep it tight — if a
section gets stale, fix it. Don't append "addendums" indefinitely.

## TL;DR for a fresh session

- **Brand voice is editorial restraint.** Warm charcoal not black. One
  restrained effect at a time. The visual identity (Garden District
  Stone) is a *light* theme; dark mode is supported but is a
  minimum-viable-parity pass.
- **Gloss is scoped — it marks what you press, it never decorates.**
  *No gloss/glow on decorative surfaces*: cards, panels, page/section
  backgrounds, empty-state art, dividers, glyph tiles, and any
  badge/chip that isn't a selected state all stay matte. The one place
  gloss is **required** is the primary action affordance: green/bark
  **primary** buttons and **selected** controls use `btn-grad-primary`
  / `<Button variant="bark">` and must never render flat. A flat
  primary button and a glowing decorative card are both defects —
  neither rule licenses the other. Same rule, stated identically in
  `.claude/skills/lh-audit/SKILL.md` §3 ("Color & effects"); if you
  change one, change both.
- **Cowork handles** Supabase migrations, iOS native builds, edge
  function deploys, and anything needing the Studio MCP / Apple
  Developer / App Store Connect creds.
- **Lexi handles** content/copy decisions, brand judgement,
  TestFlight triggers, GitHub-secrets entry, Sentry alert paste-in.
- **You handle** TS/JS/CSS code, React, Vitest tests, CI YAML,
  shadcn-built UI, anything in `src/` and `.github/workflows/`.

## Editorial type pattern (use this on every new surface)

The pattern is: **sienna eyebrow → italic Bodoni headline →
italic Garamond body**. Used on hero cards, dialog headers,
empty states, onboarding screens, page headers. Copy-paste the
following for any new editorial surface:

```tsx
<span
  className="font-serif italic uppercase text-[0.62rem]"
  style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
>
  Eyebrow text
</span>
<h1
  className="font-display italic font-bold leading-tight mt-1"
  style={{
    fontSize: "clamp(1.35rem, 2vw + 0.4rem, 1.65rem)",
    color: "hsl(var(--ink-deep))",
    letterSpacing: "-0.025em",
  }}
>
  Headline.
</h1>
<p
  className="font-serif italic mt-2 text-[0.92rem] leading-relaxed"
  style={{ color: "hsl(var(--olivewood) / 0.78)" }}
>
  Supporting body text.
</p>
```

The `text-display-eyebrow` utility (defined in `index.css`) is the
short form of the eyebrow span — use it when you don't need to
override the inline color.

For glyph badges (used in editorial empty states + dialog headers):

```tsx
<div
  className="w-14 h-14 rounded-2xl flex items-center justify-center"
  style={{
    backgroundColor: "hsl(var(--primary) / 0.10)",
    border: "1px solid hsl(var(--primary) / 0.18)",
    color: "hsl(var(--primary))",
    boxShadow:
      "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
      "0 6px 18px -6px hsl(var(--primary) / 0.30)",
  }}
>
  <Icon className="w-6 h-6" strokeWidth={1.75} />
</div>
```

Reference implementations: `ReportDialog.tsx`, `SavedSearches.tsx`,
`PermissionRationaleDialog.tsx`, the empty states in
`Activity.tsx` / `SavedHelpersTab.tsx` / `EarningsTab.tsx`.

## Dialog rules

1. **Always** add `onOpenAutoFocus={(e) => e.preventDefault()}` to a
   `DialogContent` whose first focusable child is an `<Input>` or
   `<Textarea>`. Otherwise iOS pops the keyboard the moment the
   dialog opens, hiding most of the form.
2. The base `DialogContent` already caps at `max-h-[88dvh]` with
   internal scroll. Don't re-add `max-h-[90vh] overflow-y-auto` on
   individual dialogs — it conflicts with the cap.
3. Mobile padding on `DialogContent` is `p-5`; sm+ is `p-7`.
   Already in the base — don't override unless you have a reason.

## Safe-area + MobileNav clearance

The floating dock (`MobileNav`) is ~96px tall plus the
`safe-area-inset-bottom`. **Any scrollable surface that ends near
the dock needs:**

```tsx
style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1rem)" }}
// or via Tailwind:
className="pb-[calc(env(safe-area-inset-bottom,0px)+96px+1rem)]"
```

`pb-32` (128px) is **2px short** on notched iPhones. Don't use it.
The Tailwind utility `pb-safe-nav` may be defined in some
configurations — if it's there, use it. Otherwise the calc above is
canonical.

For pages that use `AppShell`, set `scrollable={true}` and AppShell
adds the bottom padding for you. For pages that hand-roll their own
`<div className="h-[100dvh] flex flex-col">` shell, the inner
scrollable region needs the explicit padding above.

## Header double-safe-area gotcha

`DashboardHeader` already applies `paddingTop: env(safe-area-inset-top)`
internally. If you wrap it in a parent that also adds safe-area top
padding (e.g. inside `AppShell`'s `header` prop), you get a double
pad and ~50-60px of dead space at the top on notched phones. Either:
- Render `DashboardHeader` directly (not through AppShell's `header`
  slot), OR
- Make AppShell's wrapper set `paddingTop: 0`, OR
- Strip the inner padding from a single-use header.

Reference: the Profile.tsx fix in commit `908df352` and the
PageHeader fix in commit `53000f3b`.

## Migration filename hygiene

**Always** generate new migrations with:

```bash
npm run migration:new -- <slug>
```

This runs `scripts/new-migration.mjs`, which stamps a collision-safe
`YYYYMMDDhhmmss` prefix and refuses to write if that version already exists.
**Never** use `supabase migration new` directly — it does not have the
collision guard, and three version collisions happened in a single day under
parallel lanes before the wrapper was written. **Never** hand-roll prefixes
like `20260506240000` (hour 24+ is invalid and won't parse as a timestamp
— only string-sorts correctly by accident).

If a migration is applied to prod via the Studio MCP
`apply_migration` path, the recorded `schema_migrations.version` is
the *current time*, not the file's prefix. To keep `db push
--include-all` idempotent, rename the local file to match the
recorded version. Cowork has tooling for this (see the
2026-05-09 rename PR).

## CI workflows

| Workflow | Triggers | What it does |
|---|---|---|
| `db-smoke.yml` | PR with migration changes | Boots a Supabase Postgres, applies all migrations, fires the post-job trigger, fails on regressions. |
| `migration-lint.yml` | PR with migration changes | RLS / CHECK / DROP / reserved-schema lint. |
| `db-deploy.yml` | Push to `main` with migration changes | `supabase db push --linked --include-all` against prod. Concurrency-locked. |
| `db-drift-detect.yml` | Nightly 06:00 UTC | Diffs local migration files vs prod's `schema_migrations`, opens/closes a labeled GitHub issue. |

**All four need three repo secrets to function:**
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`,
`SUPABASE_PROJECT_REF=fncmgoasalhdgfwzhsqa`. Set in
Settings → Secrets and variables → Actions.

## TypeScript types regen

After any migration that adds/changes columns:

```bash
npm run db:types
```

This regens `src/integrations/supabase/types.ts` from prod's
`public` schema. Needs `supabase login` or `SUPABASE_ACCESS_TOKEN`
in the env. Function-only / policy-only / cron-only migrations
don't change generated types — skip the regen for those.

## iOS build flow

1. `npm run build:ios` — production web build with Capacitor flag
2. `npm run sync:ios` — copies bundle into `ios/App/App/public/`,
   syncs metadata, runs the verifier
3. Open `ios/App/App.xcodeproj` in Xcode
4. If App Store Connect rejects a duplicate build number, raise
   `versioning.current_project_version` in `fastlane/ios_app_metadata.yml`
   (CI auto-bumps it past that floor on every archive; manual edits
   are only needed when ASC's API lags and reports a stale highest build)
5. Re-run `npm run sync:ios` so the new build number propagates
6. Either: Xcode Archive + Upload manually, OR push the trigger
   in Actions → "Deploy iOS (TestFlight / App Store)"

## Working with Cowork (the offshore agent)

Cowork has different sandbox permissions: Studio MCP for Supabase,
Apple Developer access, GitHub Actions write. They CAN:
- Run `gh workflow run` to fire iOS builds
- Modify Supabase function configs

They CAN'T (without your help):
- Apply migrations via MCP `apply_migration` — BANNED. Records the wrong
  timestamp in `schema_migrations` and breaks automated deploys. Migrations
  go through the normal file + PR → `db-deploy.yml` path only (see CLAUDE.md).
- Read `/Users/lexilombas/Developer/louisianahelpr/` directly —
  ask them to write scripts you run from your sandbox.
- Add GitHub repo secrets (Lexi must do via web UI).
- Create Sentry alert rules (no API surface in their MCP).
- Trigger Capacitor Archive + Upload from Xcode (needs Lexi's Mac).

Cross-session protocol when authorizing prod-touching work:
- Always specify ORDER explicitly (when migrations have deps).
- Always specify STOP CONDITIONS (halt + report, don't improvise).
- Always specify VERIFICATION (what query/smoke test confirms
  success).

## What NOT to do

- Don't use generic shadcn `<DialogTitle>` styling on user-facing
  dialogs. Apply the editorial header pattern.
- Don't add inline `confirm()` JavaScript dialogs. Use the
  `<AlertDialog>` primitive.
- Don't write tests that hit a real Supabase. Mock
  `@/integrations/supabase/client`.
- Don't bypass the migration filename rule "just this once."
- Don't `git mv` migration files without coordinating — the
  prefix is the primary key into `schema_migrations`.
- Don't add `pb-32`. Use the safe-area calc.
- Don't disable `lint-staged` to push a fix. Fix the lint.

## Reading the codebase

- `src/pages/` — top-level routes (Dashboard, Activity, Profile,
  Messages, Post, Login, Signup, etc.)
- `src/components/` — shared UI; many are domain-named
  (`JobCard`, `MobileNav`, `AppShell`)
- `src/components/ui/` — shadcn primitives (Dialog, Button,
  Input). **Edit with care** — every dialog inherits from
  `Dialog.tsx`.
- `src/components/dashboard/` — Dashboard-only chrome
  (`JobFilters`, `JobDetailDialog`, `JobCard`)
- `src/components/profile/` — Profile tab components
  (`SubscriptionTab`, `EarningsTab`, and others); `PaymentTab` is at
  `src/components/PaymentTab.tsx` (outside the `profile/` subdirectory)
- `src/lib/` — pure helpers, all should be Vitest-tested
- `src/hooks/` — React hooks, should also be tested
- `src/integrations/supabase/` — generated types + client
  singleton. Don't edit `types.ts` by hand.
- `supabase/migrations/` — chronological SQL. Append-only via
  `npm run migration:new -- <slug>` (see Migration filename hygiene above).
- `supabase/functions/` — edge functions, deployed independently
  via `supabase functions deploy <name>`.

## Memory & TODO

The user has an auto-memory system (per Claude Code's user prompt)
that persists across sessions. Brand restraint, OAuth client IDs,
pending action items live there. Don't restate that memory in this
file — read it at session start.

Project-scoped state lives in `TODO.md`. Keep the "Where We Left
Off — YYYY-MM-DD" block at the top current. Older blocks below
the line are historical session notes — don't re-read top to bottom
unless looking up history.
