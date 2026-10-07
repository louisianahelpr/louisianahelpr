# Launch checklist

The exact, runnable steps for the launch-day items in `docs/OPEN.md`: Q152
(the last TestFlight build), Q1289 (App Store links back), Q552 (hide the
fixtures), Q1368 (the cold-visit outline on guest /browse). The open/closed
state of each lives ONLY in `docs/OPEN.md`; this file says how to do them.

Every script below is read-only unless a step says `--confirm`. Each was
dry-run on 2026-10-07 against prod (results noted beside it).

## The day before

1. `npm run launch-status` — the launch list shows only the four items above.
2. `npm run launch:go` (report only, writes nothing). Expect no `✗`. Set
   `SUPABASE_ACCESS_TOKEN` (a Supabase personal access token) in the shell
   first, or the "live definitions consult the gate" check reports SKIP, and
   a SKIP is not a pass: it is the only live evidence for the trigger and
   sweep surfaces. Dry run 2026-10-07: registry check PASS (12 surfaces; it
   FAILED on origin/main 15e0f080f until the parser fix guarded by
   `src/test/launchGoSeedRegistry.test.ts`), live check SKIP (no token in that
   shell), flag false, 1 real open job, Stripe LIVE, backup 6.8h old.
3. `npm run launch:appstore` — expect exit 1, `VERDICT: not-live` until Apple
   releases the app (dry run 2026-10-07: HTTP 404, lookup resultCount 0).

## Step 1 — Q152: the last TestFlight build

Only when every other launch-list item is closed.

1. From a clean checkout of `origin/main` (no local edits under `src`, `ios`,
   `capacitor.config.ts`, `package.json`; the release gate refuses otherwise):
   `node scripts/release-gate.mjs "$(git rev-parse HEAD)" --dispatch`, then
   `node scripts/release-gate.mjs "$(git rev-parse HEAD)" --wait` until all six
   checks are green. (Dry run 2026-10-07 on 15e0f080f: 6 of 6 MISSING, as
   expected for a sha nobody dispatched; `test` runs on PRs only, so it is
   always dispatched here.)
2. If the Q1314 CAPTCHA cutover rides this build, the build environment must
   carry `VITE_TURNSTILE_ENABLED=true` (the local lane runs `npm run build:ios`,
   which reads `.env`). An installed build without it sends no token, and once
   `security_captcha_enabled` is on every email sign-in from it is refused.
3. `bundle exec fastlane ios beta`.
4. Owner: install from TestFlight, sign in, tap Enable -> Allow on the
   notifications pill. Then raise `platform_settings.min_supported_build` to
   the new build number (Admin -> Settings) and read it back.

## Step 2 — Q1289: App Store links back (once Apple releases the app)

1. `npm run launch:appstore`. Exit 2 / `VERDICT: flip-now` means Apple lists
   app id 6754470134 (page 200 AND lookup resultCount 1, bundle com.Helpr) and
   the repo still hides it; it prints the four edits (APP_STORE_URL +
   APP_STORE_LISTING_LIVE in `src/lib/appStore.ts`, the Smart App Banner meta in
   `index.html`, the live expectations in
   `src/test/appStoreLinksHiddenUntilLive.test.ts`, a look at the footer at
   375 and 1440, light and dark). Exit 1 = not released yet: change nothing.
2. Land the edits with `bash scripts/land.sh`, then `npm run launch:appstore`
   again: exit 0, `VERDICT: live-and-shipped`.

## Step 3 — Q552: hide the fixtures

1. `npm run launch:go -- --on --confirm`. It measures every anon surface,
   flips `platform_settings.feature_flags.seed_jobs_hidden_publicly` to true
   (the only thing it can write), and measures again; every surface must show
   0 fixture rows AFTER. It refuses to flip into an empty marketplace unless
   `--allow-empty-marketplace` is passed on purpose.
2. `npm run check:launch` — prints "all launch flags are in their launch
   position" (dry run 2026-10-07: FAILED, the flag is false, as it should be
   before launch).
3. Roll back if needed: `npm run launch:go -- --off --confirm`.
4. Seed PROFILES and their reviews are not behind this switch (Q552's line
   says which read paths); follow the owner's decision recorded there.

## Step 4 — Q1368: the cold-visit outline on guest /browse

After Step 3, in a private window (no persisted list) at 375 wide, open the
site signed out. If real jobs exist, the "Nothing today, neighbor." outline
flashes before the cards. Owner decides: keep it, or draw card skeletons on a
cold anon visit (`GuestFeedEmptySkeleton` in
`src/components/GuestBrowseSkeleton.tsx`, the frame condition in
`src/pages/home/DashboardGuest.tsx`; re-prove
`src/test/loadingStateShape.test.ts` and `src/test/dataAwareSkeletons.test.tsx`).

## Adding to this list

A setting whose testing position differs from its launch position gets a
step here AND a check a script can run (`scripts/check-launch-flags.sh`,
`scripts/launch-go.mjs`, `scripts/app-store-live.mjs`). A flag that lives only
in someone's memory is the failure this file exists to stop.
