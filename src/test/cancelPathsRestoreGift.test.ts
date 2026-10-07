/**
 * GUARD (SC-005 follow-up): every edge-function path that writes a job to a
 * terminal cancelled/refunded payment_status gives a gift card back first.
 *
 * THE CLASS. A job funded by a gift card has no Stripe charge behind it (or
 * only a shortfall) — redeem_gift_card consumed the gift against the job, so
 * the gift IS the money. A path that cancels or refunds the job and stops
 * there leaves the gift 'redeemed' on a dead job: the recipient simply loses
 * it, and nothing anywhere notices. create-payment's `cancel_escrow` did exactly
 * that until 2026-09-25 (found by e2e/prod-gift-card.spec.ts), while
 * void-cancelled-payments, release-payout, execute-dispute-split and
 * process-scheduled-payouts all call `restore_gift_card_for_job`.
 *
 * THE INVENTORY is built from source: every `payment_status: "cancelled"` /
 * `"refunded"` literal under supabase/functions, grouped by the path that owns
 * it — one `if (action === "…")` branch of a multi-action function, or the
 * whole file otherwise. Module-level helpers after the `serve()` body are not
 * part of any branch, so a helper that calls the RPC cannot make every branch
 * pass by sitting at the bottom of the file.
 *
 * KNOWN_NO_RESTORE is EXACT, both ways (docs/OPEN.md: see the queue item that
 * names this file). It is EMPTY since Q454 (2026-10-03), which fixed the three
 * paths measured on 2026-09-25 to cancel or refund a job without restoring its
 * gift: create-payment#admin_refund_dispute and #admin_refund_general (on a
 * PARTLY gift-funded job they refunded the shortfall charge and dropped the
 * gift portion; a fully gift-funded job has no PaymentIntent and they 400) and
 * stripe-webhook/handlers/chargeRefunded.ts (a full refund of the shortfall PI
 * marked the job refunded and dropped the gift portion). Each now restores the
 * whole gift AFTER the job's terminal flip (lh-money-escrow review of Q454,
 * HIGH: a gift back while the job is still open to a payout path is a double
 * payment), unless a decided dispute or a live payout owns the escrow; a
 * failed restore pages, and by hand it can no longer double-pay. A path added
 * that drops the gift fails here.
 *
 * SQL writers are out of scope: the one SQL function that sets a job's
 * payment_status to 'cancelled' (rpc_settle_dispute_without_payment,
 * 20260924013122) refuses any job with a redeemed or reserved gift.
 */
import { describe, expect, it } from "vitest";
import { relative, resolve } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const FUNCTIONS = resolve(ROOT, "supabase/functions");

// A literal, or a two-way choice of them (cancel_escrow since Q86:
// `payment_status: captureRefunded ? "refunded" : "cancelled"`).
const TERMINAL_WRITE = /payment_status:\s*(?:[\w$]+\s*\?\s*)?"(cancelled|refunded)"/;
/**
 * CALLING the RPC, or one of the local wrappers that do and handle its
 * outcomes (create-payment's restoreGiftForCancelledJob and its
 * returnGiftAfterRefund, void-cancelled-payments' restorePifGift, the webhook's
 * restoreGiftForRefundedJob). A bare mention of the RPC's name (an alert
 * telling a person to run it by hand) is not a restore: it used to count, so a
 * path that only named the RPC in a string passed (found writing Q454,
 * 2026-10-03).
 */
const RESTORES = /\.rpc\(\s*["']restore_gift_card_for_job["']|restoreGiftForCancelledJob\(|restorePifGift\(|restoreGiftForRefundedJob\(|returnGiftAfterRefund\(/;

// @two-way src/test/cancelPathsRestoreGift.test.ts:stale KNOWN_NO_RESTORE entry
const KNOWN_NO_RESTORE: string[] = [];

type Segment = { id: string; code: string };

/** Split one function's source into the paths that own its writes. */
function segments(rel: string, src: string): Segment[] {
  const code = blankComments(src);
  const starts = [...code.matchAll(/if \(action === "([a-z_]+)"\)/g)];
  if (starts.length === 0) return [{ id: rel, code }];
  // The serve() body closes with `});` in column 0; anything after it is
  // module-level helpers, which belong to no branch.
  const serveEnd = code.search(/\n\}\);\s*\n/);
  const end = serveEnd > starts[0].index! ? serveEnd : code.length;
  return starts.map((m, i) => ({
    id: `${rel}#${m[1]}`,
    code: code.slice(m.index!, i + 1 < starts.length ? starts[i + 1].index! : end),
  }));
}

