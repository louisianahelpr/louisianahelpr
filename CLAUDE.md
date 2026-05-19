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
  StatusBar, Keyboard, Social Login).
- **Checks:** `npm run typecheck` · `npm run lint` · `npm run build`.

This is a deliberate architecture — one codebase serves web + iOS + Android.
A SwiftUI rewrite is explicitly not the direction.

## Working rules

Each of these is a real, non-obvious gotcha that has cost real time — keep
this list tight; project-specific trivia belongs in code comments, not here.

- **Migrations don't auto-deploy.** Supabase migrations are NOT applied to
  production automatically — they need a manual `supabase db push`. When a
  migration adds a new RPC/function, the code calling it MUST ship a graceful
  fallback for the PGRST202 "function not found" error, so the feature isn't
  broken on production between merge and the manual push.
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
