// The two dispute release paths that bypass completeJob — synchronous
// in-flight guard.
//
//   - Poster "Resolve & Pay" (PostedJobActions.resolveDisputeAndRelease):
//     rpc_withdraw_dispute then create-payment release.
//   - Admin "Quick: Release / Refund" (AdminDisputes.resolveDispute):
//     create-payment admin_release_dispute / admin_refund_dispute.
//
// Both guarded only with React state (and the admin one set it AFTER an
// awaited biometric check), so two clicks in one frame both fired. The server
// does not refuse a concurrent duplicate release, so the client guard matters.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const rpcMock = vi.fn();
const invokeMock = vi.fn();
let disputedRows: unknown[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const build = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "not", "in", "order", "limit", "is", "or", "neq", "gte", "lte", "maybeSingle", "single"]) {
      b[m] = () => b;
    }
    b.eq = (col: string, val: string) => { if (col === "status" && val === "disputed") b.__open = true; return b; };
    b.then = (res: (v: unknown) => void) =>
      res({ data: table === "jobs" ? (b.__open ? disputedRows : []) : [], error: null });
    return b;
  };
  return {
    supabase: {
      from: (t: string) => build(t),
      auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
      rpc: (...args: unknown[]) => { rpcMock(...args); return new Promise(() => {}); },
      functions: { invoke: (...args: unknown[]) => { invokeMock(...args); return new Promise(() => {}); } },
    },
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/adminAudit", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/biometricGate", () => ({ requireBiometric: vi.fn(async () => true) }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null }));

import { PostedJobActions } from "./activity/postedJobCard/PostedJobActions";
import AdminDisputes from "./admin/AdminDisputes";

function doubleClick(button: HTMLElement) {
  act(() => {
    button.click();
    button.click();
  });
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("dispute release — same-frame double click sends one request", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    invokeMock.mockReset();
  });

  it("PostedJobActions: Resolve & Pay → Release Payment", async () => {
    const job = {
      id: "job-1", title: "Fence", budget: 100, status: "disputed",
      customer_id: "poster-1", helper_id: "helper-1",
      disputed_by: "poster-1", dispute_status: "open",
      dispute_deadline: new Date(Date.now() + 86_400_000).toISOString(),
      proof_before_urls: [], proof_after_urls: [],
    } as never;
    const noop = vi.fn();
    render(
      <MemoryRouter>
        <PostedJobActions
          job={job} userId="poster-1" helperNames={{ "helper-1": "Hallie H." }} completedJobMeta={{}}
          onBoost={noop} onEdit={noop} onCancel={noop} onComplete={noop} completingJobId={null}
          onRevision={noop} onNoShow={noop} onTip={noop} onReview={noop} onDispute={noop} onReport={noop}
          onViewDispute={noop} onConfirmArrival={noop} confirmingArrivalJobId={null}
          onConfirmWorking={noop} confirmingWorkingJobId={null} onActionComplete={noop}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Resolve & Pay/ }));
    doubleClick(await screen.findByRole("button", { name: "Release Payment" }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    await settle();
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("AdminDisputes: Quick Release → Release Payment", async () => {
    disputedRows = [{
      id: "job-2", title: "Gutter", budget: 100, status: "disputed",
      customer_id: "poster-1", helper_id: "helper-1", stripe_payment_intent_id: "pi_2",
      dispute_reason: "no_show", dispute_evidence_urls: [],
      disputed_at: new Date().toISOString(), disputed_by: "helper-1",
    }];
    render(<AdminDisputes />);
    fireEvent.click(await screen.findByRole("button", { name: /Quick: Release to Helpr/ }));
    doubleClick(await screen.findByRole("button", { name: "Release Payment" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    await settle();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][1]).toEqual({ body: { action: "admin_release_dispute", jobId: "job-2" } });
  });
});
