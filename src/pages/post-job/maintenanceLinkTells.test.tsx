// Rentals: when Post a Job's link to the maintenance request fails or is
// refused, the landlord is told the job posted but is not linked, so the
// tenant will not see it booked (lh-authz-rls review of ca8e149b9, nit #10;
// before, useJobSubmit only reported it and showed nothing). Harness: the fake
// jobs table of haulAwayRelinkNoCleanup.test.tsx, with the maintenance link
// client answering what each test queues.
//
// Red first (2026-10-17) against S1's useJobSubmit.ts (aad8aace3): no toast on
// a refused link, a thrown link, or a chunk that cannot load. The stop cases
// (lh-money-escrow review of 01f8eab54 #2: a refusal because the repair is
// already paid from another tab went on to pay a second job) were red against
// 01f8eab54: payment started for job-1.
//
// @mutate src/pages/post-job/useJobSubmit.ts |   toast.error("Your job posted, but it isn't linked to the repair request", { |   void ("Your job posted, but it isn't linked to the repair request", {
// @mutate src/pages/post-job/useJobSubmit.ts |     if (await mod.linkMaintenanceJob(requestId, jobId)) return "go"; |     await mod.linkMaintenanceJob(requestId, jobId); return "go";
// @mutate src/pages/post-job/useJobSubmit.ts |     if (now === undefined \|\| now?.alreadyPosted) return "stop"; |     if (now?.alreadyPosted) return "stop";
// @mutate src/pages/post-job/useJobSubmit.ts |     if (now === undefined \|\| now?.alreadyPosted) return "stop"; |     if (now === undefined) return "stop";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

