/**
 * docs/OPEN.md LOW-7 — no refusal between taking a payout claim and sending
 * the transfer.
 *
 * `claimPayout` INSERTs a pending payout_transfers row (null transfer id)
 * before `stripe.transfers.create`. Every exit between those two points that
 * is not one of claimPayout's own decisions (error / blocked / adopt-mismatch,
 * none of which leaves a NEW row) strands that row: nothing settles or fails
 * it, and the next run's classifyLedger resumes an orphan that
 * checkUnrecordedTransfers then has to reason about. process-scheduled-payouts'
 * Step 4b escrow cap did exactly that on its payout>escrow exit; it now runs
 * before the claim.
 *
 * Inventory is derived from source: every edge function whose index.ts calls
 * `claimPayout(`. Each one's exit count inside the claim→transfer window is
 * pinned EXACTLY (two-way): a new refusal added there turns this red, and so
 * does a removed claim-decision exit (the window then means something else).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { blankComments } from "../helpers/blankNonCode";

const ROOT = "supabase/functions";

/**
 * The claimPayout decisions — the only legal exits: error, blocked,
 * adopt-mismatch, and (Q764) the error that IS a payout hold (the
 * payout_transfers trigger refused the claim insert with payout_held, so no
 * row was left behind), answered like the hold check itself.
 */
const EXPECTED_EXITS: Record<string, number> = {
  "process-scheduled-payouts": 4,
  "release-payout": 4,
};

function claimWindows() {
  const out: { fn: string; exits: number; capBeforeClaim: boolean | null }[] = [];
  for (const fn of readdirSync(ROOT)) {
    const file = `${ROOT}/${fn}/index.ts`;
    if (!existsSync(file)) continue;
    const src = blankComments(readFileSync(file, "utf8"));
    const claimAt = src.indexOf("claimPayout(");
    if (claimAt < 0) continue;
    const transferAt = src.indexOf("transfers.create(", claimAt);
    expect(transferAt, `${fn}: no transfers.create after claimPayout`).toBeGreaterThan(claimAt);
    const window = src.slice(claimAt, transferAt);
    const exits = (window.match(/\bcontinue;/g) ?? []).length + (window.match(/\breturn\b/g) ?? []).length;
    const capAt = src.indexOf("exceeds_captured_escrow");
    out.push({ fn, exits, capBeforeClaim: capAt < 0 ? null : capAt < claimAt });
  }
  return out;
}

// Proof this guard can fail: put a refusal back between the claim and the transfer.
// @mutate supabase/functions/process-scheduled-payouts/index.ts | const failedCount = claim.failedCount; | const failedCount = claim.failedCount; if (failedCount > 99) continue;
describe("payout claim → transfer window has no refusal exits (LOW-7)", () => {
  const windows = claimWindows();

  it("inventory: every claimPayout caller is found and pinned", () => {
    expect(windows.length).toBeGreaterThan(1);
    expect(windows.map((w) => w.fn).sort()).toEqual(Object.keys(EXPECTED_EXITS).sort());
  });

  it("each window holds exactly its claim-decision exits", () => {
    for (const w of windows) expect({ fn: w.fn, exits: w.exits }).toEqual({ fn: w.fn, exits: EXPECTED_EXITS[w.fn] });
  });

  it("process-scheduled-payouts refuses an over-escrow payout BEFORE it claims", () => {
    const psp = windows.find((w) => w.fn === "process-scheduled-payouts");
    expect(psp?.capBeforeClaim).toBe(true);
  });
});
