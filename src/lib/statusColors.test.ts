import { describe, it, expect } from "vitest";
import {
  JOB_STATUS_COLORS,
  FALLBACK_STATUS_COLOR,
  jobStatusColor,
  jobStatusColorClasses,
} from "./statusColors";

// Contract: every `job_status` enum value MUST have both a bg and a text
// color in the canonical map. If a new enum value lands, this file is the
// tripwire forcing the new entry — same shape as `statusLabels.test.ts`.

describe("JOB_STATUS_COLORS", () => {
  it("covers every value in the job_status Postgres enum", () => {
    // Mirror of the enum literal in src/integrations/supabase/types.ts —
    // if it grows, add the new value here AND to JOB_STATUS_COLORS.
    const required = [
      "open",
      "accepted",
      "in_progress",
      "completed",
      "cancelled",
      "revision_requested",
      "disputed",
    ] as const;
    for (const value of required) {
      const entry = JOB_STATUS_COLORS[value];
      expect(entry, `${value} missing from JOB_STATUS_COLORS`).toBeTruthy();
      expect(entry.bg, `${value} is missing a bg color`).toBeTruthy();
      expect(entry.text, `${value} is missing a text color`).toBeTruthy();
    }
  });

  it("uses the warm brand palette tokens — never raw Tailwind color names", () => {
    // All seven canonical colors should be expressed via the brand CSS
    // vars (`--olivewood`, `--bark`, `--burnt-sienna`, plus the amber
    // pending/revision pair). If a future edit reaches for `bg-red-500` or
    // `text-blue-700`, this catches it.
    const allowedTokens = ["--olivewood", "--bark", "--burnt-sienna", "--amber-tint", "--amber-ink"];
    for (const [value, color] of Object.entries(JOB_STATUS_COLORS)) {
      const blob = `${color.bg} ${color.text}`;
      const ok = allowedTokens.some((t) => blob.includes(t));
      expect(ok, `${value} should use a brand CSS var, got: ${blob}`).toBe(true);
    }
  });
});

describe("jobStatusColor()", () => {
  it("returns the canonical color for known statuses", () => {
    expect(jobStatusColor("in_progress").text).toBe("hsl(var(--burnt-sienna))");
    expect(jobStatusColor("completed").text).toBe("hsl(var(--bark))");
    expect(jobStatusColor("revision_requested").text).toBe("hsl(var(--amber-ink))");
  });

  it("falls back gracefully for unknown / null / undefined / empty", () => {
    // Defensive: a fresh enum value rolled out server-side before the
    // client deploys must NOT crash the chip render.
    expect(jobStatusColor("escrow_held")).toEqual(FALLBACK_STATUS_COLOR);
    expect(jobStatusColor(null)).toEqual(FALLBACK_STATUS_COLOR);
    expect(jobStatusColor(undefined)).toEqual(FALLBACK_STATUS_COLOR);
    expect(jobStatusColor("")).toEqual(FALLBACK_STATUS_COLOR);
  });
});

describe("jobStatusColorClasses()", () => {
  it("returns a className string keyed off the brand CSS vars", () => {
    expect(jobStatusColorClasses("in_progress")).toContain("--burnt-sienna");
    expect(jobStatusColorClasses("revision_requested")).toContain("--amber-ink");
    expect(jobStatusColorClasses("open")).toContain("--olivewood");
  });

  it("returns a non-empty fallback string for unknown / null", () => {
    expect(jobStatusColorClasses("escrow_held")).toBeTruthy();
    expect(jobStatusColorClasses(null)).toBeTruthy();
    expect(jobStatusColorClasses(undefined)).toBeTruthy();
  });
});
