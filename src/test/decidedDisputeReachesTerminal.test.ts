import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import {
  deriveHelperWait,
  derivePosterWait,
  withDisputeSettling,
} from "@/components/job-card/jobStatusLine";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import { readdirSync } from "./helpers/trackedFiles";

/**
 * Q342 + Q344 class guard: a decided dispute is never stuck, and never told
 * "resolved"/"paid" before its money moves.
 *
 * Q342. rpc_decide_dispute leaves execution_status='pending' until
 * execute-dispute-split runs, and the split runs only from escrow/payout_pending.
 * Every Stripe path that takes the job OUT of those states for good must either
 * close the decided dispute or be a named, queued gap. The inventory is derived
 * from the chargeback webhook handlers themselves:
 *   - every handler that blocks a job with payment_status 'chargeback';
 *   - every Stripe dispute outcome charge.dispute.closed branches on.
 * Each outcome is classified: 'lost' (money gone) must call the terminal close
 * before anything else in its branch; 'warning_closed' restores the pre-block
 * payment state, so the split can still run; 'won' (Q449) restores it too
 * whenever an internal hold such as a decided split still holds the job,
 * keeping that hold's markers. The close itself (settle_dispute_by_chargeback,
 * newest definition) must close only a decided, unexecuted dispute, refuse a
 * partial chargeback, and be service-role only. Its behaviour is proved in
 * PGlite by src/test/pglite/chargebackLostClosesDecidedDispute.pglite.mjs.
 *
 * Q450. The other Stripe door out of escrow for good is a FULL refund:
 * charge.refunded flips the job 'refunded'. Every webhook handler that writes
 * 'refunded' must call the external-refund close right after (inventoried from
 * the handlers), and that close (settle_dispute_by_external_refund, newest
 * definition) must close only a decided, unexecuted, non-crew dispute, refuse
 * a partial refund, a gift card or money a split moved, and be service-role
 * only. Behaviour: src/test/pglite/fullRefundClosesDecidedDispute.pglite.mjs
 * and src/test/edge/disputeSettlementWebhook.test.ts.
 *
 * Q344. Every SQL function that records a decision as NOT yet executed
 * (stamps execution_status 'pending') must not notify 'Dispute resolved' /
 * 'Dispute settled'; and the job cards say "Decided — payment processing",
 * not "Done · paid" / "Paid out", while the dispute row is unexecuted.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | await closeDecidedDisputeOnLostChargeback( | void (
 * @mutate supabase/migrations/20260926034237_chargeback_lost_closes_decided_dispute.sql | OR _disputed_cents < _charge_cents THEN | THEN
 * @mutate supabase/migrations/20260927012240_group_crew_disputes.sql | _customer_id,\n      'info',\n      'Dispute decided', | _customer_id,\n      'info',\n      'Dispute resolved',
 * @mutate supabase/migrations/20260927012240_group_crew_disputes.sql | _job.customer_id, 'info', 'Dispute decided', | _job.customer_id, 'info', 'Dispute resolved',
 * @mutate src/components/job-card/jobStatusLine.ts | case "completed":\n      if (disputeSettling(job)) return "dispute_settling";\n      return payoutNotSettled(job) ? "done_payout_pending" : "done_paid"; | case "completed":\n      return payoutNotSettled(job) ? "done_payout_pending" : "done_paid";
 * @mutate supabase/migrations/20260927012240_group_crew_disputes.sql | IF _payment_status = 'chargeback' THEN | IF false THEN
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | const restored = preDecisionPaymentStatus(closedJob); | const restored = preChargebackPaymentStatus(closedJob);
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | } else if (repaid.rows === 0 && decidedSplitOnly && closedJob.payment_status === "chargeback") { | } else if (repaid.rows === 0 && held && closedJob.payment_status === "chargeback") {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | if (crew) { | if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | await closeDecidedDisputeOnExternalRefund( | void (
 * @mutate supabase/migrations/20261003181427_full_refund_closes_decided_dispute.sql | OR _refunded_cents < _charge_cents THEN | THEN
 * @mutate supabase/migrations/20261003181427_full_refund_closes_decided_dispute.sql | execution_status IN ('pending', 'executing', 'failed'))\n   ORDER BY | execution_status IN ('pending', 'executing', 'failed', 'crew_fanout'))\n   ORDER BY
 */

