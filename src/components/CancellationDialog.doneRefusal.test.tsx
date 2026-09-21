// poster_cancel_job refuses a job the Helpr already marked done with
// not_cancellable + its own HINT (20260914215112). The dialog must show that
// hint, not the generic "cancelled, finished, or disputed" line, because the
// poster's next step (approve / ask for a change / dispute) lives only there.
//
// A REFUSAL IS ALSO NOT A DEAD END. `cancelling` disables the destructive
// action while the RPC is in flight, so the `finally { setCancelling(false) }`
// is the only thing that hands the poster their control back. Delete it and a
// single refusal — by far the likeliest outcome on this dialog — leaves the
// button stuck on "Cancelling…" until the dialog is closed and reopened. That
// is the PostedJobActions latch defect in different clothes, and the copy
// assertions below cannot see it, so the last test proves the RELEASE.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const toastError = vi.fn();
const DONE_HINT = "Your Helpr already marked this job done. Approve it, ask for a change, or open a dispute.";
const rpcMock = vi.hoisted(() => vi.fn());
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
    rpc: (...a: unknown[]) => {
      rpcMock(...a);
      return Promise.resolve({ data: null, error: rpcError });
    },
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

  it("hands the button back after the refusal, so the poster can try again", async () => {
    toastError.mockClear();
    rpcMock.mockClear();
    rpcError = { message: "not_cancellable", hint: DONE_HINT, code: "P0001" };
    render(<CancellationDialog {...props} />);
    const button = await screen.findByRole("button", { name: /^cancel job$/i });

    fireEvent.click(button);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(DONE_HINT));

    // Not "Cancelling…" forever: enabled, and back to its resting label.
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).toHaveTextContent(/^Cancel Job$/);

    // …and the second press actually reaches the server.
    fireEvent.click(button);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(2));
  });
});

// The hint passthrough itself: with the special case gone, the poster is told
// the job "couldn't be cancelled" and never learns that approving, requesting
// a change or disputing is what is left to them.
// @mutate src/components/CancellationDialog.tsx | if (String(error.message ?? "").trim() === "not_cancellable" && /already marked this job done/i.test(doneHint)) { | if (false) {
// The latch release. Nothing above the third test notices this.
// @mutate src/components/CancellationDialog.tsx | setCancelling(false); | void 0;
