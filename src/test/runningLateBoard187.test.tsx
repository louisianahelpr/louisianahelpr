// Board 187: the Helpr's one-tap "Running late" (10/20/30 min) sends the poster an ordinary chat message
// on this job, by first name; "Need a new time" hands over to the date-change request.
// @mutate src/components/job-card/RunningLateSheet.tsx |   return `Running about ${minutes} minutes late. Sorry for the wait.`; |   return `Running late. Sorry for the wait.`;
// @mutate src/pages/jobs/appliedJobCard/ConfirmedSection.tsx | job.date_needed?.slice(0, 10) === todayLocalISO() && !job.helper_arrived_at | !job.helper_arrived_at
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";

const inserts: unknown[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: (row: unknown) => { inserts.push(row); return { select: async () => ({ data: [{ id: "m1" }], error: null }) }; } }) },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const { RunningLateSheet, runningLateMessage } = await import("@/components/job-card/RunningLateSheet");

describe("board 187: running late", () => {
  it("sends the picked minutes to the poster, by first name", async () => {
    const close = vi.fn();
    render(<RunningLateSheet open onOpenChange={close} jobId="j1" posterId="p1" posterName="Lexi Lambert" userId="h1" onNeedNewTime={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "20 min" }));
    fireEvent.click(screen.getByRole("button", { name: "Tell Lexi" }));
    await waitFor(() => expect(inserts.at(-1)).toMatchObject({ job_id: "j1", sender_id: "h1", receiver_id: "p1", content: runningLateMessage(20) }));
    expect(runningLateMessage(20)).toBe("Running about 20 minutes late. Sorry for the wait.");
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  });

  it("'Need a new time' hands over to the date-change request", () => {
    const need = vi.fn();
    render(<RunningLateSheet open onOpenChange={() => {}} jobId="j1" posterId="p1" posterName="" userId="h1" onNeedNewTime={need} />);
    fireEvent.click(screen.getByRole("button", { name: "Need a new time" }));
    expect(need).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send it" })).toBeInTheDocument();
  });

  it("the Helpr's booked card offers it only on the day, before arriving", () => {
    const src = blankComments(readFileSync("src/pages/jobs/appliedJobCard/ConfirmedSection.tsx", "utf8"));
    expect(src).toMatch(/const canSayLate = !!job\.customer_id && job\.date_needed\?\.slice\(0, 10\) === todayLocalISO\(\) && !job\.helper_arrived_at;/);
    expect(src).toMatch(/canSayLate && \(\s*<JobActionChip key="late"/);
  });
});
