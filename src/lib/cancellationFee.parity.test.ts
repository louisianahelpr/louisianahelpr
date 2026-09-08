import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// The edge helper lives in the Deno functions tree but is plain TS (no Deno
// imports at module scope), so vitest can import it directly. This is the guard
// that keeps the server-side cancellation-fee math (the authority that moves
// money in void-cancelled-payments) in lock-step with the client estimate in
// CancellationDialog.tsx, and pins the anti-tamper property of F-MONEY-32.
import {
  cancellationFeePercent,
  computeCancellationFee,
  hoursUntilJob,
  jobLocalMidnightMs,
} from "../../supabase/functions/_shared/cancellationFee";

// Mirror of the client ladder in CancellationDialog.tsx (display-only there).
function clientPercent(hasHelper: boolean, hoursUntilJob: number): number {
  return !hasHelper ? 0 : hoursUntilJob < 2 ? 50 : hoursUntilJob < 24 ? 25 : 0;
}

describe("cancellation-fee tiered ladder (server authority)", () => {
  it("encodes the 0 / 25 / 50 schedule", () => {
    expect(cancellationFeePercent(true, 48)).toBe(0); // 24+ hours → free
    expect(cancellationFeePercent(true, 23)).toBe(25); // <24h → 25%
    expect(cancellationFeePercent(true, 1)).toBe(50); // <2h → 50%
    expect(cancellationFeePercent(true, -5)).toBe(50); // already past start
  });

  it("is always free when no helper was assigned", () => {
    expect(cancellationFeePercent(false, 1)).toBe(0);
    expect(cancellationFeePercent(false, -100)).toBe(0);
  });

  it("matches the client-side ladder across the boundary hours", () => {
    for (const hasHelper of [true, false]) {
      for (const h of [-5, 0, 1, 1.99, 2, 2.01, 23, 23.99, 24, 24.01, 100]) {
        expect(cancellationFeePercent(hasHelper, h)).toBe(clientPercent(hasHelper, h));
      }
    }
  });
});

describe("computeCancellationFee (derives dollars from trusted fields only)", () => {
  // A fixed "now" is not needed: we pass an explicit cancelled_at and a
  // date_needed far enough apart to land in a known tier.
  const farFuture = "2099-01-02"; // well over 24h from any cancelled_at below

  it("returns 0 with no helper assigned, whatever the schedule", () => {
    expect(
      computeCancellationFee({
        budget: 200,
        date_needed: "2099-01-01",
        start_time: null,
        cancelled_at: "2099-01-01T00:00:00Z", // 0h before → would be 50% if helper
        helper_id: null,
      }),
    ).toBe(0);
  });

  it("returns 0 for a free-tier (24+ hours out) cancellation", () => {
    expect(
      computeCancellationFee({
        budget: 200,
        date_needed: farFuture,
        start_time: null,
        cancelled_at: "2026-01-01T00:00:00Z",
        helper_id: "helper-1",
      }),
    ).toBe(0);
  });

  it("charges 25% when cancelled inside 24h", () => {
    // date at 2099-01-02T00:00:00 local; cancel 10h before.
    // Zone-explicit, exactly like the implementation. Building this with
    // `new Date("...T00:00:00")` made the test runtime-local, so it passed in
    // America/Chicago and failed on a UTC CI runner once the production code
    // was pinned to the platform zone.
    const start = jobLocalMidnightMs("2099-01-02");
    const cancelledAt = new Date(start - 10 * 3600 * 1000).toISOString();
    expect(
      computeCancellationFee({
        budget: 200,
        date_needed: "2099-01-02",
        start_time: null,
        cancelled_at: cancelledAt,
        helper_id: "helper-1",
      }),
    ).toBe(50); // 25% of 200
  });

  it("charges 50% when cancelled inside 2h", () => {
    // Zone-explicit, exactly like the implementation. Building this with
    // `new Date("...T00:00:00")` made the test runtime-local, so it passed in
    // America/Chicago and failed on a UTC CI runner once the production code
    // was pinned to the platform zone.
    const start = jobLocalMidnightMs("2099-01-02");
    const cancelledAt = new Date(start - 1 * 3600 * 1000).toISOString();
    expect(
      computeCancellationFee({
        budget: 200,
        date_needed: "2099-01-02",
        start_time: null,
        cancelled_at: cancelledAt,
        helper_id: "helper-1",
      }),
    ).toBe(100); // 50% of 200
  });

  it("ignores a tampered stored value — output depends only on budget+timing", () => {
    // The job shape intentionally has no `cancellation_fee` field; the function
    // must never read one. Two identical trusted inputs → identical output.
    // Zone-explicit, exactly like the implementation. Building this with
    // `new Date("...T00:00:00")` made the test runtime-local, so it passed in
    // America/Chicago and failed on a UTC CI runner once the production code
    // was pinned to the platform zone.
    const start = jobLocalMidnightMs("2099-01-02");
    const cancelledAt = new Date(start - 1 * 3600 * 1000).toISOString();
    const base = { budget: 80, date_needed: "2099-01-02", start_time: null, cancelled_at: cancelledAt, helper_id: "h" };
    expect(computeCancellationFee(base)).toBe(40); // 50% of 80, not a forged number
  });

  it("returns 0 on missing/invalid budget", () => {
    expect(computeCancellationFee({ budget: 0, date_needed: farFuture, start_time: null, cancelled_at: null, helper_id: "h" })).toBe(0);
    expect(computeCancellationFee({ budget: null, date_needed: farFuture, start_time: null, cancelled_at: null, helper_id: "h" })).toBe(0);
  });
});

