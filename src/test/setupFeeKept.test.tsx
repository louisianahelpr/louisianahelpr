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
import { setupFeeKeptCents, setupFeeKeptReason } from "../../supabase/functions/_shared/posterFees";
import { setupFeeReceiptNote, spentRows } from "@/lib/posterSpend";
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

  it("the refund notice's kept reason names the setup fee after the path's own fee reason", () => {
    expect(setupFeeKeptReason("the card processing fee, which can't be returned", 200)).toBe(
      "the card processing fee, which can't be returned, and the one-time $2.00 account setup fee, which is paid once and never refunded",
    );
    expect(setupFeeKeptReason(null, 200)).toBe("the one-time $2.00 account setup fee, which is paid once and never refunded");
    expect(setupFeeKeptReason("the card processing fee, which can't be returned", 0)).toBe("the card processing fee, which can't be returned");
    expect(setupFeeKeptReason(null, 0)).toBeNull();
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
    expect(spent).toContain("setupFeeReceiptNote(r.job, r.refundedCents, r.adminRefunded)");
    expect(spent).toContain('.select("job_id, amount_cents, stripe_payment_intent_id, source")');
    // An admin's full refund of a LEGACY job (the old 12% service fee) keeps
    // the setup fee and Stripe's card fee, never the 12% (owner pop-up,
    // 2026-10-14): 1320 charged, 1120 back (the client cannot read Stripe's
    // real fee, so the $2 alone is enough to show the line).
    const tenDollar = { budget: 10, customer_fee_amount: 1.2, onboarding_fee_amount: 2 };
    expect(setupFeeReceiptNote(tenDollar, 1120, true)).toBe(" · $2.00 one-time setup fee kept (not refundable)");
    expect(setupFeeReceiptNote(tenDollar, 1120, false)).toBe("");
    // Since 2026-10-14 an admin's full refund keeps the CARD fee too ("if admin
    // refunds we keep the fee also"). A no-service-fee first job (platform_fee_percent
    // 0, $1.06 card cost, $2 setup fee; 2806 charged): the admin refund returns
    // 2500 and keeps 306, and the receipt says the $2 was kept.
    const cardCostFirst = { budget: 25, customer_fee_amount: 1.06, onboarding_fee_amount: 2, platform_fee_percent: 0 };
    expect(setupFeeReceiptNote(cardCostFirst, 2500, true)).toBe(" · $2.00 one-time setup fee kept (not refundable)");
    // ...and the Spent row is what stayed on the card: the card fee and the $2.
    const cardJob = { id: "j9", ...cardCostFirst, payment_status: "refunded", stripe_payment_intent_id: "pi_9" };
    const [cardRow] = spentRows([cardJob], [{ job_id: "j9", amount_cents: 2500, stripe_payment_intent_id: "pi_9", source: "admin_refund_general" }], []);
    expect(cardRow.cents).toBe(306);
    // The card fee comes off first: an admin refund that left only $2 on that
    // charge returned the card cost but not all of the setup fee, so the
    // receipt does not claim the $2 was kept (the old "an admin refund keeps
    // only the setup fee" reading would).
    expect(setupFeeReceiptNote(cardCostFirst, 2606, true)).toBe("");
    // The Spent screen reads the column the rule needs.
    expect(spent).toContain("customer_fee_amount, platform_fee_percent, urgent_fee");
    // The Spent rows carry which refunds were the admin's, from the ledger's source.
    const job = { id: "j1", ...tenDollar, payment_status: "refunded", stripe_payment_intent_id: "pi_1" };
    const [adminRow] = spentRows([job], [{ job_id: "j1", amount_cents: 1120, stripe_payment_intent_id: "pi_1", source: "admin_refund_general" }], []);
    expect(adminRow.adminRefunded).toBe(true);
    const [cancelRow] = spentRows([job], [{ job_id: "j1", amount_cents: 1000, stripe_payment_intent_id: "pi_1", source: "cancel_escrow" }], []);
    expect(cancelRow.adminRefunded).toBe(false);
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
    expect(recon).toMatch(/stripe_payment_intent_id, stripe_session_id, customer_fee_amount, onboarding_fee_amount",/);
  });

  it("every poster refund path takes the kept fee off what it returns", () => {
    const cp = code("supabase/functions/create-payment/index.ts");
    expect(cp.match(/setupFeeKeptCents\(job\)/g)?.length).toBeGreaterThanOrEqual(4); // cancel, dispute refund + reason, admin full refund
    // Owner, 2026-10-12 (second pop-up): an admin's FULL refund keeps it too
    // (through _shared/refundAmount.ts since 2026-10-14).
    expect(cp).toContain("const keptSetupCents = isPartial ? 0 : generalSplit.setupKeptCents;");
    expect(code("src/components/admin/adminJobs/RefundJobDialog.tsx")).toContain("also keeps its one-time $2 setup fee");
    expect(code("supabase/functions/void-cancelled-payments/index.ts")).toMatch(/setupFeeCents: setupFeeKeptCents\(job\),/);
    expect(code("supabase/functions/void-cancelled-payments/index.ts")).toMatch(/customer_fee_amount, onboarding_fee_amount, cancellation_fee/);
    const split = code("supabase/functions/execute-dispute-split/index.ts");
    expect(split).toMatch(/setupFeeCents: pi \? setupFeeKeptCents\(job\) : 0,/);
    expect(split).toMatch(/stripe_session_id, onboarding_fee_amount, customer_fee_amount, platform_fee_percent"/);
  });
});

// @mutate supabase/functions/_shared/posterFees.ts |   return Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0; |   return 0;
// @mutate src/components/CancellationDialog.tsx |                   {keptFeeSentence}\n                </p> |                 </p>
// @mutate src/lib/posterSpend.ts |   if (!(refundedCents > 0)) return ` · includes ${amount} one-time setup fee`; |   if (!(refundedCents > 0)) return "";
// @mutate src/components/profile/earningsTab/SpentSection.tsx |                   {r.job ? setupFeeReceiptNote(r.job, r.refundedCents, r.adminRefunded) : ""} |
// @mutate src/lib/disputeSplitPreview.ts |   const posterGross = Math.round(Math.max(0, capturedCents - keptSetupFeeCents) * posterShare) / 100; |   const posterGross = Math.round(capturedCents * posterShare) / 100;
// @mutate src/hooks/useActivityData.ts | materials_note, onboarding_fee_amount` | materials_note`
// @mutate supabase/functions/money-reconciliation/index.ts |             + setupFeeKeptCents(job as { onboarding_fee_amount?: number \| string \| null }); |             + 0;
// @mutate src/lib/posterSpend.ts |   const otherKeptCents = adminRefunded ? cardCostFeeCents(job) : job.dispute_status ? stripeCents : Math.max(cents(job.customer_fee_amount ?? 0), stripeCents); |   const otherKeptCents = 0;
// @mutate src/lib/posterSpend.ts |   const otherKeptCents = adminRefunded ? cardCostFeeCents(job) : |   const otherKeptCents = adminRefunded ? 0 :
// @mutate src/components/profile/earningsTab/SpentSection.tsx | customer_fee_amount, platform_fee_percent, urgent_fee, | customer_fee_amount, urgent_fee,
// @mutate src/lib/posterSpend.ts |     if (r.source === "admin_refund_general") adminRefundedJobs.add(r.job_id); |
