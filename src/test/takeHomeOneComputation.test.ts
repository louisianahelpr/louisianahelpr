/**
 * #62 (audit 2026-10-21): the quick view and the "Application sent" sheet showed a
 * Helpr's take-home from a different path than the job page ("$103" beside "posted
 * at $120"). They now read useHelprTakeHome (src/components/dashboard/helprTakeHome.tsx),
 * which must run the job page's OWN computation (useHelprMoney in JobPageParts.tsx):
 * the same computeNet call, argument for argument. If one side changes how it
 * prices a take-home, this fails until the other does too.
 *
 * @mutate src/components/dashboard/helprTakeHome.tsx | computeNet(job.budget, tierPct, job.urgent_fee ?? 0, helpers, job.status === "disputed" ? 0 : firstPayoutFee, job) | computeNet(job.budget, tierPct, job.urgent_fee ?? 0, helpers, firstPayoutFee, job)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));
const CALL = /computeNet\(([^;]*?)\)\.netEarnings/;

describe("one take-home computation for the job page, the quick view and Application sent (#62)", () => {
  it("useHelprTakeHome's computeNet call is the job page's, argument for argument", () => {
    const page = read("src/pages/jobs/jobPage/JobPageParts.tsx").match(CALL)?.[1];
    const shared = read("src/components/dashboard/helprTakeHome.tsx").match(CALL)?.[1];
    expect(page, "useHelprMoney no longer calls computeNet(...).netEarnings").toBeTruthy();
    expect(shared, "useHelprTakeHome no longer calls computeNet(...).netEarnings").toBeTruthy();
    expect(shared).toBe(page);
  });

  it("the quick view and Application sent both render the shared pair", () => {
    expect(read("src/components/dashboard/JobDetailDialog.tsx")).toContain("<JobPriceTakeHome job={job} bare />");
    expect(read("src/components/dashboard/ApplicationSentDialog.tsx")).toContain("<JobPriceTakeHome job={job} after=");
  });
});
