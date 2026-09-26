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
 * names this file). Each entry is a path measured on 2026-09-25 to cancel or
 * refund a job without restoring its gift:
 *   - create-payment#admin_refund_dispute / #admin_refund_general refuse a
 *     job with no PaymentIntent (so a fully gift-funded job is never silently
 *     refunded there — they 400), but on a PARTLY gift-funded job they refund
 *     the shortfall charge and drop the gift portion;
 *   - stripe-webhook/handlers/chargeRefunded.ts marks a job refunded on a full
 *     refund of its PaymentIntent — for a partly gift-funded job that is the
 *     shortfall PI, and the gift portion is dropped the same way.
 * Fixing one means removing it here in the same commit; adding one fails.
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

const TERMINAL_WRITE = /payment_status:\s*"(cancelled|refunded)"/;
/** Calling the RPC, or one of the two local wrappers that do and handle its outcomes. */
const RESTORES = /restore_gift_card_for_job|restoreGiftForCancelledJob\(|restorePifGift\(/;

// @two-way src/test/cancelPathsRestoreGift.test.ts:stale KNOWN_NO_RESTORE entry
const KNOWN_NO_RESTORE = [
  "create-payment/index.ts#admin_refund_dispute",
  "create-payment/index.ts#admin_refund_general",
  "stripe-webhook/handlers/chargeRefunded.ts",
];

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
