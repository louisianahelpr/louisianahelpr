/**
 * Q1418 (a) (owner, 2026-10-07): a gift funds an 'abandoned' or 'failed' job
 * like an 'unpaid' one, as create-payment's card re-mint already does
 * (RE_MINTABLE_PAYMENT_STATUSES); a live open checkout still blocks it.
 * redeem_gift_card refused both as "This job has already been funded".
 *
 * Static half: the NEWEST redeem_gift_card in the migrations admits exactly the
 * re-mintable states and keeps the open-checkout refusal. Behaviour (real
 * Postgres): src/test/pglite/giftFundsAbandonedJob.pglite.mjs (7 PASS; 3 FAIL
 * with NEW_MIGRATION=skip, the live definition).
 *
 * @mutate supabase/migrations/20261007130001_gift_funds_abandoned_or_failed_job.sql |      or v_job.payment_status not in ('unpaid', 'abandoned', 'failed') then |      or v_job.payment_status not in ('unpaid') then
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");
const body = blankSqlComments(defs.get("redeem_gift_card")?.stmt ?? "");
const createPayment = readFileSync("supabase/functions/create-payment/index.ts", "utf8");

describe("Q1418 (a): a gift funds the same job states a card checkout re-mints on", () => {
  it("inventory: the effective redeem_gift_card is found (floor)", () => {
    expect(body.length).toBeGreaterThan(1000);
  });

  it("redeem_gift_card admits exactly create-payment's re-mintable states", () => {
    const remint = /RE_MINTABLE_PAYMENT_STATUSES = new Set\(\[([^\]]*)\]\)/.exec(createPayment)?.[1] ?? "";
    const states = [...remint.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
    expect(states).toEqual(["abandoned", "failed", "unpaid"]);
    const admitted = /payment_status not in \(([^)]*)\)/i.exec(body)?.[1] ?? "";
    expect([...admitted.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual(states);
  });

  it("an open card checkout other than the one just retired is still refused", () => {
    expect(body).toMatch(/stripe_session_id is distinct from p_retired_session/i);
  });
});
