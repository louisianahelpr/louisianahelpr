/**
 * Q72 "verify the events fire in a journey test": every KEY event the
 * analytics-freshness monitor watches (scripts/lib/analyticsFreshness.mjs
 * KEY_EVENTS) is driven here through the REAL code path that emits it, and the
 * test asserts the event reached the analytics NETWORK boundary.
 *
 * What is real: the page/hook/component that emits, `@/lib/analytics` (track,
 * its queue and its flush), `@/lib/jobCompletedEvent`, ppoAttribution.
 * What is mocked: only network boundaries -- `@/integrations/supabase/client`
 * (a programmable supabase-js stand-in answering realistic success shapes),
 * `@/lib/restInsert` (the analytics write itself: `postRows`, whose
 * `rowsFor(true)` body is captured for `analytics_events`), the HIBP password
 * lookup, geocoding, PostHog, the Stripe-eligibility probe -- plus non-network
 * UI side effects (toasts, haptics, confetti, success moment, error logger,
 * notifications, push nudges, external-URL open).
 *
 * The monitor answers "did analytics stop in prod"; this answers "does the
 * code still send it". A key event whose firing test is missing fails the
 * inventory test at the bottom (two-way against KEY_EVENTS).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const h = vi.hoisted(() => {
  type Op = { m: string; a: unknown[] };
  type FromCall = { table: string; ops: Op[] };
  type Result = { data: unknown; error: unknown; count?: number | null };
  type Terminal = "then" | "single" | "maybeSingle";

  const state = {
    /** Rows `analytics_events` would have received (the `asUser` body). */
    analyticsRows: [] as Array<{ event: string; properties: Record<string, unknown> }>,
    fromCalls: [] as FromCall[],
    /** Per-test override for table reads/writes; undefined falls to the default. */
    fromHandler: null as null | ((c: FromCall, t: Terminal) => Result | undefined),
    rpcHandler: null as null | ((name: string, args: unknown) => Result | undefined),
    invokeCalls: [] as Array<{ name: string; body: unknown }>,
    invokeHandler: null as null | ((name: string, body: unknown) => Result | undefined),
    signUpCalls: 0,
  };

  const USER_ID = "10000000-0000-4000-8000-0000000000aa";

  function defaultFrom(c: FromCall, t: Terminal): Result {
    const sel = c.ops.find((o) => o.m === "select");
    const opts = sel?.a[1] as { head?: boolean } | undefined;
    if (opts?.head) return { data: null, error: null, count: 1 };
    const isWrite = c.ops.some((o) => ["insert", "update", "delete", "upsert"].includes(o.m));
    if (t === "single" || t === "maybeSingle") return { data: { id: "row-1" }, error: null };
    if (isWrite) return { data: [{ id: "row-1" }], error: null };
    return { data: [], error: null, count: 0 };
  }

  function chain(table: string) {
    const call: FromCall = { table, ops: [] };
    state.fromCalls.push(call);
    const settle = (t: Terminal) => Promise.resolve(state.fromHandler?.(call, t) ?? defaultFrom(call, t));
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settle("then").then(res, rej);
          }
          if (prop === "single" || prop === "maybeSingle") return () => settle(prop);
          if (typeof prop === "symbol") return undefined;
          return (...a: unknown[]) => {
            call.ops.push({ m: prop, a });
            return proxy;
          };
        },
      },
    );
    return proxy;
  }

  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signUp: async () => {
        state.signUpCalls += 1;
        return { data: { user: { id: USER_ID }, session: null }, error: null };
      },
    },
    from: (table: string) => chain(table),
    rpc: async (name: string, args: unknown) => {
      const r = state.rpcHandler?.(name, args);
      if (r) return r;
      if (name === "get_parish_for_zip") return { data: "Orleans", error: null };
      if (name === "apply_to_job") return { data: "app-new-1", error: null };
      return { data: null, error: null };
    },
    functions: {
      invoke: async (name: string, opts?: { body?: unknown }) => {
        state.invokeCalls.push({ name, body: opts?.body });
        const r = state.invokeHandler?.(name, opts?.body);
        if (r) return r;
        if (name === "complete-signup") return { data: { success: true, referralRecorded: false }, error: null };
        if (name === "create-payment") return { data: { url: "https://checkout.stripe.test/session" }, error: null };
        return { data: {}, error: null };
      },
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: "p" }, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://example.test/p.png" } }),
      }),
    },
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => {} };
      return ch;
    },
    removeChannel: () => {},
  };

  return { state, supabase, USER_ID };
});

