// The Activity page's data layer is four fetchers, not one — a CORE fetch per
// tab (everything a card needs to be CORRECT on first paint) and a deferred
// DETAIL fetch per tab (decoration that may land afterwards). Bugs here cause
// silently-wrong screens: jobs missing, applicant counts absent (which moves a
// job into the wrong "whose move is it" bucket), helper names blank, a
// "tipped" badge wrong, declined jobs reappearing.
//
// Tests target the pure async functions, not the React Query wrappers, since
// those wrappers are well-trodden and the branching logic is in the fetch.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Builders for the heavily-chained supabase query mocks
const responses: Record<string, unknown> = {};

function setResponse(key: string, response: unknown) {
  responses[key] = response;
}

const fromMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    rpc: (fn: string, args: unknown) => rpcMock(fn, args),
  },
}));

vi.mock("@/lib/utils", () => ({
  formatName: (name: string | null, fallback = "User") =>
    name ? `${name.split(" ")[0]} ${(name.split(" ")[1] || "").charAt(0)}.`.trim() : fallback,
}));

import {
  fetchPostedActivity,
  fetchPostedActivityDetail,
  fetchAppliedActivity,
  fetchAppliedActivityDetail,
  postedDetailInputs,
  appliedDetailInputs,
} from "./useActivityData";
import type { Job, AppliedApp } from "@/components/activity/activityConstants";

/** Every table read the mock actually saw, in issue order. */
let issued: string[] = [];

beforeEach(() => {
  Object.keys(responses).forEach((k) => delete responses[k]);
  issued = [];
  fromMock.mockReset();
  rpcMock.mockReset();

  fromMock.mockImplementation((table: string) => makeChainable(table));

  rpcMock.mockImplementation(async (fn: string, args?: { user_ids: string[] }) => {
    const key = args?.user_ids ? `rpc:${fn}:${args.user_ids.join(",")}` : `rpc:${fn}`;
    issued.push(key);
    return responses[key] ?? { data: [], error: null };
  });
});

// Builds a chainable query mock that records the operation chain into
// a key string, then resolves to a configured response.
function makeChainable(table: string) {
  const filters: string[] = [];
  const builder: Record<string, unknown> = {};

  const resolveQuery = () => {
    const key = `${table}|${filters.join(",")}`;
    issued.push(key);
    return Promise.resolve(responses[key] ?? { data: [], error: null });
  };

  builder.select = (_col?: string) => {
    filters.push("select");
    return builder;
  };
  builder.eq = (col: string, val: string) => {
    filters.push(`eq:${col}=${val}`);
    return builder;
  };
  builder.in = (col: string, vals: string[]) => {
    filters.push(`in:${col}=${[...vals].sort().join("&")}`);
    return builder;
  };
  builder.order = (col: string, _opts?: unknown) => {
    filters.push(`order:${col}`);
    return resolveQuery();
  };
  // Allow direct then() resolution for queries without .order()
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    resolveQuery().then(resolve, reject);
  return builder;
}

const POSTED_JOBS_KEY = "jobs|select,eq:customer_id=u1,order:created_at";
const APPLICANT_COUNT_KEY = "applications|select,eq:jobs.customer_id=u1";
const APPS_KEY = "applications|select,eq:helper_id=u1,order:created_at";
const OFFERS_KEY = "rpc:get_my_pending_direct_offers";
const APPLIED_JOBS_KEY = "rpc:get_jobs_for_my_applications";
const VIOLATIONS_KEY = "user_violations|select,eq:user_id=u1,eq:violation_type=job_denial";
const HELPER_REVIEWS_KEY = "reviews|select,eq:reviewer_id=u1";

// ---------------------------------------------------------------------------

