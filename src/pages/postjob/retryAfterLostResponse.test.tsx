// Q267 + Q270 — a retried job post must be ONE job, and a dropped
// connection must never show its raw error text.
//
// Q267 (a): the jobs INSERT reached the server and landed; only its response
// was lost, so the poster saw a failure and pressed Post again. With no key
// on the INSERT the second press wrote a SECOND job.
// Q267 (b): the job landed and create-payment ran, and ITS response was lost.
// The old error path deleted the job (refused, in prod, once create-payment
// has stamped a session on it) and the retry posted a NEW job with a new
// Checkout Session, leaving the first one live.
// Q270: the INSERT failed on the wire and the toast read the transport's own
// words ("TypeError: Failed to fetch").
//
// e2e/slow-network/slow-network.spec.ts `post · drop` and `pay-start · drop`
// drive these against prod; this is the same scenario at the client-write
// layer, against a fake `jobs` table that enforces exactly the migration's
// UNIQUE (customer_id, client_request_id) WHERE client_request_id IS NOT NULL
// (20260923181707_idempotent_job_post_and_message_send.sql).
//
// Red first (2026-09-23), against the pre-fix useJobSubmit.ts: 6 of 7 tests
// fail — (a) 2 jobs, (b) 2 jobs and "Couldn't start payment: …" for a lost
// response, (c) 2 jobs, Q270 the toast was "TypeError: Failed to fetch". The
// 7th pins the unchanged path (a REFUSED payment still deletes the job).
//
// @mutate src/pages/postjob/useJobSubmit.ts | ...(withExtras ? { client_request_id: attempt.key } : {}), | ...({}),
// @mutate src/pages/postjob/useJobSubmit.ts | if (error && (error as { code?: string }).code === "23505") { | if (false) {
// @mutate src/pages/postjob/useJobSubmit.ts | const outcomeUnknown = !paymentData?.error && isNetworkFailure(paymentError); | const outcomeUnknown = false;
// @mutate src/pages/postjob/useJobSubmit.ts | if (attempt.jobId) { | if (false) {
// @mutate src/pages/postjob/useJobSubmit.ts | await openExternalUrl(paymentUrl);\n      // Handed off: | attemptRef.current = null;\n      await openExternalUrl(paymentUrl);\n      // Handed off:
// @mutate src/pages/postjob/useJobSubmit.ts | const sig = JSON.stringify(sigFields); | const sig = JSON.stringify(buildPayload({ withExtras: true }));
// @mutate src/pages/postjob/useJobSubmit.ts | ? CONNECTION_TROUBLE_COPY\n              : userFacingError( | ? String(error?.message)\n              : userFacingError(
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
        const stored = { id: `job-${server.nextId++}`, payment_status: "unpaid", stripe_session_id: null, ...row };
        server.jobs.push(stored);
        if (server.loseNextJobInsertResponse) {
          server.loseNextJobInsertResponse = false;
          return { data: null, error: FETCH_FAIL };
        }
        return { data: { id: stored.id }, error: null };
      }
      if (op === "delete") {
        // The prod DELETE policy (20260903055308): an unpaid job is deletable
        // only while no Checkout Session has been stamped on it.
        const hit = match().filter((r) => r.stripe_session_id == null);
        server.jobs = server.jobs.filter((r) => !hit.includes(r));
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      if (op === "update") return { data: match().map((r) => ({ id: r.id })), error: null };
      const hit = match();
      return head ? { data: null, error: null, count: hit.length } : { data: hit[0] ? { id: hit[0].id } : null, error: null };
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
          if (server.refuseNextPayment) {
            server.refuseNextPayment = false;
            return { data: { error: "Job budgets run from $25 to $5,000." }, error: null };
          }
          // create-payment mints a session and stamps it on the job before it
          // answers, so a LOST response still leaves the session behind.
          if (job) job.stripe_session_id = `cs_test_${server.paymentCalls.length}`;
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
vi.mock("@/lib/storageCleanup", () => ({ removeJobPhotos: async () => {} }));

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
    setIdvStatus: vi.fn(),
    setIdvFailureReason: vi.fn(),
    setIdvDialogOpen: vi.fn(),
    clearDraft: vi.fn(),
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
    platformFee: 10,
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
  vi.mocked(toast.error).mockClear();
  vi.mocked(openExternalUrl).mockClear();
  safeStorage.removeItem("helpr_last_job_submit");
});

