/**
 * Owner, 2026-10-01: "Leave it empty." Prod holds no test jobs until launch,
 * so open_jobs_browse can serve 0 rows. While this is true, browse journeys
 * check the designed empty state instead of failing on the empty feed.
 * Launch checklist (docs/OPEN.md) flips it to false, together with
 * EMPTY_MARKETPLACE_ALLOWED_BEFORE_LAUNCH in scripts/e2e/anon-surface-contract.mjs.
 */
export const EMPTY_MARKETPLACE_ALLOWED_BEFORE_LAUNCH = true;
