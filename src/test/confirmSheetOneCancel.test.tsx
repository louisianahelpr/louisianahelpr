/**
 * F11 (app audit 2026-10-28, part 4 half 2): the day-of confirm sheet ("Confirm you'll be there" since LEAD-CONFIRM-WORDS) had a "Cancel"
 * button beside an underlined "Cancel job" link (two cancels that do very different things), a Title
 * Case "Yes, I Confirm", and "Scheduled for" with the date only, no time.
 *
 * Red first (2026-10-28) against origin/main 6b3206e2bd: "Cancel" + "Cancel job" both rendered,
 * "Yes, I Confirm", and "Scheduled for Thursday, October 22, 2037".
 *
 * @mutate src/components/JobConfirmation.tsx | onClick={() => setShowConfirmDialog(false)}>Not now</DialogSecondaryAction> | onClick={() => setShowConfirmDialog(false)}>Cancel</DialogSecondaryAction>
 * @mutate src/components/JobConfirmation.tsx | : isOwner ? "Yes, it's still on" : "Yes, I'll be there"} | : isOwner ? "Yes, I confirm" : "Yes, I confirm"}
 * @mutate src/components/JobConfirmation.tsx | <DialogHero title={isOwner ? "Confirm the job is still on" : "Confirm you'll be there"} /> | <DialogHero title="Commit to this job?" />
 * @mutate src/components/JobConfirmation.tsx |     scheduledStart ? ` at ${ |     false ? ` at ${
 * @mutate src/components/JobConfirmation.tsx | {jobTitle?.trim() && ( | {false && (
 * @mutate src/pages/jobs/appliedJobCard/HelperTrackerPanel.tsx |       jobTitle={job.title}\n      jobId={app.job_id} |       jobId={app.job_id}
 * @mutate src/pages/posts/postedJobCard/steps/ScheduledStep.tsx |             jobTitle={job.title}\n            jobId={job.id}\n            isOwner={true} |             jobId={job.id}\n            isOwner={true}
 *
 * The sheet names the job first (owner 2026-10-31, LEAD-JOBPAGE-LAYOUT: "add the job name to the confirm sheet").
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JobConfirmation } from "@/components/JobConfirmation";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async () => ({ data: null, error: null }) } }));

// Thu 2037-10-22, 6:00 AM CT: the Helpr's day-of confirm is open (owed until 7:00 AM for a 9:00 AM job).
const NOW = new Date("2037-10-22T11:00:00Z");
const DAY = "2037-10-22";

afterEach(() => vi.useRealTimers());

const openSheet = (startTime: string | null, jobTitle: string | null = "Mow and Weed Eat") => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  render(
    <JobConfirmation variant="inline" jobId="j1" isOwner={false} isHelper posterConfirmedAt={null} helperConfirmedAt="t"
      helperDayofConfirmedAt={null} dateNeeded={DAY} startTime={startTime} jobStatus="accepted" helperOnTheWayAt={null}
      onCantMakeIt={() => {}} jobTitle={jobTitle} />,
  );
  // Inventory floor: the card drew its controls (Nudge and the confirm).
  expect(screen.getAllByRole("button").length).toBeGreaterThan(1);
  fireEvent.click(screen.getByRole("button", { name: "Confirm you'll be at the job" }));
  return screen.getByRole("dialog");
};

describe("F11: the day-of confirm sheet", () => {
  it("one cancel only: the dismiss says Not now, beside the Cancel job link", () => {
    const sheet = openSheet("09:00");
    const names = within(sheet).getAllByRole("button").map((b) => (b.textContent ?? "").trim());
    expect(names).toContain("Cancel job");
    expect(names, "a plain Cancel still sits beside Cancel job").not.toContain("Cancel");
    expect(names).toContain("Not now");
  });

  it("plain words for the Helpr, no 'commit' anywhere (owner 2026-10-31, LEAD-CONFIRM-WORDS)", () => {
    const sheet = openSheet("09:00");
    expect(within(sheet).getByText("Confirm you'll be there")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Yes, I'll be there" })).toBeTruthy();
    expect(sheet.textContent ?? "").not.toMatch(/commit/i);
    // The Helpr keeps the no-show line; the poster's late-cancel line is theirs only (JobPage.test.tsx).
    expect(within(sheet).getByText(/^No-shows or last-minute cancellations after confirming/)).toBeTruthy();
    expect(sheet.textContent ?? "").not.toMatch(/paid for their trouble/);
  });

  it("the sheet names the job first; no name, no empty line", () => {
    const sheet = openSheet("09:00");
    const name = sheet.querySelector("[data-confirm-job-title]");
    expect(name?.textContent).toBe("Mow and Weed Eat");
    vi.useRealTimers();
    cleanup();
    const bare = openSheet("09:00", null);
    expect(bare.querySelector("[data-confirm-job-title]")).toBeNull();
  });

  it("both cards hand the sheet their job's name (source)", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const mounts = ["src/pages/jobs/appliedJobCard/HelperTrackerPanel.tsx", "src/pages/posts/postedJobCard/steps/ScheduledStep.tsx"];
    let n = 0;
    for (const f of mounts) {
      const src = read(f);
      const at = src.indexOf("<JobConfirmation");
      expect(at, f).toBeGreaterThan(-1);
      expect(src.slice(at, src.indexOf("/>", at)), f).toContain("jobTitle={job.title}");
      n++;
    }
    expect(n).toBe(2);
  });

  it("Scheduled for shows the start time with the date (Louisiana time)", () => {
    const sheet = openSheet("09:00");
    expect(sheet.textContent).toContain("Thursday, October 22, 2037 at 9:00 AM");
  });

  it("a job with no start time shows the date alone", () => {
    const sheet = openSheet(null);
    expect(sheet.textContent).toContain("Thursday, October 22, 2037");
    expect(sheet.textContent).not.toMatch(/2037 at /);
  });
});