type Row = Record<string, unknown>;
const POSTER = "poster-1";
const server = vi.hoisted(() => ({
  jobs: [] as Row[],
  nextId: 1,
  jobInserts: 0,
  loseNextJobInsertResponse: false,
  failNextJobInsertOnWire: false,
  paymentCalls: [] as string[],
  loseNextPaymentResponse: false,
  refuseNextPayment: false,
  photoRemovals: [] as string[],
  deletes: 0,
  links: [] as string[],
  linkAnswers: [] as unknown[],
  undos: [] as string[],
  fundOnPayment: false,
}));
const FETCH_FAIL = { code: "", message: "TypeError: Failed to fetch", details: "", hint: "" };

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | null = null;
    let head = false;
    const filters: Array<[string, unknown]> = [];
    const match = () => server.jobs.filter((r) => filters.every(([k, v]) => r[k] === v));
    const run = (): { data: unknown; error: unknown; count?: number } => {
      if (table === "profiles") return { data: { idv_status: "verified" }, error: null };
      if (table !== "jobs") return { data: [], error: null };
      if (op === "insert") {
        server.jobInserts += 1;
        if (server.failNextJobInsertOnWire) {
          server.failNextJobInsertOnWire = false;
          return { data: null, error: FETCH_FAIL };
        }
        const row = payload!;
        if (
          row.client_request_id != null &&
          server.jobs.some((r) => r.customer_id === row.customer_id && r.client_request_id === row.client_request_id)
        ) {
          return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "jobs_customer_client_request_id_key"' } };
        }
        const stored = { id: `job-${server.nextId++}`, status: "open", payment_status: "unpaid", stripe_session_id: null, ...row };
        server.jobs.push(stored);
        if (server.loseNextJobInsertResponse) {
          server.loseNextJobInsertResponse = false;
          return { data: null, error: FETCH_FAIL };
        }
        return { data: { id: stored.id }, error: null };
      }
      if (op === "delete") {
        server.deletes += 1;
        // The prod DELETE policy (20260903055308): an unpaid job is deletable
        // only while no Checkout Session has been stamped on it.
        const hit = match().filter((r) => r.stripe_session_id == null);
        server.jobs = server.jobs.filter((r) => !hit.includes(r));
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      if (op === "update") return { data: match().map((r) => ({ id: r.id })), error: null };
      const hit = match();
      return head ? { data: null, error: null, count: hit.length } : { data: hit[0] ? { ...hit[0] } : null, error: null };
    };
    const chain: Record<string, unknown> = {
      insert: (row: Row) => { op = "insert"; payload = row; return chain; },
      update: () => { op = "update"; return chain; },
      delete: () => { op = "delete"; return chain; },
      select: (_c?: string, opts?: { head?: boolean }) => { head = !!opts?.head; return chain; },
      eq: (k: string, v: unknown) => { filters.push([k, v]); return chain; },
      not: () => chain,
      single: () => Promise.resolve(run()),
      maybeSingle: () => Promise.resolve(run()),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return chain;
  };
  return {
    supabase: {
      from,
      auth: { getUser: async () => ({ data: { user: { id: POSTER } } }) },
      functions: {
        invoke: async (_fn: string, { body }: { body: { jobId: string } }) => {
          server.paymentCalls.push(body.jobId);
          const job = server.jobs.find((r) => r.id === body.jobId);
          // create-payment's re-mint gate (RE_MINTABLE_PAYMENT_STATUSES): a job
          // already funded is refused as "already processed" (a PublicError).
          if (job && !["unpaid", "abandoned", "failed"].includes(String(job.payment_status ?? "unpaid"))) {
            return { data: { error: "This job's payment has already been processed. Open the job to see its payment status." }, error: null };
          }
          if (server.refuseNextPayment) {
            server.refuseNextPayment = false;
            return { data: { error: "Job budgets run from $25 to $5,000." }, error: null };
          }
          // create-payment mints a session and stamps it on the job before it
          // answers, so a LOST response still leaves the session behind.
          if (job) job.stripe_session_id = `cs_test_${server.paymentCalls.length}`;
          // A gift card covering the job settles it inside create-payment.
          if (job && server.fundOnPayment) job.payment_status = "escrow";
          if (server.loseNextPaymentResponse) {
            server.loseNextPaymentResponse = false;
            return {
              data: null,
              error: Object.assign(new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError" }),
            };
          }
          return { data: { url: `https://checkout.stripe.com/c/${body.jobId}` }, error: null };
        },
      },
    },
  };
});

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: {} }));
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock("@/lib/requireOnline", () => ({ requireOnline: () => true }));
vi.mock("@/hooks/useImpersonation", () => ({ assertWritable: () => true }));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: async () => null, composeJobAddress: () => "" }));
vi.mock("./firstPostConfetti", () => ({ maybeFireFirstPostConfetti: async () => {} }));
vi.mock("@/hooks/useNotificationPermissionPrompt", () => ({ recordJobActionForPermissionPrompt: vi.fn() }));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: vi.fn(async () => {}) }));
vi.mock("@/lib/storageCleanup", () => ({ removeJobPhotos: async (id: string) => { server.photoRemovals.push(id); return 0; } }));
const link = vi.hoisted(() => ({
  calls: [] as Array<[string, string]>,
  answer: true as boolean | Error,
  /** What a re-read of the request says after a refusal: already posted (paid or paying) or not; an Error = the read failed. */
  recheck: { alreadyPosted: false } as { alreadyPosted: boolean } | null | Error,
  rechecks: 0,
}));
vi.mock("./maintenancePrefill", () => ({
  linkMaintenanceJob: async (requestId: string, jobId: string) => {
    link.calls.push([requestId, jobId]);
    if (link.answer instanceof Error) throw link.answer;
    return link.answer;
  },
  fetchMaintenancePrefill: async () => {
    link.rechecks += 1;
    if (link.recheck instanceof Error) throw link.recheck;
    return link.recheck;
  },
}));

import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { safeStorage } from "@/lib/safeStorage";
import { useJobSubmit, type UseJobSubmitParams } from "./useJobSubmit";

