/**
 * Where the "are fixture/demo jobs visible on public surfaces?" switch lives.
 *
 * THE SWITCH IS NOT IN THIS FILE ANY MORE, AND THAT IS THE FIX.
 *
 * ── What was here, and why it didn't work ───────────────────────────────────
 *
 * This module used to export `SHOW_SEED_JOBS_PUBLICLY = true` with a docstring
 * promising "flip to `false` and every public surface that reads it stops
 * showing fixtures." Measured against prod on 2026-09-01, it reached ONE of
 * the three surfaces a person can browse jobs on:
 *
 *   /jobs      `get_ranked_open_jobs(p_include_seed)`  honoured it
 *   the map    `get_open_jobs_for_map()`               `Args: never` — the RPC
 *                                                      takes no arguments, so
 *                                                      nothing could be passed
 *   dashboard  `open_jobs_browse` (view)               no `is_seed` column at
 *                                                      all (42703)
 *
 * Prod's open-job population was 20 rows, every one of them a fixture. So
 * flipping the constant would have emptied `/jobs` while leaving every fixture
 * pin on the map and every fixture card on the browse list — three surfaces
 * disagreeing, which is worse than the honest "fixtures everywhere" they show
 * today.
 *
 * ── Why the switch moved into the database ─────────────────────────────────
 *
 * 1. THIS IS A NATIVE APP. A `const` in `src/config` only changes what a
 *    shipped bundle does. Flipping it for iOS means a build, a submission and
 *    App Review; the web would flip immediately and the native app days later.
 *    "Every public surface stops showing fixtures" would be false on the
 *    surface that matters most for as long as review takes. Same reason
 *    `src/lib/featureFlags.ts` exists.
 * 2. A CLIENT-SUPPLIED FILTER IS ONE THE CLIENT CAN DROP. That shape had just
 *    been removed from these exact three surfaces one migration earlier
 *    (20260901022522), because it was how the paid Early Access window leaked
 *    to any anon caller on `/jobs`.
 * 3. THREE CALL SITES IS THREE CHANCES TO DRIFT. The map and the dashboard
 *    list are read by `BrowseMap` and `useDashboardData`, neither of which
 *    ever knew this flag existed. A gate in the row filter is inherited by
 *    every future surface for free; a gate in three hooks is inherited by
 *    none.
 *
 * The authority is now `public.seed_jobs_hidden_publicly()`, read by all three
 * browse surfaces AND by the saved-search alert trigger, exactly as
 * `public.early_access_cutoff()` is read by all three. See migration
 * 20260901035245.
 *
 * ── How to flip it ─────────────────────────────────────────────────────────
 *
 * One statement. Takes effect on web and native at once, no release:
 *
 *     UPDATE public.platform_settings
 *        SET feature_flags = feature_flags
 *                            || '{"seed_jobs_hidden_publicly": true}'::jsonb;
 *
 * To put fixtures back, write `false` (or delete the key). The flag is named
 * for the EXCEPTION — `…_hidden_…`, not `show_…` — for the same reason
 * `idv_requirement_paused` is: every way of failing to read it (key absent,
 * blob reset, no settings row, a replay onto a fresh database) has to land on
 * TODAY'S behaviour, which is fixtures visible. A `show_…` flag defaulting to
 * false would empty the public marketplace the moment the key went missing,
 * which is precisely the outcome the owner rejected when they chose to keep
 * fixtures visible while testing.
 *
 * The owner's chosen value is unchanged: fixtures are VISIBLE. The migration
 * seeds the key as `false` and never overwrites an existing value.
 *
 * Admin aggregates are deliberately NOT behind this switch — they exclude
 * `is_seed` unconditionally (migration 20260825184500), because a money figure
 * that counts fixtures is wrong at every stage, testing included.
 */

/** The `platform_settings.feature_flags` key the operator writes. */
export const SEED_VISIBILITY_FLAG_KEY = "seed_jobs_hidden_publicly";

/** The single SQL function every gated surface asks. */
export const SEED_VISIBILITY_AUTHORITY = "public.seed_jobs_hidden_publicly";

/**
 * Every surface that must consult the authority, by the SQL object that
 * implements it. `showSeedJobs.parity.test.ts` grades the migration against
 * this list, so adding a browse surface here fails the build until the SQL
 * catches up — which is the failure mode that let the map and the dashboard
 * list drift away from the flag for good.
 */
export const SEED_GATED_SURFACES = [
  { surface: "/jobs", object: "public.get_ranked_open_jobs" },
  { surface: "dashboard browse list", object: "public.open_jobs_browse" },
  { surface: "map", object: "public.get_open_jobs_for_map" },
  { surface: "saved-search alerts", object: "public.notify_saved_searches_on_new_job" },
] as const;
