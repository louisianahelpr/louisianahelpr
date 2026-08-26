/**
 * Whether fixture/demo rows are visible on PUBLIC, guest-facing surfaces.
 *
 * Production is currently mostly test data — of 13 open jobs, 12 are fixtures
 * and 1 is real (measured 2026-08-25). Hiding them today would leave the
 * public marketplace showing a single listing, and would make most flows
 * untestable, so they stay visible for now (owner: "should we keep them now
 * for testing purposes?" — yes, while testing).
 *
 * This exists so that is a ONE-LINE decision at launch rather than something
 * anyone has to remember to go and find. Flip to `false` and every public
 * surface that reads it stops showing fixtures.
 *
 * It deliberately does NOT gate the admin aggregates — those already exclude
 * `is_seed` unconditionally (migration 20260825184500), because a money figure
 * that counts fixtures is wrong at any stage, testing included.
 */
export const SHOW_SEED_JOBS_PUBLICLY = true;