// ── Network boundaries ──────────────────────────────────────────────────────
vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/restInsert", () => ({
  postRows: async (table: string, _cols: readonly string[], rowsFor: (asUser: boolean) => unknown[]) => {
    if (table === "analytics_events") {
      h.state.analyticsRows.push(...(rowsFor(true) as Array<{ event: string; properties: Record<string, unknown> }>));
    }
    return 201;
  },
}));
vi.mock("@/lib/posthog", () => ({ captureEvent: vi.fn(), initPostHog: vi.fn() }));
vi.mock("@/lib/hibpCheck", () => ({ checkPasswordPwned: async () => 0 }));
vi.mock("@/lib/geocode", () => ({
  geocodeAddress: async () => null,
  composeJobAddress: () => "1 Main St, New Orleans, LA 70112",
}));
vi.mock("@/hooks/useStripeConnectCheck", () => ({
  useStripeConnectCheck: () => ({ checkHelperAwardEligibility: async () => ({ ok: true }) }),
}));

// ── Non-network UI side effects ─────────────────────────────────────────────
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn(),
  hapticSelection: vi.fn(), hapticHeavy: vi.fn(), hapticWarning: vi.fn(),
}));
vi.mock("@/lib/successMoment", () => ({ fireSuccessMoment: vi.fn() }));
vi.mock("@/lib/celebrate", () => ({ maybeCelebrate: () => Promise.resolve() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/pushPermissionNudge", () => ({ usePushPermissionNudge: () => vi.fn() }));
vi.mock("@/hooks/useNotificationPermissionPrompt", () => ({ recordJobActionForPermissionPrompt: vi.fn() }));
vi.mock("@/lib/inAppReview", () => ({ maybeRequestInAppReview: vi.fn() }));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: vi.fn(async () => undefined) }));
vi.mock("@/pages/postjob/firstPostConfetti", () => ({ maybeFireFirstPostConfetti: vi.fn() }));

import { KEY_EVENTS } from "../../scripts/lib/analyticsFreshness.mjs";
import { __resetJobCompletedForTests } from "@/lib/jobCompletedEvent";
import Signup from "@/pages/Signup";
import PaymentSuccess from "@/pages/PaymentSuccess";
import { ReviewForm } from "@/components/reviewPanel/ReviewForm";
import { useJobSubmit, type UseJobSubmitParams } from "@/pages/postjob/useJobSubmit";
import { useApplyFlow } from "@/pages/dashboard/useApplyFlow";
import { useActivityActions } from "@/pages/activity/useActivityActions";
import type { Application, Job } from "@/components/activity/activityConstants";

// ── Analytics boundary helpers ──────────────────────────────────────────────

/** Force analytics.ts's page-hide flush (the 1.5 s timer's other trigger). */
function flushAnalytics() {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
  delete (document as unknown as Record<string, unknown>).visibilityState;
}

const rowsFor = (event: string) => h.state.analyticsRows.filter((r) => r.event === event);

