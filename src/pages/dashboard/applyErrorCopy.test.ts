import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveApplyErrorCopy } from "./applyErrorCopy";

/**
 * The reason this test exists: the daily-application-limit refusal used to be
 * matched by exact string, and migration 20260907230038 made the trigger
 * interpolate the configured cap. A miss here is not cosmetic — the helper
 * falls through to a generic toast with a Retry button, for a refusal that
 * re-fails identically every time it is retried.
 */
describe("resolveApplyErrorCopy", () => {
  it("maps the daily-limit refusal for ANY configured cap", () => {
    for (const cap of [1, 3, 15, 200, 100_000]) {
      const raised = `You have reached the daily application limit (${cap}). Please try again tomorrow.`;
      expect(resolveApplyErrorCopy(raised)).toBe(
        "You've hit today's application limit — check back tomorrow.",
      );
    }
  });

  it("still maps the old hard-coded (15) sentence", () => {
    // Prod may raise the pre-migration message for as long as the deploy is in
    // flight, so both shapes have to resolve.
    expect(
      resolveApplyErrorCopy(
        "You have reached the daily application limit (15). Please try again tomorrow.",
      ),
    ).toBe("You've hit today's application limit — check back tomorrow.");
  });

  it("does not name a number in the copy", () => {
    const copy = resolveApplyErrorCopy(
      "You have reached the daily application limit (15). Please try again tomorrow.",
    );
    expect(copy).not.toMatch(/\d/);
  });

  it("keeps the exact-match refusals working", () => {
    expect(resolveApplyErrorCopy("Already applied to this job")).toBe(
      "You've already applied to this job.",
    );
    expect(resolveApplyErrorCopy("Cannot apply to your own job")).toBe(
      "You can't apply to your own post.",
    );
    expect(resolveApplyErrorCopy("Job not found")).toBe("This job is no longer available.");
    expect(resolveApplyErrorCopy("Job is no longer accepting applications")).toBe(
      "This job isn't accepting applications anymore.",
    );
    expect(resolveApplyErrorCopy("credential_tier_required")).toMatch(/license or insurance/);
  });

  it("falls through for anything unrecognised", () => {
    for (const msg of ["", null, undefined, "boom", "daily application limit"]) {
      expect(resolveApplyErrorCopy(msg)).toBeNull();
    }
  });

  it("matches the message the migration actually raises", () => {
    // Derived from the migration file rather than restated, so a reword of the
    // trigger's sentence fails HERE instead of silently un-mapping in prod.
    const migration = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../supabase/migrations/20260907230038_application_and_signup_caps_admin_adjustable.sql",
      ),
      "utf8",
    );
    const m = migration.match(/RAISE EXCEPTION '(You have reached the daily application limit[^']*)'/);
    expect(m, "the trigger's RAISE was not found — did the message move?").toBeTruthy();
    const raised = m![1].replace("%", "15");
    expect(resolveApplyErrorCopy(raised)).toBe(
      "You've hit today's application limit — check back tomorrow.",
    );
  });
});
