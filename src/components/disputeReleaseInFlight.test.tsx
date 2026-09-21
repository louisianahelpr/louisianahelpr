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
      /*
       * The spy's OWN return value wins; a never-settling promise is only the
       * DEFAULT.
       *
       * These used to discard whatever `rpcMock` returned and always hand back
       * a promise that never resolves. That is exactly right for the
       * double-click tests below — the request must still be in flight when
       * the second click lands — and it silently disarms any test that needs
       * the call to FINISH. A `mockResolvedValueOnce({ error })` was accepted
       * and ignored, so a test of the failure path could not be written at
       * all, which is why the re-entry latch below went unnoticed.
       *
       * `?? new Promise(() => {})` keeps the old behaviour for every test that
       * does not set a return value.
       */
      rpc: (...args: unknown[]) => rpcMock(...args) ?? new Promise(() => {}),
      functions: { invoke: (...args: unknown[]) => invokeMock(...args) ?? new Promise(() => {}) },
    },
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/adminAudit", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/biometricGate", () => ({ requireBiometric: vi.fn(async () => true) }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null, PhotoProofDialog: () => null, PhotoProofRequirementNote: () => null }));

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

  /*
   * THE OTHER HALF OF A RE-ENTRY GUARD: it has to let go.
   *
   * `resolveDisputeAndRelease`'s `finally` released the spinner
   * (`setDisputeActing(false)`, which re-enables the button) and left
   * `disputeInFlight.current` TRUE. So after ANY failed Resolve & Pay the
   * poster saw an enabled button that silently did nothing — the guard at the
   * top returned immediately, for the life of the component.
   *
   * Not a rare path. The handler's own comment records that this call failed
   * 100% of the time for six days. And the lockout's only escape was
   * ESCALATING, since `escalateDispute`'s finally clears the same ref — so the
   * way out of "Resolve is dead" was a different, irreversible action that
   * hands the decision to an admin.
   *
   * The double-click test above cannot see this: it only ever proves the guard
   * ENGAGES. A guard that never disengages passes it perfectly.
   */
  it("PostedJobActions: a failed Resolve & Pay can be retried", async () => {
    const job = {
      id: "job-1", title: "Fence", budget: 100, status: "disputed",
      customer_id: "poster-1", helper_id: "helper-1",
      disputed_by: "poster-1", dispute_status: "open",
      dispute_deadline: new Date(Date.now() + 86_400_000).toISOString(),
      proof_before_urls: [], proof_after_urls: [],
    } as never;
    const noop = vi.fn();
    // First attempt fails the way prod did — a refused RPC, not a throw.
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "permission denied", code: "42501" } });
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
    fireEvent.click(await screen.findByRole("button", { name: "Release Payment" }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    await settle();

    // The SECOND attempt must reach the server. With the ref left latched it
    // never does, and the poster taps an enabled button into silence.
    // The confirm dialog animates closed; give Radix a beat before re-opening,
    // or the open flag flips back inside the same unmount and renders nothing.
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Resolve & Pay/ }));
      await new Promise((r) => setTimeout(r, 300));
    });
    fireEvent.click(await screen.findByRole("button", { name: "Release Payment" }));
    await settle();
    expect(
      rpcMock.mock.calls.length,
      "a failed Resolve & Pay latched the re-entry ref, so every later attempt is a silent no-op",
    ).toBeGreaterThan(1);
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

/* BLIND SPOTS. This proves the CLIENT sends one request per double tap. It
 * proves nothing about the server: `create-payment`'s release path is mocked to
 * a promise that never settles, so idempotency at the edge function and in
 * Stripe is untested here, and the comment above is explicit that the server
 * does not refuse a concurrent duplicate. Two taps in two different FRAMES, or
 * from two devices, are also outside this file — the ref only closes the
 * same-frame window. */

// THE POSTER'S GUARD. React state alone loses this race: both taps in one frame
// read `disputeActing === false` and both release the full escrow.
// @mutate src/components/activity/postedJobCard/PostedJobActions.tsx | if (disputeInFlight.current) return; | if (false) return;
// THE ADMIN'S GUARD, which additionally has to hold across the awaited
// biometric prompt — `setResolving` only runs after it.
// @mutate src/components/admin/AdminDisputes.tsx | if (resolveInFlight.current) return; | if (false) return;
