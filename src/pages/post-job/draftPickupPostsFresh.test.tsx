// F25 (app audit 2026-10-28, part 4 half 2): "Pick up your draft" re-asked the
// category, and posting the picked-up draft made a SECOND job row: the job the
// draft had been sent to checkout for stayed behind, never paid. Lead decision:
// the draft opens at Details (as a template and the AI builder do), and on
// posting the never-paid earlier job is removed (cleanupOrphanJob) and the
// edited job is posted fresh; the old row is never reused.
//
// Harness: a fake jobs table with the poster's DELETE policy (20260903055308:
// open, and unpaid with no checkout session, or abandoned) and create-payment's
// session stamp. Red first (2026-10-28) against origin/main 6b3206e2bd: the
// expired draft job stayed (2 rows), and the draft card's tap never set page 2.
//
// @mutate src/pages/post-job/useJobSubmit.ts |       if (priorDraftJob && (await cleanupOrphanJob(priorDraftJob, { keptIsExpected: true }))) { |       if (false) {
// @mutate src/pages/post-job/EntryChoice.tsx |             if (form.loadDraftAndContinue()) form.setFormPage(2); |             form.loadDraftAndContinue();
// @mutate src/pages/post-job/useJobEntry.ts |     return !!draft.category; |     return false;
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ComponentProps } from "react";

type Row = Record<string, unknown>;
const POSTER = "poster-1";
const server = vi.hoisted(() => ({
  jobs: [] as Row[],
  nextId: 1,
  jobInserts: 0,
  deletes: 0,
  paymentCalls: [] as string[],
  photoRemovals: [] as string[],
}));

// JA-41: the entry screen now holds the group grid, whose "suggest a category" link reads a switch.
vi.mock("@/components/SuggestCategory", () => ({ SuggestCategory: () => null }));
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
        const stored = { id: `job-${server.nextId++}`, status: "open", payment_status: "unpaid", stripe_session_id: null, ...payload! };
        server.jobs.push(stored);
        return { data: { id: stored.id }, error: null };
      }
      if (op === "delete") {
        server.deletes += 1;
        // The poster's DELETE policy (20260903055308).
        const hit = match().filter((r) =>
          r.customer_id === POSTER && r.status === "open" &&
          ((r.payment_status === "unpaid" && r.stripe_session_id == null) || r.payment_status === "abandoned"));
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
      in: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => chain,
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
          if (job) job.stripe_session_id = `cs_test_${server.paymentCalls.length}`;
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
// EntryChoice's data reads, all settled: the column renders its real cards.
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: POSTER }, profile: null, loading: false }) }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ useRecentPostedJobs: () => [], usePostedBefore: () => false }));
vi.mock("@/hooks/useSpendableGiftCards", () => ({ useSpendableGiftCards: () => ({ userId: POSTER, ids: [], settled: true }) }));
vi.mock("./useDraftCheckoutState", () => ({ useDraftCheckout: () => ({ state: "none", settled: true }) }));
vi.mock("./OfferToSavedHelpr", () => ({
  useSavedHelpersLite: () => ({ data: [], fetchStatus: "idle", status: "success" }),
  OfferToSavedHelpr: () => null,
}));
vi.mock("@/components/postjob/AiJobBuilder", () => ({ AiJobBuilder: () => null }));
vi.mock("@/hooks/useArrivalGate", () => ({ useArrivalGate: (ready: boolean) => ready }));

import { safeStorage } from "@/lib/safeStorage";
import { DRAFT_CHECKOUT_JOB_KEY } from "@/hooks/useDraftJob";
import { useJobSubmit, type UseJobSubmitParams } from "./useJobSubmit";
import { useJobEntry, type UseJobEntryParams } from "./useJobEntry";
import { EntryChoice } from "./EntryChoice";

function params(overrides: Partial<UseJobSubmitParams> = {}): UseJobSubmitParams {
  return {
    saving: false, setSaving: vi.fn(), setRedirecting: vi.fn(), setStep: vi.fn(), setConfirmed: vi.fn(), flushDraft: vi.fn(),
    title: "Clean the kitchen", description: "Counters, floor and the stove top.", category: "cleaning",
    streetAddress: "1 Main St", city: "Baton Rouge", addrState: "LA", zipCode: "70801", parish: "East Baton Rouge",
    dateNeeded: "2026-11-01", startTime: "09:00", isFlexibleSchedule: false, estimatedHours: "2", budget: "45",
    specialRequirements: "", isRecurring: false, recurrenceInterval: "", recurrenceEndDate: "", recurrenceDays: [], recurrenceWeeks: 0,
    isGroupJob: false, helpersNeeded: "1", isUrgent: false, urgentFee: "", salesTaxRate: 0,
    offerToHelperId: null, offerResponseHours: 24, credentialTier: 0, requirePhotoProof: true,
    includeMaterials: false, materialsNote: "", saveCardForFuture: false, giftCardId: null,
    uploadAndAttachPhotos: async () => {}, uploadAndAttachScopeVideo: async () => {},
    ...overrides,
  };
}

