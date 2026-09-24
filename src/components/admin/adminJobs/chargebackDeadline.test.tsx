/**
 * AM-002: a card chargeback's evidence deadline is stored on the job by
 * stripe-webhook and must be visible where the admin notice lands
 * (/admin?view=jobs&job=<id> opens this dialog).
 *
 * @mutate src/components/admin/adminJobs/JobDetailDialog.tsx |             {detailJob.chargeback_evidence_due_by && ( |             {false && (
 */
import { describe, it, expect, vi } from "vitest";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import { render, screen } from "@testing-library/react";
import { JobDetailDialog } from "./JobDetailDialog";
import type { Job } from "./types";

const job = (over: Partial<Job> = {}) =>
  ({
    id: "job-1", title: "Fence repair", description: "d", category: "handyman", status: "in_progress",
    payment_status: "chargeback", budget: 100, location: "Baton Rouge", date_needed: jobLocalDateISO(6),
    stripe_payment_intent_id: "pi_123", created_at: "2026-09-20T00:00:00Z", ...over,
  }) as unknown as Job;

const props = (detailJob: Job) => ({
  detailJob, deleteOpen: false, jobFlags: new Map(), resolvedFlags: new Set<string>(),
  posterName: "P", helperName: "H", onClose: vi.fn(), onReopenFlag: vi.fn(), onMarkFlagResolved: vi.fn(),
  onOpenDelete: vi.fn(), onOpenOverride: vi.fn(), onOpenRefund: vi.fn(),
});

describe("admin job detail shows the chargeback evidence deadline (AM-002)", () => {
  it("renders the deadline and the Stripe payment link when set", () => {
    render(<JobDetailDialog {...props(job({ chargeback_evidence_due_by: "2026-10-05T04:59:59Z" }))} />);
    const box = screen.getByTestId("chargeback-evidence-due");
    expect(box.textContent).toMatch(/evidence due Oct 4, 2026/);
    expect(screen.getByRole("link", { name: /Open the payment in Stripe/ }).getAttribute("href"))
      .toBe("https://dashboard.stripe.com/payments/pi_123");
  });

  it("renders nothing when there is no chargeback deadline", () => {
    render(<JobDetailDialog {...props(job({ chargeback_evidence_due_by: null, payment_status: "escrow" }))} />);
    expect(screen.queryByTestId("chargeback-evidence-due")).toBeNull();
  });
});