function inventory() {
  const writers: string[] = [];
  const unrestored: string[] = [];
  for (const file of walkSource([FUNCTIONS])) {
    const rel = relative(FUNCTIONS, file);
    if (rel.includes("mocks/") || /\.test\.ts$/.test(rel)) continue;
    const src = readSource(file);
    if (src === null) continue;
    for (const seg of segments(rel, src)) {
      if (!TERMINAL_WRITE.test(seg.code)) continue;
      writers.push(seg.id);
      if (!RESTORES.test(seg.code)) unrestored.push(seg.id);
    }
  }
  return { writers: writers.sort(), unrestored: unrestored.sort() };
}

describe("every path that cancels or refunds a job gives its gift card back", () => {
  // @mutate supabase/functions/create-payment/index.ts | const giftBack = await restoreGiftForCancelledJob(supabaseAdmin, jobId); | const giftBack = { ok: true as const, reason: "" };
  // @mutate supabase/functions/create-payment/index.ts | const disputeGift = await returnGiftAfterRefund(supabaseAdmin, job, "Quick Refund"); | const disputeGift = { restoredCents: 0, failed: false, posterSentence: "" };
  // @mutate supabase/functions/create-payment/index.ts | : await returnGiftAfterRefund(supabaseAdmin, job, "Admin refund"); | : { restoredCents: 0, failed: false, posterSentence: "" };
  // @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | const giftBack = await restoreGiftForRefundedJob(supabase, String(refundedJob.id)); | const giftBack = { ok: true as const, outcome: null };
  const { writers, unrestored } = inventory();

  it("finds the terminal cancel/refund writers (the inventory is not empty)", () => {
    // cancel_escrow, both admin refunds, chargeRefunded, void-cancelled-payments: 5 on 2026-09-25.
    expect(writers.length).toBeGreaterThan(4);
    expect(writers).toContain("create-payment/index.ts#cancel_escrow");
    expect(writers).toContain("void-cancelled-payments/index.ts");
  });

  it("no path outside the exact known list drops the gift", () => {
    expect(
      unrestored.filter((id) => !KNOWN_NO_RESTORE.includes(id)),
      "these paths cancel or refund a job without restore_gift_card_for_job",
    ).toEqual([]);
  });

  it("the known list is exact: an entry that now restores must be removed", () => {
    const stale = KNOWN_NO_RESTORE.filter((id) => !unrestored.includes(id));
    expect(stale, `stale KNOWN_NO_RESTORE entry ${stale.join(", ")} — it restores now (or is gone); remove it (lower the baseline)`).toEqual([]);
  });

  it("Q454: both admin refunds restore only AFTER their terminal flip succeeded (review HIGH)", () => {
    const src = readSource(resolve(FUNCTIONS, "create-payment/index.ts"));
    expect(src).not.toBeNull();
    // [branch, the restore whose result is used, the flip-failure exit it must follow]
    const cases: Array<[string, string, RegExp]> = [
      ["admin_refund_dispute", "const disputeGift = await returnGiftAfterRefund(",
        /if \(refundUpdateErr \|\| !refundUpdated \|\| refundUpdated\.length === 0\) \{[\s\S]*?status: 500 \}\);\s*\}/],
      ["admin_refund_general", ": await returnGiftAfterRefund(",
        /if \(generalRefundUpdateErr \|\| !generalRefundUpdated \|\| generalRefundUpdated\.length === 0\) \{[\s\S]*?status: 500 \}\);\s*\}/],
    ];
    for (const [id, call, flipExit] of cases) {
      const seg = segments("create-payment/index.ts", src!).find((s) => s.id === `create-payment/index.ts#${id}`);
      expect(seg, id).toBeDefined();
      const restore = seg!.code.indexOf(call);
      const exit = seg!.code.search(flipExit);
      expect(restore, `${id} never restores`).toBeGreaterThan(-1);
      expect(exit, `${id}: its flip-failure exit was not found`).toBeGreaterThan(-1);
      expect(restore, `${id} restores before its flip is known to have landed`).toBeGreaterThan(exit);
    }
    // The wrapper never throws (the job is already closed) and pages critical.
    const helper = blankComments(src!).slice(blankComments(src!).indexOf("async function returnGiftAfterRefund("));
    expect(helper).toMatch(/await restoreGiftForCancelledJob\(supabaseAdmin, job\.id\)/);
    expect(helper.slice(0, helper.indexOf("\n}\n"))).not.toMatch(/\bthrow\b/);
    expect(helper).toMatch(/severity: "critical"/);
  });

  it("Q454: the webhook's wrapper calls the RPC and accepts only the outcomes it defines", () => {
    // @mutate supabase/functions/stripe-webhook/handlers/_giftCardRestore.ts | const { data, error: rpcErr } = await supabase.rpc("restore_gift_card_for_job", { p_job_id: jobId }); | const { data, error: rpcErr } = { data: { outcome: "no_credit" }, error: null };
    const src = blankComments(readSource(resolve(FUNCTIONS, "stripe-webhook/handlers/_giftCardRestore.ts")) ?? "");
    expect(src).toMatch(/supabase\.rpc\("restore_gift_card_for_job", \{ p_job_id: jobId \}\)/);
    for (const o of ["restored", "unreserved", "already_restored", "no_credit", "nothing_to_restore", "job_not_found"]) {
      expect(src).toContain(`outcome === "${o}"`);
    }
    // An error is survivable only when no gift is at stake.
    expect(src).toMatch(/\.in\("status", \["redeemed", "reserved"\]\)/);
  });

  it("Q454 review: every restore wrapper reads 'already given back' before calling a failure a gift still at stake", () => {
    // @mutate supabase/functions/void-cancelled-payments/index.ts | if (!restoredErr && (restoredRows ?? []).length > 0) { | if (false) {
    // The wrappers, found by shape: a function whose name says it restores a
    // gift. Each must, after the RPC, read gift_cards.restored_from_job_id
    // BEFORE its "is a gift at stake" read (the original row stays 'redeemed'
    // after a restore, so an outage after it read as a gift still owed).
    const wrappers: string[] = [];
    for (const file of walkSource([FUNCTIONS])) {
      const rel = relative(FUNCTIONS, file);
      if (rel.includes("mocks/") || /\.test\.ts$/.test(rel)) continue;
      const code = blankComments(readSource(file) ?? "");
      for (const m of code.matchAll(/(?:async function (restore\w*Gift\w*)\(|const (restore\w*Gift\w*) = async \()/g)) {
        const name = m[1] ?? m[2];
        const body = code.slice(m.index!, m.index! + 4000);
        const rpc = body.search(/\.rpc\(\s*"restore_gift_card_for_job"/);
        const atStake = body.search(/\.in\("status", \["redeemed", "reserved"\]\)/);
        if (rpc === -1 || atStake === -1) continue;
        wrappers.push(`${rel}#${name}`);
        const already = body.indexOf('.eq("restored_from_job_id", ');
        expect(already, `${rel}#${name} never reads restored_from_job_id`).toBeGreaterThan(rpc);
        expect(already, `${rel}#${name} reads it after the at-stake check`).toBeLessThan(atStake);
        // ...and settles on it (a read whose answer is ignored proves nothing).
        expect(body.slice(already, atStake), `${rel}#${name} reads it but never acts on it`).toMatch(
          /if \(!restoredErr && \(\(?restoredRows \?\? \[\]\)(?: as unknown\[\]\))?\.length > 0\) \{\s*(?:console\.warn\([\s\S]*?\);\s*)?return \{ ok: true/,
        );
      }
    }
    expect(wrappers.sort()).toEqual([
      "create-payment/index.ts#restoreGiftForCancelledJob",
      "stripe-webhook/handlers/_giftCardRestore.ts#restoreGiftForRefundedJob",
      "void-cancelled-payments/index.ts#restorePifGift",
    ]);
  });

  it("a branch is judged on its own code, not on a helper at the bottom of the file", () => {
    const src = [
      'serve(async () => {',
      '  if (action === "a") { await x.update({ payment_status: "cancelled" }); }',
      '  if (action === "b") { await restoreGiftForCancelledJob(db, id); await x.update({ payment_status: "refunded" }); }',
      '});',
      '',
      'async function restoreGiftForCancelledJob() { return db.rpc("restore_gift_card_for_job"); }',
    ].join("\n");
    const segs = segments("f.ts", src);
    expect(segs.map((s) => s.id)).toEqual(["f.ts#a", "f.ts#b"]);
    expect(RESTORES.test(segs[0].code)).toBe(false);
    expect(RESTORES.test(segs[1].code)).toBe(true);
  });
});
