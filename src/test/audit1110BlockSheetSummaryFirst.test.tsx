/**
 * F260i (whole-app audit 2026-11-10, Medium): "Block Hallie H.?" was a long wall listing all 10 jobs that would be
 * cancelled, and the money line said "(it starts within 24 hours)" without saying which job "it" was, with the strike
 * buried at the bottom. Now: one short summary first (how many jobs, the amount, the strike), then the details; the
 * job list shows three (the late ones first, each marked "starts within 24 hours") behind "Show all 10 jobs", and the
 * amount line names the job it is for.
 * @mutate src/components/BlockUserDialog.tsx |                 {hasJobs && ( |                 {false && (
 * @mutate src/components/BlockUserDialog.tsx | (showAllJobs ? jobs : jobs.slice(0, 3)) | jobs
 * @mutate src/components/BlockUserDialog.tsx | {j.late && <> (starts within 24 hours)</>} | {null}
 * @mutate src/components/BlockUserDialog.tsx | which starts within 24 hours | which starts soon
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const rows: Array<Record<string, unknown>> = [];
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/userBlocks", () => ({ blockUser: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "poster-1" } } })) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        or: vi.fn(() => ({
          in: vi.fn(() => ({ is: vi.fn(() => Promise.resolve({ data: rows, error: null })) })),
        })),
      })),
    })),
  },
}));

import { BlockUserDialog } from "@/components/BlockUserDialog";

const NOW = new Date("2026-09-27T12:00:00Z");
// Late = committed, started yesterday ($100 budget, the 50% tier). Free = committed, a week out.
const job = (i: number, late: boolean) => ({
  id: `job-${i}`, title: `Job number ${i}`, budget: 100, date_needed: jobLocalDateISO(late ? -1 : 7, NOW), start_time: null,
  customer_id: "poster-1", helper_id: "helper-1", helper_confirmed_at: "2026-09-20T12:00:00Z",
});

function open() {
  render(<BlockUserDialog open onClose={vi.fn()} blockedUserId="helper-1" blockedUserName="Hallie" />);
  return screen.getByRole("dialog");
}

beforeEach(() => {
  rows.length = 0;
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

describe("F260i: the block sheet says the summary first, then a short job list", () => {
  it("ten jobs, two late: summary first with count, amount and strike; three titles, late first; Show all opens the rest", async () => {
    for (let i = 1; i <= 8; i++) rows.push(job(i, false));
    rows.push(job(9, true), job(10, true));
    const dialog = open();
    const summary = await within(dialog).findByText(/^Blocking Hallie also cancels 10 jobs\./);
    expect(summary.textContent).toMatch(/^Blocking Hallie also cancels 10 jobs\. You will pay about \$100 for the Helpr’s time and it counts as a strike against you\.$/);
    // First thing after the title: before the generic "You won't see their messages" bullet.
    const seeLine = within(dialog).getByText(/You won.t see their messages/);
    expect(summary.compareDocumentPosition(seeLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const list = within(dialog).getByRole("list", { name: "Jobs that will be cancelled" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "“Job number 9” (starts within 24 hours)",
      "“Job number 10” (starts within 24 hours)",
      "“Job number 1”",
    ]);
    expect(within(dialog).getByText(/^That covers 2 jobs that start within 24 hours\. You get most of the rest back\.$/)).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/\(it starts within 24 hours\)/);

    fireEvent.click(within(dialog).getByRole("button", { name: "Show all 10 jobs" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    expect(within(dialog).queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("one late job: the amount line names it", async () => {
    rows.push({ ...job(1, true), title: "Mow" });
    const dialog = open();
    await within(dialog).findByText(/^Blocking Hallie also cancels 1 job\./);
    expect(within(dialog).getByText("That covers “Mow”, which starts within 24 hours. You get most of the rest back.")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /Show all/ })).toBeNull();
  });
});
