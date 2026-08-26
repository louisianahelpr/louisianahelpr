# Launch checklist

Things that are deliberately in a **testing** position while the app is being
built, and must be flipped before the marketplace opens to the public. Each one
is cheap to flip and expensive to forget.

Run the automated half with:

    npm run check:launch

That fails the build when a flag is still in its testing position. It is opt-in
(`HELPR_LAUNCH=1`) so ordinary development builds are unaffected.

## Automated (enforced by `scripts/check-launch-flags.sh`)

| Flag | File | Now | At launch | Why it matters |
|---|---|---|---|---|
| `SHOW_SEED_JOBS_PUBLICLY` | `src/config/showSeedJobs.ts` | `true` | `false` | Fixture rows are flagged `is_seed` in the DB; this switch hides them from guest-facing surfaces. Measured 2026-08-25: **12 of 13 open jobs were fixtures**, so launching with `true` opens a marketplace made of fake listings. Admin money aggregates already exclude `is_seed` unconditionally, so this is only about the public feed. |

## Manual — not automatable, still required

- **Verify the public jobs feed has real listings.** Flipping the flag above
  with no real jobs posted leaves the marketplace nearly empty. Hiding fixtures
  and having stock are the same decision; do not flip in isolation.
- **Stripe keys are LIVE and correct.** Confirm the publishable key in the
  deployed environment matches the intended account, and that the restricted
  key's scopes cover every charge path.
- **Point local development away from production.** See
  `docs/PLATFORM_CONVENTIONS.md`. While one Supabase project exists, every
  local write and every test account lands in the live database.
- **Purge or retain the fixture rows deliberately.** They are flagged, not
  deleted. Decide whether they stay (hidden) or are removed, and record which.
- **Confirm `FAMILY_ENABLED`** (`src/config/familyEnabled.ts`) is in the
  intended position for launch — currently `false`.

## Adding to this list

If you add a flag whose testing position differs from its launch position, add
a row above **and** a check in `scripts/check-launch-flags.sh`. A flag that
only lives in someone's memory is the exact failure this file exists to stop.
