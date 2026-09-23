/**
 * Stripe TEST balance monitor (docs/OPEN.md Q3 / Q145): threshold maths, the
 * balance parser, the upcoming-payout SQL and the alert text.
 * scripts/check-stripe-balance.mjs does the reads and calls `evaluateBalance`.
 *
 * Why: on 2026-09-22 the platform's TEST balance ran to $0 and scheduled
 * payouts / transfers failed with "insufficient available funds". Nothing
 * warned before the transfers failed. This alerts while there is still time
 * to top up: available < max($100, 1.5 x what is due in the next 72h).
 */

/** Floor: never let the available balance fall below $100 unalerted. */
export const FLOOR_CENTS = 10_000;
/** Headroom over the payouts due in the window. */
export const MULTIPLIER = 1.5;
export const WINDOW_HOURS = 72;

/** Cents the available balance must stay at or above. */
export function thresholdCents(upcomingCents) {
  const up = Number.isFinite(upcomingCents) && upcomingCents > 0 ? upcomingCents : 0;
  return Math.max(FLOOR_CENTS, Math.ceil(up * MULTIPLIER));
}

/**
 * @param {{availableCents: number|null|undefined, upcomingCents: number|null|undefined}} r
 * upcomingCents null = the DB schedule could not be read; the floor alone applies.
 */
export function evaluateBalance({ availableCents, upcomingCents }) {
  if (typeof availableCents !== "number" || !Number.isFinite(availableCents)) {
    return { status: "unreadable", threshold: null, availableCents: null, upcomingCents: upcomingCents ?? null };
  }
  const threshold = thresholdCents(upcomingCents ?? 0);
  return { status: availableCents < threshold ? "low" : "ok", threshold, availableCents, upcomingCents: upcomingCents ?? null };
}

/**
 * Available USD cents from a GET /v1/balance body. Throws on anything that is
 * not a readable TEST-mode balance: an empty or malformed body is a broken
 * read, never $0 and never "fine".
 */
export function parseAvailableUsdCents(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || body.object !== "balance") {
    throw new Error(`GET /v1/balance did not return a balance object — refusing to report clean: ${JSON.stringify(body).slice(0, 160)}`);
  }
  if (body.livemode !== false) throw new Error(`GET /v1/balance answered with livemode=${body.livemode}; this monitor reads TEST mode only`);
  const usd = Array.isArray(body.available) ? body.available.filter((b) => b?.currency === "usd") : [];
  if (usd.length === 0) throw new Error("GET /v1/balance has no USD available balance — refusing to report clean");
  const cents = usd.reduce((s, b) => s + Number(b.amount), 0);
  if (!Number.isFinite(cents)) throw new Error(`GET /v1/balance USD available amount is not a number: ${JSON.stringify(usd).slice(0, 160)}`);
  return cents;
}

/**
 * Payouts due within the window (overdue included), an UPPER BOUND in cents:
 * each job's budget + urgent fee, before the helper commission comes off.
 * Seed jobs count too: process-scheduled-payouts skips them by default, but
 * journeys and the admin release path pay them from the same TEST balance.
 */
export const UPCOMING_SQL = `
SELECT count(*)::int AS jobs,
       coalesce(sum(round((coalesce(budget, 0) + coalesce(urgent_fee, 0)) * 100)), 0)::bigint AS cents
  FROM public.jobs
 WHERE status = 'completed'
   AND payment_status = 'payout_pending'
   AND payout_scheduled_at IS NOT NULL
   AND payout_scheduled_at <= now() + interval '${WINDOW_HOURS} hours'`;

export const dollars = (c) => `$${(c / 100).toFixed(2)}`;

export const LOW_TITLE = "Stripe TEST balance below payout threshold — top up before payouts fail";
export const UNREADABLE_TITLE = "Stripe balance monitor cannot read the TEST balance";

/** How to top up, in TEST mode only (the Q145 procedure). */
export const TOP_UP_HOW =
  "Top up in TEST mode only: with the sk_test_ key, charge the platform account with the 0077 test card " +
  "(4000 0000 0000 0077, payment_method pm_card_bypassPending), which lands in the AVAILABLE balance at once " +
  "(4242 lands in pending). Confirm livemode=false on the charge and on GET /v1/balance, then re-run " +
  "quota-monitor.yml. Procedure and receipts: docs/OPEN.md Q145. Never use a live key.";

export function lowSample(res, upcomingJobs) {
  const up = res.upcomingCents === null
    ? "payouts due in the next 72h could not be read, so the $100 floor applies"
    : `${upcomingJobs ?? "?"} payout(s) due in the next ${WINDOW_HOURS}h, up to ${dollars(res.upcomingCents)}`;
  return `Stripe TEST available balance ${dollars(res.availableCents)} is below ${dollars(res.threshold)} ` +
    `(max($100, ${MULTIPLIER} x upcoming); ${up}). Scheduled payouts and transfers will fail with ` +
    `"insufficient available funds" once it runs out. ${TOP_UP_HOW}`;
}
