/**
 * Q456 class guard: every IN-FLIGHT payment_status a server path writes is
 * watched by money-reconciliation.
 *
 * The defect: cancel_escrow claims a job by writing payment_status
 * 'cancelling' and leaves it there when a later step fails (gift restore, the
 * final flip). Nothing swept 'cancelling' and nothing re-reported it; the
 * one-shot critical alert was the only memory of a stuck cancel. The same
 * shape had already happened once with 'payout_pending' (the reconciler only
 * looked at 'escrow'; see payout_pending_stranded).
 *
 * The class, from source: every payment_status value an edge function
 * writes (inventory below, never hand-listed) must be classified here as
 * RESTING (a state a row may legitimately sit in indefinitely) or IN_FLIGHT (a
 * claim a path takes intending to leave within its own run or a scheduled
 * window). A new written value that is in neither list fails, so it has to be
 * classified; every IN_FLIGHT value must be compared against in
 * money-reconciliation's code (comments blanked), i.e. some check selects it.
 *
 * SCOPE (stated, not hidden): the inventory reads edge-function object
 * literals only. A value written solely by an SQL function/trigger, via
 * .in(...), or through a variable is NOT seen here. "Watched" means a
 * comparison exists in the reconciler; the edge test
 * src/test/edge/money-reconciliation-cancelling.test.ts pins that the
 * comparison really selects stranded rows.
 *
 * @mutate supabase/functions/money-reconciliation/index.ts | if (job.payment_status !== "cancelling") continue; | if (job.payment_status !== "x_removed") continue;
 */
import { describe, it, expect } from "vitest";
import { relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const FUNCTIONS = resolve(ROOT, "supabase/functions");
const RECONCILER = resolve(FUNCTIONS, "money-reconciliation/index.ts");

/** States a row may sit in indefinitely; why each is safe to leave unwatched. */
const RESTING: Record<string, string> = {
  unpaid: "a posted job before checkout; abandoned-checkout sweeps own it",
  pending: "tips and gift-card checkouts awaiting Stripe; the webhook settles them",
  escrow: "a funded open job; escrow on a terminal job is escrow_on_terminal_job",
  released: "settled; released_without_transfer grades it",
  paid: "settled tip / gift card",
  cancelled: "settled; the stripe_* checks grade it against Stripe",
  refunded: "settled; refunded_with_live_payout and the stripe_* checks grade it",
  abandoned: "terminal: checkout never completed",
  failed: "terminal: Stripe declined the payment",
  chargeback: "terminal for the platform; disputes own it",
};

/** Claims a path takes intending to leave; a row left here is stranded. */
const IN_FLIGHT = ["cancelling", "payout_pending"] as const;

function writtenStatuses(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of walkSource([FUNCTIONS])) {
    const src = readSource(file);
    if (src === null) continue;
    const code = blankComments(src);
    for (const m of code.matchAll(/\bpayment_status:\s*"([a-z_]+)"/g)) {
      const list = out.get(m[1]) ?? [];
      list.push(relative(ROOT, file));
      out.set(m[1], list);
    }
  }
  return out;
}

describe("in-flight payment_status values are watched by money-reconciliation (Q456)", () => {
  const written = writtenStatuses();

  it("reads a real inventory (floor: 12 distinct written values, measured 2026-10-02)", () => {
    expect(written.size).toBeGreaterThanOrEqual(12);
    for (const s of IN_FLIGHT) expect(written.has(s), `${s} is no longer written by any edge function`).toBe(true);
  });

  it("every written payment_status is classified RESTING or IN_FLIGHT", () => {
    const unclassified = [...written.keys()].filter(
      (s) => !(s in RESTING) && !(IN_FLIGHT as readonly string[]).includes(s),
    );
    expect(unclassified, `classify these (written in ${unclassified.map((s) => written.get(s)).join("; ")})`).toEqual([]);
  });

  it("every IN_FLIGHT value is compared against in money-reconciliation's code", () => {
    const code = blankComments(readSource(RECONCILER) ?? "");
    const unwatched = IN_FLIGHT.filter(
      (s) => !new RegExp(`payment_status\\s*[!=]==\\s*"${s}"`).test(code),
    );
    expect(unwatched).toEqual([]);
  });
});
