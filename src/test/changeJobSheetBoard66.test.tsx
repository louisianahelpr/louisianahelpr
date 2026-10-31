// Board 66: the poster's "Change this job" sheet on a hired job: a new time by request (the existing RPC),
// or hand over to the existing cancellation dialog. Names, never pronouns; nothing is charged by asking.
// @mutate src/components/schedule/ChangeJobSheet.tsx |                   await requestScheduleChange(jobId, date, time ? `${time}:00` : null); |                   await requestScheduleChange(jobId, dateNeeded, time ? `${time}:00` : null);
// @mutate src/components/schedule/ChangeJobSheet.tsx |               onCancelJob(); |               void 0;
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls: unknown[][] = [];
vi.mock("@/lib/scheduleChange", async (orig) => ({
  ...(await orig<typeof import("@/lib/scheduleChange")>()),
  requestScheduleChange: async (...a: unknown[]) => { calls.push(a); },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/components/TimePickerWheel", () => ({
  TimePickerWheel: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="New start time" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const { ChangeJobSheet } = await import("@/components/schedule/ChangeJobSheet");

function show(onCancelJob = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChangeJobSheet open onOpenChange={() => {}} jobId="j1" jobTitle="Assemble a bookshelf" helperName="Jolie Thibodeaux" userId="u1"
        dateNeeded="2026-10-24" startTime="13:00:00" onCancelJob={onCancelJob} today={new Date(2026, 9, 21, 12)} />
    </QueryClientProvider>,
  );
  return onCancelJob;
}

describe("board 66: change this job", () => {
  it("sends the picked day and time to the Helpr by name; 60 days to pick from", async () => {
    show();
    expect(screen.getByText(/Jolie gets the new time and says yes or no\. Nothing is charged/)).toBeInTheDocument();
    const days = screen.getAllByRole("button", { pressed: false }).filter((b) => /Oct|Nov/.test(b.textContent ?? ""));
    expect(screen.getByRole("group", { name: "New day" }).querySelectorAll("button")).toHaveLength(60); // JOBS-19: was 14
    // The 44 px floor (min-h-11), not the shared chip's 40.
    for (const b of screen.getByRole("group", { name: "New day" }).querySelectorAll("button")) expect(b.className.split(/\s+/)).toContain("min-h-11");
    const send = screen.getByRole("button", { name: "Send new time to Jolie" });
    expect(send).toBeDisabled();
    fireEvent.click(days[9]); // Oct 31
    fireEvent.change(screen.getByLabelText("New start time"), { target: { value: "09:30" } });
    fireEvent.click(send);
    await waitFor(() => expect(calls[calls.length - 1]).toEqual(["j1", "2026-10-31", "09:30:00"]));
  });

  it("Cancel the job hands over to the cancellation dialog (fee shown there)", () => {
    const onCancelJob = show();
    fireEvent.click(screen.getByRole("radio", { name: /Cancel the job/ }));
    fireEvent.click(screen.getByRole("button", { name: "Review cancellation" }));
    expect(onCancelJob).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/\bhe\b|\bshe\b/i);
  });
});
