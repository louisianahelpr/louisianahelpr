// Declutter haul-away, re-review 2026-10-17 finding 1: Post a Job re-links a
// haul-away before it retries a payment hand-off whose answer was lost. By
// then the job may be FUNDED (a gift card settles inside create-payment), and
// the old code answered a re-link refusal with cleanupOrphanJob: the job's
// photos were removed first, then the DELETE was refused (the poster's policy
// keeps a funded job), so a funded job lost its photos. A re-link refusal must
// never clean up: no photo removal, no DELETE, no undo, and no payment for
// items that moved on. Harness: the fake jobs table of
// retryAfterLostResponse.test.tsx (the prod DELETE policy shape), with the
// haul-away client and the storage cleanup recorded.
//
// Red first (2026-10-17) against the pre-fix useJobSubmit.ts: the photos of
// job-1 were removed and a DELETE was sent.
//
// Q?gift-paid-retry-photos (2026-10-17, the hub handoff's MEDIUM for haul-away
// v2, the same path for every job): the re-link answers success, the retried
// create-payment is refused as "already processed" because the lost first call
// had settled a gift card, and the refusal path then ran cleanupOrphanJob:
// photos removed, DELETE refused, "Couldn't start payment" shown for a paid
// job. Red first against useJobSubmit.ts as rebased on the stack (a6b60cd85):
// photoRemovals ["job-1"], one DELETE, an undo, the error toast.
//
// @mutate src/pages/post-job/useJobSubmit.ts |         if (funded === true) { |         if (funded === true && false) {
// @mutate src/pages/post-job/useJobSubmit.ts |     if (!deletable) { |     if (false) {
//
// @mutate src/pages/post-job/useJobSubmit.ts |           // Never clean up a job that may hold money: |           if (!isNetworkFailure(linkErr)) await removeJobPhotos(attempt.jobId, "PostJob.orphanCleanup");\n          // Never clean up a job that may hold money:
// @mutate src/pages/post-job/useJobSubmit.ts |           // Never clean up a job that may hold money: |           attemptRef.current = null;\n          // Never clean up a job that may hold money:
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
// The haul-away client (loaded by useJobSubmit's dynamic import): the first
// link succeeds, every later one answers what the test queues.
vi.mock("@/lib/declutter/haulAway", () => ({
  linkHaulAwayForJob: async (ids: string[], jobId: string) => {
    server.links.push(jobId);
    const next = server.linkAnswers.shift();
    if (next) throw next;
    return ids.length;
  },
  undoHaulAwayForJob: async (_ids: string[], jobId: string) => { server.undos.push(jobId); return 0; },
  haulAwayErrorMessage: (e: { userMessage?: string }) => e.userMessage ?? "Something went wrong. Please try again.",
}));

import { toast } from "sonner";
import { openExternalUrl } from "@/lib/openExternalUrl";
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
const press = async (submit: () => Promise<void>) => {
  await act(async () => { await submit(); });
};
const errorToasts = () => vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));
const HAUL = ["66666666-0000-4000-8000-000000000001", "66666666-0000-4000-8000-000000000002"];
const REFUSED = Object.assign(new Error("haul_away_job_not_found"), { code: "P0002", userMessage: "That job isn't open any more." });

beforeEach(() => {
  uploads = [];
  server.jobs = [];
  server.nextId = 1;
  server.jobInserts = 0;
  server.loseNextJobInsertResponse = false;
  server.failNextJobInsertOnWire = false;
  server.paymentCalls = [];
  server.loseNextPaymentResponse = false;
  server.refuseNextPayment = false;
  server.photoRemovals = [];
  server.deletes = 0;
  server.links = [];
  server.linkAnswers = [];
  server.undos = [];
  server.fundOnPayment = false;
  vi.mocked(toast.error).mockClear();
  vi.mocked(openExternalUrl).mockClear();
  safeStorage.removeItem("helpr_last_job_submit");
});

