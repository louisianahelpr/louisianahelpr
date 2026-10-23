/**
 * The "Waiting on the Poster's Approval" card (owner 2026-10-23: nothing is paid without the poster's
 * approval; past the window Helpr support steps in). What an admin sees and what each button sends:
 *  - a row the poster still has not answered offers "Approve for the poster", which, after the confirm,
 *    calls create-payment `release` with forPoster (the server's authz is in src/test/edge/create-payment.test.ts);
 *  - a row the poster settled since (still_waiting false) offers only "Mark reviewed";
 *  - "Mark reviewed" calls resolve_approval_escalation and never says success on `false`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const rpcMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const build = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "order", "limit"]) b[m] = () => b;
    b.then = (res: (v: unknown) => void) => res({ data: [], error: null });
    return b;
  };
  return {
    supabase: {
      from: () => build(),
      rpc: (...args: unknown[]) => rpcMock(...args),
      functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    },
  };
});
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/biometricGate", () => ({ requireBiometric: vi.fn(async () => true) }));

import { AdminApprovalEscalations } from "@/components/admin/AdminApprovalEscalations";

const row = (over: Record<string, unknown> = {}) => ({
  job_id: "job-1", reason: "approval", title: "Mow two lawns", customer_id: "poster-1", helper_id: "helpr-1",
  budget: 100, status: "in_progress", payment_status: "escrow", helper_completed_at: "2026-10-22T17:18:33Z",
  revision_completed_at: null, is_group_job: false, escalated_at: "2026-10-23T17:30:00Z",
  resolved_at: null, resolution: null, still_waiting: true, ...over,
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AdminApprovalEscalations /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminApprovalEscalations", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    invokeMock.mockReset();
    toastMock.success.mockReset();
    toastMock.mockReset();
  });

  it("a waiting row offers Approve for the poster, which sends forPoster after the confirm", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    invokeMock.mockResolvedValue({ data: { success: true, bothDone: true }, error: null });
    mount();
    expect(await screen.findByText("Mow two lawns")).toBeTruthy();
    expect(screen.getByText(/didn't answer in 24 hours/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve for the poster" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve and schedule the payout" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("create-payment", {
      body: { action: "release", jobId: "job-1", forPoster: true },
    }));
  });

  // @mutate src/components/admin/AdminApprovalEscalations.tsx | {row.still_waiting && ( | {(
  it("a row the poster settled since offers no approval, only Mark reviewed", async () => {
    rpcMock.mockResolvedValue({ data: [row({ still_waiting: false })], error: null });
    mount();
    expect(await screen.findByText("Mow two lawns")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve for the poster" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeTruthy();
  });

  it("Mark reviewed answers false: says someone got there first, never success", async () => {
    rpcMock.mockImplementation(async (name: string) =>
      name === "admin_approval_escalation_queue" ? { data: [row()], error: null } : { data: false, error: null });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Mark reviewed" }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("resolve_approval_escalation", { p_job_id: "job-1" }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith("Already cleared — someone got to this one first."));
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("an empty queue says so", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    mount();
    expect(await screen.findByText("No jobs are waiting on an approval")).toBeTruthy();
  });
});
