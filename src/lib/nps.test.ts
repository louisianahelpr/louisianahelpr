import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Build a tiny chainable supabase mock that mirrors the surface checkNps*
// touches: .from(table).select(...).eq(...).eq(...).limit(...) and the
// count-style `.select("id", { count: "exact", head: true })` variant. We
// drive responses via a per-test queue so each call returns exactly what
// that branch needs.
type Result = { data: any; error: any; count?: number };

const queue: Result[] = [];
function enqueue(r: Result) {
  queue.push(r);
}
function nextResult(): Result {
  return queue.shift() ?? { data: [], error: null };
}

// Every row handed to `.insert(...)`, in order. The mock used to throw the
// payload away, which made the three submitNps cases assert nothing but the
// table name: measured 2026-09-21, `comment: trimmed ? trimmed : null` could
// become `comment ?? null`, `user_role: role` could be inverted and
// `triggered_at_jobs_completed` zeroed, and all 20 tests stayed green.
const inserts: Record<string, unknown>[] = [];

// Each `.from(...)` returns a chainable thenable: every method returns
// the same object, and awaiting it yields the next queued Result.
function makeChain() {
  const chain: any = {};
  const methods = ["select", "eq", "limit"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.insert = vi.fn((row: Record<string, unknown>) => {
    inserts.push(row);
    return chain;
  });
  chain.then = (onFulfilled: (r: Result) => any) => Promise.resolve(nextResult()).then(onFulfilled);
  return chain;
}

const fromMock = vi.fn((_table: string) => makeChain());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}));

// Import AFTER mocks are registered.
import {
  checkNpsEligibility,
  hasSubmittedNps,
  setNpsLocalCooldown,
  isLocalCooldownActive,
  clearNpsLocalCooldownForTests,
  submitNps,
} from "./nps";

beforeEach(() => {
  queue.length = 0;
  inserts.length = 0;
  fromMock.mockClear();
  clearNpsLocalCooldownForTests();
});

afterEach(() => {
  clearNpsLocalCooldownForTests();
});

describe("isLocalCooldownActive / setNpsLocalCooldown", () => {
  it("returns false when no cooldown is set", () => {
    expect(isLocalCooldownActive()).toBe(false);
  });

  it("returns true immediately after setNpsLocalCooldown", () => {
    setNpsLocalCooldown(Date.now());
    expect(isLocalCooldownActive()).toBe(true);
  });

  it("returns false once 90 days have elapsed", () => {
    const t0 = 1_700_000_000_000;
    setNpsLocalCooldown(t0);
    // 91 days after the cooldown was set
    const t1 = t0 + 91 * 24 * 60 * 60 * 1000;
    expect(isLocalCooldownActive(t1)).toBe(false);
  });

  it("ignores corrupt localStorage values", () => {
    localStorage.setItem("nps-cooldown-until", "not-a-number");
    expect(isLocalCooldownActive()).toBe(false);
  });
});

describe("hasSubmittedNps", () => {
  it("returns true when the user has a row", async () => {
    enqueue({ data: [{ id: "r1" }], error: null });
    await expect(hasSubmittedNps("u1")).resolves.toBe(true);
  });

  it("returns false when the user has no rows", async () => {
    enqueue({ data: [], error: null });
    await expect(hasSubmittedNps("u1")).resolves.toBe(false);
  });

  it("returns null when the table is missing (migration not pushed)", async () => {
    enqueue({ data: null, error: { code: "PGRST205", message: "schema cache" } });
    await expect(hasSubmittedNps("u1")).resolves.toBe(null);
  });

  it("returns null when the error message matches 'relation does not exist'", async () => {
    enqueue({ data: null, error: { code: "42P01", message: 'relation "nps_responses" does not exist' } });
    await expect(hasSubmittedNps("u1")).resolves.toBe(null);
  });

  it("returns true on unknown errors (safer to under-prompt)", async () => {
    enqueue({ data: null, error: { code: "PGRST301", message: "network failure" } });
    await expect(hasSubmittedNps("u1")).resolves.toBe(true);
  });
});

