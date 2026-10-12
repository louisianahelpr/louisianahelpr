/*
 * Q1418 (a): the gift funds every job create-payment would open a new payment
 * for. create-payment's re-mint gate (RE_MINTABLE_PAYMENT_STATUSES: unpaid,
 * abandoned, failed) let a gift tap through on an abandoned or failed job, and
 * redeem_gift_card then refused it as 'This job has already been funded' (the
 * review measured 116 abandoned jobs with a session id on prod). The class: the
 * set of payment_status values the newest redeem_gift_card accepts must EQUAL
 * the re-mintable set, both ways, so neither side can drift alone.
 *
 * (c) rides along: the concurrent-tap refusal names the gift's own difference
 * checkout when that is what is open.
 */

// @mutate supabase/migrations/20261012081639_gift_funds_unfunded_abandoned_job.sql |   if coalesce(v_job.payment_status, 'unpaid') not in ('unpaid', 'abandoned', 'failed') then |   if v_job.payment_status is distinct from 'unpaid' then
// @mutate supabase/functions/create-payment/index.ts | new Set(["unpaid", "abandoned", "failed"]) | new Set(["unpaid", "abandoned", "failed", "refunded"])
// @mutate supabase/migrations/20261012081639_gift_funds_unfunded_abandoned_job.sql | where g.id = p_credit_id and g.status = 'reserved' and g.job_id = p_job_id) then | where false) then

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments, blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const redeem = effectiveDefs(join(ROOT, "supabase", "migrations")).get("redeem_gift_card");
const body = blankSqlComments(redeem?.stmt ?? "");

/** The payment_status values the body lets through to funding. */
function fundable(sql: string): string[] | null {
  const m = sql.match(/if\s+coalesce\(\s*v_job\.payment_status\s*,\s*'(\w+)'\s*\)\s+not\s+in\s*\(([^)]*)\)\s+then\s+raise\s+exception\s+'This job has already been funded'/i);
  if (!m) return null;
  return [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
}

describe("the gift funds every job create-payment re-mints for (Q1418 a)", () => {
  it("redeem_gift_card's fundable set equals RE_MINTABLE_PAYMENT_STATUSES", () => {
    expect(redeem, "no redeem_gift_card definition in the migrations").toBeDefined();
    const cp = blankComments(readFileSync(join(ROOT, "supabase/functions/create-payment/index.ts"), "utf8"));
    const m = cp.match(/RE_MINTABLE_PAYMENT_STATUSES\s*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(m, "create-payment's re-mint set not found").not.toBeNull();
    const remint = [...m![1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort();
    // Floor: the set is the three unfunded states today.
    expect(remint.length).toBeGreaterThan(2);
    expect(fundable(body)).toEqual(remint);
    // Null is 'unpaid' on both sides (create-payment: `job.payment_status ?? "unpaid"`).
    expect(cp).toMatch(/job\.payment_status \?\? "unpaid"/);
  });

  it("names the gift's own difference checkout when that is the open one (c)", () => {
    expect(body).toMatch(/g\.status\s*=\s*'reserved'\s+and\s+g\.job_id\s*=\s*p_job_id\)\s+then\s+raise exception 'Your gift is already applied to this job/);
    // The card-checkout refusal is still there for every other open session.
    expect(body).toContain("raise exception 'A card payment for this job is already open.");
  });
});
