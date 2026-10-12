/**
 * Q1674 (owner decision 2026-10-12): the $2 first-post setup fee is KEPT when
 * the first job is cancelled or refunded. It is "paid and done": never
 * refunded, never charged again. Refunds of a first job return everything
 * except the $2, and the refund notice and receipt say the $2 was kept.
 *
 * WHAT WAS WRONG (measured live 2026-10-12): both real first-post fees (jobs
 * 4d7f3085, 1e16c281) were cancelled and refunded the capture less the
 * service fee only, so the $2 went back to the card while
 * profiles.onboarding_fee_paid stayed true, and the account was never charged
 * it again.
 *
 * The money paths are proven by the edge tests (each shown red by mutation):
 * create-payment cancel_escrow and admin_refund_dispute
 * (src/test/edge/create-payment.test.ts), void-cancelled-payments
 * (src/test/edge/void-cancelled-payments.seriesRefund.test.ts) and
 * execute-dispute-split (src/test/edge/execute-dispute-split.test.ts). This
 * file pins the shared rule, the words, and that every refund path uses it.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { setupFeeKeptCents, setupFeeKeptSentence } from "../../supabase/functions/_shared/posterFees";
import { setupFeeReceiptNote } from "@/lib/posterSpend";
import { previewDisputeSplit } from "@/lib/disputeSplitPreview";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    })),
  },
}));
import { CancellationDialog } from "@/components/CancellationDialog";

const ROOT = join(__dirname, "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

describe("Q1674: a first job's $2 setup fee is kept on every refund", () => {
  it("the shared rule reads the stamped fee, and nothing when there is none", () => {
    expect(setupFeeKeptCents({ onboarding_fee_amount: 2 })).toBe(200);
    expect(setupFeeKeptCents({ onboarding_fee_amount: "2.00" })).toBe(200);
    expect(setupFeeKeptCents({ onboarding_fee_amount: null })).toBe(0);
    expect(setupFeeKeptCents(null)).toBe(0);
  });

  it("the refund notice sentence says the fee was kept", () => {
    expect(setupFeeKeptSentence(200)).toBe(" The one-time $2.00 account setup fee was kept: it is paid once and never refunded.");
    expect(setupFeeKeptSentence(0)).toBe("");
  });

  it("the receipt (Spent row) says the fee was kept, read from the money, never from the status", () => {
    // Live shape (job 1e16c281, read on live Stripe 2026-10-12): 4120c = 3500 job + 420 service fee + 200 setup fee.
    const first = { budget: 35, customer_fee_amount: 4.2, onboarding_fee_amount: 2 };
    expect(setupFeeReceiptNote(first, 0)).toBe(" · includes $2.00 one-time setup fee");
    // Cancelled under Q1674: 3500 back, the fee stayed on the charge.
    expect(setupFeeReceiptNote(first, 3500)).toBe(" · $2.00 one-time setup fee kept (not refundable)");
    // The two real jobs cancelled BEFORE Q1674 got the $2 back: their receipt
    // must not claim it was kept (lh-money-escrow review). 1e16c281: 3700 of
    // 4120 back; 4d7f3085: 1200 of 1320 back.
    expect(setupFeeReceiptNote(first, 3700)).toBe("");
    expect(setupFeeReceiptNote({ budget: 10, customer_fee_amount: 1.2, onboarding_fee_amount: 2 }, 1200)).toBe("");
    // A dispute the poster won returns the service fee too, keeping Stripe's
    // cost (149c on 4120c) and the $2.
    expect(setupFeeReceiptNote({ ...first, dispute_status: "resolved" }, 4120 - 149 - 200)).toBe(" · $2.00 one-time setup fee kept (not refundable)");
    expect(setupFeeReceiptNote({ ...first, onboarding_fee_amount: null }, 3500)).toBe("");
    const spent = code("src/components/profile/earningsTab/SpentSection.tsx");
    expect(spent.length).toBeGreaterThan(1000);
    expect(spent).toContain("setupFeeReceiptNote(r.job, r.refundedCents)");
  });

  it("the cancel dialog tells a first-job poster the $2 is kept, and no one else", () => {
    const props = {
      jobId: "j1", jobTitle: "First job", jobDate: "2032-01-10", jobStartTime: "09:00:00", jobBudget: 35,
      hasHelper: false, wasFunded: true, open: true, onClose: () => {}, onCancelled: () => {},
    };
    const { unmount } = render(<CancellationDialog {...props} setupFeeKept={2} />);
    expect(screen.getByText(/The one-time \$2\.00 account setup fee is kept: it is paid once and never refunded\./)).toBeInTheDocument();
    unmount();
    render(<CancellationDialog {...props} setupFeeKept={null} />);
    expect(screen.queryByText(/account setup fee is kept/)).toBeNull();
    // The card's job carries the fee into the dialog.
    expect(code("src/components/job-card/ActivityDialogs.tsx")).toMatch(/setupFeeKept=\{\(props\.cancelDialogJob as \{ onboarding_fee_amount\?: number \| null \}\)\.onboarding_fee_amount \?\? null\}/);
    expect(code("src/hooks/useActivityData.ts")).toContain("materials_note, onboarding_fee_amount`");
  });

  it("the admin dispute preview keeps the fee out of the poster's share, like the executor", () => {
    const base = { budget: 100, customer_fee_amount: 10, urgent_fee: 0, sales_tax_amount: 0, helper_fee_percent: 12 };
    const p = previewDisputeSplit({ ...base, onboarding_fee_amount: 2 } as never, 0, "free");
    expect(p.posterGross).toBe(110);
  });

  it("money-reconciliation's under-refund ceiling allows the kept fee (no false critical on every first-job cancel)", () => {
    const recon = code("supabase/functions/money-reconciliation/index.ts");
    expect(recon).toMatch(/\+ setupFeeKeptCents\(job as \{ onboarding_fee_amount\?: number \| string \| null \}\);/);
    expect(recon).toMatch(/stripe_payment_intent_id, customer_fee_amount, onboarding_fee_amount",/);
  });

  it("every poster refund path takes the kept fee off what it returns", () => {
    const cp = code("supabase/functions/create-payment/index.ts");
    expect(cp.match(/setupFeeKeptCents\(job\)/g)?.length).toBeGreaterThanOrEqual(3); // cancel, dispute refund, dispute notice
    expect(code("supabase/functions/void-cancelled-payments/index.ts")).toMatch(/\+ setupFeeKeptCents\(job\);/);
    expect(code("supabase/functions/void-cancelled-payments/index.ts")).toMatch(/customer_fee_amount, onboarding_fee_amount, cancellation_fee/);
    const split = code("supabase/functions/execute-dispute-split/index.ts");
    expect(split).toMatch(/capturedCents - nonRefundableCents - \(pi \? setupFeeKeptCents\(job\) : 0\)/);
    expect(split).toMatch(/stripe_session_id, onboarding_fee_amount"/);
  });
});

// @mutate supabase/functions/_shared/posterFees.ts |   return Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0; |   return 0;
// @mutate src/components/CancellationDialog.tsx | the service fee isn&apos;t refundable once payment has been processed.{keptFeeSentence}</p> | the service fee isn&apos;t refundable once payment has been processed.</p>
// @mutate src/lib/posterSpend.ts |   if (!(refundedCents > 0)) return ` · includes ${amount} one-time setup fee`; |   if (!(refundedCents > 0)) return "";
// @mutate src/components/profile/earningsTab/SpentSection.tsx |                   {r.job ? setupFeeReceiptNote(r.job, r.refundedCents) : ""} |
// @mutate src/lib/disputeSplitPreview.ts |   const posterGross = Math.round(Math.max(0, capturedCents - keptSetupFeeCents) * posterShare) / 100; |   const posterGross = Math.round(capturedCents * posterShare) / 100;
// @mutate src/hooks/useActivityData.ts | materials_note, onboarding_fee_amount` | materials_note`
// @mutate supabase/functions/money-reconciliation/index.ts |             + setupFeeKeptCents(job as { onboarding_fee_amount?: number \| string \| null }); |             + 0;
// @mutate src/lib/posterSpend.ts |   const otherKeptCents = job.dispute_status ? stripeCents : Math.max(cents(job.customer_fee_amount ?? 0), stripeCents); |   const otherKeptCents = 0;
