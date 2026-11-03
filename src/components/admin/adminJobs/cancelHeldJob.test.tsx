/**
 * Q2449 (finding: lh-silent-failure@756b4e7602#9): Admin -> Jobs had no way to cancel a job whose card is only
 * HELD (admin_refund_general refuses it: nothing was charged). The job detail now offers "Cancel job (card on
 * hold)" on an open, unhired held job; two taps run create-payment cancel_escrow (its held branch, which releases
 * the hold; the server checks the admin role, proven in src/test/edge/card-hold.test.ts "Q2449"). Not offered on
 * a charged job (Refund Poster) or a job with a Helpr on it.
 *
 * @mutate src/components/admin/adminJobs/JobDetailDialog.tsx |                 {detailJob.payment_status === "held" && detailJob.status === "open" && !detailJob.helper_id && onHeldJobCancelled && ( |                 {false && (
 * @mutate src/components/admin/adminJobs/CancelHeldJobButton.tsx |     if (!confirming) { setConfirming(true); return; } |
 * @mutate src/components/admin/adminJobs/CancelHeldJobButton.tsx |         body: { action: "cancel_escrow", jobId, reason: "Cancelled by an admin from Admin > Jobs" }, |         body: { action: "admin_refund_general", jobId },
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Job } from "./types";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/hooks/useJobAccessNote", () => ({ useJobAccessNote: () => null, fetchJobAccessNote: async () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { JobDetailDialog } from "./JobDetailDialog";

const job = (over: Partial<Job> = {}) =>
  ({
    id: "job-1", title: "Mow the yard", description: "d", category: "yard_work", status: "open",
    payment_status: "held", budget: 40, location: "Baton Rouge", date_needed: jobLocalDateISO(7),
    helper_id: null, created_at: "2026-11-01T00:00:00Z", ...over,
  }) as unknown as Job;

const props = (detailJob: Job, onHeldJobCancelled = vi.fn()) => ({
  detailJob, deleteOpen: false, jobFlags: new Map(), resolvedFlags: new Set<string>(),
  posterName: "P", helperName: "H", onClose: vi.fn(), onReopenFlag: vi.fn(), onMarkFlagResolved: vi.fn(),
  onOpenDelete: vi.fn(), onOpenOverride: vi.fn(), onOpenRefund: vi.fn(), onHeldJobCancelled,
});

describe("Admin -> Jobs cancels a held job (Q2449)", () => {
  beforeEach(() => invoke.mockReset());

  it("an open, unhired held job: two taps run the poster's cancel and the list is told", async () => {
    invoke.mockResolvedValue({ data: { success: true, released: true }, error: null });
    const done = vi.fn();
    render(<JobDetailDialog {...props(job(), done)} />);
    const btn = screen.getByRole("button", { name: /Cancel job \(card on hold\)/ });
    fireEvent.click(btn);
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Tap again to cancel and release the hold/ }));
    await waitFor(() => expect(done).toHaveBeenCalledWith("job-1"));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe("create-payment");
    expect((invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body).toMatchObject({ action: "cancel_escrow", jobId: "job-1" });
  });

  it("a refusal from the server leaves the job as it was", async () => {
    invoke.mockResolvedValue({ data: { error: "Not authorized" }, error: null });
    const done = vi.fn();
    render(<JobDetailDialog {...props(job(), done)} />);
    fireEvent.click(screen.getByRole("button", { name: /Cancel job \(card on hold\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Tap again/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(done).not.toHaveBeenCalled();
  });

  it("not offered on a charged job, a job with a Helpr on it, or a closed job", () => {
    for (const over of [{ payment_status: "escrow" }, { helper_id: "h-1", status: "accepted" }, { status: "cancelled" }] as Array<Partial<Job>>) {
      const { unmount } = render(<JobDetailDialog {...props(job(over))} />);
      expect(screen.queryByRole("button", { name: /Cancel job \(card on hold\)/ })).toBeNull();
      unmount();
    }
  });
});
