/**
 * AUD31-55, part (Money, Low). Spent and Receipts showed a partly refunded job's net ("Clean gutters · Oct 8 · $80.00"
 * for a $105 job refunded $25) with nothing saying money came back, and "includes $20.91 tip" for a $20 tip (the row's
 * tip cents are the card charge, tip + card fee, tipChargeBreakdown). Receipts said only " · Cancelled".
 * Now ONE rule for both lists (spentRowNote, src/lib/posterSpend.ts): " · Cancelled", " · $25.00 refunded",
 * " · includes $20.91 tip and card fee".
 *
 * CLASS: every list that draws spentRows() (SpentSection, Receipts) writes its row words through spentRowNote, so the
 * two can never say different things about the same money; and the rule says the refund and the card fee.
 *
 * @mutate src/lib/posterSpend.ts |     + (r.refundedCents > 0 ? ` · ${money(r.refundedCents)} refunded` : "") |     + ""
 * @mutate src/lib/posterSpend.ts | tip and card fee` : ""); | tip` : "");
 * @mutate src/pages/profile/Receipts.tsx |         note: spentRowNote(r, formatCents), |         note: r.job?.status === "cancelled" ? " · Cancelled" : "",
 * @mutate src/components/profile/earningsTab/SpentSection.tsx |                   {spentRowNote(r, formatCents)} |                   {r.job?.status === "cancelled" ? " · Cancelled" : ""}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { spentRowNote } from "@/lib/posterSpend";

const ROOT = resolve(__dirname, "../..");
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const job = (status: string | null = "completed") => ({ status });

describe("Spent and Receipts say a refund and the tip's card fee (AUD31-55)", () => {
  it("a partly refunded job says how much came back", () => {
    expect(spentRowNote({ job: job(), tipCents: 0, refundedCents: 2500 }, money)).toBe(" · $25.00 refunded");
  });

  it("a tip is named with its card fee", () => {
    expect(spentRowNote({ job: job(), tipCents: 2091, refundedCents: 0 }, money)).toBe(" · includes $20.91 tip and card fee");
  });

  it("a cancelled job with money back says both, in that order; a plain job says nothing; a lone tip row says nothing", () => {
    expect(spentRowNote({ job: job("cancelled"), tipCents: 0, refundedCents: 4500 }, money)).toBe(" · Cancelled · $45.00 refunded");
    expect(spentRowNote({ job: job(), tipCents: 0, refundedCents: 0 }, money)).toBe("");
    expect(spentRowNote({ job: null, tipCents: 900, refundedCents: 0 }, money)).toBe("");
  });

  it("every list that draws spentRows() writes its row words through spentRowNote", () => {
    const users = ["src/components/profile/earningsTab/SpentSection.tsx", "src/pages/profile/Receipts.tsx"];
    for (const f of users) {
      const code = blankComments(readFileSync(resolve(ROOT, f), "utf8"));
      expect(code, f).toMatch(/\bspentRows\(/);
      expect(code, f).toMatch(/\bspentRowNote\(r, formatCents\)/);
      expect(code, f).not.toMatch(/" · Cancelled"/);
    }
    expect(users.length).toBeGreaterThan(1);
  });
});
