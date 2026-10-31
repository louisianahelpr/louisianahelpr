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
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { JobConfirmation } from "@/components/JobConfirmation";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async () => ({ data: null, error: null }) } }));

// Thu 2037-10-22, 6:00 AM CT: the Helpr's day-of confirm is open (owed until 7:00 AM for a 9:00 AM job).
const NOW = new Date("2037-10-22T11:00:00Z");
const DAY = "2037-10-22";

afterEach(() => vi.useRealTimers());

const openSheet = (startTime: string | null) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  render(
    <JobConfirmation variant="inline" jobId="j1" isOwner={false} isHelper posterConfirmedAt={null} helperConfirmedAt="t"
      helperDayofConfirmedAt={null} dateNeeded={DAY} startTime={startTime} jobStatus="accepted" helperOnTheWayAt={null}
      onCantMakeIt={() => {}} />,
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
