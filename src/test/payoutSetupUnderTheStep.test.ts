/**
 * JOBS2-44 (Jobs audit 10-30): on the day, the Helpr's card drew "Finish payout setup to get paid" ABOVE the job's
 * step, pushing the step down the card. The money band is drawn twice now: the payment problem above the step (it can
 * stop the job), the payout setup note under the step sections (the pay waits either way).
 *
 * @mutate src/pages/jobs/AppliedJobCard.tsx | amountLabel={null} only="problem" />} | amountLabel={null} />}
 * @mutate src/pages/jobs/AppliedJobCard.tsx | amountLabel={`$${formatPriceFloor(payout)}`} only="setup" />} | amountLabel={`$${formatPriceFloor(payout)}`} only="problem" />}
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const src = blankComments(readFileSync("src/pages/jobs/AppliedJobCard.tsx", "utf8"));
const at = (re: RegExp) => {
  const m = re.exec(src);
  return m ? m.index : -1;
};

describe("the Helpr's card: payout setup sits under the job's step (JOBS2-44)", () => {
  const problem = at(/<HelperMoneyNotices [^>]*only="problem"/);
  const setup = at(/<HelperMoneyNotices [^>]*only="setup"/);
  const steps = ["<ConfirmedSection", "<ActiveJobSection", "<CrewMemberSection"].map((s) => src.indexOf(s));

  it("finds the band twice and the three step sections (floor)", () => {
    expect([problem, setup, ...steps].filter((i) => i >= 0).length).toBeGreaterThan(4);
    expect(src.match(/<HelperMoneyNotices /g)?.length).toBe(2);
  });

  it("the problem part is above every step section, the setup part under every one", () => {
    for (const s of steps) {
      expect(problem).toBeLessThan(s);
      expect(setup).toBeGreaterThan(s);
    }
  });
});
