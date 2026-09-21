import { describe, it, expect } from "vitest";
import {
  JOB_STATUS_COLORS,
  FALLBACK_STATUS_COLOR,
  jobStatusColor,
  jobStatusColorClasses,
} from "./statusColors";
import { Constants } from "@/integrations/supabase/types";

// Contract: every `job_status` enum value MUST have both a bg and a text
// color in the canonical map. If a new enum value lands, this file is the
// tripwire forcing the new entry — same shape as `statusLabels.test.ts`.

describe("JOB_STATUS_COLORS", () => {
  it("covers every value in the job_status Postgres enum", () => {
    // DERIVED from the generated enum, not mirrored by hand. The mirror
    // was already stale — seven of the eight values — so "covers every
    // value in the job_status enum" was true of the list and false of the
    // enum. See the same fix in statusLabels.test.ts.
    const required = Constants.public.Enums.job_status;
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
    expect(jobStatusColor("in_progress").text).toBe("hsl(var(--sienna-ink))");
    expect(jobStatusColor("completed").text).toBe("hsl(var(--sage-ink))");
    expect(jobStatusColor("revision_requested").text).toBe("hsl(var(--amber-ink))");
  });

  it("labels every status with a theme-adaptive -ink token, never a raw brand hue", () => {
    // The defect this guards: a raw brand hue (--bark, --burnt-sienna) has a
    // dark value tuned for ACCENTS, not for 9px text sitting on its own tint.
    // Measured on the dark canvas before the fix: "In progress" 3.83:1,
    // "Completed" 4.28:1, "Disputed" 3.52:1 — all under AA, on the chips whose
    // whole job is to be read at a glance. Every -ink token in the palette
    // carries a light AND a dark value chosen for label duty.
    //
    // `--olivewood` is the deliberate exception: it is the app's neutral text
    // hue, already theme-adaptive, and measures 7.75:1 on its own tint.
    const ADAPTIVE = /--(\w+-)?ink\b|--olivewood/;
    for (const [status, { text }] of Object.entries(JOB_STATUS_COLORS)) {
      expect(text, `${status} label`).toMatch(ADAPTIVE);
    }
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

describe("STATUS_COLOR_CLASSES (the className mirror)", () => {
  it("covers every job_status enum value — no status falls to the fallback", () => {
    // The style-prop map above is checked against the enum; the className map
    // was checked against THREE hand-picked statuses, so a missing key was
    // indistinguishable from a present one (both return a truthy string). An
    // enum value with no entry silently paints the neutral fallback on every
    // Tailwind-driven chip while the style-driven chips paint correctly.
    for (const value of Constants.public.Enums.job_status) {
      expect(
        jobStatusColorClasses(value),
        `${value} falls through to FALLBACK in the className map`,
      ).not.toBe(jobStatusColorClasses("definitely-not-a-status"));
    }
  });

  /*
   * BOTH tokens now — the drift this was scoped around is fixed.
   *
   * It was correctly scoped to `bg` when written: `accepted` disagreed on the
   * TEXT token, because the AA contrast sweep replaced the raw accent hues
   * with `-ink` values in the style map and left this mirror behind.
   * `completed` on the next line had been updated; `accepted` had not. Every
   * chip painted through `jobStatusColorClasses("accepted")` kept the
   * pre-sweep colour, measured 4.28:1 on dark — under the 4.5:1 AA floor for
   * text that size.
   *
   * Scoping to bg was the right call at the time (asserting text would have
   * reddened main over a defect the lane had not been asked to fix). Now the
   * production line is fixed, so the assertion widens to cover what the sweep
   * was actually about — the two maps painting the same LABEL colour.
   */
  it("paints the same background AND text tokens as the style-prop map", () => {
    for (const value of Constants.public.Enums.job_status) {
      const cls = jobStatusColorClasses(value);
      for (const half of ["bg", "text"] as const) {
        const token = JOB_STATUS_COLORS[value][half].match(/--[a-z-]+/)![0];
        expect(
          cls,
          `${value}: the className map's ${half} disagrees with the style map. Two maps painting ` +
            `one chip differently is how the AA sweep's fix got half-applied — the style prop was ` +
            `corrected and this mirror kept the failing hue.`,
        ).toContain(token);
      }
    }
  });
});

// @mutate src/lib/statusColors.ts | in_progress:        { bg: "hsl(var(--burnt-sienna) / 0.12)", text: "hsl(var(--sienna-ink))" }, | in_progress:        { bg: "hsl(var(--burnt-sienna) / 0.12)", text: "hsl(var(--burnt-sienna))" },
// @mutate src/lib/statusColors.ts | pending_approval:   "bg-[hsl(var(--amber-tint)/0.14)] text-[hsl(var(--amber-ink))]", | pending_approvalX:  "bg-[hsl(var(--amber-tint)/0.14)] text-[hsl(var(--amber-ink))]",
