/**
 * The seed's dispute fixtures, and the one shape they must never be left in.
 *
 * A dispute that is `status='decided'` with a `payout_split` but
 * `execution_status='pending'` is, to the platform, money a person decided to
 * move and that never moved. `auto-resolve-disputes` sweeps for exactly that
 * and alerts every admin, daily, forever — which is what dispute
 * c7a12050-1542-40f0-99b6-189c47a13bd8 (job bb2c3732, is_seed, decided
 * 2026-09-07 06:44 UTC) did until 20260914183932 taught the sweep to skip
 * is_seed jobs. Skipping is the right behaviour for real seed data; it is not
 * a reason to keep manufacturing a fake emergency.
 *
 * Note what prod actually shows (read 2026-09-14): `prod-seed.mjs` does NOT
 * create this row. Its only dispute fixture goes through `rpc_open_dispute`
 * and stays `open`. c7a12050 was made by hand on 2026-09-07 and has outlived
 * every script that might have cleaned it up. So the fix is not "stop creating
 * it" — it is that the seed OWNS the fixture: --apply retires any stuck seed
 * split it finds, --verify fails while one exists, and --teardown removes it
 * with everything else.
 *
 * Retiring means UN-DECIDING, never faking a settlement. No transfer and no
 * refund id exists on these rows, so no money moved; writing
 * `execution_status='executed'` would be a lie that `money-reconciliation`
 * would then read as a real settlement. The dispute goes to 'withdrawn' with
 * execution_status NULL — a state the real `rpc_withdraw_dispute` produces —
 * and the decision text is kept, prefixed, as the record of what happened.
 *
 * Exported so src/test/seedDisputeFixture.test.ts can check the predicate
 * without running anything against prod.
 */

/**
 * The three execution states `auto-resolve-disputes` counts as stuck, verbatim
 * from its own `.in("execution_status", [...])` (index.ts, Sweep 2). A narrower
 * list here would let --verify report a clean seed while the sweeper still
 * counts the row: 'failed' in particular is the state that actually occurs, and
 * the sweeper does not filter on `status` at all, so neither do we.
 */
export const STUCK_EXECUTION_STATUSES = ["pending", "executing", "failed"];

/** Never touched unless BOTH are true: the job is seed data, and no money moved. */
export function isStuckSeedSplit(d) {
  if (!d) return false;
  if (!STUCK_EXECUTION_STATUSES.includes(d.execution_status)) return false;
  // The money guards, not the status, are what make this safe: a row with any
  // transfer id, refund id, settlement time or cents has moved real Stripe
  // test-mode money and is a record of it, not a fixture.
  if (d.execution_transfer_id || d.execution_refund_id || d.executed_at) return false;
  if (d.execution_helper_cents || d.execution_refund_cents) return false;
  return d.jobs?.is_seed === true;
}

/**
 * PostgREST query for the candidates. `jobs!inner(is_seed)` keeps a non-seed
 * dispute out of the result set on the server side as well as in the
 * predicate — a real stuck split must reach a person, not this script.
 */
export const STUCK_SEED_SPLIT_QUERY =
  "disputes?execution_status=in.(pending,executing,failed)" +
  "&execution_transfer_id=is.null" +
  "&execution_refund_id=is.null" +
  "&executed_at=is.null" +
  "&select=id,job_id,status,execution_status,execution_started_at,execution_transfer_id,execution_refund_id," +
  "executed_at,execution_helper_cents,execution_refund_cents,decision_text,jobs!inner(is_seed)" +
  "&jobs.is_seed=eq.true";

const RETIRED_PREFIX = "SEED fixture retired (never executed, no money moved): ";

/**
 * The PATCH filter for ONE row, carrying the whole predicate rather than the id
 * alone: a compare-and-swap, so a row `execute-dispute-split` claims between
 * the read and the write is not retired out from under a Stripe call in flight.
 * `isStuckSeedSplit` accepts 'executing', which is exactly that window, and
 * seed jobs carry real Stripe test-mode money.
 */
export function stuckSplitCasFilter(id) {
  return (
    `disputes?id=eq.${id}` +
    `&execution_status=in.(${STUCK_EXECUTION_STATUSES.join(",")})` +
    "&execution_transfer_id=is.null" +
    "&execution_refund_id=is.null" +
    "&executed_at=is.null" +
    "&select=id"
  );
}

/** The PATCH body that takes a stuck seed split out of the stuck state. */
export function retireStuckSplitPatch(d) {
  if (!isStuckSeedSplit(d)) throw new Error(`refusing to retire dispute ${d?.id}: not a stuck seed split`);
  const text = d.decision_text ?? "";
  return {
    status: "withdrawn",
    execution_status: null,
    execution_started_at: null,
    execution_error: null,
    decision_text: text.startsWith(RETIRED_PREFIX) ? text : `${RETIRED_PREFIX}${text}`.slice(0, 2000),
  };
}
