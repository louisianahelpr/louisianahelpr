// Q320 — Accept Job on a job whose escrow is not funded (refunded after the
// offer). The live trigger enforce_job_funded_before_award refuses with 23514
// "This job is not funded yet…". The client used to answer "Couldn't accept the
// job — please try again.", a retry that can never work, and left Accept Job on
// the card to bounce again. It must say why and re-read.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const UNFUNDED = {
  code: "23514",
  message: "This job is not funded yet, so it cannot be assigned to a helper. The poster needs to complete checkout first.",
};
const { toastError, written, rpcNames } = vi.hoisted(() => ({
  toastError: vi.fn(),
  // Every .update()/.upsert()/.insert() payload, by table: a refusal must not write the job itself (Q1187).
  written: [] as { table: string; payload: unknown }[],
  rpcNames: [] as string[],
}));
const rpcResult = { current: { data: null as unknown, error: null as unknown } };

function chain(table: string, result: unknown) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "or", "in", "neq", "order", "limit", "maybeSingle", "single"]) {
    self[m] = () => self;
  }
  for (const m of ["update", "upsert", "insert"]) {
    self[m] = (payload: unknown) => { written.push({ table, payload }); return self; };
  }
  self.then = (resolve: (v: unknown) => void) => resolve(result);
  return self;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: (table: string) => chain(table, { data: null, error: UNFUNDED }),
    rpc: async (name: string) => { rpcNames.push(name); return rpcResult.current; },
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn(), hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock("@/lib/successMoment", () => ({ fireSuccessMoment: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: {} }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/pushPermissionNudge", () => ({ usePushPermissionNudge: () => vi.fn() }));
vi.mock("@/hooks/useStripeConnectCheck", () => ({
  useStripeConnectCheck: () => ({ checkHelperAwardEligibility: async () => ({ ok: true }) }),
}));
vi.mock("./activityActions/useOptimisticJobCache", () => ({
  useOptimisticJobCache: () => ({ optimisticallyPatchJob: () => undefined, rollbackActivity: vi.fn() }),
}));
vi.mock("./activityActions/useApplicantsState", () => ({
  useApplicantsState: () => ({
    selectedJob: null, setSelectedJob: vi.fn(),
    applications: [], setApplications: vi.fn(),
    applicationsLoading: false, applicationsError: null,
    inlineApplicants: {}, setInlineApplicants: vi.fn(),
    loadingApplicants: {}, applicantErrors: {},
    loadApplications: vi.fn(), loadInlineApplicants: vi.fn(),
  }),
}));

import { useActivityActions } from "./useActivityActions";
import { UNFUNDED_AWARD_COPY } from "@/lib/awardGate";
import type { Application } from "@/components/job-card/activityConstants";

type Args = Parameters<typeof useActivityActions>[0];
const USER = { id: "user-1" } as unknown as Args["user"];

function setup(refresh: () => Promise<void>) {
  return renderHook(() =>
    useActivityActions({ user: USER, postedJobs: [], appliedApps: [], refresh, setStatusFilter: vi.fn() }),
  );
}

describe("Accept Job on an unfunded job (Q320)", () => {
  beforeEach(() => {
    toastError.mockReset();
    rpcResult.current = { data: null, error: null };
    written.length = 0;
    rpcNames.length = 0;
  });

  it("application accept: says the job is not funded and re-reads, never 'try again'", async () => {
    // accept_job_offer (Q1180) carries the funding refusal now.
    rpcResult.current = { data: null, error: UNFUNDED };
    const refresh = vi.fn(async () => undefined);
    const { result } = setup(refresh);
    const app = { id: "app-1", job_id: "job-1", helper_id: "user-1" } as unknown as Application;
    await act(async () => { await result.current.handleHelperResponse(app, true); });
    expect(toastError).toHaveBeenCalledWith(UNFUNDED_AWARD_COPY);
    expect(toastError).not.toHaveBeenCalledWith("Couldn't accept the job — please try again.");
    expect(refresh).toHaveBeenCalled();
  });

  it("no fallback (Q1187): a refused accept_job_offer never writes the confirmation itself", async () => {
    // The retired pre-RPC path answered PGRST202 by PATCHing helper_confirmed_at
    // and calling reject_other_applications_on_accept: a confirmation with no
    // "accepted your offer" notice, which the database now refuses
    // (20261004001807). Any refusal is now the RPC's answer, and nothing else
    // is written.
    rpcResult.current = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    const refresh = vi.fn(async () => undefined);
    const { result } = setup(refresh);
    const app = { id: "app-1", job_id: "job-1", helper_id: "user-1" } as unknown as Application;
    await act(async () => { await result.current.handleHelperResponse(app, true); });
    expect(rpcNames).toEqual(["accept_job_offer"]);
    expect(written.filter((w) => w.table === "jobs")).toEqual([]);
    expect(toastError).toHaveBeenCalledWith("Couldn't accept the job — please try again.");
  });

  // Q1214 (3): a deadlock victim (the hourly sweep held the job) is told
  // nothing changed and to tap again, and logged under its own tag.
  // @mutate src/components/job-card/activityActions/useOfferHandlers.ts |       if (String((acceptError as { code?: string }).code ?? "") === "40P01") { |       if (false) {
  it("Q1214 (3): a deadlocked accept says nothing changed and to tap again", async () => {
    rpcResult.current = { data: null, error: { code: "40P01", message: "deadlock detected" } };
    const refresh = vi.fn(async () => undefined);
    const { result } = setup(refresh);
    const app = { id: "app-1", job_id: "job-1", helper_id: "user-1" } as unknown as Application;
    await act(async () => { await result.current.handleHelperResponse(app, true); });
    expect(toastError).toHaveBeenCalledWith("This job was being updated at the same moment. Nothing changed: tap Accept again.");
    const { report } = await import("@/lib/errorLogger");
    expect(report).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tags: expect.objectContaining({ deadlock_victim: "true" }) }));
  });

  it("direct offer accept: same refusal, same answer", async () => {
    rpcResult.current = { data: null, error: UNFUNDED };
    const refresh = vi.fn(async () => undefined);
    const { result } = setup(refresh);
    const app = { id: "direct-job-1", job_id: "job-1", helper_id: "user-1", is_direct_offer: true } as unknown as Application;
    await act(async () => { await result.current.handleHelperResponse(app, true); });
    expect(toastError).toHaveBeenCalledWith(UNFUNDED_AWARD_COPY);
    expect(refresh).toHaveBeenCalled();
  });
});

// @mutate src/components/job-card/activityActions/useOfferHandlers.ts | report(acceptError, { tags: { source: "useOfferHandlers.acceptJobOffer" } }); | await supabase.from("jobs").update({ helper_confirmed_at: new Date().toISOString() }).eq("id", app.job_id); report(acceptError, { tags: { source: "useOfferHandlers.acceptJobOffer" } });
// @mutate src/components/job-card/activityActions/useOfferHandlers.ts | if (isUnfundedAwardRefusal(acceptError)) { | if (false) {
// @mutate src/components/job-card/activityActions/useOfferHandlers.ts | if (isUnfundedAwardRefusal(error)) { | if (false) {
