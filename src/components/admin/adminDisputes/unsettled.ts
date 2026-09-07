import type { DisputeRecord } from "./types";

/**
 * A dispute whose DECISION is committed but whose MONEY has not moved.
 *
 * `rpc_decide_dispute` commits the decision — dispute 'decided', job
 * 'completed'/'cancelled', both parties notified — and the client only THEN
 * invokes `execute-dispute-split`. Every way that second call can fail (a 409
 * for an escrow with no PaymentIntent, a Stripe 502, a closed tab) leaves the
 * decision standing and the escrow untouched. Prod dispute
 * c7a12050-1542-40f0-99b6-189c47a13bd8 sat in exactly that state with $180
 * unsettled while the console showed it as a clean green DECIDED.
 *
 * So "decided" is not the end state — 'executed' is. This predicate is the one
 * definition of the gap, shared by the dispute queue and the Exception Queue so
 * the two can never disagree about which cases are still open work.
 *
 * `undefined` execution_status is the deploy-lag read (the queue drops the
 * execution columns on a 42703) — unknown, not unsettled, so it is excluded
 * rather than flooding the queue with false alarms during a deploy window.
 */
export function isUnsettled(record: Pick<DisputeRecord, "status" | "execution_status"> | undefined | null): boolean {
  if (!record) return false;
  if (record.status !== "decided") return false;
  if (record.execution_status === undefined) return false;
  return record.execution_status !== "executed";
}

/** Human label for why a settlement is outstanding. */
export function unsettledReason(record: Pick<DisputeRecord, "execution_status" | "execution_error">): string {
  switch (record.execution_status) {
    case "failed":
      return record.execution_error
        ? `Settlement failed: ${record.execution_error}`
        : "Settlement failed — no money moved, or only part of it did.";
    case "executing":
      return "A settlement run started and never finished. Retry is safe — the ledger and Stripe idempotency keys prevent a double payout.";
    default:
      // 'pending' or a legacy NULL: the decision is on record and settlement
      // was never attempted, or the attempt never reached the claim.
      return "The decision is recorded but the escrow has NOT moved. Nobody has been paid or refunded.";
  }
}