/** Wait until `event` reached the analytics_events write, flushing as we go. */
async function expectSent(event: string, jobId?: string) {
  await waitFor(() => {
    flushAnalytics();
    const rows = rowsFor(event);
    expect(rows.map((r) => r.event), `${event} never reached analytics_events`).toContain(event);
    if (jobId !== undefined) expect(rows.map((r) => r.properties.job_id)).toContain(jobId);
  }, { timeout: 4000 });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const USER = { id: h.USER_ID } as unknown as NonNullable<Parameters<typeof useApplyFlow>[0]["user"]>;

// ── Drivers: one per key event, each runs the real emitting path ─────────────

async function driveSignup(): Promise<string | undefined> {
  render(
    <MemoryRouter initialEntries={["/signup"]}>
      <Signup />
    </MemoryRouter>,
  );
  // Step 1: credentials + the two required boxes.
  fireEvent.change(document.getElementById("email")!, { target: { value: "keyevents.test@example.com" } });
  fireEvent.change(document.getElementById("password")!, { target: { value: "Str0ng!Passw0rd#" } });
  fireEvent.click(document.getElementById("policies")!);
  fireEvent.click(document.getElementById("age-confirm")!);
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  // Step 2: about you.
  await waitFor(() => expect(document.getElementById("firstName")).not.toBeNull());
  const photo = new File([new Uint8Array([137, 80, 78, 71])], "me.png", { type: "image/png" });
  fireEvent.change(document.getElementById("avatar")!, { target: { files: [photo] } });
  fireEvent.change(document.getElementById("firstName")!, { target: { value: "Kay" } });
  fireEvent.change(document.getElementById("lastName")!, { target: { value: "Events" } });
  fireEvent.change(document.getElementById("phone")!, { target: { value: "5045550123" } });
  fireEvent.change(document.getElementById("location")!, { target: { value: "New Orleans" } });
  fireEvent.change(document.getElementById("zipCode")!, { target: { value: "70112" } });
  // DOB through the real wheel picker: open it, pick a year.
  fireEvent.click(document.getElementById("dob")!);
  const yearWheel = await screen.findByRole("listbox", { name: "Year" });
  const year = Array.from(yearWheel.querySelectorAll<HTMLElement>("[role=option]")).find((o) => o.textContent === "1990")!;
  fireEvent.click(year);
  fireEvent.click(await screen.findByRole("button", { name: /create account/i }));
  await waitFor(() => expect(h.state.invokeCalls.some((c) => c.name === "complete-signup")).toBe(true), { timeout: 4000 });
  return undefined;
}

async function driveJobPosted(): Promise<string> {
  h.state.fromHandler = (c, t) => {
    if (c.table === "profiles" && t === "single") return { data: { idv_status: "verified", idv_failure_reason: null }, error: null };
    if (c.table === "jobs" && t === "single" && c.ops.some((o) => o.m === "insert")) return { data: { id: "job-posted-1" }, error: null };
    return undefined;
  };
  const params: UseJobSubmitParams = {
    saving: false, setSaving: vi.fn(), setRedirecting: vi.fn(), setStep: vi.fn(), setConfirmed: vi.fn(),
    setIdvStatus: vi.fn(), setIdvFailureReason: vi.fn(), setIdvDialogOpen: vi.fn(), clearDraft: vi.fn(),
    title: "Mow the lawn", description: "Front and back yard, about an hour.", category: "yard_work",
    selectedPetIds: [], streetAddress: "1 Main St", city: "New Orleans", addrState: "LA", zipCode: "70112",
    parish: "Orleans", dateNeeded: "2099-01-01", startTime: "09:00", isFlexibleSchedule: false, estimatedHours: "1",
    budget: "60", specialRequirements: "", isRecurring: false, recurrenceInterval: "", recurrenceEndDate: "",
    recurrenceDays: [], recurrenceWeeks: 0, isGroupJob: false, helpersNeeded: "1", isUrgent: false, urgentFee: "",
    platformFee: null, salesTaxRate: 0, offerToHelperId: null, offerResponseHours: 24, credentialTier: 0,
    requirePhotoProof: true, includeMaterials: false, materialsNote: "", saveCardForFuture: false, giftCardId: null,
    uploadAndAttachPhotos: vi.fn(async () => undefined), uploadAndAttachScopeVideo: vi.fn(async () => undefined),
  };
  const { result } = renderHook(() => useJobSubmit(params), { wrapper });
  await act(async () => { await result.current.handleSubmit(); });
  return "job-posted-1";
}

async function driveJobApplied(): Promise<string> {
  const { result } = renderHook(() => useApplyFlow({ user: USER, allJobs: [] }), { wrapper });
  act(() => { result.current.handleApplyConfirm("job-applied-1"); });
  await waitFor(() => expect(result.current.applyLoading).toBe(false));
  return "job-applied-1";
}

function renderActivity(postedJobs: Job[] = []) {
  return renderHook(
    () =>
      useActivityActions({
        user: USER,
        postedJobs,
        appliedApps: [],
        refresh: async () => undefined,
        setStatusFilter: vi.fn(),
        helperNames: {},
        completedJobMeta: {},
      }),
    { wrapper },
  );
}

async function driveJobAccepted(): Promise<string> {
  const { result } = renderActivity();
  const app = { id: "app-accept-1", job_id: "job-accepted-1", helper_id: h.USER_ID } as unknown as Application;
  await act(async () => { await result.current.handleHelperResponse(app, true); });
  return "job-accepted-1";
}

async function drivePaymentMade(): Promise<string> {
  const JOB = "job-paid-1";
  h.state.fromHandler = (c, t) =>
    c.table === "jobs" && t === "maybeSingle"
      ? { data: { budget: 120, category: "cleaning", payment_status: "escrow" }, error: null }
      : undefined;
  render(
    <MemoryRouter initialEntries={[`/payment-success?job_id=${JOB}`]}>
      <PaymentSuccess />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: /payment authorized/i });
  return JOB;
}

