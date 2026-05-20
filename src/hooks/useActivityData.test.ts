// fetchActivityData is the heavy lifter behind the Activity page —
// 10+ supabase calls compose into one ActivityData snapshot. Bugs
// here cause silently-wrong dashboards (jobs missing, helper names
// blank, "tipped" indicator wrong, declined jobs reappearing).
//
// Tests target the pure async function, not the React Query wrapper,
// since that wrapper is well-trodden + the branching logic is in the
// fetch.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Builders for the heavily-chained supabase query mocks
const responses: Record<string, unknown> = {};

function setResponse(key: string, response: unknown) {
  responses[key] = response;
}

const inMock = vi.fn();
const eqEqMock = vi.fn();
const eqMock2 = vi.fn();
const orderMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
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

import { fetchActivityData } from "./useActivityData";

beforeEach(() => {
  Object.keys(responses).forEach((k) => delete responses[k]);
  fromMock.mockReset();
  rpcMock.mockReset();
  selectMock.mockReset();
  eqMock.mockReset();
  orderMock.mockReset();
  eqMock2.mockReset();
  eqEqMock.mockReset();
  inMock.mockReset();

  // Default implementation: dispatch on table name + filter chain shape
  fromMock.mockImplementation((table: string) => {
    return makeChainable(table);
  });

  rpcMock.mockImplementation(async (fn: string, args: { user_ids: string[] }) => {
    const key = `rpc:${fn}:${args.user_ids?.join(",")}`;
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

describe("fetchActivityData — empty user (no jobs, no apps, no offers)", () => {
  it("returns empty data when all three top-level queries return empty", async () => {
    setResponse("jobs|select,eq:customer_id=u1,order:created_at", { data: [], error: null });
    setResponse("applications|select,eq:helper_id=u1,order:created_at", { data: [], error: null });
    setResponse(
      "jobs|select,eq:offered_to_helper_id=u1,eq:direct_offer_status=pending,order:created_at",
      { data: [], error: null },
    );

    const result = await fetchActivityData("u1");
    expect(result.postedJobs).toEqual([]);
    expect(result.appliedApps).toEqual([]);
    expect(result.applicantCounts).toEqual({});
    expect(result.startRequestedJobIds.size).toBe(0);
    expect(result.helperNames).toEqual({});
    expect(result.completedJobMeta).toEqual({});
    expect(result.declinedJobIds.size).toBe(0);
    expect(result.helperReviewedJobIds.size).toBe(0);
  });
});

describe("fetchActivityData — posted jobs", () => {
  it("counts applications per posted job", async () => {
    const job1 = { id: "j1", customer_id: "u1", status: "open", helper_id: null };
    setResponse("jobs|select,eq:customer_id=u1,order:created_at", { data: [job1], error: null });
    setResponse("applications|select,eq:helper_id=u1,order:created_at", { data: [], error: null });
    setResponse(
      "jobs|select,eq:offered_to_helper_id=u1,eq:direct_offer_status=pending,order:created_at",
      { data: [], error: null },
    );
    setResponse("applications|select,in:job_id=j1", {
      data: [{ job_id: "j1" }, { job_id: "j1" }, { job_id: "j1" }],
      error: null,
    });
    setResponse("job_checkins|select,in:job_id=j1,eq:type=start_request", { data: [], error: null });

    const result = await fetchActivityData("u1");
    expect(result.postedJobs).toHaveLength(1);
    expect(result.applicantCounts["j1"]).toBe(3);
    expect(result.startRequestedJobIds.has("j1")).toBe(false);
  });

  it("populates startRequestedJobIds from job_checkins type=start_request", async () => {
    const job1 = { id: "j1", customer_id: "u1", status: "in_progress", helper_id: null };
    setResponse("jobs|select,eq:customer_id=u1,order:created_at", { data: [job1], error: null });
    setResponse("applications|select,eq:helper_id=u1,order:created_at", { data: [], error: null });
    setResponse(
      "jobs|select,eq:offered_to_helper_id=u1,eq:direct_offer_status=pending,order:created_at",
      { data: [], error: null },
    );
    setResponse("applications|select,in:job_id=j1", { data: [], error: null });
    setResponse("job_checkins|select,in:job_id=j1,eq:type=start_request", {
      data: [{ job_id: "j1" }],
      error: null,
    });

    const result = await fetchActivityData("u1");
    expect(result.startRequestedJobIds.has("j1")).toBe(true);
  });

  it("resolves helper names via get_safe_profiles RPC for jobs with assigned helpers", async () => {
    const job1 = { id: "j1", customer_id: "u1", status: "in_progress", helper_id: "helper-1" };
    setResponse("jobs|select,eq:customer_id=u1,order:created_at", { data: [job1], error: null });
    setResponse("applications|select,eq:helper_id=u1,order:created_at", { data: [], error: null });
    setResponse(
      "jobs|select,eq:offered_to_helper_id=u1,eq:direct_offer_status=pending,order:created_at",
      { data: [], error: null },
    );
    setResponse("applications|select,in:job_id=j1", { data: [], error: null });
    setResponse("job_checkins|select,in:job_id=j1,eq:type=start_request", { data: [], error: null });
    setResponse("rpc:get_safe_profiles:helper-1", {
      data: [{ user_id: "helper-1", full_name: "Marie Beaumont" }],
      error: null,
    });

    const result = await fetchActivityData("u1");
    expect(result.helperNames["helper-1"]).toBe("Marie B.");
  });

  it("populates completedJobMeta with tipped+reviewed flags for completed jobs", async () => {
    const job1 = { id: "j1", customer_id: "u1", status: "completed", helper_id: "helper-1" };
    const job2 = { id: "j2", customer_id: "u1", status: "completed", helper_id: "helper-1" };
    setResponse("jobs|select,eq:customer_id=u1,order:created_at", {
      data: [job1, job2],
      error: null,
    });
    setResponse("applications|select,eq:helper_id=u1,order:created_at", { data: [], error: null });
    setResponse(
      "jobs|select,eq:offered_to_helper_id=u1,eq:direct_offer_status=pending,order:created_at",
      { data: [], error: null },
    );
    setResponse("applications|select,in:job_id=j1&j2", { data: [], error: null });
    setResponse("job_checkins|select,in:job_id=j1&j2,eq:type=start_request", { data: [], error: null });
    setResponse("rpc:get_safe_profiles:helper-1", {
      data: [{ user_id: "helper-1", full_name: "Marie Beaumont" }],
      error: null,
    });
    // j1: tipped+reviewed; j2: nothing
    setResponse("tips|select,in:job_id=j1&j2,eq:tipper_id=u1", {
      data: [{ job_id: "j1" }],
      error: null,
    });
    setResponse("reviews|select,in:job_id=j1&j2,eq:reviewer_id=u1", {
      data: [{ job_id: "j1" }],
      error: null,
    });

    const result = await fetchActivityData("u1");
    expect(result.completedJobMeta["j1"]).toEqual({ tipped: true, reviewed: true });
    expect(result.completedJobMeta["j2"]).toEqual({ tipped: false, reviewed: false });
  });
});

describe("fetchActivityData — applied jobs (helper side)", () => {
  it("attaches job + posterName to each application", async () => {
    setResponse("jobs|select,eq:customer_id=u1,order:created_at", { data: [], error: null });
    setResponse("applications|select,eq:helper_id=u1,order:created_at", {
      data: [{ id: "a1", job_id: "j1", helper_id: "u1", status: "pending" }],
      error: null,
    });
    setResponse(
      "jobs|select,eq:offered_to_helper_id=u1,eq:direct_offer_status=pending,order:created_at",
      { data: [], error: null },
    );
    setResponse("jobs|select,in:id=j1", {
      data: [{ id: "j1", customer_id: "poster-1", title: "Yard work" }],
      error: null,
    });
    setResponse("user_violations|select,eq:user_id=u1,eq:violation_type=job_denial", {
      data: [],
      error: null,
    });
    setResponse("job_checkins|select,in:job_id=j1,eq:type=start_request", { data: [], error: null });
    setResponse("reviews|select,eq:reviewer_id=u1,in:job_id=j1", { data: [], error: null });
    setResponse("rpc:get_safe_profiles:poster-1", {
      data: [{ user_id: "poster-1", full_name: "Bob Smith" }],
      error: null,
    });

    const result = await fetchActivityData("u1");
    expect(result.appliedApps).toHaveLength(1);
    expect(result.appliedApps[0].posterName).toBe("Bob S.");
    expect(result.appliedApps[0].job?.title).toBe("Yard work");
  });

  it("populates declinedJobIds from job_denial violations", async () => {
    setResponse("jobs|select,eq:customer_id=u1,order:created_at", { data: [], error: null });
    setResponse("applications|select,eq:helper_id=u1,order:created_at", {
      data: [{ id: "a1", job_id: "j1", helper_id: "u1" }],
      error: null,
    });
    setResponse(
      "jobs|select,eq:offered_to_helper_id=u1,eq:direct_offer_status=pending,order:created_at",
      { data: [], error: null },
    );
    setResponse("jobs|select,in:id=j1", {
      data: [{ id: "j1", customer_id: "poster-1" }],
      error: null,
    });
    setResponse("user_violations|select,eq:user_id=u1,eq:violation_type=job_denial", {
      data: [{ job_id: "j1" }],
      error: null,
    });
    setResponse("job_checkins|select,in:job_id=j1,eq:type=start_request", { data: [], error: null });
    setResponse("reviews|select,eq:reviewer_id=u1,in:job_id=j1", { data: [], error: null });
    setResponse("rpc:get_safe_profiles:poster-1", { data: [], error: null });

    const result = await fetchActivityData("u1");
    expect(result.declinedJobIds.has("j1")).toBe(true);
  });

  it("populates helperReviewedJobIds from reviews table", async () => {
    setResponse("jobs|select,eq:customer_id=u1,order:created_at", { data: [], error: null });
    setResponse("applications|select,eq:helper_id=u1,order:created_at", {
      data: [{ id: "a1", job_id: "j1", helper_id: "u1" }],
      error: null,
    });
    setResponse(
      "jobs|select,eq:offered_to_helper_id=u1,eq:direct_offer_status=pending,order:created_at",
      { data: [], error: null },
    );
    setResponse("jobs|select,in:id=j1", {
      data: [{ id: "j1", customer_id: "poster-1" }],
      error: null,
    });
    setResponse("user_violations|select,eq:user_id=u1,eq:violation_type=job_denial", {
      data: [],
      error: null,
    });
    setResponse("job_checkins|select,in:job_id=j1,eq:type=start_request", { data: [], error: null });
    setResponse("reviews|select,eq:reviewer_id=u1,in:job_id=j1", {
      data: [{ job_id: "j1" }],
      error: null,
    });
    setResponse("rpc:get_safe_profiles:poster-1", { data: [], error: null });

    const result = await fetchActivityData("u1");
    expect(result.helperReviewedJobIds.has("j1")).toBe(true);
  });
});

describe("fetchActivityData — direct offers", () => {
  it("synthesizes pending applications from direct offers", async () => {
    setResponse("jobs|select,eq:customer_id=u1,order:created_at", { data: [], error: null });
    setResponse("applications|select,eq:helper_id=u1,order:created_at", { data: [], error: null });
    setResponse(
      "jobs|select,eq:offered_to_helper_id=u1,eq:direct_offer_status=pending,order:created_at",
      {
        data: [
          {
            id: "j1",
            customer_id: "poster-1",
            title: "Direct offer",
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          },
        ],
        error: null,
      },
    );
    setResponse("rpc:get_safe_profiles:poster-1", {
      data: [{ user_id: "poster-1", full_name: "Direct Poster" }],
      error: null,
    });

    const result = await fetchActivityData("u1");
    expect(result.appliedApps).toHaveLength(1);
    expect(result.appliedApps[0].id).toBe("direct-j1");
    expect(result.appliedApps[0].posterName).toBe("Direct P.");
  });

  it("does NOT duplicate when user has both a direct offer AND an existing application", async () => {
    setResponse("jobs|select,eq:customer_id=u1,order:created_at", { data: [], error: null });
    setResponse("applications|select,eq:helper_id=u1,order:created_at", {
      data: [{ id: "a1", job_id: "j1", helper_id: "u1" }],
      error: null,
    });
    setResponse(
      "jobs|select,eq:offered_to_helper_id=u1,eq:direct_offer_status=pending,order:created_at",
      {
        data: [
          {
            id: "j1",
            customer_id: "poster-1",
            title: "Same job",
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          },
        ],
        error: null,
      },
    );
    setResponse("jobs|select,in:id=j1", {
      data: [{ id: "j1", customer_id: "poster-1", title: "Same job" }],
      error: null,
    });
    setResponse("user_violations|select,eq:user_id=u1,eq:violation_type=job_denial", {
      data: [],
      error: null,
    });
    setResponse("job_checkins|select,in:job_id=j1,eq:type=start_request", { data: [], error: null });
    setResponse("reviews|select,eq:reviewer_id=u1,in:job_id=j1", { data: [], error: null });
    setResponse("rpc:get_safe_profiles:poster-1", {
      data: [{ user_id: "poster-1", full_name: "Bob Smith" }],
      error: null,
    });

    const result = await fetchActivityData("u1");
    // Should be 1 (the real application), NOT 2 (real + synthetic duplicate)
    expect(result.appliedApps).toHaveLength(1);
    expect(result.appliedApps[0].id).toBe("a1");
  });
});

// Regression coverage for the N+1 fixes from #135. The Activity page used
// to mount one <JobTracking> per active card (each firing its own SELECT)
// and one <GroupJobHelpers> per active group-job card (firing a 2-query
// waterfall). useActivityData now batches both, indexed by job_id, so
// every card renders without its own round-trip. These tests assert that
// (a) the batched queries run with the expected `in:job_id=...` shape
// and (b) the returned maps cover every active card the page will render.
describe("fetchActivityData — batched per-job side data (N+1 fixes, #135)", () => {
  it("batches latestTracking for every active posted job + accepted application via a single in() query", async () => {
    // Two active posted jobs (poster side) + one accepted application
    // (helper side) — three job_tracking lookups in the old per-card
    // world. Should collapse to ONE `in:job_id=...` query here.
    const postedActive1 = { id: "p1", customer_id: "u1", status: "in_progress", helper_id: "h1", is_group_job: false };
    const postedActive2 = { id: "p2", customer_id: "u1", status: "accepted", helper_id: "h2", is_group_job: false };
    const postedOpen = { id: "p3", customer_id: "u1", status: "open", helper_id: null, is_group_job: false };
    setResponse("jobs|select,eq:customer_id=u1,order:created_at", {
      data: [postedActive1, postedActive2, postedOpen],
      error: null,
    });
    setResponse("applications|select,eq:helper_id=u1,order:created_at", {
      data: [{ id: "a1", job_id: "ap1", helper_id: "u1", status: "accepted" }],
      error: null,
    });
    setResponse(
      "jobs|select,eq:offered_to_helper_id=u1,eq:direct_offer_status=pending,order:created_at",
      { data: [], error: null },
    );
    // Posted-side enrichment fan-out (unchanged, returns empty).
    setResponse("applications|select,in:job_id=p1&p2&p3", { data: [], error: null });
    setResponse("job_checkins|select,in:job_id=p1&p2&p3,eq:type=start_request", { data: [], error: null });
    setResponse("rpc:get_safe_profiles:h1,h2", { data: [], error: null });
    // Applied-side enrichment fan-out.
    setResponse("jobs|select,in:id=ap1", {
      data: [{ id: "ap1", customer_id: "poster-x", status: "in_progress" }],
      error: null,
    });
    setResponse("user_violations|select,eq:user_id=u1,eq:violation_type=job_denial", { data: [], error: null });
    setResponse("job_checkins|select,in:job_id=ap1,eq:type=start_request", { data: [], error: null });
    setResponse("reviews|select,eq:reviewer_id=u1,in:job_id=ap1", { data: [], error: null });
    setResponse("rpc:get_safe_profiles:poster-x", { data: [], error: null });
    // The single batched call we expect — order matters because
    // `Array.from(Set)` preserves insertion order: postedJobs (p1, p2)
    // then applications (ap1), and the mock sorts the IN values.
    setResponse("job_tracking|select,in:job_id=ap1&p1&p2,order:created_at", {
      data: [
        // Two rows for p1 (older first), so the dedupe keeps the newest.
        { id: "t-p1-new", job_id: "p1", status: "working", latitude: null, longitude: null, eta_minutes: null, updated_at: "2026-05-02T00:00:00Z", created_at: "2026-05-02T00:00:00Z" },
        { id: "t-p1-old", job_id: "p1", status: "on_the_way", latitude: null, longitude: null, eta_minutes: null, updated_at: "2026-05-01T00:00:00Z", created_at: "2026-05-01T00:00:00Z" },
        { id: "t-ap1", job_id: "ap1", status: "arrived", latitude: null, longitude: null, eta_minutes: null, updated_at: "2026-05-03T00:00:00Z", created_at: "2026-05-03T00:00:00Z" },
        // No row for p2 — should surface as null in the result map.
      ],
      error: null,
    });

    const result = await fetchActivityData("u1");
    // Every active card has a key in the map (null = "we looked, no row").
    expect(Object.keys(result.latestTracking).sort()).toEqual(["ap1", "p1", "p2"].sort());
    // Newest-per-job dedupe holds.
    expect(result.latestTracking["p1"]?.id).toBe("t-p1-new");
    expect(result.latestTracking["p1"]?.status).toBe("working");
    expect(result.latestTracking["ap1"]?.status).toBe("arrived");
    expect(result.latestTracking["p2"]).toBeNull();
    // Open-status posted job is NOT pre-fetched (no JobTracking renders for it).
    expect("p3" in result.latestTracking).toBe(false);
  });

  it("batches groupHelpersByJob with a single in() + one batched profiles lookup", async () => {
    const groupActive1 = { id: "g1", customer_id: "u1", status: "in_progress", helper_id: "h1", is_group_job: true };
    const groupActive2 = { id: "g2", customer_id: "u1", status: "accepted", helper_id: "h2", is_group_job: true };
    const groupOpen = { id: "g3", customer_id: "u1", status: "open", helper_id: null, is_group_job: true };
    const soloActive = { id: "s1", customer_id: "u1", status: "in_progress", helper_id: "h3", is_group_job: false };
    setResponse("jobs|select,eq:customer_id=u1,order:created_at", {
      data: [groupActive1, groupActive2, groupOpen, soloActive],
      error: null,
    });
    setResponse("applications|select,eq:helper_id=u1,order:created_at", { data: [], error: null });
    setResponse(
      "jobs|select,eq:offered_to_helper_id=u1,eq:direct_offer_status=pending,order:created_at",
      { data: [], error: null },
    );
    setResponse("applications|select,in:job_id=g1&g2&g3&s1", { data: [], error: null });
    setResponse("job_checkins|select,in:job_id=g1&g2&g3&s1,eq:type=start_request", { data: [], error: null });
    setResponse("rpc:get_safe_profiles:h1,h2,h3", { data: [], error: null });
    // Tracking batch (also asserts it's one query — fans across solo + group active jobs).
    setResponse("job_tracking|select,in:job_id=g1&g2&s1,order:created_at", { data: [], error: null });
    // Group-helpers batch: only active group jobs (g3 is open, s1 isn't a group job).
    setResponse("group_job_helpers|select,in:job_id=g1&g2", {
      data: [
        { id: "gh1", job_id: "g1", helper_id: "helper-A", status: "accepted", joined_at: "2026-05-01" },
        { id: "gh2", job_id: "g1", helper_id: "helper-B", status: "accepted", joined_at: "2026-05-02" },
        { id: "gh3", job_id: "g2", helper_id: "helper-A", status: "accepted", joined_at: "2026-05-03" },
      ],
      error: null,
    });
    // Single batched profiles fetch for every helper across every group.
    setResponse("profiles|select,in:user_id=helper-A&helper-B", {
      data: [
        { user_id: "helper-A", full_name: "Anna Test" },
        { user_id: "helper-B", full_name: "Ben Test" },
      ],
      error: null,
    });

    const result = await fetchActivityData("u1");
    expect(Object.keys(result.groupHelpersByJob).sort()).toEqual(["g1", "g2"]);
    expect(result.groupHelpersByJob["g1"]).toHaveLength(2);
    expect(result.groupHelpersByJob["g1"][0].helperName).toBe("Anna T.");
    expect(result.groupHelpersByJob["g1"][1].helperName).toBe("Ben T.");
    expect(result.groupHelpersByJob["g2"]).toHaveLength(1);
    expect(result.groupHelpersByJob["g2"][0].helperName).toBe("Anna T.");
    // Solo + open jobs are NOT pre-fetched.
    expect("s1" in result.groupHelpersByJob).toBe(false);
    expect("g3" in result.groupHelpersByJob).toBe(false);
  });

  it("skips both batched fetches when there are no active jobs at all", async () => {
    // Only an `open` posted job — no JobTracking and no GroupJobHelpers
    // will render, so neither batched query should be issued. The maps
    // come back empty.
    const postedOpen = { id: "p1", customer_id: "u1", status: "open", helper_id: null, is_group_job: false };
    setResponse("jobs|select,eq:customer_id=u1,order:created_at", { data: [postedOpen], error: null });
    setResponse("applications|select,eq:helper_id=u1,order:created_at", { data: [], error: null });
    setResponse(
      "jobs|select,eq:offered_to_helper_id=u1,eq:direct_offer_status=pending,order:created_at",
      { data: [], error: null },
    );
    setResponse("applications|select,in:job_id=p1", { data: [], error: null });
    setResponse("job_checkins|select,in:job_id=p1,eq:type=start_request", { data: [], error: null });

    // No `job_tracking` or `group_job_helpers` mock — so if the code under
    // test issues either query it'd resolve to the default `{ data: [] }`
    // and not error. To pin down "skipped entirely" we just assert the
    // result maps are empty (the function returns before hitting them).
    const result = await fetchActivityData("u1");
    expect(result.latestTracking).toEqual({});
    expect(result.groupHelpersByJob).toEqual({});
  });
});
