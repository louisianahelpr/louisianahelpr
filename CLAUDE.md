# Louisiana Helpr

## Stack — read this before any audit

Louisiana Helpr is a **Capacitor app**, not a native SwiftUI/UIKit app.
The entire UI, navigation, state, and business logic is **React 18 +
TypeScript + Vite** (in `src/`), built into `dist/` and shipped inside the
native iOS/Android shell. `capacitor.config.ts` bundles `dist/` into the
`.ipa`/`.apk` — it is a real, self-contained, App Store-distributed app
(App Store Connect, currently v1.0.x), just with a web UI layer.

There is **no meaningful native code**: `ios/App/App/AppDelegate.swift` is
stock Capacitor boilerplate. Do **not** audit for SwiftUI patterns
(`@State`, `@StateObject`, `@Observable`, Swift concurrency) — there are
none. Audit and improve the React/TypeScript code in `src/`; that *is* the
iOS app. Map any "native" concept to its React/Capacitor equivalent.

- **Backend:** Supabase — Postgres, RPCs, edge functions in `supabase/functions/`.
- **Payments:** Stripe Connect (escrow).
- **Native bridges:** Capacitor plugins (Haptics, Camera, Geolocation, Push,
  StatusBar, Keyboard, Social Login, Biometric auth, App Badge).
- **Checks:** `npm run typecheck` · `npm run lint` · `npm run build`.

This is a deliberate architecture — one codebase serves web + iOS + Android.
A SwiftUI rewrite is explicitly not the direction.

## Page layout — which shell to use

There is exactly **one** fixed-viewport primitive: `AppShell`
(`src/components/AppShell.tsx`). It owns the only implementation of the
100dvh lock, the internal scroll container, the safe-area top inset, and the
bottom-nav clearance. Never re-implement those — build on `AppShell`.

- **Fixed-shell pages** — the page locks to 100dvh, the bottom nav stays
  pinned, and scrolling happens in an internal container. Use `AppShell`
  directly (Profile, AccountPending), or `PageScaffold`
  (`src/components/ui/PageScaffold.tsx`) when you want its two-card layout
  (Dashboard, Activity, Messages list, guest dashboard). `PageScaffold` is a
  *thin wrapper over `AppShell`* — it adds only the title-card + bleeding
  panel, never its own viewport lock.
- **Document-scroll pages** — long-form / tall content that scrolls the
  document (legal, marketing, multi-step forms, Profile/Activity tab pages).
  Use a plain `min-h-screen bg-premium-page pb-safe-nav` wrapper (with
  `<PageHeader>` if a back-button header is needed). Do NOT use `AppShell`.
- The authoritative map of which routes do which lives in
  `DOCUMENT_SCROLL_ROUTES` in `src/hooks/useAppShellViewport.ts` — that hook
  toggles the `app-shell` class on `<html>`. A page's shell choice and its
  entry in that list must agree.

## Working rules

Each of these is a real, non-obvious gotcha that has cost real time — keep
this list tight; project-specific trivia belongs in code comments, not here.

- **Migrations don't auto-deploy.** Supabase migrations are NOT applied to
  production automatically — they need a manual `supabase db push`. When a
  migration adds a new RPC/function, the code calling it MUST ship a graceful
  fallback for the PGRST202 "function not found" error, so the feature isn't
  broken on production between merge and the manual push.
- **Prod must never lag the repo on migrations.** Every migration file in
  `supabase/migrations/` must have its objects present in production — zero
  drift is the standing requirement. Because migrations don't auto-deploy,
  apply each one to prod (surgically, via MCP `apply_migration`, never a blind
  `db push` — see [[prod-migration-drift]]) as part of the same change that
  merges it. To audit drift, compare repo files against prod by **object
  existence** (`to_regclass`/`to_regprocedure`/`information_schema`), NOT by
  `schema_migrations.version` — MCP-applied migrations are recorded under their
  apply-time timestamp, so version strings won't match the filenames.
- **Migrations must be replay-safe.** A from-scratch rebuild runs every
  migration in timestamp order. Guard DDL against objects that may not exist
  yet (`REVOKE`/`ALTER` on a function defined by a *later* migration →
  `IF to_regprocedure(...) IS NOT NULL`). An unguarded one aborts the rebuild
  and reds the Supabase Preview check on every migration PR.
- **Never drop the Supabase `error`.** `const { data } = await supabase...`
  silently swallows failures into a blank screen. In a React Query `queryFn`
  use `unwrap()` (`src/lib/supabaseResult.ts`); elsewhere check `error`.
- **Realtime subscriptions:** give every `postgres_changes` channel a
  server-side `filter` scoped to the user (an unfiltered `event: "*"`
  receives every platform-wide write), and a unique channel-name nonce via
  `channelNonce()` (`src/lib/realtimeChannel.ts`) — Supabase dedupes channels
  by name, so a reused name silently drops the second subscription.
- **Branch + PR; never commit to `main` directly.** Before opening a PR run
  `npm run typecheck && npm run lint && npm run build` — all three must pass.
- End every commit message with:
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