function params(overrides: Partial<UseJobSubmitParams> = {}): UseJobSubmitParams {
  return {
    saving: false,
    setSaving: vi.fn(),
    setRedirecting: vi.fn(),
    setStep: vi.fn(),
    setConfirmed: vi.fn(),
    flushDraft: vi.fn(),
    title: "Mow the back lawn",
    description: "Front and back, bagging clippings.",
    category: "lawn_care",
    streetAddress: "1 Main St",
    city: "Baton Rouge",
    addrState: "LA",
    zipCode: "70801",
    parish: "East Baton Rouge",
    dateNeeded: "2026-10-01",
    startTime: "09:00",
    isFlexibleSchedule: false,
    estimatedHours: "2",
    budget: "80",
    specialRequirements: "",
    isRecurring: false,
    recurrenceInterval: "",
    recurrenceEndDate: "",
    recurrenceDays: [],
    recurrenceWeeks: 0,
    isGroupJob: false,
    helpersNeeded: "1",
    isUrgent: false,
    urgentFee: "",
    salesTaxRate: 0,
    offerToHelperId: null,
    offerResponseHours: 24,
    credentialTier: 0,
    requirePhotoProof: true,
    includeMaterials: false,
    materialsNote: "",
    saveCardForFuture: false,
    giftCardId: null,
    uploadAndAttachPhotos: async (jobId: string) => { uploads.push(jobId); },
    uploadAndAttachScopeVideo: async () => {},
    ...overrides,
  };
}

let uploads: string[] = [];
const REQUEST = "77777777-0000-4000-8000-000000000001";
const errorToasts = () => vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));
const post = async () => {
  const { result } = renderHook(() => useJobSubmit(params({ maintenanceRequestId: REQUEST })));
  await act(async () => { await result.current.handleSubmit(); });
};
const NOT_LINKED = "Your job posted, but it isn't linked to the repair request";

beforeEach(() => {
  uploads = [];
  server.jobs = [];
  server.nextId = 1;
  server.paymentCalls = [];
  server.photoRemovals = [];
  link.calls = [];
  link.answer = true;
  link.recheck = { alreadyPosted: false };
  link.rechecks = 0;
  server.deletes = 0;
  vi.mocked(toast.error).mockClear();
  vi.mocked(report).mockClear();
  safeStorage.removeItem("helpr_last_job_submit");
});

describe("Rentals: Post a Job tells the landlord when the maintenance link fails", () => {
  it("a linked post says nothing extra and goes on to pay", async () => {
    await post();
    expect(link.calls).toEqual([[REQUEST, "job-1"]]);
    expect(errorToasts()).toEqual([]);
    expect(server.paymentCalls).toEqual(["job-1"]);
  });

  it("a refused link (the server answers false) is reported AND told, and the job still goes on to pay", async () => {
    link.answer = false;
    await post();
    expect(link.calls).toEqual([[REQUEST, "job-1"]]);
    expect(errorToasts(), "a refused maintenance link showed the landlord nothing").toEqual([NOT_LINKED]);
    const opts = vi.mocked(toast.error).mock.calls[0][1] as { description?: string };
    expect(opts.description).toMatch(/tenant won't see it on their request/);
    expect(link.rechecks).toBe(1);
    expect(vi.mocked(report).mock.calls.some((c) => (c[1] as { tags?: { source?: string } }).tags?.source === "useJobSubmit.linkMaintenance")).toBe(true);
    expect(server.paymentCalls, "a refused link must not stop the payment hand-off").toEqual(["job-1"]);
    expect(server.photoRemovals, "a refused link must not clean up the posted job").toEqual([]);
  });

  it("a link that throws (switch off, banned, network) is told the same way", async () => {
    link.answer = Object.assign(new Error("feature_disabled"), { code: "42501" });
    await post();
    expect(errorToasts()).toEqual([NOT_LINKED]);
    expect(server.paymentCalls).toEqual(["job-1"]);
  });

  it("a refusal because the repair already has a paid or paying job (another tab) stops before payment and removes this unpaid job", async () => {
    link.answer = false;
    link.recheck = { alreadyPosted: true };
    await post();
    expect(server.paymentCalls, "it went on to pay for the same repair twice").toEqual([]);
    expect(server.deletes, "the unpaid duplicate job was left behind").toBe(1);
    expect(server.jobs).toHaveLength(0);
    expect(errorToasts()).toEqual(["This repair already has a job"]);
  });

  it("a refusal whose reason cannot be read back also stops (never pay when it may already be paid)", async () => {
    link.answer = false;
    link.recheck = new Error("TypeError: Failed to fetch");
    await post();
    expect(server.paymentCalls).toEqual([]);
    expect(errorToasts()).toEqual(["This repair already has a job"]);
  });
});
