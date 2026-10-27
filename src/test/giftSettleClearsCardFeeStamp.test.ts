/**
 * A fully gift-funded job never carries a card checkout's fee stamp.
 *
 * THE BUG (lh-money-escrow review of the gift path, 2026-10-05; code read):
 * create-payment's stampSession writes the poster's card fee
 * (customer_fee_amount) the moment a Checkout Session is created. When that
 * checkout was abandoned and the job was then fully paid by a gift card,
 * redeem_gift_card's settled branch flipped the job to escrow and cleared the
 * dead session id, but left the fee as stamped, so every refund path and
 * notice read a fee that was never charged. Fixed by
 * 20261012231646_gift_settle_clears_card_fee_stamp.sql.
 *
 * The class, inventoried from source: every poster-charge column (`customer_*`)
 * that ANY stampSession call in create-payment writes must be zeroed by every
 * update in the NEWEST redeem_gift_card (any dollar tag, comments blanked)
 * that flips the job to escrow. A new stamped poster fee column fails here
 * until the gift path clears it too.
 *
 * Behaviour (real Postgres, old RED / new GREEN, applied 3x):
 * src/test/pglite/giftSettleClearsCardFeeStamp.pglite.mjs.
 *
 * Since 20261018031451 (jobs poster fee, owner 2026-10-18) the settle writes
 * customer_fee_amount = v_fee_cents / 100: 0 on the flat model (still zeroing a
 * stale card fee), the stamped fee the gift paid on a poster-fee job. The
 * guard pins that v_fee_cents is 0 whenever the job carries no poster stamp.
 *
 * @mutate supabase/migrations/20261018031451_poster_fee_gift_first.sql | stripe_session_id = null, customer_fee_amount = v_fee_cents::numeric / 100 where | stripe_session_id = null where
 * @mutate supabase/migrations/20261018031451_poster_fee_gift_first.sql | stripe_session_id = null, customer_fee_amount = v_fee_cents::numeric / 100 where | stripe_session_id = null, customer_fee_amount = 1 where
 * @mutate supabase/migrations/20261018031451_poster_fee_gift_first.sql |   else\n    v_fee_cents := 0;\n |   else\n    v_fee_cents := 1;\n
 * @mutate supabase/functions/create-payment/index.ts | const diffStamp = await stampSession(diffSession.id, { customer_fee_amount: | const diffStamp = await stampSession(diffSession.id, { customer_card_fee: 0, customer_fee_amount:
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const cp = blankComments(readFileSync(join(ROOT, "supabase/functions/create-payment/index.ts"), "utf8"));
const redeem = effectiveDefs(join(ROOT, "supabase", "migrations")).get("redeem_gift_card");
const body = blankSqlComments(redeem?.stmt ?? "");

/**
 * Poster-charge columns written by any stampSession(<id>, { ... }) call, or stampSession(<id>, <name>) whose
 * `const <name> = { ... }` is in the same file (Q2399: the escrow and card-hold setup checkouts share one stamp).
 */
function stampedPosterFeeColumns(src: string): { calls: number; cols: string[] } {
  const bodies: string[] = [];
  for (const c of src.matchAll(/stampSession\(\s*[\w.]+\s*,\s*(?:\{([^}]*)\}|([A-Za-z_$][\w$]*)\s*\))/g)) {
    if (c[1] !== undefined) { bodies.push(c[1]); continue; }
    const decl = new RegExp(`const\\s+${c[2]}\\s*=\\s*\\{([^}]*)\\}`).exec(src);
    expect(decl, `stampSession(..., ${c[2]}) with no object-literal declaration`).not.toBeNull();
    bodies.push(decl![1]);
  }
  const cols = new Set<string>();
  for (const b of bodies) for (const k of b.matchAll(/\b(\w+)\s*:/g)) if (k[1].startsWith("customer_")) cols.add(k[1]);
  return { calls: bodies.length, cols: [...cols].sort() };
}

describe("a gift-settled job keeps no card fee stamp", () => {
  it("every poster fee column a checkout stamps is zeroed when the gift funds the job", () => {
    const { calls, cols } = stampedPosterFeeColumns(cp);
    // Inventory floors: the full-price and the gift-difference checkouts both stamp.
    expect(calls).toBeGreaterThan(1);
    expect(cols.length).toBeGreaterThan(0);
    expect(cols).toContain("customer_fee_amount");

    expect(redeem, "no redeem_gift_card definition in the migrations").toBeDefined();
    const escrowWrites = [...body.matchAll(/update\s+jobs\s+set\s+([^;]*?)\s+where\s+id\s*=\s*p_job_id/gi)]
      .map((m) => m[1])
      .filter((set) => /payment_status\s*=\s*'escrow'/i.test(set));
    expect(escrowWrites.length).toBeGreaterThan(0);
    for (const set of escrowWrites) {
      for (const col of cols) {
        // 0, or the poster-fee amount v_fee_cents (0 off the poster stamp, below).
        expect(set, `escrow flip leaves ${col} as stamped`).toMatch(
          new RegExp(`\\b${col}\\s*=\\s*(0\\b|v_fee_cents::numeric\\s*/\\s*100\\b)`, "i"));
      }
    }
    // v_fee_cents is non-zero ONLY under the poster stamp: the flat branch sets 0.
    if (/v_fee_cents/i.test(body)) {
      expect(body).toMatch(/if\s+v_job\.poster_fee_flat_cents\s+is\s+not\s+null\s+then[\s\S]*?else\s+v_fee_cents\s*:=\s*0\s*;\s*end\s+if\s*;/i);
      expect([...body.matchAll(/v_fee_cents\s*:=/gi)].length).toBe(2);
    }
  });
});
