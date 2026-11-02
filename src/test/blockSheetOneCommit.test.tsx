/**
 * Q2682 (audit 1102e row 35, LOW): the block sheet had three buttons, a red full-width "Block and report", then
 * "Cancel" and "Just block" side by side in the same grey, so the softer action read as a second Cancel. Now the
 * footer is the app's one shape, Cancel | one red commit, and reporting is a box in the body: ticked, the same
 * button reads "Block and report", blocks, then opens the report; unticked it only blocks. A failed block never
 * opens the report.
 *
 * @mutate src/components/BlockUserDialog.tsx |               if (blocked && report) onReportAndBlock(); |               if (blocked) onReportAndBlock?.();
 * @mutate src/components/BlockUserDialog.tsx |             ) : alsoReport && onReportAndBlock ? ( |             ) : onReportAndBlock ? (
 * @mutate src/components/BlockUserDialog.tsx |               {onReportAndBlock && ( |               {false && (
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const blockUser = vi.fn();
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/userBlocks", () => ({ blockUser: (...a: unknown[]) => blockUser(...a) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "poster-1" } } })) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        or: vi.fn(() => ({
          in: vi.fn(() => ({ is: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
        })),
      })),
    })),
  },
}));

import { BlockUserDialog } from "@/components/BlockUserDialog";

function open(onReportAndBlock?: () => void) {
  render(
    <BlockUserDialog open onClose={vi.fn()} blockedUserId="helper-1" blockedUserName="Marie" onReportAndBlock={onReportAndBlock} />,
  );
  return screen.getByRole("dialog");
}
const buttonNames = (dialog: HTMLElement) =>
  within(dialog).getAllByRole("button").map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim());

beforeEach(() => {
  blockUser.mockReset();
  blockUser.mockResolvedValue({ ok: true, cancelledJobIds: [] });
});

describe("the block sheet has one commit beside Cancel (Q2682)", () => {
  it("with a report path: Cancel and Block only, no Just block, and an Also report box", () => {
    const dialog = open(vi.fn());
    const names = buttonNames(dialog).filter((n) => n !== "Close");
    expect(names).toEqual(["Cancel", "Block"]);
    expect(within(dialog).queryByText(/just block/i)).toBeNull();
    expect(within(dialog).getByRole("checkbox", { name: "Also report Marie to our team" })).not.toBeChecked();
  });

  it("unticked, Block only blocks; the report does not open", async () => {
    const report = vi.fn();
    const dialog = open(report);
    fireEvent.click(within(dialog).getByRole("button", { name: "Block" }));
    await waitFor(() => expect(blockUser).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(report).not.toHaveBeenCalled();
  });

  it("ticked, the commit reads Block and report, blocks, then opens the report", async () => {
    const report = vi.fn();
    const dialog = open(report);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Also report Marie to our team" }));
    const names = buttonNames(dialog).filter((n) => n !== "Close");
    expect(names).toEqual(["Cancel", "Block and report"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Block and report" }));
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(blockUser).toHaveBeenCalledTimes(1);
  });

  it("ticked, a failed block never opens the report", async () => {
    blockUser.mockResolvedValue({ ok: false, error: "nope" });
    const report = vi.fn();
    const dialog = open(report);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Also report Marie to our team" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Block and report" }));
    await waitFor(() => expect(blockUser).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(report).not.toHaveBeenCalled();
  });

  it("with no report path: no box, and the commit reads Block", () => {
    const dialog = open();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(buttonNames(dialog).filter((n) => n !== "Close")).toEqual(["Cancel", "Block"]);
  });
});