describe("haul-away: a re-link refusal before a retried payment hand-off never cleans up", () => {
  it("a job a gift card funded while the answer was lost keeps its photos and its row", async () => {
    const { result } = renderHook(() => useJobSubmit(params({ haulAwayItemIds: HAUL, giftCardId: "gift-1" })));
    server.loseNextPaymentResponse = true;
    server.fundOnPayment = true;
    await press(result.current.handleSubmit);
    expect(server.jobs).toHaveLength(1);
    expect(server.jobs[0].payment_status).toBe("escrow");
    expect(server.links).toEqual(["job-1"]);

    // The retry re-links first; the server refuses.
    server.linkAnswers.push(REFUSED);
    safeStorage.removeItem("helpr_last_job_submit");
    await press(result.current.handleSubmit);
    expect(server.links).toEqual(["job-1", "job-1"]);
    expect(server.photoRemovals, "a re-link refusal removed the photos of a job that may be funded").toEqual([]);
    expect(server.deletes, "a re-link refusal sent a DELETE for the job").toBe(0);
    expect(server.undos, "a re-link refusal undid the haul-away").toEqual([]);
    expect(server.jobs).toHaveLength(1);
    expect(server.paymentCalls, "it paid again for items the server refused").toEqual(["job-1"]);
    expect(errorToasts().slice(-1)[0]).toMatch(/^Couldn't book the haul-away: /);

    // The attempt still names job-1: another press never posts a second job.
    safeStorage.removeItem("helpr_last_job_submit");
    await press(result.current.handleSubmit);
    expect(server.jobInserts, "a press after the refusal posted a second job").toBe(1);
    expect(server.links).toEqual(["job-1", "job-1", "job-1"]);
  });

  it("a re-link answered as success (the server's early return) goes on to pay for that same job", async () => {
    const { result } = renderHook(() => useJobSubmit(params({ haulAwayItemIds: HAUL })));
    server.loseNextPaymentResponse = true;
    await press(result.current.handleSubmit);
    safeStorage.removeItem("helpr_last_job_submit");
    await press(result.current.handleSubmit);
    expect(server.links).toEqual(["job-1", "job-1"]);
    expect(server.paymentCalls).toEqual(["job-1", "job-1"]);
    expect(server.photoRemovals).toEqual([]);
    expect(server.deletes).toBe(0);
  });

  it("the FIRST link refusal (job just created, never paid) still removes the job and puts the items back, as before", async () => {
    server.linkAnswers.push(REFUSED);
    const { result } = renderHook(() => useJobSubmit(params({ haulAwayItemIds: HAUL })));
    await press(result.current.handleSubmit);
    expect(server.jobs).toHaveLength(0);
    expect(server.undos).toEqual(["job-1"]);
    expect(server.paymentCalls).toEqual([]);
  });
});

describe("Q?gift-paid-retry-photos: a job funded by a gift card while its payment answer was lost is a success, never cleaned up", () => {
  const redirected = (p: UseJobSubmitParams) => vi.mocked(p.setRedirecting).mock.calls.some((c) => c[0] === true);

  it("haul-away: the retry's 'already processed' refusal keeps the photos, the row and the link, and goes to the success page", async () => {
    const p = params({ haulAwayItemIds: HAUL, giftCardId: "gift-1" });
    const { result } = renderHook(() => useJobSubmit(p));
    server.loseNextPaymentResponse = true;
    server.fundOnPayment = true;
    await press(result.current.handleSubmit);
    expect(server.jobs[0].payment_status).toBe("escrow");
    vi.mocked(toast.error).mockClear();

    // The retry: the re-link answers success (the server's early return), create-payment refuses as already paid.
    safeStorage.removeItem("helpr_last_job_submit");
    await press(result.current.handleSubmit);
    expect(server.paymentCalls).toEqual(["job-1", "job-1"]);
    expect(server.photoRemovals, "the photos of a job the gift card paid for were removed").toEqual([]);
    expect(server.deletes, "a DELETE was sent for a paid job").toBe(0);
    expect(server.undos, "the haul-away of a paid job was undone").toEqual([]);
    expect(server.jobs).toHaveLength(1);
    expect(errorToasts(), "the poster was told payment failed for a paid job").toEqual([]);
    expect(redirected(p), "it never went on to the success page").toBe(true);
  });

  it("an ordinary job takes the same path (the gift card funds it inside the lost call)", async () => {
    const p = params({ giftCardId: "gift-1" });
    const { result } = renderHook(() => useJobSubmit(p));
    server.loseNextPaymentResponse = true;
    server.fundOnPayment = true;
    await press(result.current.handleSubmit);
    vi.mocked(toast.error).mockClear();
    safeStorage.removeItem("helpr_last_job_submit");
    await press(result.current.handleSubmit);
    expect(server.photoRemovals).toEqual([]);
    expect(server.deletes).toBe(0);
    expect(server.jobs).toHaveLength(1);
    expect(errorToasts()).toEqual([]);
    expect(redirected(p)).toBe(true);
  });

  it("an edit between presses never removes the photos of the earlier job when it was funded meanwhile", async () => {
    let title = "Mow the back lawn";
    const { result, rerender } = renderHook(() => useJobSubmit(params({ giftCardId: "gift-1", title })));
    server.loseNextPaymentResponse = true;
    server.fundOnPayment = true;
    await press(result.current.handleSubmit);
    server.fundOnPayment = false;
    title = "Mow the front lawn too";
    rerender();
    safeStorage.removeItem("helpr_last_job_submit");
    await press(result.current.handleSubmit);
    expect(server.photoRemovals, "the stale (funded) job's photos were removed").not.toContain("job-1");
    expect(server.jobs.find((r) => r.id === "job-1"), "the funded job was deleted").toBeTruthy();
  });

  it("a refusal for a job that holds no money still removes it, as before", async () => {
    server.refuseNextPayment = true;
    const { result } = renderHook(() => useJobSubmit(params()));
    await press(result.current.handleSubmit);
    expect(server.photoRemovals).toEqual(["job-1"]);
    expect(server.jobs).toHaveLength(0);
    expect(errorToasts().slice(-1)[0]).toMatch(/^Couldn't start payment: /);
  });
});
