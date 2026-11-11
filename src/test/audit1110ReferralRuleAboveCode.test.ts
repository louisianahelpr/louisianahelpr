/**
 * Audit 11-10 W5 F466: the Referrals screen showed "Signed up 2" beside "Total earned $0" with the rule ("you both earn
 * $5 when a friend completes their first job") far below. The rule now reads above the code, so the two numbers make
 * sense on first sight.
 *
 * @mutate src/components/ReferralSection.tsx | you both earn $5 | you earn
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

describe("F466: the referral rule reads above the code", () => {
  it("the $5 rule comes before 'Your referral code' in the card", () => {
    const src = blankComments(readFileSync("src/components/ReferralSection.tsx", "utf8"));
    const rule = src.indexOf("you both earn $5");
    const code = src.indexOf("Your referral code");
    expect(rule, "the rule sentence is gone").toBeGreaterThan(-1);
    expect(code).toBeGreaterThan(-1);
    expect(rule).toBeLessThan(code);
  });
});
