/**
 * An admin FULL refund on a paid-out job is a refused request, not money at risk.
 *
 * 2026-09-24: press-every-control (07:05Z) and the prod-audit admin-jobs explore
 * (11:42Z) pressed Refund on a released SEED job. create-payment correctly
 * answered 409 (a full refund after a payout would spend the escrow twice), but
 * through the dispute helper, so it paged #ops-alerts "Dispute settlement refused
 * — needs manual reconciliation" for a job with no dispute and no money moved
 * (ops ledger 9bfdd9ff). And the dialog offered the full refund the server
 * always refuses: "blank = full refund" on a released job.
 *
 * @mutate supabase/functions/create-payment/index.ts | const alreadyPaidOut = await escrowAlreadyMovedTheOtherWay(supabaseAdmin, jobId, "refund", "admin_refund"); | const alreadyPaidOut = await escrowAlreadyMovedTheOtherWay(supabaseAdmin, jobId, "refund");
 * @mutate supabase/functions/create-payment/index.ts | const partialAlreadyPaidOut = await escrowAlreadyMovedTheOtherWay(supabaseAdmin, jobId, "refund", "admin_refund"); | const partialAlreadyPaidOut = await escrowAlreadyMovedTheOtherWay(supabaseAdmin, jobId, "refund");
 * @mutate src/components/admin/adminJobs/RefundJobDialog.tsx | disabled={refunding \|\| needsAmount} | disabled={refunding}
 * @mutate src/components/admin/adminJobs/RefundJobDialog.tsx | const paidOut = payoutMoved ?? detailJob?.payment_status === "released"; | const paidOut = detailJob?.payment_status === "released";
 * @mutate src/components/admin/AdminJobs.tsx | .eq("job_id", refundJobId).in("status", ["pending", "paid"]).limit(1), | .eq("job_id", refundJobId).limit(1),
 *
 * Review (lh-money-escrow): payment_status is the wrong question both ways — a
 * released job whose only transfer FAILED can still be fully refunded, and a
 * payout_pending job with a transfer in flight cannot. The dialog now takes the
 * ledger answer (payoutMoved) AdminJobs reads with the server's own filter.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RefundJobDialog } from "@/components/admin/adminJobs/RefundJobDialog";
import type { Job } from "@/components/admin/adminJobs/types";

const src = readFileSync(resolve(__dirname, "../../supabase/functions/create-payment/index.ts"), "utf8");

function renderDialog(payment_status: string, refundAmount: string, payoutMoved?: boolean) {
  const job = { id: "j1", title: "Test job", budget: 100, payment_status, helper_id: "h1" } as unknown as Job;
  render(
    <RefundJobDialog
      open
      detailJob={job}
      refundReason=""
      refundAmount={refundAmount}
      refunding={false}
      payoutMoved={payoutMoved}
      onOpenChange={vi.fn()}
      onReasonChange={vi.fn()}
      onAmountChange={vi.fn()}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  return screen.getByRole("button", { name: /issue refund/i });
}

describe("admin refund after payout", () => {
  it("every admin_refund_general payout check uses the non-paging context", () => {
    const start = src.indexOf('if (action === "admin_refund_general")');
    const end = src.indexOf("async function escrowAlreadyMovedTheOtherWay(");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, end);
    const calls = block.match(/escrowAlreadyMovedTheOtherWay\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c, c).toContain('"admin_refund"');
  });

  it("the admin_refund refusal answers 409 before any Slack page", () => {
    const fn = src.slice(src.indexOf("async function escrowAlreadyMovedTheOtherWay("));
    const branch = fn.slice(fn.indexOf('if (context === "admin_refund")'), fn.indexOf("postSlackOpsAlert("));
    expect(branch).toMatch(/status: 409/);
    expect(branch).not.toMatch(/postSlackOpsAlert/);
  });

  it("a paid-out job cannot issue a refund with the amount blank", () => {
    expect(renderDialog("released", "")).toBeDisabled();
  });

  it("a paid-out job can issue a partial refund", () => {
    expect(renderDialog("released", "25")).toBeEnabled();
  });

  it("a job still in escrow can issue a full refund with the amount blank", () => {
    expect(renderDialog("escrow", "")).toBeEnabled();
  });

  it("a released job whose only transfer failed can still be fully refunded", () => {
    expect(renderDialog("released", "", false)).toBeEnabled();
  });

  it("a payout_pending job with a transfer in flight needs an amount", () => {
    expect(renderDialog("payout_pending", "", true)).toBeDisabled();
  });

  it("AdminJobs asks the ledger with the server's own pending/paid filter", () => {
    const admin = readFileSync(resolve(__dirname, "../components/admin/AdminJobs.tsx"), "utf8");
    const helper = src.slice(src.indexOf("async function escrowAlreadyMovedTheOtherWay("));
    expect(helper).toMatch(/ledger\.in\("status", \["pending", "paid"\]\)/);
    expect(admin).toMatch(/from\("payout_transfers"\)[\s\S]{0,200}\.in\("status", \["pending", "paid"\]\)/);
    expect(admin).toMatch(/payoutMoved=\{payoutMoved\}/);
  });
});