describe("fetchPostedActivity — My Posts core", () => {
  it("returns empty data for a user with no posted jobs", async () => {
    const result = await fetchPostedActivity("u1");
    expect(result.postedJobs).toEqual([]);
    expect(result.applicantCounts).toEqual({});
  });

  it("counts applications per posted job", async () => {
    setResponse(POSTED_JOBS_KEY, { data: [{ id: "j1", customer_id: "u1", status: "open" }], error: null });
    setResponse(APPLICANT_COUNT_KEY, {
      data: [{ job_id: "j1" }, { job_id: "j1" }, { job_id: "j1" }],
      error: null,
    });

    const result = await fetchPostedActivity("u1");
    expect(result.postedJobs).toHaveLength(1);
    expect(result.applicantCounts["j1"]).toBe(3);
  });


  // The whole point of the split: the enrichment reads are scoped by an
  // embedded `jobs!inner` filter on the USER, not by an `.in(jobIds)` list, so
  // they go out in the SAME wave as the jobs query instead of waiting for it.
  it("issues the applicant-count read without waiting for the job ids", async () => {
    setResponse(POSTED_JOBS_KEY, { data: [{ id: "j1", customer_id: "u1", status: "open" }], error: null });
    await fetchPostedActivity("u1");
    expect(issued).toContain(APPLICANT_COUNT_KEY);
    // No id-list variant anywhere.
    expect(issued.some((k) => k.startsWith("applications|select,in:job_id="))).toBe(false);
  });

  it("throws when the jobs read fails, so the screen shows an error not an empty list", async () => {
    setResponse(POSTED_JOBS_KEY, { data: null, error: { message: "boom" } });
    await expect(fetchPostedActivity("u1")).rejects.toEqual({ message: "boom" });
  });

  it("degrades rather than throwing when only an enrichment read fails", async () => {
    setResponse(POSTED_JOBS_KEY, { data: [{ id: "j1", customer_id: "u1", status: "open" }], error: null });
    setResponse(APPLICANT_COUNT_KEY, { data: null, error: { message: "rls" } });
    const result = await fetchPostedActivity("u1");
    expect(result.postedJobs).toHaveLength(1);
    expect(result.applicantCounts).toEqual({});
  });
});

describe("fetchPostedActivityDetail — My Posts decoration", () => {
  const job = (over: Partial<Job>) =>
    ({ id: "j1", customer_id: "u1", status: "open", helper_id: null, is_group_job: false, ...over }) as unknown as Job;

  it("resolves helper names via get_safe_profiles for jobs with assigned helpers", async () => {
    setResponse("rpc:get_safe_profiles:helper-1", {
      data: [{ user_id: "helper-1", full_name: "Marie Beaumont" }],
      error: null,
    });
    const inputs = postedDetailInputs([job({ status: "in_progress", helper_id: "helper-1" })]);
    const result = await fetchPostedActivityDetail("u1", inputs);
    expect(result.helperNames["helper-1"]).toBe("Marie B.");
  });

  it("populates completedJobMeta with tipped+reviewed flags for completed jobs", async () => {
    // The tips query now filters on payment_status = 'paid', so the mock key
    // carries that predicate too.
    setResponse("tips|select,in:job_id=j1&j2,eq:tipper_id=u1,eq:payment_status=paid", { data: [{ job_id: "j1" }], error: null });
    setResponse("reviews|select,in:job_id=j1&j2,eq:reviewer_id=u1", { data: [{ job_id: "j1" }], error: null });
    const inputs = postedDetailInputs([
      job({ id: "j1", status: "completed", helper_id: "helper-1" }),
      job({ id: "j2", status: "completed", helper_id: "helper-1" }),
    ]);
    const result = await fetchPostedActivityDetail("u1", inputs);
    expect(result.completedJobMeta["j1"]).toEqual({ tipped: true, reviewed: true });
    expect(result.completedJobMeta["j2"]).toEqual({ tipped: false, reviewed: false });
  });

  it("does NOT mark a job tipped when the only tips row is unpaid", async () => {
    // create-payment writes a `pending` tips row BEFORE the tipper reaches
    // Stripe. Abandoning that checkout used to leave the row behind forever,
    // and the unfiltered query counted it — permanently locking the Tip button
    // to a disabled "Tipped" state, so the poster could never tip and the
    // helper never got one. The paid filter is what stops that, and this test
    // fails if anyone removes it: the mock returns nothing for the paid query,
    // exactly as prod would when the only row is pending.
    setResponse("tips|select,in:job_id=j1,eq:tipper_id=u1,eq:payment_status=paid", { data: [], error: null });
    setResponse("reviews|select,in:job_id=j1,eq:reviewer_id=u1", { data: [], error: null });
    const inputs = postedDetailInputs([job({ id: "j1", status: "completed", helper_id: "helper-1" })]);
    const result = await fetchPostedActivityDetail("u1", inputs);
    expect(result.completedJobMeta["j1"]).toEqual({ tipped: false, reviewed: false });
  });

  // Regression coverage for the N+1 fixes from #135: one <JobTracking> per
  // active card used to fire its own SELECT.
  it("batches latestTracking for every active posted job into a single in() query", async () => {
    setResponse("job_tracking|select,in:job_id=p1&p2,order:created_at", {
      data: [
        { id: "t-p1-new", job_id: "p1", status: "working", latitude: null, longitude: null, eta_minutes: null, updated_at: "2026-05-02T00:00:00Z", created_at: "2026-05-02T00:00:00Z" },
        { id: "t-p1-old", job_id: "p1", status: "on_the_way", latitude: null, longitude: null, eta_minutes: null, updated_at: "2026-05-01T00:00:00Z", created_at: "2026-05-01T00:00:00Z" },
        // No row for p2 — should surface as null in the result map.
      ],
      error: null,
    });
    const inputs = postedDetailInputs([
      job({ id: "p1", status: "in_progress", helper_id: "h1" }),
      job({ id: "p2", status: "accepted", helper_id: "h2" }),
      job({ id: "p3", status: "open" }),
    ]);
    const result = await fetchPostedActivityDetail("u1", inputs);
    expect(Object.keys(result.latestTracking).sort()).toEqual(["p1", "p2"]);
    expect(result.latestTracking["p1"]?.id).toBe("t-p1-new");
    expect(result.latestTracking["p2"]).toBeNull();
    // Open-status posted job is NOT pre-fetched (no JobTracking renders for it).
    expect("p3" in result.latestTracking).toBe(false);
  });

  it("batches groupHelpersByJob with a single in() + one batched profiles lookup", async () => {
    setResponse("group_job_helpers|select,in:job_id=g1&g2", {
      data: [
        { id: "gh1", job_id: "g1", helper_id: "helper-A", status: "accepted", joined_at: "2026-05-01" },
        { id: "gh2", job_id: "g1", helper_id: "helper-B", status: "accepted", joined_at: "2026-05-02" },
        { id: "gh3", job_id: "g2", helper_id: "helper-A", status: "accepted", joined_at: "2026-05-03" },
      ],
      error: null,
    });
    setResponse("profiles|select,in:user_id=helper-A&helper-B", {
      data: [
        { user_id: "helper-A", full_name: "Anna Test" },
        { user_id: "helper-B", full_name: "Ben Test" },
      ],
      error: null,
    });
    const inputs = postedDetailInputs([
      job({ id: "g1", status: "in_progress", helper_id: "h1", is_group_job: true }),
      job({ id: "g2", status: "accepted", helper_id: "h2", is_group_job: true }),
      job({ id: "g3", status: "open", is_group_job: true }),
      job({ id: "s1", status: "in_progress", helper_id: "h3", is_group_job: false }),
    ]);
    const result = await fetchPostedActivityDetail("u1", inputs);
    expect(Object.keys(result.groupHelpersByJob).sort()).toEqual(["g1", "g2"]);
    expect(result.groupHelpersByJob["g1"]).toHaveLength(2);
    expect(result.groupHelpersByJob["g1"][0].helperName).toBe("Anna T.");
    expect(result.groupHelpersByJob["g2"][0].helperName).toBe("Anna T.");
    // Solo + open jobs are NOT pre-fetched.
    expect("s1" in result.groupHelpersByJob).toBe(false);
    expect("g3" in result.groupHelpersByJob).toBe(false);
  });

  it("issues no side queries at all when there is nothing to decorate", async () => {
    const result = await fetchPostedActivityDetail("u1", postedDetailInputs([job({ status: "open" })]));
    expect(issued).toEqual([]);
    expect(result.latestTracking).toEqual({});
    expect(result.groupHelpersByJob).toEqual({});
    expect(result.helperNames).toEqual({});
  });
});