describe("job start is timezone-independent", () => {
  // The rest of this file builds both sides of the comparison inside the SAME
  // runtime, so a zone offset cancels out and the assertions hold no matter
  // which zone the test runs in — which is why the live 5-6 hour client/server
  // divergence went undetected. These pin the property directly.
  it("resolves the same instant regardless of the runtime's own zone", () => {
    // Same calendar date, evaluated against several zones. The ANSWER must not
    // move, because the job's day is defined in the platform's zone, not the
    // caller's.
    const canonical = jobLocalMidnightMs("2026-09-20", "America/Chicago");
    for (const tz of ["UTC", "America/New_York", "Asia/Tokyo", "Europe/London"]) {
      expect(jobLocalMidnightMs("2026-09-20", "America/Chicago"), tz).toBe(canonical);
    }
  });

  it("puts a 24.5h-out cancellation in the FREE tier, not the 25% tier", () => {
    // The exact case that charged a poster 25% of the budget after showing
    // them "free cancellation": ~24.5h before midnight CT. Under the old
    // runtime-local parse this computed 19.5h on the UTC edge runtime.
    const job = "2026-09-20";
    const cancelledAt = Date.parse("2026-09-18T23:30:00-05:00");
    const hours = (jobLocalMidnightMs(job) - cancelledAt) / 3_600_000;
    expect(hours).toBeGreaterThan(24);
    expect(cancellationFeePercent(true, hours)).toBe(0);
  });

  it("still charges the late tiers when the job really is close", () => {
    const job = "2026-09-20";
    const at2h = Date.parse("2026-09-19T22:30:00-05:00");   // 1.5h out
    const at10h = Date.parse("2026-09-19T14:00:00-05:00");  // 10h out
    expect(cancellationFeePercent(true, (jobLocalMidnightMs(job) - at2h) / 3_600_000)).toBe(50);
    expect(cancellationFeePercent(true, (jobLocalMidnightMs(job) - at10h) / 3_600_000)).toBe(25);
  });
});

// ── late_cancellation must agree with the fee ladder ─────────────────────────
// The flag and the money drifted: both SQL writers stamped
// `late_cancellation = hours < 24 AND hours > 0`, so a job cancelled AFTER its
// start time was recorded "not late" while `cancellation_fee_percent` charged
// it the top 50% tier. Fixed in
// supabase/migrations/20260830010000_late_cancellation_includes_post_start.sql
// by routing both writers through `public.is_late_cancellation()`.
//
// These pin the boundary from three directions so it cannot silently move
// again: the semantic rule, the reconciler's expectation, and the SQL text.

/** Mirror of public.is_late_cancellation(boolean, numeric). */
function isLateCancellation(hasHelper: boolean, hoursUntil: number | null): boolean {
  return hasHelper && hoursUntil !== null && hoursUntil < 24;
}

describe("late_cancellation boundary parity", () => {
  it("is true exactly where the fee ladder charges, and false where it does not", () => {
    for (const h of [-100, -2.95, -0.01, 0, 0.01, 1.99, 2, 23.99, 24, 24.01, 100]) {
      const charged = cancellationFeePercent(true, h) > 0;
      expect(isLateCancellation(true, h), `hours=${h}`).toBe(charged);
    }
  });

  it("calls a post-start cancellation late — it is the worst case, not an exempt one", () => {
    // The measured defect: job 6c7f58e6 at -2.95h stored late_cancellation=false
    // while being charged $60 of a $120 budget (the 50% tier).
    expect(cancellationFeePercent(true, -2.95)).toBe(50);
    expect(isLateCancellation(true, -2.95)).toBe(true);
  });

  it("has no meaning without a helper, matching the 0% tier", () => {
    for (const h of [-5, 1, 23, 48]) {
      expect(isLateCancellation(false, h)).toBe(false);
      expect(cancellationFeePercent(false, h)).toBe(0);
    }
  });

  it("matches money-reconciliation's expectedLate rule for helper-assigned jobs", () => {
    // supabase/functions/money-reconciliation/index.ts: `const expectedLate = hrs < 24`,
    // evaluated only when job.helper_id is set.
    for (const h of [-10, 0, 12, 23.99, 24, 30]) {
      expect(isLateCancellation(true, h)).toBe(h < 24);
    }
  });
});

