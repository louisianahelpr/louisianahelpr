/**
 * A3-45 (audit 11-01): the Applicants sheet says the next step, by when, and what happens if nobody is hired.
 *
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx |           <ApplicantsNextStep job={selectedJob} pending={applications.filter((a) => a.status === "pending").length} /> |
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsNextStep.tsx |   if (first && first.at.getTime() > now.getTime()) { |   if (first) {
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsNextStep.tsx | job.payment_status === "held" ? " and your card isn't charged" : "" | " and your card isn't charged"
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsNextStep.tsx | if (job.status !== "open" \|\| pending <= 0) return null; | if (pending < 0) return null;
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsNextStep.tsx | const TZ = "America/Chicago"; | const TZ = "UTC";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { nextStepWords } from "@/components/ui/NextStep";
import { ApplicantsNextStep, applicantsNextStep } from "./ApplicantsNextStep";

// Sat Nov 16 2058 9:00 AM CST = 15:00Z; the listing closes 14 days later.
// Pinned 28 years out (same weekdays and DST days as 2026), so no job day here ages into the present (jobDayFixtureTimezone).
const job = { status: "open", payment_status: "held", date_needed: "2058-11-16", start_time: "09:00:00", expires_at: "2058-11-30T15:00:00Z" };
const NOW = new Date("2058-11-12T18:00:00Z");
const words = (j: Parameters<typeof applicantsNextStep>[0], now = NOW) => {
  const v = applicantsNextStep(j, 2, now);
  return v ? `${nextStepWords(v.step)} | ${v.ifNot ?? ""}` : null;
};

describe("A3-45: the Applicants sheet's next step", () => {
  it("names the step, the start as the pick-by, and the close with the card hold", () => {
    expect(words(job)).toBe("Next: choose a Helpr · by Sat, Nov 16, 9:00 AM | If nobody is hired by Sat, Nov 30, 9:00 AM, the job closes and your card isn't charged.");
  });

  it("a close before the start is the pick-by", () => {
    expect(words({ ...job, expires_at: "2058-11-14T18:00:00Z" })).toBe(
      "Next: choose a Helpr · by Thu, Nov 14, 12:00 PM | If nobody is hired by Thu, Nov 14, 12:00 PM, the job closes and your card isn't charged.",
    );
  });

  it("a start with no time names the day only", () => {
    expect(words({ ...job, start_time: null })).toMatch(/^Next: choose a Helpr · by Sat, Nov 16 \|/);
  });

  it("past the start, the close is the pick-by; past both, no date", () => {
    expect(words(job, new Date("2058-11-17T00:00:00Z"))).toMatch(/^Next: choose a Helpr · by Sat, Nov 30, 9:00 AM \|/);
    expect(words(job, new Date("2058-12-01T00:00:00Z"))).toBe("Next: choose a Helpr | ");
  });

  it("only a card hold is promised as not charged", () => {
    expect(words({ ...job, payment_status: "escrow" })).toMatch(/the job closes\.$/);
  });

  it("nothing when the job is not open or nobody is waiting", () => {
    expect(applicantsNextStep({ ...job, status: "accepted" }, 2, NOW)).toBeNull();
    expect(applicantsNextStep(job, 0, NOW)).toBeNull();
  });

  it("draws the line", () => {
    render(<ApplicantsNextStep job={{ ...job, date_needed: "2099-11-14", expires_at: "2099-11-28T15:00:00Z" }} pending={2} />);
    expect(screen.getByText("Next: choose a Helpr")).toBeTruthy();
    expect(screen.getByText(/the job closes and your card isn't charged\./)).toBeTruthy();
  });

  it("the Applicants panel draws it with the pending count", () => {
    const panel = readFileSync("src/pages/posts/postedJobs/ApplicantsPanel.tsx", "utf8");
    expect(panel).toContain('<ApplicantsNextStep job={selectedJob} pending={applications.filter((a) => a.status === "pending").length} />');
    expect(panel.match(/<ApplicantsNextStep\b/g)?.length ?? 0).toBeGreaterThan(0);
  });
});