/** The job the kept draft was sent to checkout for, then backed out of. */
const priorDraftJob = (fields: Row) => {
  server.jobs.push({ id: "draft-job", customer_id: POSTER, status: "open", payment_status: "unpaid", stripe_session_id: null, ...fields });
  safeStorage.setItem(DRAFT_CHECKOUT_JOB_KEY, "draft-job");
};
const post = async () => {
  const { result } = renderHook(() => useJobSubmit(params()));
  await act(async () => { await result.current.handleSubmit(); });
};

beforeEach(() => {
  cleanup();
  server.jobs = []; server.nextId = 1; server.jobInserts = 0; server.deletes = 0; server.paymentCalls = []; server.photoRemovals = [];
  safeStorage.removeItem("helpr_last_job_submit");
  safeStorage.removeItem(DRAFT_CHECKOUT_JOB_KEY);
});

describe("F25: posting a picked-up draft never leaves a second job", () => {
  it("the earlier job, its checkout expired and never paid, is removed; the edited job is posted fresh", async () => {
    priorDraftJob({ stripe_session_id: null });
    await post();
    // Inventory floor: the post really ran (a harness that never inserts would pass the rest vacuously).
    expect(server.jobInserts).toBeGreaterThan(0);
    expect(server.jobs.map((r) => r.id), "the never-paid earlier job was left as a second job").toEqual(["job-1"]);
    expect(server.photoRemovals).toEqual(["draft-job"]);
    expect(server.paymentCalls, "the old row was reused instead of a fresh post").toEqual(["job-1"]);
    expect(safeStorage.getItem(DRAFT_CHECKOUT_JOB_KEY)).toBe("job-1");
  });

  it("an abandoned earlier job is removed too", async () => {
    priorDraftJob({ payment_status: "abandoned", stripe_session_id: "cs_old" });
    await post();
    expect(server.jobs.map((r) => r.id)).toEqual(["job-1"]);
  });

  it("an earlier job whose checkout is still live is kept whole (it may be paid any moment); the new one is still fresh", async () => {
    priorDraftJob({ stripe_session_id: "cs_live" });
    await post();
    expect(server.deletes, "a DELETE was sent for a job with a live checkout").toBe(0);
    expect(server.photoRemovals).toEqual([]);
    expect(server.jobs.map((r) => r.id)).toEqual(["draft-job", "job-1"]);
    expect(server.paymentCalls).toEqual(["job-1"]);
  });

  it("a funded earlier job is never touched", async () => {
    priorDraftJob({ payment_status: "escrow", stripe_session_id: "cs_paid" });
    await post();
    expect(server.deletes).toBe(0);
    expect(server.photoRemovals).toEqual([]);
    expect(server.jobs.find((r) => r.id === "draft-job")?.payment_status).toBe("escrow");
  });
});

describe("F25: 'Pick up your draft' opens at Details, not the category screen", () => {
  type Form = ComponentProps<typeof EntryChoice>["form"];
  const renderEntry = (draftCategory: string) => {
    const setFormPage = vi.fn();
    const setStep = vi.fn();
    const noop = () => {};
    const entryParams = new Proxy({ draft: { category: draftCategory, location: "", title: "Clean the kitchen" }, setStep } as unknown as UseJobEntryParams, {
      get: (t, k) => (k in t ? (t as unknown as Record<string | symbol, unknown>)[k] : noop),
    });
    const { result } = renderHook(() => useJobEntry(entryParams));
    const form = {
      draftLoaded: true, hasDraft: true, openJobCount: 0, entryPanel: null,
      loadDraftAndContinue: result.current.loadDraftAndContinue, setFormPage, startFresh: vi.fn(), setEntryPanel: vi.fn(),
    } as unknown as Form;
    render(<MemoryRouter initialEntries={["/post-job"]}><EntryChoice form={form} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Pick up your draft/ }));
    return { setFormPage, setStep };
  };

  it("a draft with its category picked lands on Details (form page 2)", () => {
    const { setFormPage, setStep } = renderEntry("cleaning");
    expect(setStep).toHaveBeenCalledWith("form");
    expect(setFormPage, "the picked-up draft re-asked the category").toHaveBeenCalledWith(2);
  });

  it("a draft saved before a category was picked starts at the category screen", () => {
    const { setFormPage } = renderEntry("");
    expect(setFormPage).not.toHaveBeenCalled();
  });
});
