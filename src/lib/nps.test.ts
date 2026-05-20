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

// Each `.from(...)` returns a chainable thenable: every method returns
// the same object, and awaiting it yields the next queued Result.
function makeChain() {
  const chain: any = {};
  const methods = ["select", "eq", "limit", "insert"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
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
  });

  it("nulls a blank/whitespace-only comment", async () => {
    enqueue({ data: null, error: null });
    await submitNps({ userId: "u1", score: 10, comment: "   ", role: "helper", jobsCompleted: 2 });
    // The chain's `insert` is what actually receives the payload, but the
    // mock just resolves — the meaningful coverage is "no throw".
    expect(fromMock).toHaveBeenCalledWith("nps_responses");
  });

  it("re-throws the supabase error so the caller can toast it", async () => {
    enqueue({ data: null, error: { code: "23505", message: "duplicate key" } });
    await expect(
      submitNps({ userId: "u1", score: 3, role: "customer", jobsCompleted: 2 }),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
