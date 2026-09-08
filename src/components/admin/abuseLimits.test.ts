import { describe, it, expect } from "vitest";
import {
  ABUSE_LIMITS,
  allCapsOff,
  capInputValue,
  describeCap,
  parseCapInput,
  type AbuseLimitKey,
} from "./abuseLimits";

/**
 * This file is the substitute for driving the control by eye. An admin session
 * is not mintable here, so what gets proved instead is the property the screen
 * depends on: blank, "0" and a negative are ONE state (no limit), that state
 * round-trips through the stored value unchanged, and the sentence shown back
 * to the operator says which of the two things just happened.
 */

const KEYS = ABUSE_LIMITS.map((l) => l.key);

describe("parseCapInput", () => {
  it.each(["", "   ", "0", "00", "-1", "-9999"])(
    "%j means no limit",
    (raw) => {
      expect(parseCapInput(raw)).toEqual({ ok: true, value: null });
    },
  );

  it("reads a positive whole number as itself", () => {
    expect(parseCapInput("15")).toEqual({ ok: true, value: 15 });
    expect(parseCapInput(" 200 ")).toEqual({ ok: true, value: 200 });
    expect(parseCapInput("1")).toEqual({ ok: true, value: 1 });
  });

  it.each(["1.5", "ten", "1e3", "15px", "٣"])("%j is refused, not coerced", (raw) => {
    const parsed = parseCapInput(raw);
    expect(parsed.ok).toBe(false);
  });

  it("refuses a number so large it is not a limit", () => {
    const parsed = parseCapInput("100001");
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toMatch(/100,000/);
  });

  it("accepts the boundary", () => {
    expect(parseCapInput("100000")).toEqual({ ok: true, value: 100_000 });
  });
});

describe("capInputValue", () => {
  it("renders every off-state as an empty box, never as '0'", () => {
    for (const stored of [null, undefined, 0, -3, Number.NaN]) {
      expect(capInputValue(stored as number | null)).toBe("");
    }
  });

  it("round-trips a real cap", () => {
    for (const n of [1, 15, 200, 100_000]) {
      const shown = capInputValue(n);
      expect(parseCapInput(shown)).toEqual({ ok: true, value: n });
    }
  });

  it("round-trips every off-state back to null", () => {
    for (const stored of [null, 0, -1]) {
      expect(parseCapInput(capInputValue(stored))).toEqual({ ok: true, value: null });
    }
  });
});

describe("describeCap", () => {
  it("says NO LIMIT — not 'saved' — when a cap is turned off", () => {
    for (const key of KEYS) {
      const text = describeCap(key, null);
      expect(text).toMatch(/NO LIMIT/);
      expect(text).toMatch(/nothing is being enforced/);
    }
  });

  it("names the number, the unit and the window when a cap is on", () => {
    expect(describeCap("daily_application_cap", 15)).toBe(
      "Applications per day: 15 applications per rolling 24 hours.",
    );
    expect(describeCap("application_cap_per_minute", 10)).toBe(
      "Applications per minute: 10 applications per minute.",
    );
    expect(describeCap("signup_rate_limit_per_hour", 5)).toBe(
      "Signup completions per hour: 5 signup completions per hour.",
    );
  });

  it("does not pluralise a cap of one", () => {
    expect(describeCap("daily_application_cap", 1)).toBe(
      "Applications per day: 1 application per rolling 24 hours.",
    );
  });
});

describe("allCapsOff", () => {
  it("is true for the shipped default — every column NULL", () => {
    expect(allCapsOff({})).toBe(true);
    expect(allCapsOff(Object.fromEntries(KEYS.map((k) => [k, null])))).toBe(true);
  });

  it("treats 0 and negatives as off, matching the database's normalisation", () => {
    expect(allCapsOff(Object.fromEntries(KEYS.map((k) => [k, 0])))).toBe(true);
    expect(allCapsOff(Object.fromEntries(KEYS.map((k) => [k, -5])))).toBe(true);
  });

  it("is false as soon as ANY single one is enforcing", () => {
    for (const key of KEYS) {
      const values = Object.fromEntries(KEYS.map((k) => [k, null])) as Record<
        AbuseLimitKey,
        number | null
      >;
      values[key] = 1;
      expect(allCapsOff(values)).toBe(false);
    }
  });
});

describe("the four keys are the four database columns", () => {
  // Derived from the world, not restated: a column renamed in a later
  // migration without this list moving would otherwise write a patch Postgres
  // rejects with 42703, which the screen surfaces as "not live yet" — a
  // permanently wrong explanation.
  it("matches the columns 20260907230038 adds", () => {
    expect(KEYS.slice().sort()).toEqual([
      "application_cap_per_hour",
      "application_cap_per_minute",
      "daily_application_cap",
      "signup_rate_limit_per_hour",
    ]);
  });
});