// ---------------------------------------------------------------------------

describe("fetchAppliedActivity — My Jobs core", () => {
  it("attaches the job row to each application", async () => {
    setResponse(APPS_KEY, {
      data: [{ id: "a1", job_id: "j1", helper_id: "u1", status: "pending" }],
      error: null,
    });
    setResponse(APPLIED_JOBS_KEY, {
      data: [{ id: "j1", customer_id: "poster-1", title: "Yard work" }],
      error: null,
    });

    const result = await fetchAppliedActivity("u1");
    expect(result.appliedApps).toHaveLength(1);
    expect(result.appliedApps[0].job?.title).toBe("Yard work");
    // posterName is DECORATION and is resolved by the detail fetch — the core
    // deliberately leaves it undefined rather than painting a placeholder.
    expect(result.appliedApps[0].posterName).toBeUndefined();
  });

  it("populates declinedJobIds from job_denial violations", async () => {
    setResponse(APPS_KEY, { data: [{ id: "a1", job_id: "j1", helper_id: "u1" }], error: null });
    setResponse(APPLIED_JOBS_KEY, { data: [{ id: "j1", customer_id: "poster-1" }], error: null });
    setResponse(VIOLATIONS_KEY, { data: [{ job_id: "j1" }], error: null });

    const result = await fetchAppliedActivity("u1");
    expect(result.declinedJobIds.has("j1")).toBe(true);
  });

  it("populates helperReviewedJobIds and start-request check-ins in the FIRST wave", async () => {
    setResponse(APPS_KEY, { data: [{ id: "a1", job_id: "j1", helper_id: "u1" }], error: null });
    setResponse(APPLIED_JOBS_KEY, { data: [{ id: "j1", customer_id: "poster-1" }], error: null });
    setResponse(HELPER_REVIEWS_KEY, { data: [{ job_id: "j1" }], error: null });

    const result = await fetchAppliedActivity("u1");
    expect(result.helperReviewedJobIds.has("j1")).toBe(true);
    // Issued BEFORE the dependent jobs-by-id read.
    expect(issued.indexOf(HELPER_REVIEWS_KEY)).toBeLessThan(issued.indexOf(APPLIED_JOBS_KEY));
  });

  it("throws when the jobs-behind-the-applications read fails", async () => {
    setResponse(APPS_KEY, { data: [{ id: "a1", job_id: "j1", helper_id: "u1" }], error: null });
    setResponse(APPLIED_JOBS_KEY, { data: null, error: { message: "boom" } });
    await expect(fetchAppliedActivity("u1")).rejects.toEqual({ message: "boom" });
  });

  it("synthesizes pending applications from direct offers", async () => {
    setResponse(OFFERS_KEY, {
      data: [{ id: "j1", customer_id: "poster-1", title: "Direct offer", created_at: "2026-01-01", updated_at: "2026-01-01" }],
      error: null,
    });

    const result = await fetchAppliedActivity("u1");
    expect(result.appliedApps).toHaveLength(1);
    expect(result.appliedApps[0].id).toBe("direct-j1");
    expect(result.appliedApps[0].job?.title).toBe("Direct offer");
  });

  it("does NOT duplicate when the user has both a direct offer AND an application", async () => {
    setResponse(APPS_KEY, { data: [{ id: "a1", job_id: "j1", helper_id: "u1" }], error: null });
    setResponse(OFFERS_KEY, {
      data: [{ id: "j1", customer_id: "poster-1", title: "Same job", created_at: "2026-01-01", updated_at: "2026-01-01" }],
      error: null,
    });
    setResponse(APPLIED_JOBS_KEY, {
      data: [{ id: "j1", customer_id: "poster-1", title: "Same job" }],
      error: null,
    });

    const result = await fetchAppliedActivity("u1");
    // 1 (the real application), NOT 2 (real + synthetic duplicate)
    expect(result.appliedApps).toHaveLength(1);
    expect(result.appliedApps[0].id).toBe("a1");
  });
});

