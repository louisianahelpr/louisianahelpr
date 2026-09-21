// ReportDialog + RestrictApplicationsDialog — synchronous in-flight guard.
//
// `submitting` / `saving` are React state, so two clicks dispatched in one
// frame both read false and both inserted a row. Same class and fix as
// adminDialogsInFlight.test.tsx: a ref set before the first await.
//
// THE SECOND HALF, ADDED 2026-09-21. Until then this file proved only that
// the latch ENGAGES, and every assertion in it passed with each dialog's
// RELEASE deleted — `submitInFlight.current = false` on ReportDialog's error
// branch, and RestrictApplicationsDialog's whole `finally`. A latch that
// engages and never releases is not a double-submit guard; it is a one-shot
// control that goes silently dead after its first failure, which is the
// PostedJobActions defect. Both are user-visible in the worst way: the button
// RE-ENABLES (that is the separate `setSubmitting(false)` / `setSaving(false)`
// line), so the operator presses a live-looking button and nothing at all
// happens — no row, no toast, no error. The `releases…` tests below fail the
// moment either release line is removed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";

/*
 * The insert chain is SETTLEABLE now. `settle === null` keeps the write in
 * flight forever (what the same-frame tests need); setting it makes the await
 * resolve, which is the only way to reach either dialog's failure branch — and
 * a mock whose only reachable outcome is "still pending" is exactly the
 * default-return blindness that hid the ReuploadIdDialog and adminAudit holes.
 */
const db = vi.hoisted(() => ({
  insert: vi.fn(),
  settle: null as null | { data: unknown; error: unknown },
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => {
  const pendingChain = () => {
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.single = () => self;
    self.then = (resolve: (value: unknown) => void) => {
      if (db.settle) resolve({ ...db.settle });
      // else: stays in flight
    };
    return self;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
      from: () => ({
        insert: (...args: unknown[]) => { db.insert(...args); return pendingChain(); },
      }),
    },
  };
});
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/lib/haptics", () => ({ hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticLight: vi.fn() }));
vi.mock("@/lib/adminAudit", () => ({ logAdminAction: vi.fn() }));
// unwrapMutation reports every silent rejection; keep that off the wire.
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import ReportDialog from "./ReportDialog";
import { RestrictApplicationsDialog } from "./admin/RestrictApplicationsDialog";

function doubleClick(button: HTMLElement) {
  act(() => {
    button.click();
    button.click();
  });
}

const fillReport = async () => {
  fireEvent.click(screen.getByRole("button", { name: /Spam or scam/ }));
  fireEvent.change(await screen.findByRole("textbox"), { target: { value: "This listing is a scam." } });
};

describe("same-frame double click inserts one row", () => {
  beforeEach(() => {
    db.insert.mockReset();
    toastError.mockReset();
    db.settle = null; // in flight, so the first click never completes
  });

  it("ReportDialog: Submit Report", async () => {
    render(<ReportDialog open onClose={vi.fn()} reportedType="job" reportedId="job-1" />);
    await fillReport();
    doubleClick(screen.getByRole("button", { name: "Submit Report" }));
    await waitFor(() => expect(db.insert).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("RestrictApplicationsDialog: Restrict", async () => {
    const profile = { user_id: "u-1", full_name: "Test User" } as never;
    render(<RestrictApplicationsDialog profile={profile} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Restriction reason"), { target: { value: "spam applications" } });
    doubleClick(screen.getByRole("button", { name: /Restrict for 7 days/ }));
    await waitFor(() => expect(db.insert).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});

describe("the latch RELEASES, so a refused write can be retried", () => {
  beforeEach(() => {
    db.insert.mockReset();
    toastError.mockReset();
  });

  it("ReportDialog: a refused insert does not retire the Submit button", async () => {
    db.settle = { data: null, error: { message: "permission denied for table reports" } };
    render(<ReportDialog open onClose={vi.fn()} reportedType="job" reportedId="job-1" />);
    await fillReport();

    const submit = screen.getByRole("button", { name: "Submit Report" });
    fireEvent.click(submit);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await waitFor(() => expect(submit).not.toBeDisabled());

    // Second attempt. Without the release this reports nothing, forever, on a
    // button that looks perfectly alive — on the safety surface.
    fireEvent.click(submit);
    await waitFor(() => expect(db.insert).toHaveBeenCalledTimes(2));
  });

  it("RestrictApplicationsDialog: a zero-row (RLS-refused) insert can be retried", async () => {
    // `{ data: [], error: null }` is the silent rejection unwrapMutation exists
    // to catch: RLS refused the write and PostgREST reported no error at all.
    db.settle = { data: [], error: null };
    const profile = { user_id: "u-1", full_name: "Test User" } as never;
    render(<RestrictApplicationsDialog profile={profile} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Restriction reason"), { target: { value: "spam applications" } });

    const restrict = screen.getByRole("button", { name: /Restrict for 7 days/ });
    fireEvent.click(restrict);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await waitFor(() => expect(restrict).not.toBeDisabled());

    fireEvent.click(restrict);
    await waitFor(() => expect(db.insert).toHaveBeenCalledTimes(2));
  });
});

// ENGAGE — the ref is the only thing that sees the second same-frame click.
// @mutate src/components/ReportDialog.tsx | if (submitInFlight.current) return; | if (false) return;
// @mutate src/components/admin/RestrictApplicationsDialog.tsx | if (inFlight.current) return; | if (false) return;
// RELEASE — delete these and one refused write kills the control for good.
// @mutate src/components/ReportDialog.tsx | toast.error("We couldn't send your report — please try again.");\n      submitInFlight.current = false; | toast.error("We couldn't send your report — please try again.");
// @mutate src/components/admin/RestrictApplicationsDialog.tsx | } finally {\n      inFlight.current = false;\n      setSaving(false);\n    } | } finally {\n      setSaving(false);\n    }
