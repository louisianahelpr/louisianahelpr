/**
 * THE JOB PAGE'S TRACKER LINE NAMES WHO THE PAGE NAMES (B49 headless 375 look, 10-31). The poster's job page showed
 * "Message Eli" under a tracker reading "Your Helpr is working": JobTracker never got a name, while every job card
 * (PostedJobCard, AppliedJobCard, Home's Helpr side) passes one. JobPage now hands JobTracker the other person's
 * first name from the same card read its Message button uses.
 *
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |     otherFirst,\n    rescheduled, |     rescheduled,
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |               otherFirst={isPoster ? helperFirst : posterFirst} |               otherFirst={null}
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "@/test/helpers/blankNonCode";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import { pinJobClock } from "@/test/helpers/pinJobClock";

vi.mock("@/hooks/useJobRescheduled", () => ({ useJobRescheduled: () => false }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null }) }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0 }));

import { JobTracker } from "./JobPageParts";
import type { JobPageRow } from "./useJobPage";

pinJobClock();

const T = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const JOB = {
  id: "j1", title: "Mow the front yard", status: "in_progress", payment_status: "escrow", customer_id: "p", helper_id: "h",
  date_needed: jobLocalDateISO(0), start_time: "09:00", is_group_job: false,
  helper_confirmed_at: T(30), helper_dayof_confirmed_at: T(4), poster_confirmed_at: T(4), helper_on_the_way_at: T(2),
  helper_arrived_at: T(1.5), helper_arrival_verified_at: T(1.5), poster_confirmed_arrival_at: T(1.4),
} as unknown as JobPageRow;

const show = (otherFirst: string | null, trackingStatus: string | null = null) =>
  render(<MemoryRouter><JobTracker job={JOB} side="poster" trackingStatus={trackingStatus} otherFirst={otherFirst} /></MemoryRouter>);

describe("the job page's tracker line names the Helpr the page names", () => {
  it("with a name: 'Eli is working'", () => {
    show("Eli");
    expect(screen.getByText("Eli is working")).toBeTruthy();
  });

  it("while the Helpr's own row says arrived, not started: 'Eli is at the job'", () => {
    show("Eli", "arrived");
    expect(screen.getByText("Eli is at the job")).toBeTruthy();
  });

  it("with no name yet: 'Your Helpr is working'", () => {
    show(null);
    expect(screen.getByText("Your Helpr is working")).toBeTruthy();
  });

  it("JobPage passes the poster the Helpr's first name and the Helpr the poster's", () => {
    const src = blankComments(readFileSync(resolve(import.meta.dirname, "JobPage.tsx"), "utf8"));
    const tracker = /<JobTracker\b[\s\S]*?\/>/.exec(src)?.[0] ?? "";
    expect(tracker).toContain("otherFirst={isPoster ? helperFirst : posterFirst}");
    expect(src).toMatch(/const helperFirst = \(helperCard\.data\?\.name/);
  });
});
