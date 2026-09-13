// ReportDialog + RestrictApplicationsDialog — synchronous in-flight guard.
//
// `submitting` / `saving` are React state, so two clicks dispatched in one
// frame both read false and both inserted a row. Same class and fix as
// adminDialogsInFlight.test.tsx: a ref set before the first await.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";

const insertMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  const pendingChain = () => {
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.single = () => self;
    self.then = () => {}; // stays in flight
    return self;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
      from: () => ({
        insert: (...args: unknown[]) => { insertMock(...args); return pendingChain(); },
      }),
    },
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticLight: vi.fn() }));
vi.mock("@/lib/adminAudit", () => ({ logAdminAction: vi.fn() }));

import ReportDialog from "./ReportDialog";
import { RestrictApplicationsDialog } from "./admin/RestrictApplicationsDialog";

function doubleClick(button: HTMLElement) {
  act(() => {
    button.click();
    button.click();
  });
}

describe("same-frame double click inserts one row", () => {
  beforeEach(() => insertMock.mockReset());

  it("ReportDialog: Submit Report", async () => {
    render(<ReportDialog open onClose={vi.fn()} reportedType="job" reportedId="job-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Spam or scam/ }));
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "This listing is a scam." } });
    doubleClick(screen.getByRole("button", { name: "Submit Report" }));
    await waitFor(() => expect(insertMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("RestrictApplicationsDialog: Restrict", async () => {
    const profile = { user_id: "u-1", full_name: "Test User" } as never;
    render(<RestrictApplicationsDialog profile={profile} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Restriction reason"), { target: { value: "spam applications" } });
    doubleClick(screen.getByRole("button", { name: /Restrict for 7 days/ }));
    await waitFor(() => expect(insertMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