describe("checkNpsEligibility", () => {
  it("short-circuits to false when the local cooldown is active", async () => {
    setNpsLocalCooldown(Date.now());
    const result = await checkNpsEligibility("u1");
    expect(result.eligible).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("bails quietly when the table is missing", async () => {
    enqueue({ data: null, error: { code: "PGRST205", message: "schema cache" } });
    const result = await checkNpsEligibility("u1");
    expect(result).toEqual({ eligible: false, reason: "table-missing" });
  });

  it("rejects users who have already submitted", async () => {
    enqueue({ data: [{ id: "r1" }], error: null });
    const result = await checkNpsEligibility("u1");
    expect(result).toEqual({ eligible: false, reason: "already-submitted" });
  });

  it("returns false when neither role has 2+ qualifying completions", async () => {
    enqueue({ data: [], error: null }); // hasSubmittedNps → no rows
    enqueue({ data: null, error: null, count: 1 }); // customer count
    enqueue({ data: [], error: null }); // helper jobs
    const result = await checkNpsEligibility("u1");
    expect(result).toEqual({ eligible: false, reason: "below-threshold" });
  });

  it("returns customer eligibility at exactly 2 completed customer jobs", async () => {
    enqueue({ data: [], error: null }); // hasSubmittedNps → no rows
    enqueue({ data: null, error: null, count: 2 }); // customer count
    enqueue({ data: [], error: null }); // helper jobs (empty)
    const result = await checkNpsEligibility("u1");
    expect(result).toEqual({ eligible: true, role: "customer", jobsCompleted: 2 });
  });

  it("counts DISTINCT customers for the helper-side gate", async () => {
    enqueue({ data: [], error: null }); // hasSubmittedNps → no rows
    enqueue({ data: null, error: null, count: 0 }); // customer count
    enqueue({
      data: [
        { customer_id: "c1" },
        { customer_id: "c1" }, // duplicate — same customer
        { customer_id: "c1" }, // duplicate again
      ],
      error: null,
    });
    const result = await checkNpsEligibility("u1");
    // Only 1 distinct customer → not eligible.
    expect(result.eligible).toBe(false);
  });

  it("returns helper eligibility once 2 DISTINCT customers complete", async () => {
    enqueue({ data: [], error: null });
    enqueue({ data: null, error: null, count: 0 });
    enqueue({
      data: [
        { customer_id: "c1" },
        { customer_id: "c2" },
        { customer_id: "c1" }, // duplicate doesn't count
      ],
      error: null,
    });
    const result = await checkNpsEligibility("u1");
    expect(result).toEqual({ eligible: true, role: "helper", jobsCompleted: 2 });
  });

  it("prefers helper role when both qualify", async () => {
    enqueue({ data: [], error: null });
    enqueue({ data: null, error: null, count: 5 });
    enqueue({
      data: [{ customer_id: "c1" }, { customer_id: "c2" }, { customer_id: "c3" }],
      error: null,
    });
    const result = await checkNpsEligibility("u1");
    expect(result).toMatchObject({ eligible: true, role: "helper" });
  });
});

describe("submitNps", () => {
  it("inserts a row with trimmed comment and the supplied metadata", async () => {
    enqueue({ data: null, error: null });
    await submitNps({ userId: "u1", score: 9, comment: "  great  ", role: "customer", jobsCompleted: 2 });
    expect(fromMock).toHaveBeenCalledWith("nps_responses");
    // The PAYLOAD, not just the table. `user_role` and
    // `triggered_at_jobs_completed` are the only two columns that make a score
    // segmentable — a row that reaches the table under the wrong role is a
    // silently wrong dashboard, not a missing one.
    expect(inserts).toEqual([
      {
        user_id: "u1",
        score: 9,
        comment: "great",
        user_role: "customer",
        triggered_at_jobs_completed: 2,
      },
    ]);
  });

  it("nulls a blank/whitespace-only comment", async () => {
    enqueue({ data: null, error: null });
    await submitNps({ userId: "u1", score: 10, comment: "   ", role: "helper", jobsCompleted: 2 });
    // A whitespace-only comment must land as NULL, not as "   ": every NPS
    // read-out counts commented responses, and a blank string counts as one.
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      comment: null,
      user_role: "helper",
      score: 10,
      triggered_at_jobs_completed: 2,
    });
  });

  it("re-throws the supabase error so the caller can toast it", async () => {
    enqueue({ data: null, error: { code: "23505", message: "duplicate key" } });
    await expect(
      submitNps({ userId: "u1", score: 3, role: "customer", jobsCompleted: 2 }),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

// The helper-side gate is 2 DISTINCT customers, not 2 completed jobs — one
// repeat customer re-hiring a helper five times is the "one-off luck" case the
// dedupe exists to exclude.
// @mutate src/lib/nps.ts | return distinct.size; | return data.length;
// The submitNps payload, not just the table name — see the `inserts` comment
// above. This whole block was hollow until 2026-09-21.
// @mutate src/lib/nps.ts | comment: trimmed ? trimmed : null, | comment: comment ?? null,
// @mutate src/lib/nps.ts | user_role: role, | user_role: role === "helper" ? "customer" : "helper",