const POSTED_JOB = { id: "job-done-1", helper_id: "helper-1" } as unknown as Job;
const release = (data: Record<string, unknown>) => {
  h.state.invokeHandler = (name, body) =>
    name === "create-payment" && (body as { action?: string })?.action === "release" ? { data, error: null } : undefined;
};

async function completeOnce(result: { current: ReturnType<typeof useActivityActions> }, jobId: string) {
  const before = h.state.invokeCalls.length;
  await act(async () => { await result.current.completeJob(jobId); });
  expect(h.state.invokeCalls.length).toBeGreaterThan(before); // the release really went out
}

async function driveJobCompleted(): Promise<string> {
  release({ success: true, bothDone: true, helperPayout: 42, platformFee: 5 });
  const { result } = renderActivity([POSTED_JOB]);
  await completeOnce(result, POSTED_JOB.id);
  return POSTED_JOB.id;
}

async function driveReviewLeft(): Promise<string> {
  const JOB = "job-reviewed-1";
  render(
    <MemoryRouter>
      <ReviewForm open onClose={vi.fn()} jobId={JOB} revieweeId="helper-1" revieweeName="Hallie H." />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("radio", { name: "Overall 4 stars" }));
  fireEvent.click(screen.getByRole("button", { name: /submit review/i }));
  await waitFor(() => expect(h.state.fromCalls.some((c) => c.table === "reviews" && c.ops.some((o) => o.m === "insert"))).toBe(true));
  return JOB;
}

/**
 * Event -> the real path that emits it. The inventory test holds these keys
 * equal to KEY_EVENTS both ways; each driver returns the job_id the event must
 * carry (undefined when the event has none).
 */
const DRIVERS: Record<string, () => Promise<string | undefined>> = {
  signup_completed: driveSignup,
  job_posted: driveJobPosted,
  job_applied: driveJobApplied,
  job_accepted: driveJobAccepted,
  payment_made: drivePaymentMade,
  job_completed: driveJobCompleted,
  review_left: driveReviewLeft,
};