describe("Q267 (a): the INSERT landed, its response was lost, the poster presses again", () => {
  it("holds ONE job and takes the poster to checkout for it", async () => {
    const { result } = renderHook(() => useJobSubmit(params()));
    server.loseNextJobInsertResponse = true;
    await press(result.current.handleSubmit);
    expect(server.jobs).toHaveLength(1); // it landed
    expect(server.paymentCalls).toEqual([]);

    await press(result.current.handleSubmit);
    expect(server.jobInserts).toBe(2); // the retry really re-sent the INSERT
    expect(server.jobs, "a retry after a lost INSERT response posted a second job").toHaveLength(1);
    expect(server.paymentCalls).toEqual(["job-1"]);
    expect(openExternalUrl).toHaveBeenCalledWith("https://checkout.stripe.com/c/job-1");
  });

  it("two separate posts of identical details are still two jobs (the key is per attempt, not per content)", async () => {
    const first = renderHook(() => useJobSubmit(params()));
    await press(first.result.current.handleSubmit);
    safeStorage.removeItem("helpr_last_job_submit"); // past the 30s cooldown
    const second = renderHook(() => useJobSubmit(params()));
    await press(second.result.current.handleSubmit);
    expect(server.jobs).toHaveLength(2);
    expect(new Set(server.jobs.map((j) => j.client_request_id)).size).toBe(2);
  });
});

describe("Q267 (b): the job landed, create-payment's response was lost, the poster presses again", () => {
  it("pays for the SAME job, never posts a second one", async () => {
    const { result } = renderHook(() => useJobSubmit(params()));
    server.loseNextPaymentResponse = true;
    await press(result.current.handleSubmit);
    expect(server.jobs).toHaveLength(1);
    expect(errorToasts().slice(-1)[0]).toMatch(/Connection trouble/);

    await press(result.current.handleSubmit);
    expect(server.jobs, "the retry posted a NEW job behind a new Checkout Session").toHaveLength(1);
    expect(server.paymentCalls, "the retry paid for a job the first press never created").toEqual(["job-1", "job-1"]);
    expect(openExternalUrl).toHaveBeenCalledWith("https://checkout.stripe.com/c/job-1");
    // Only the payment hand-off is retried: re-running the INSERT would also
    // re-run everything after it (pet links, photo uploads, funnel events).
    expect(server.jobInserts, "the retry re-ran the job INSERT and its follow-ups").toBe(1);
    expect(uploads).toEqual(["job-1"]);
  });

  it("a payment the server REFUSED still removes the job, as before", async () => {
    const { result } = renderHook(() => useJobSubmit(params()));
    server.refuseNextPayment = true;
    await press(result.current.handleSubmit);
    expect(server.jobs).toHaveLength(0);
    expect(errorToasts().slice(-1)[0]).toMatch(/^Couldn't start payment: Job budgets run/);
  });

  it("an edit between presses is a new post: the stale job is removed, the new one paid for", async () => {
    let p = params();
    const { result, rerender } = renderHook(() => useJobSubmit(p));
    server.loseNextJobInsertResponse = true;
    await press(result.current.handleSubmit);
    expect(server.jobs).toHaveLength(1);
    p = params({ budget: "95" });
    rerender();
    await press(result.current.handleSubmit);
    expect(server.jobs).toHaveLength(1);
    expect(server.jobs[0].budget).toBe(95);
    expect(server.paymentCalls).toEqual([server.jobs[0].id]);
  });
});

describe("Q267 (d): the checkout redirect itself throws", () => {
  it("the next press pays for the SAME job instead of posting a second one", async () => {
    const { result } = renderHook(() => useJobSubmit(params()));
    vi.mocked(openExternalUrl).mockRejectedValueOnce(new Error("Browser.open failed"));
    await press(result.current.handleSubmit);
    expect(server.jobs).toHaveLength(1);
    safeStorage.removeItem("helpr_last_job_submit"); // past the 30s cooldown
    await press(result.current.handleSubmit);
    expect(server.jobs, "a failed redirect dropped the attempt key; the retry posted a second job").toHaveLength(1);
    expect(server.paymentCalls).toEqual(["job-1", "job-1"]);
    expect(server.jobInserts).toBe(1);
  });
});

describe("Q267 (c): a job starting within the hour (expires_at floored to now + 1h)", () => {
  it("a retry a minute later is still the SAME attempt, so it still pays for the same job", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-01T13:30:00Z")); // 08:30 in Louisiana
      const { result } = renderHook(() => useJobSubmit(params({ dateNeeded: "2026-10-01", startTime: "09:00" })));
      server.loseNextPaymentResponse = true;
      await press(result.current.handleSubmit);
      expect(server.jobs).toHaveLength(1);
      vi.setSystemTime(new Date("2026-10-01T13:31:00Z"));
      await press(result.current.handleSubmit);
      expect(server.jobs, "a retry within the hour read as an edit and posted again").toHaveLength(1);
      expect(server.paymentCalls).toEqual(["job-1", "job-1"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Q270: a network failure on Post shows plain connection copy", () => {
  it("never the raw transport text", async () => {
    const { result } = renderHook(() => useJobSubmit(params()));
    server.failNextJobInsertOnWire = true;
    await press(result.current.handleSubmit);
    expect(server.jobs).toHaveLength(0);
    const shown = errorToasts();
    expect(shown).toHaveLength(1);
    expect(shown[0], "the post toast showed the transport's raw error").not.toMatch(/TypeError|Failed to fetch/);
    expect(shown[0]).toBe("Connection trouble. Check your signal and try again.");
  });
});
