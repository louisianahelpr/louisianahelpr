/**
 * Q805 (5): a won dispute's re-payment row must be writable beside the reversed
 * original. The unique index leaves rows tagged with chargebackClawback.ts's
 * REPAY_SOURCE out, so the tag in the index and the tag the writer stamps must
 * be the same string. Behaviour (red before, 3x replay):
 * src/test/pglite/chargebackRepayLedgerRow.pglite.mjs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

describe("chargeback re-payment rows sit outside the one-live-payout index", () => {
  const mig = read("supabase/migrations/20261007012447_chargeback_repay_row_beside_reversed.sql");
  const writer = read("supabase/functions/_shared/chargebackClawback.ts");
  const tag = /const REPAY_SOURCE = "([^"]+)"/.exec(writer)?.[1];

  it("reads the real migration and writer (inventory floor)", () => {
    expect(mig.length).toBeGreaterThan(800);
    expect(writer.length).toBeGreaterThan(5000);
  });

  it("the writer stamps a source tag on the re-payment row", () => {
    expect(tag).toBeTruthy();
    expect(writer).toMatch(/status: "paid",[\s\S]{0,200}metadata: \{ source: REPAY_SOURCE/);
  });

  it("the index excludes exactly that tag and keeps the live statuses", () => {
    expect(mig).toContain(`(metadata ->> 'source') IS DISTINCT FROM '${tag}'`);
    expect(mig).toMatch(/WHERE status IN \('pending', 'paid', 'reversed'\)/);
    expect(mig).toMatch(/RENAME TO payout_transfers_one_live_per_job_helper;/);
  });
});
