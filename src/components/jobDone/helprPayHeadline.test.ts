/**
 * A3-59 (audit 11-01): the Helpr's Job done sheet, before the transfer exists, names the day the page names
 * ("Approved · your pay goes out Tue, Nov 3"), never an amount (account-level deductions can change it).
 *
 * @mutate src/components/jobDone/JobDoneSummary.tsx |   if (at && !Number.isNaN(at.getTime()) && at.getTime() > now.getTime()) { |   if (false) {
 * @mutate src/components/jobDone/JobDoneSummary.tsx |           scheduledAt={job.payout_scheduled_at} |           scheduledAt={null}
 * @mutate src/components/jobDone/JobDoneSummary.tsx | timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" })}`; | timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })}`;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { helprPayHeadline } from "./JobDoneSummary";

const NOW = new Date("2030-11-01T18:00:00Z");

describe("A3-59: the Job done headline before the transfer", () => {
  it("names the scheduled day, in Louisiana time, and no amount", () => {
    // Tue Nov 5 2030 at 11:30 PM CST = Wed 05:30Z: still Tuesday in Louisiana.
    expect(helprPayHeadline(0, false, "2030-11-06T05:30:00Z", NOW)).toBe("Approved · your pay goes out Tue, Nov 5");
  });

  it("no day, a passed day or an unreadable one: being prepared", () => {
    expect(helprPayHeadline(0, false, null, NOW)).toBe("Your pay is being prepared");
    expect(helprPayHeadline(0, false, "2030-10-30T18:00:00Z", NOW)).toBe("Your pay is being prepared");
    expect(helprPayHeadline(0, false, "garbage", NOW)).toBe("Your pay is being prepared");
  });

  it("once a transfer exists, its amount", () => {
    expect(helprPayHeadline(11300, false, "2030-11-06T05:30:00Z", NOW)).toBe("$113 is on its way");
    expect(helprPayHeadline(11300, true, null, NOW)).toBe("$113 was sent");
  });

  it("the sheet passes the job's payout_scheduled_at", () => {
    const src = readFileSync("src/components/jobDone/JobDoneSummary.tsx", "utf8");
    expect(src).toContain("scheduledAt={job.payout_scheduled_at}");
    expect(src.match(/helprPayHeadline\(cents, sent, scheduledAt\)/g)?.length ?? 0).toBeGreaterThan(0);
  });
});