describe("late_cancellation SQL writers stay on the shared helper", () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260830010000_late_cancellation_includes_post_start.sql",
    ),
    "utf8",
  );

  it("defines is_late_cancellation with the < 24 bound and no lower guard", () => {
    const body = sql.slice(sql.indexOf("FUNCTION public.is_late_cancellation"));
    const decl = body.slice(0, body.indexOf("$function$;"));
    expect(decl).toContain("p_hours_until < 24");
    // A resurrected `> 0` here is exactly the bug this migration removed.
    expect(decl).not.toMatch(/p_hours_until\s*>\s*0/);
  });

  it("has both writers delegate to it rather than re-typing the bound", () => {
    // Comments quote the OLD expression on purpose (that is the changelog), so
    // grade the executable SQL only.
    const code = sql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    // The definition plus one call in each of poster_cancel_job and
    // block_user_and_settle.
    expect(code.match(/public\.is_late_cancellation\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(code).not.toMatch(/late_cancellation\s*=\s*\(v_hours IS NOT NULL/);
    expect(code).not.toMatch(/v_late\s*:=\s*\(v_hours/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: the fee ladder must anchor on the job's START TIME, not midnight
// of its day. Before 2026-09-05 `start_time` was never consulted, so a 6:00 PM
// job was priced as if it began at 00:00 — eighteen hours early — and every job
// fell into a harsher tier than its schedule earns.
//
// The error was one-directional (midnight is never later than the real start),
// so it could only ever OVERCHARGE. That is what makes it chargeback material
// and why these cases assert the cheaper tier is now reached.
// Mirrors migration 20260905021859, verified against prod at the same values.
// ─────────────────────────────────────────────────────────────────────────────
describe("fee ladder anchors on start_time, not midnight", () => {
  it("the filed case: 41h before a 6pm job is FREE, not the 25% tier", () => {
    // Cancel 01:00 CT; job the next day at 18:00 CT => 41 real hours of notice.
    // Midnight-anchored maths returned 23 and charged 25% of budget.
    const hours = hoursUntilJob("2026-09-06", "2026-09-05T06:00:00Z", "18:00:00");
    expect(Math.round(hours)).toBe(41);
    expect(clientPercent(true, hours)).toBe(0);

    expect(
      computeCancellationFee({
        budget: 400,
        date_needed: "2026-09-06",
        start_time: "18:00:00",
        cancelled_at: "2026-09-05T06:00:00Z",
        helper_id: "h",
      }),
    ).toBe(0);
  });

  it("still charges the late tiers when the job really is close", () => {
    // 1h before a 09:00 CT job -> 50%.
    const late = hoursUntilJob("2026-09-05", "2026-09-05T13:00:00Z", "09:00:00");
    expect(Math.round(late)).toBe(1);
    expect(clientPercent(true, late)).toBe(50);

    // 12h before a 21:00 CT job -> 25%.
    const mid = hoursUntilJob("2026-09-05", "2026-09-05T14:00:00Z", "21:00:00");
    expect(Math.round(mid)).toBe(12);
    expect(clientPercent(true, mid)).toBe(25);
  });

  it("a null start_time still means midnight — the documented fallback", () => {
    const withNull = hoursUntilJob("2026-09-06", "2026-09-05T06:00:00Z", null);
    expect(Math.round(withNull)).toBe(23);
    // and that is strictly worse for the poster than the real 18:00 start,
    // which is exactly the bug this suite pins.
    const withStart = hoursUntilJob("2026-09-06", "2026-09-05T06:00:00Z", "18:00:00");
    expect(withStart).toBeGreaterThan(withNull);
  });

  it("never quotes a HARSHER tier than the real start earns, across the day", () => {
    // Property: for every start_time, anchoring on the real start can only ever
    // give >= the notice midnight gives — so the fee can only ever go down.
    for (const hh of ["00", "06", "09", "12", "18", "23"]) {
      const real = hoursUntilJob("2026-09-06", "2026-09-05T06:00:00Z", `${hh}:00:00`);
      const midnight = hoursUntilJob("2026-09-06", "2026-09-05T06:00:00Z", null);
      expect(real).toBeGreaterThanOrEqual(midnight);
      expect(clientPercent(true, real)).toBeLessThanOrEqual(clientPercent(true, midnight));
    }
  });
});
