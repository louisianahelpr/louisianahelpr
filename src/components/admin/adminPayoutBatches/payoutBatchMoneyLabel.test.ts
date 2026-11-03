/**
 * Q2088: Admin -> Payout Batches labels a batch "test account" only when release-payout would pay it in Stripe test
 * mode (admin_payout_batch_money_modes, the jobMoneyMode rule), never from the Helpr's is_seed alone: a seed Helpr's
 * batch on a real poster's job pays LIVE, so it is real money in both confirm dialogs. The SQL rule is proven in
 * src/test/pglite/payoutBatchMoneyModes.pglite.mjs.
 *
 * @mutate src/components/admin/adminPayoutBatches/adminPayoutBatchesHelpers.ts | (typeof b.money_test === "boolean" ? b.money_test : !!b.is_seed) | !!b.is_seed
 * @mutate src/components/admin/AdminPayoutBatches.tsx |         ...(modes ? { money_test: modes.get(r.helper_id) === "test" } : {}), |
 * @mutate src/components/admin/AdminPayoutBatches.tsx |   const realReadyBatches = readyBatches.filter((b) => !isTestMoney(b)); |   const realReadyBatches = readyBatches.filter((b) => !b.is_seed);
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { bulkPayoutDescription, isTestMoney, singlePayoutDescription, splitRealAndTest } from "./adminPayoutBatchesHelpers";

const seedOnRealJob = { total_payout: 40, is_seed: true, money_test: false, helper_name: "Sam", job_count: 1 };
const realTest = { total_payout: 25, is_seed: true, money_test: true, helper_name: "Tess", job_count: 1 };

describe("Q2088: a payout batch is test money only where the money sits", () => {
  it("a seed Helpr's batch that pays live is labelled real money", () => {
    expect(isTestMoney(seedOnRealJob)).toBe(false);
    expect(singlePayoutDescription(seedOnRealJob)).toContain("This moves real money");
    expect(singlePayoutDescription(seedOnRealJob)).not.toContain("test account");
  });

  it("a batch paid in test mode is still named a test account", () => {
    expect(singlePayoutDescription(realTest)).toContain("to the test account Tess");
  });

  it("the bulk confirm counts the seed-on-real batch as real money", () => {
    expect(splitRealAndTest([seedOnRealJob, realTest])).toEqual({ real: 40, test: 25, realCount: 1, testCount: 1 });
    expect(bulkPayoutDescription([seedOnRealJob, realTest])).toContain("$40.00 of real money to 1 Helpr and $25.00 to 1 test account");
  });

  it("with no money-mode answer the label falls back to is_seed (as before)", () => {
    expect(isTestMoney({ total_payout: 1, is_seed: true })).toBe(true);
    expect(isTestMoney({ total_payout: 1, is_seed: false })).toBe(false);
  });

  it("the screen reads the money modes and labels by them", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/admin/AdminPayoutBatches.tsx"), "utf8"));
    expect(src).toContain('supabase.rpc("admin_payout_batch_money_modes")');
    expect(src).toContain('money_test: modes.get(r.helper_id) === "test"');
    expect(src).toContain("readyBatches.filter((b) => !isTestMoney(b))");
    expect(src.match(/isTestMoney\(/g)?.length ?? 0).toBeGreaterThan(0);
  });
});
