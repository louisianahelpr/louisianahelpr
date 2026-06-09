# Function grant-guard (audit H4)

A build-time guard that stops the **grant-regression class** that ate a full
day (the #355 / #358 / #364 / #366 saga): the Supabase advisor pass keeps
stripping the default `PUBLIC EXECUTE` from functions, silently breaking RLS
helpers and client RPCs in production between merge and the next manual push.

## What it does

`scripts/check-migration-grants.mjs`, wired into **`.github/workflows/migration-lint.yml`**,
fails a PR when a migration **defines a new `public` function without an
explicit `GRANT` or `REVOKE`**.

- **PR-scoped:** only functions *defined in the migrations changed by the PR*
  are checked, so the existing corpus never reds an unrelated PR.
- **History-aware grants:** the GRANT/REVOKE set is read from the *whole*
  `supabase/migrations` tree, so a `CREATE OR REPLACE` that merely updates an
  already-granted function does **not** trip the guard.
- **Trigger-safe:** `RETURNS trigger` / `event_trigger` functions are exempt —
  they're invoked by the trigger machinery, never called by a role.

The fix the guard asks for is one line in the migration:

```sql
-- callable by signed-in users (most RPCs / RLS helpers):
GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO authenticated;
-- or locked down (cron / internal-only):
REVOKE ALL ON FUNCTION public.<name>(<args>) FROM PUBLIC, anon, authenticated;
```

## Audit the whole tree locally

```bash
node scripts/check-migration-grants.mjs --all
```

## Pre-existing backlog (predates the guard)

As of this guard landing, `--all` flags the functions below — they were
created before the guard and carry **no explicit GRANT/REVOKE anywhere in the
migration history**, so each is a latent `#355`-shape regression. The guard is
deliberately PR-scoped so these don't block unrelated work, but they should be
triaged in a dedicated grant migration. **Verify each first** (some may have
since been dropped or superseded — the scanner reads `CREATE`, not `DROP`),
then classify:

- **Likely client-callable → `GRANT EXECUTE … TO authenticated` (and `anon`
  where used by guest/marketing surfaces):** `get_approved_helpers`,
  `get_top_helpers_by_parish`, `get_hero_parishes`, `count_profiles`,
  `can_review_job`, `get_helper_parish_badges`, `is_category_taxable`
- **RLS / SECURITY DEFINER helpers → `GRANT EXECUTE … TO authenticated`:**
  `get_user_business_ids`, `is_user_verified_business_member`,
  `business_seat_limit`
- **Cron / internal → `REVOKE ALL … FROM PUBLIC, anon, authenticated`:**
  `cleanup_observability_tables`, `cleanup_stripe_webhook_events`,
  `log_notification`

This backlog is intentionally **not** auto-fixed here: the correct posture is
per-function (over-granting `anon` on the wrong function is a data-exposure
risk; revoking a function a surface actually calls breaks it), so each needs a
human decision + a verification pass against the live schema.
