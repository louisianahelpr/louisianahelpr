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
