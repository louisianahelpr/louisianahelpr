// PROVEN ABLE TO FAIL: deleting one leg's annotation test from the spec turns
// "every leg has its own skipUncovered test" red.
// @mutate e2e/journeys/notifications/notifications.spec.ts | test("tip notification is not exercised here" | test.skip("tip notification is not exercised here"

/**
 * Q230: e2e/journeys/notifications/notifications.spec.ts says legs it cannot
 * drive "are annotated uncovered, never silently skipped", but direct offer,
 * saved-search match, job-match fan-out, tip and cron notifications had no test
 * and no annotation at all. Each now has its own test that calls
 * skipUncovered(); this holds the spec to that, in code (comments blanked), and
 * holds every named server function to still existing in the migration corpus
 * so the reasons do not rot.
 *
 * Trigger/cron wiring for these functions was read live on prod 2026-09-27
 * (pg_trigger + cron.job): all nine exist and are wired.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const SPEC = resolve(ROOT, "e2e/journeys/notifications/notifications.spec.ts");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

const LEGS = [
  { title: "direct-offer notification is not exercised here", fns: ["notify_helper_on_direct_offer"] },
  { title: "saved-search-match notification is not exercised here", fns: ["notify_saved_searches_on_new_job"] },
  { title: "job-match fan-out notification is not exercised here", fns: ["notify_helpers_on_job_post"] },
  { title: "tip notification is not exercised here", fns: ["notify_helper_on_tip"] },
  {
    title: "cron notifications are not exercised here",
    fns: [
      "sweep_job_start_reminders",
      "sweep_no_show_alerts",
      "sweep_daily_job_digest",
      "sweep_dayof_confirm_reminders",
      "sweep_release_last_chance",
    ],
  },
] as const;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The body of `test("<title>", async () => { ... })` must call skipUncovered(. */
export function legIsAnnotated(code: string, title: string): boolean {
  const re = new RegExp(`\\btest\\(\\s*"${esc(title)}"\\s*,\\s*async\\s*\\(\\)\\s*=>\\s*\\{\\s*skipUncovered\\(`);
  return re.test(code);
}

describe("notifications.spec.ts names every leg it cannot drive (Q230)", () => {
  const code = blankComments(readFileSync(SPEC, "utf8"));

  it("the checker can fail (fixture)", () => {
    expect(legIsAnnotated('test("x leg", async () => {\n skipUncovered("a", "b");', "x leg")).toBe(true);
    expect(legIsAnnotated('// test("x leg", async () => { skipUncovered(', "x leg")).toBe(true); // raw text: caller blanks comments
    expect(legIsAnnotated(blankComments('// test("x leg", async () => { skipUncovered(\n'), "x leg")).toBe(false);
    expect(legIsAnnotated('test("x leg", async () => {\n expect(1).toBe(1);', "x leg")).toBe(false);
  });

  it("inventory: exactly 5 legs, 9 server functions", () => {
    expect(LEGS.length).toBe(5);
    expect(LEGS.flatMap((l) => l.fns).length).toBe(9);
  });

  it("every leg has its own skipUncovered test in code", () => {
    const missing = LEGS.filter((l) => !legIsAnnotated(code, l.title)).map((l) => l.title);
    expect(missing, `notifications.spec.ts no longer annotates: ${missing.join("; ")}`).toEqual([]);
  });

  it("the header still makes the claim these tests back", () => {
    expect(readFileSync(SPEC, "utf8")).toMatch(/annotated\s+(?:\*\s+)?uncovered, never silently skipped/);
  });

  it("every named server function is still defined by a migration", () => {
    const corpus = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => blankSqlComments(readFileSync(resolve(MIGRATIONS, f), "utf8")))
      .join("\n");
    const gone = LEGS.flatMap((l) => l.fns).filter(
      (fn) => !new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?"?${fn}"?\\s*\\(`, "i").test(corpus),
    );
    expect(gone, `no migration defines: ${gone.join(", ")}; update the spec's reasons and LEGS`).toEqual([]);
  });
});
