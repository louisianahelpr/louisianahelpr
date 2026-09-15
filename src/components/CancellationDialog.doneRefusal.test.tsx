// poster_cancel_job refuses a job the Helpr already marked done with
// not_cancellable + its own HINT (20260914215112). The dialog must show that
// hint, not the generic "cancelled, finished, or disputed" line, because the
// poster's next step (approve / ask for a change / dispute) lives only there.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const toastError = vi.fn();
const DONE_HINT = "Your Helpr already marked this job done. Approve it, ask for a change, or open a dispute.";
let rpcError: Record<string, unknown> = {};

vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticSuccess: vi.fn(), hapticLight: vi.fn(), hapticMedium: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    })),
    rpc: vi.fn(async () => ({ data: null, error: rpcError })),
  },
}));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { CancellationDialog } from "./CancellationDialog";

const props = {
  jobId: "job-1", jobTitle: "Fix the fence", jobDate: new Date(Date.now() + 72 * 3600e3).toISOString().slice(0, 10),
  jobStartTime: null, jobBudget: 100, hasHelper: true, wasFunded: true, helperName: "Marie",
  open: true, onClose: vi.fn(), onCancelled: vi.fn(),
};

async function pressCancel() {
  render(<CancellationDialog {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /^cancel job$/i }));
}

describe("CancellationDialog — refused because the Helpr marked the job done", () => {
  it("shows the server's hint", async () => {
    toastError.mockClear();
    rpcError = { message: "not_cancellable", hint: DONE_HINT, code: "P0001" };
    await pressCancel();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(DONE_HINT));
    expect(props.onCancelled).not.toHaveBeenCalled();
  });

  it("keeps the generic copy for every other not_cancellable", async () => {
    toastError.mockClear();
    rpcError = { message: "not_cancellable", hint: "This job is already finished, cancelled, or under dispute.", code: "P0001" };
    await pressCancel();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/couldn't be cancelled/)));
  });
});