let createObjectURLBefore: typeof URL.createObjectURL | undefined;

beforeEach(() => {
  flushAnalytics(); // drain anything a previous test left queued
  h.state.analyticsRows.length = 0;
  h.state.fromCalls.length = 0;
  h.state.invokeCalls.length = 0;
  h.state.fromHandler = null;
  h.state.rpcHandler = null;
  h.state.invokeHandler = null;
  h.state.signUpCalls = 0;
  __resetJobCompletedForTests();
  localStorage.clear();
  sessionStorage.clear();
  createObjectURLBefore = URL.createObjectURL;
  URL.createObjectURL = () => "blob:keyevents";
});

afterEach(() => {
  URL.createObjectURL = createObjectURLBefore as typeof URL.createObjectURL;
});

describe("every KEY analytics event fires from its real code path (Q72)", () => {
  for (const [event, drive] of Object.entries(DRIVERS)) {
    it(`${event} reaches analytics_events`, async () => {
      const jobId = await drive();
      await expectSent(event, jobId);
    }, 15_000);
  }
});

describe("job_completed counts a completion once", () => {
  it("a duplicate release response ({bothDone, alreadyReleased}) emits nothing", async () => {
    release({ success: true, bothDone: true, alreadyReleased: true, helperPayout: 0, platformFee: 0 });
    const { result } = renderActivity([POSTED_JOB]);
    await completeOnce(result, POSTED_JOB.id);
    flushAnalytics();
    await new Promise((r) => setTimeout(r, 30));
    flushAnalytics();
    expect(rowsFor("job_completed")).toEqual([]);
  });

  it("two fresh completions of the same job emit exactly once", async () => {
    release({ success: true, bothDone: true, helperPayout: 42, platformFee: 5 });
    const { result } = renderActivity([POSTED_JOB]);
    await completeOnce(result, POSTED_JOB.id);
    await completeOnce(result, POSTED_JOB.id);
    await expectSent("job_completed", POSTED_JOB.id);
    await new Promise((r) => setTimeout(r, 30));
    flushAnalytics();
    expect(rowsFor("job_completed")).toHaveLength(1);
  });
});

describe("inventory", () => {
  it("covers exactly the KEY_EVENTS the freshness monitor watches (two-way)", () => {
    const monitored = KEY_EVENTS.map((k) => k.event).sort();
    const covered = Object.keys(DRIVERS).sort();
    expect(monitored.length).toBeGreaterThan(6);
    expect(covered.filter((e) => !monitored.includes(e)), "firing test for a non-key event").toEqual([]);
    expect(monitored.filter((e) => !covered.includes(e)), "key event with no firing test").toEqual([]);
  });
});

// Shown able to fail: each line deletes one event's emit site; its test above
// goes red (the event never reaches analytics_events).
// @mutate src/pages/Signup.tsx | track(AhaEvent.SignupCompleted, { | void ({
// @mutate src/pages/postjob/useJobSubmit.ts | track(AhaEvent.JobPosted, { | void ({
// @mutate src/pages/dashboard/useApplyFlow.ts | track(AhaEvent.JobApplied, { job_id: vars.jobId }); | void 0;
// @mutate src/pages/activity/activityActions/useOfferHandlers.ts | track(AhaEvent.JobAccepted, { job_id: app.job_id, ...ppoProps }); | void 0;
// @mutate src/pages/PaymentSuccess.tsx | track(AhaEvent.PaymentMade, { job_id: jobId, ...ppoProps }); | void 0;
// @mutate src/pages/activity/activityActions/useLifecycleHandlers.ts | trackJobCompleted(jobId, data, "activity", user?.id); | void 0;
// @mutate src/lib/jobCompletedEvent.ts | if (emitted.has(jobId)) return false; | void 0;
// @mutate src/components/reviewPanel/ReviewForm.tsx | track(AhaEvent.ReviewLeft, { job_id: jobId, rating }); | void 0;
