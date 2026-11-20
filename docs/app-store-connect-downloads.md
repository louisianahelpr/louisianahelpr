# App Store download counts (stub, not built)

Dated 2026-11-20. Owner ask (2026-11-20): "add an app download feature ... and do your best to say which people it
came from".

## What is built

Apple and Google never tell an app WHO downloaded it. So the app records who **signs in on the native app**:

- `public.app_installs` (migration `supabase/migrations/20261120150247_app_installs.sql`): one row per member, with
  the first and latest iPhone/Android app sign-in, the platform and the app version. Written by `record_app_open`,
  which the native app calls on launch, sign-in and return to the app (`src/lib/appSignIns.ts`, mounted in
  `src/components/SessionManager.tsx`). The web app never writes a row.
- Admin home, card "App sign-ins this week" (`src/components/admin/dashboard/AppSignInsCard.tsx`): new vs returning
  by platform, and the members whose first app sign-in was this week (name, town, platform, first seen). Test and
  seed accounts never count. This is the list to use for a bonus entry in the 25 Days giveaway (owner ask, 2026-11-20).

## What is NOT built: App Store download COUNTS

App Store Connect knows how many times the app was downloaded (a number, never names). Reading it needs an
App Store Connect API key, which only the owner can create. Nothing in the app reads App Store Connect today, and no
key is stored anywhere.

To turn it on later, the owner would:

1. In App Store Connect, open Users and Access, then Integrations, then App Store Connect API, and create a key with
   the "Sales and Reports" (or "Finance") role. Apple shows the key file once.
2. Hand the key over through the usual secrets route (a Supabase edge-function secret), never in chat or in this repo.

With a key, a small scheduled job could read the daily Sales and Trends report (`GET /v1/salesReports`,
`reportType=SALES`, `frequency=DAILY`) and show "downloads this week" beside the sign-in card. The counts would still
not say who downloaded; the sign-in list above stays the only "who".
