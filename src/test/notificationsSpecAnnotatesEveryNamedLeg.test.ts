import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Q230 (2026-09-23): e2e/journeys/notifications/notifications.spec.ts's
 * header claimed every leg needing a third account or a paid tip was
 * "annotated uncovered, never silently skipped" — but direct offer,
 * saved-search match, job-match fan-out, tip, and cron notifications had NO
 * mention at all: no test, no skipUncovered/announceUncovered call, nothing
 * a reader could distinguish from a leg nobody had thought of.
 *
 * This holds the claim to the file two-way: every leg in NAMED_LEGS must be
 * mentioned (a real name check, not a substring anyone could type once and
 * forget), and NAMED_LEGS itself is sourced from the actual server-side
 * trigger functions (grep supabase/migrations), not hand-typed prose, so a
 * leg dropped from this list without the trigger disappearing would be a
 * silent narrowing of what "every named leg" means.
 */
const SPEC_PATH = "e2e/journeys/notifications/notifications.spec.ts";
const readSpec = () => readFileSync(resolve(__dirname, "../..", SPEC_PATH), "utf8");

/*
 * `phrase` is the exact test title this file's own annotation test uses —
 * not a bare word like "tip", which the header prose ("or a paid tip") could
 * satisfy by accident with no real annotation behind it at all. That exact
 * collision is why the red-proof below matches on `phrase`, not `leg`.
 */
const NAMED_LEGS = [
  { leg: "direct-offer", trigger: "notify_helper_on_direct_offer", phrase: "direct-offer notification is not exercised here" },
  { leg: "saved-search-match", trigger: "notify_saved_searches_on_new_job", phrase: "saved-search-match notification is not exercised here" },
  { leg: "job-match fan-out", trigger: "notify_helpers_on_job_post", phrase: "job-match fan-out notification is not exercised here" },
  { leg: "tip", trigger: "notify_helper_on_tip", phrase: "tip notification is not exercised here" },
  { leg: "cron", trigger: "sweep_job_start_reminders", phrase: "cron notifications are not exercised here" },
] as const;

describe("notifications.spec.ts names every leg it claims to annotate uncovered", () => {
  it("every NAMED_LEGS trigger function still exists in the migration corpus", () => {
    const dir = resolve(__dirname, "../../supabase/migrations");
    for (const { leg, trigger } of NAMED_LEGS) {
      const found = (() => {
        try {
          return execFileSync("grep", ["-rl", `CREATE OR REPLACE FUNCTION public.${trigger}`, dir], { encoding: "utf8" });
        } catch {
          return "";
        }
      })();
      expect(found.trim().length, `${leg}: no migration defines public.${trigger} any more — update NAMED_LEGS`).toBeGreaterThan(0);
    }
  });

  it("the spec mentions every named leg by its exact annotation phrase", () => {
    const src = readSpec();
    const missing = NAMED_LEGS.filter(({ phrase }) => !src.includes(phrase)).map(({ leg }) => leg);
    expect(missing, `notifications.spec.ts no longer names: ${missing.join(", ")}`).toEqual([]);
  });

  it("the spec's header claims to annotate legs needing a third account or a paid tip", () => {
    expect(readSpec()).toMatch(/annotated uncovered, never\s*\n?\s*silently skipped/);
  });
});

// @mutate e2e/journeys/notifications/notifications.spec.ts | "direct-offer notification is not exercised here" | "REMOVED for the mutation proof"