const REPO = resolve(__dirname, "../..");
const HANDLERS = "supabase/functions/stripe-webhook/handlers";
const CLOSED = `${HANDLERS}/chargeDisputeClosed.ts`;
const MIGRATIONS = resolve(REPO, "supabase/migrations");
const Q344_MIGRATION = "20260926034348_decided_dispute_says_payment_processing.sql";
const read = (rel: string) => blankComments(readFileSync(resolve(REPO, rel), "utf8"));

/** How each Stripe dispute outcome leaves a decided-but-unexecuted dispute. */
const OUTCOME_CLASS: Record<string, "closes" | "restores"> = {
  lost: "closes",
  warning_closed: "restores",
  won: "restores",
};

/** The body of `} else if (outcome === "<o>") {` … up to the next sibling branch. */
function branch(src: string, outcome: string): string {
  const open = src.search(new RegExp(`(?:if|else if) \\(outcome === "${outcome}"\\) \\{`));
  if (open < 0) return "";
  let depth = 0;
  for (let i = src.indexOf("{", open); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i);
  }
  return "";
}

describe("Q342: every chargeback outcome leaves a decided dispute settleable or settled", () => {
  const closed = read(CLOSED);

  it("the handlers that block a job as 'chargeback' are inventoried", () => {
    const blockers = readdirSync(resolve(REPO, HANDLERS))
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /\.update\(\{\s*payment_status:\s*"chargeback"/.test(read(`${HANDLERS}/${f}`)));
    // chargeDisputeCreated's escrow/payout_pending block and released flip, and
    // the clawback helper it calls (released -> chargeback). Every one of them
    // runs on charge.dispute.created / funds_withdrawn, so every job they block
    // ends in charge.dispute.closed, classified below.
    expect(blockers).toEqual(["_chargebackClawback.ts", "chargeDisputeCreated.ts"]);
    expect(read(`${HANDLERS}/chargeDisputeCreated.ts`)).toMatch(/clawBackReleasedPayout\(/);
  });

  it("every dispute outcome the closed handler branches on is classified, exactly", () => {
    // The handler itself, not the helpers below it (they name their own RPC's
    // outcomes with the same variable name).
    const handler = closed.slice(
      closed.indexOf("export async function handleChargeDisputeClosed("),
      closed.indexOf("async function closeDecidedDisputeOnLostChargeback("),
    );
    const outcomes = new Set([...handler.matchAll(/outcome === "([a-z_]+)"/g)].map((m) => m[1]));
    expect(outcomes.size).toBeGreaterThanOrEqual(3);
    expect([...outcomes].sort()).toEqual(Object.keys(OUTCOME_CLASS).sort());
  });

  it("'lost' closes the decided dispute FIRST in its branch (a throw retries with nothing done)", () => {
    const lost = branch(closed, "lost");
    const close = lost.indexOf("await closeDecidedDisputeOnLostChargeback(");
    expect(close, "the lost branch never calls the close").toBeGreaterThan(-1);
    const firstOther = lost.search(/await (finalizeLostClawback|notifyPayee|supabase)\b/);
    expect(firstOther === -1 || close < firstOther).toBe(true);
  });

  it("'warning_closed' restores the pre-block payment state (the split can run again)", () => {
    expect(branch(closed, "warning_closed")).toMatch(/preChargebackPaymentStatus\(closedJob\)/);
  });

  it("Q449: 'won' restores the state the decision left ONLY for a decided single-Helpr split, keeping its markers", () => {
    const won = branch(closed, "won");
    // Gated on a decided single-Helpr split and nothing else (review HIGH:
    // every other hold has an automatic settler the restore would switch back
    // on), never on a clawed-back released job, never with no hold.
    expect(won).toMatch(/else if \(repaid\.rows === 0 && decidedSplitOnly && closedJob\.payment_status === "chargeback"\) \{/);
    const gate = closed.slice(closed.indexOf("const decidedSplitOnly ="), closed.indexOf("if (ownsMarkers) {"));
    expect(gate).toMatch(/hold\.unsettledDisputeId !== "unknown"/);
    expect(gate).toMatch(/hold\.unsettledExecutionStatus !== "crew_fanout"/);
    expect(gate).toMatch(/closedJob\.is_group_job !== true/);
    expect(gate).toMatch(/holdReasons\(closedJob, \{ openDisputeId: hold\.openDisputeId, reversedTransferId: hold\.reversedTransferId \}\)\.length === 0/);
    // Any other hold keeps the block and is handed to a person.
    expect(won).toMatch(/else if \(repaid\.rows === 0 && held && closedJob\.payment_status === "chargeback"\) \{\s*wonNeedsHuman = true;/);
    const restore = won.slice(won.indexOf("repaid.rows === 0 && decidedSplitOnly"));
    expect(restore).toMatch(/const restored = preDecisionPaymentStatus\(closedJob\);/);
    // rpc_decide_dispute never touches payment_status / payout_scheduled_at.
    expect(closed).toMatch(/function preDecisionPaymentStatus\([\s\S]*?return job\.payout_scheduled_at \? "payout_pending" : "escrow";/);
    // disputed_at is KEPT (stamped if empty): never cleared on 'won'.
    expect(restore).toMatch(/disputed_at: closedJob\.disputed_at \?\? new Date\(\)\.toISOString\(\)/);
    // A compare-and-set on the job status, the chargeback block and the
    // dispute_status read.
    expect(restore).toMatch(/\.eq\("status", closedJob\.status\)\s*\.eq\("payment_status", "chargeback"\)\s*\.or\(disputeStatusAsReadFilter\(closedJob\.dispute_status\)\)\s*\.select\("id"\)/);
    // The hold read fails closed for 'won' too (it decides the restore).
    expect(closed).toMatch(/if \(outcome === "warning_closed" \|\| outcome === "won"\) \{\s*hold = await findInternalPayoutHold\(supabase, closedJob\.id\);\s*if \(hold\.readError\) \{/);
  });

  it("the close calls the RPC, throws on a DB error, and pages on anything but 'nothing to close'", () => {
    const fn = closed.slice(closed.indexOf("async function closeDecidedDisputeOnLostChargeback("));
    const body = fn.slice(0, fn.indexOf("\nfunction ") > 0 ? fn.indexOf("\nfunction ") : undefined);
    expect(body).toMatch(/supabase\.rpc\("settle_dispute_by_chargeback"/);
    expect(body).toMatch(/if \(error\) \{[\s\S]*?throw new Error/);
    expect(body).toMatch(/if \(outcome === "no_unsettled_dispute"\) return outcome;/);
    expect(body).toMatch(/severity: "critical",\s*title: "Chargeback LOST on a decided dispute — settle it by hand"/);
  });

  it("settle_dispute_by_chargeback (newest definition) closes only what it may, service-role only", () => {
    const def = effectiveDefs(MIGRATIONS).get("settle_dispute_by_chargeback");
    expect(def, "settle_dispute_by_chargeback is not defined by any migration").toBeDefined();
    const sql = def!.stmt;
    expect(sql).toMatch(/status = 'decided'\s+AND execution_status IS DISTINCT FROM 'executed'/);
    expect(sql).toMatch(/_disputed_cents < _charge_cents/);
    expect(sql).toMatch(/payment_status IS DISTINCT FROM 'chargeback'/);
    expect(sql).toMatch(/g\.status IN \('redeemed', 'reserved'\)/);
    expect(sql).toMatch(/money_step_at IS NOT NULL/);
    expect(sql).toMatch(/SET execution_status\s+= 'executed'/);
    // Review M1: an internal dispute still OPEN on the charged-back job pages.
    expect(sql).toMatch(/o\.status = 'open'[\s\S]*?'needs_human'/);
    const file = readFileSync(resolve(MIGRATIONS, def!.file), "utf8");
    expect(file).toMatch(/REVOKE ALL ON FUNCTION public\.settle_dispute_by_chargeback\(uuid, text, bigint, bigint\) FROM PUBLIC, anon, authenticated;/);
    expect(file).toMatch(/GRANT EXECUTE ON FUNCTION public\.settle_dispute_by_chargeback\(uuid, text, bigint, bigint\) TO service_role;/);
  });
});

describe("Q450: a full refund made outside the split closes a decided dispute", () => {
  it("every webhook handler that writes payment_status 'refunded' calls the close right after (inventoried)", () => {
    const writers = readdirSync(resolve(REPO, HANDLERS))
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /\.update\(\{\s*payment_status:\s*"refunded"/.test(read(`${HANDLERS}/${f}`)));
    expect(writers.length).toBeGreaterThanOrEqual(1);
    expect(writers).toContain("chargeRefunded.ts");
    for (const f of writers) {
      const src = read(`${HANDLERS}/${f}`);
      const write = src.search(/\.update\(\{\s*payment_status:\s*"refunded"/);
      const close = src.indexOf("await closeDecidedDisputeOnExternalRefund(");
      expect(close, `${f} writes 'refunded' but never closes a decided dispute`).toBeGreaterThan(write);
    }
  });

  it("the close keys on WHO refunded: a refund carrying the split's dispute metadata is never closed here", () => {
    const src = read(`${HANDLERS}/chargeRefunded.ts`);
    const fn = src.slice(src.indexOf("async function closeDecidedDisputeOnExternalRefund("));
    expect(fn).toMatch(/stripe\.refunds\.list\(\{ charge: charge\.id/);
    expect(fn).toMatch(/metadata[^\n]*dispute_id/);
    // A crew decision is read and handed to a person, before any Stripe read
    // (the fan-out never runs on a refunded job; review MEDIUM).
    expect(src).toMatch(/const UNEXECUTED_DECISION_FILTER = "execution_status\.is\.null,execution_status\.in\.\(pending,executing,failed,crew_fanout\)";/);
    const crewAt = fn.indexOf("if (crew) {");
    expect(crewAt).toBeGreaterThan(-1);
    expect(crewAt).toBeLessThan(fn.indexOf("stripe.refunds.list("));
    expect(fn.slice(crewAt, fn.indexOf("stripe.refunds.list("))).toMatch(/await handBack\([\s\S]*?return "needs_human";/);
    // The split's own refund returns BEFORE the RPC; a mixed charge pages.
    expect(fn.indexOf('return "split_refund"')).toBeGreaterThan(-1);
    expect(fn.indexOf('return "split_refund"')).toBeLessThan(fn.indexOf('supabase.rpc("settle_dispute_by_external_refund"'));
    // A DB error or a run in flight throws (Stripe redelivers); needs_human pages critical.
    expect(fn).toMatch(/if \(error\) \{[\s\S]*?throw new Error/);
    expect(fn).toMatch(/if \(outcome === "busy"\) \{[\s\S]*?throw new Error/);
    expect(fn).toMatch(/severity: "critical",\s*title: "Full refund on a decided dispute — settle it by hand"/);
  });

  it("settle_dispute_by_external_refund (newest definition) closes only what it may, service-role only", () => {
    const def = effectiveDefs(MIGRATIONS).get("settle_dispute_by_external_refund");
    expect(def, "settle_dispute_by_external_refund is not defined by any migration").toBeDefined();
    const sql = def!.stmt;
    expect(sql).toMatch(/status = 'decided'\s+AND \(execution_status IS NULL OR execution_status IN \('pending', 'executing', 'failed'\)\)/);
    // A crew decision is the payout fan-out's to settle, never this close's.
    expect(sql).not.toMatch(/crew_fanout/);
    expect(sql).toMatch(/_refunded_cents < _charge_cents/);
    expect(sql).toMatch(/payment_status IS DISTINCT FROM 'refunded'/);
    expect(sql).toMatch(/g\.status IN \('redeemed', 'reserved'\)/);
    expect(sql).toMatch(/money_step_at IS NOT NULL/);
    expect(sql).toMatch(/r\.source = 'dispute_split'/);
    expect(sql).toMatch(/'busy'/);
    expect(sql).toMatch(/SET execution_status\s+= 'executed'/);
    const file = readFileSync(resolve(MIGRATIONS, def!.file), "utf8");
    expect(file).toMatch(/REVOKE ALL ON FUNCTION public\.settle_dispute_by_external_refund\(uuid, text, bigint, bigint\) FROM PUBLIC, anon, authenticated;/);
    expect(file).toMatch(/GRANT EXECUTE ON FUNCTION public\.settle_dispute_by_external_refund\(uuid, text, bigint, bigint\) TO service_role;/);
  });
});

describe("Q342 review M1: no decision is recorded that could never execute", () => {
  it("rpc_decide_dispute (effective definition) refuses a 'chargeback' job", () => {
    const sql = effectiveDefs(MIGRATIONS).get("rpc_decide_dispute")!.stmt;
    expect(sql).toMatch(/IF _payment_status = 'chargeback' THEN\s+RAISE EXCEPTION 'dispute_job_charged_back'/);
    // The refusal comes BEFORE the dispute row is written.
    expect(sql.indexOf("dispute_job_charged_back")).toBeLessThan(sql.indexOf("SET status = 'decided'"));
  });

  it("the admin is shown why, not 'try again'", () => {
    expect(read("src/lib/lifecycleErrors.ts")).toMatch(/dispute_job_charged_back:\s*\n?\s*"/);
    expect(read("src/components/admin/AdminDisputes.tsx")).toMatch(/lifecycleErrorMessage\(err\) \?\? userFacingError\(err, "Couldn't record that decision/);
  });
});

describe("Q344: a decision is not announced as a settlement", () => {
  const SETTLED_WORDS = /'Dispute (resolved|settled)'/;
  const decidesUnexecuted = (stmt: string) => /execution_status\s*=\s*COALESCE\([^)]*'pending'\)|execution_status\s*=\s*'(pending|crew_fanout)'/.test(stmt);

  it("no function that records an unexecuted decision says 'Dispute resolved/settled'", () => {
    const defs = effectiveDefs(MIGRATIONS);
    const deciders = [...defs].filter(([, d]) => decidesUnexecuted(d.stmt)).map(([n]) => n);
    expect(deciders).toContain("rpc_decide_dispute");
    // A crew decision (Q728) is unexecuted too until the payout fan-out runs.
    expect(deciders).toContain("rpc_decide_crew_dispute");
    const lying = [...defs].filter(([n, d]) => deciders.includes(n) && SETTLED_WORDS.test(d.stmt)).map(([n]) => n);
    expect(lying).toEqual([]);
  });

  it("is red on the state before the fix (the check can fail)", () => {
    const before = effectiveDefs(MIGRATIONS, { before: Q344_MIGRATION });
    expect(SETTLED_WORDS.test(before.get("rpc_decide_dispute")!.stmt)).toBe(true);
  });

  const base = {
    id: "job-q344", status: "completed", helper_id: "h", customer_id: "p",
    // Q451: "the ordinary finish" this fixture falls back to when the dispute
    // is executed (not in `settling`) means the payout has actually settled,
    // not merely that it isn't blocked by a dispute — so `released`, not
    // `escrow`, which Q451's own guard now correctly reads as not-yet-paid.
    payment_status: "released", dispute_status: "resolved",
  } as unknown as Job;
  const settling = new Set(["job-q344"]);

  it("the poster's card says 'payment processing', for completed AND cancelled decisions", () => {
    expect(derivePosterWait(withDisputeSettling(base, settling), 0, new Date(), { tipped: true, reviewed: true })).toBe("dispute_settling");
    expect(derivePosterWait(withDisputeSettling({ ...base, status: "cancelled" } as Job, settling))).toBe("dispute_settling");
    // Executed (not in the set): back to the ordinary finish.
    expect(derivePosterWait(withDisputeSettling(base, new Set()), 0, new Date(), { tipped: true, reviewed: true })).toBe("done_paid");
  });

  it("the Helpr's card says 'payment processing', not 'Paid out'", () => {
    const app = (job: Job) => ({ id: "a", job_id: job.id, helper_id: "h", status: "accepted", job }) as unknown as AppliedApp;
    expect(deriveHelperWait(app(withDisputeSettling(base, settling)))).toBe("dispute_settling");
    expect(deriveHelperWait(app(withDisputeSettling({ ...base, status: "cancelled" } as Job, settling)))).toBe("dispute_settling");
    expect(deriveHelperWait(app(withDisputeSettling(base, undefined)))).toBe("done_paid");
  });

  it("both cards attach the flag from the dispute row", () => {
    expect(read("src/pages/posts/PostedJobCard.tsx")).toMatch(/<PosterStatusStrip\s+job=\{withDisputeSettling\(job, unsettledDisputeJobIds\)\}/);
    expect(read("src/pages/posts/postedJobCard/PosterStatusStrip.tsx")).toMatch(/posterStatusLine\(job,/);
    expect(read("src/pages/jobs/AppliedJobCard.tsx")).toMatch(/helperStatusLine\([^)]*withDisputeSettling\(app\.job, unsettledDisputeJobIds\)/);
    const hook = read("src/hooks/useUnsettledDisputeJobIds.ts");
    expect(hook).toMatch(/\.eq\("status", "decided"\)/);
    expect(hook).toMatch(/execution_status\.is\.null,execution_status\.neq\.executed/);
  });
});