describe("fetchAppliedActivityDetail — My Jobs decoration", () => {
  const app = (over: Partial<AppliedApp>) =>
    ({ id: "a1", job_id: "j1", helper_id: "u1", status: "pending", job: null, ...over }) as unknown as AppliedApp;

  it("resolves poster names via get_safe_profiles", async () => {
    setResponse("rpc:get_safe_profiles:poster-1", {
      data: [{ user_id: "poster-1", full_name: "Bob Smith" }],
      error: null,
    });
    const inputs = appliedDetailInputs([app({ job: { id: "j1", customer_id: "poster-1", status: "open" } as never })]);
    const result = await fetchAppliedActivityDetail(inputs);
    expect(result.posterNames["poster-1"]).toBe("Bob S.");
  });

  it("batches tracking for accepted applications on active jobs only", async () => {
    setResponse("job_tracking|select,in:job_id=ap1,order:created_at", {
      data: [{ id: "t-ap1", job_id: "ap1", status: "arrived", latitude: null, longitude: null, eta_minutes: null, updated_at: "2026-05-03T00:00:00Z", created_at: "2026-05-03T00:00:00Z" }],
      error: null,
    });
    const inputs = appliedDetailInputs([
      app({ id: "a1", job_id: "ap1", status: "accepted", job: { id: "ap1", customer_id: "p", status: "in_progress" } as never }),
      // Pending application on an open job — nothing to track.
      app({ id: "a2", job_id: "ap2", status: "pending", job: { id: "ap2", customer_id: "p", status: "open" } as never }),
    ]);
    const result = await fetchAppliedActivityDetail(inputs);
    expect(result.latestTracking["ap1"]?.status).toBe("arrived");
    expect("ap2" in result.latestTracking).toBe(false);
  });

  it("issues nothing when there is nothing to decorate", async () => {
    const result = await fetchAppliedActivityDetail(appliedDetailInputs([]));
    expect(issued).toEqual([]);
    expect(result.posterNames).toEqual({});
    expect(result.latestTracking).toEqual({});
  });
});
