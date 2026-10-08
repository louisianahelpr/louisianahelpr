/**
 * Owner, 2026-10-08 (My Jobs > Done, "Mow a quarter-acre lawn": a "Reviewed"
 * band above a "Done · payout pending" strip): "There should only be one
 * section at the bottom so merge those 2 into 1".
 *
 * @mutate src/pages/jobs/appliedJobCard/HelperCollapsedStrip.tsx |   return { ...line, detail: `${line.detail} · Reviewed` }; |   return line;
 * @mutate src/pages/jobs/AppliedJobCard.tsx | hideStatus={isOffered} reviewed={isFullyDone} /> | hideStatus={isOffered} />
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withReviewed } from "./HelperCollapsedStrip";

const line = (id: string, detail: string) => ({ id, detail, eyebrow: "", tone: "done" }) as never;

describe("a finished, reviewed job has ONE bottom line", () => {
  it("'Done · payout pending · Reviewed'", () => {
    expect((withReviewed(line("done_payout_pending", "Done · payout pending"), true) as { detail: string }).detail)
      .toBe("Done · payout pending · Reviewed");
    expect((withReviewed(line("done_paid", "Paid out"), true) as { detail: string }).detail).toBe("Paid out · Reviewed");
  });
  it("not reviewed, or not done: unchanged", () => {
    expect((withReviewed(line("done_paid", "Paid out"), false) as { detail: string }).detail).toBe("Paid out");
    expect((withReviewed(line("confirmed", "You're scheduled"), true) as { detail: string }).detail).toBe("You're scheduled");
  });
  it("the card draws no separate 'Reviewed' band and tells the strip instead", () => {
    const src = readFileSync(join(process.cwd(), "src/pages/jobs/AppliedJobCard.tsx"), "utf8");
    expect(src).not.toMatch(/<CheckCircle2 className="w-3 h-3" \/> Reviewed<\/span>/);
    expect(src).toMatch(/reviewed=\{isFullyDone\}/);
  });
});
