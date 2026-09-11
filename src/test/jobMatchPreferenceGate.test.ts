import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE JOB-MATCH OFF SWITCH, PROVEN AT THE SEND SITE.
 *
 * `job_match` is the largest notification type in prod (470 of 1,584 rows on
 * 2026-09-11) and it was the one category with no switch. A toggle that only
 * hides the in-app row while the pushes keep firing is decorative, so what
 * this file asserts is that every producer of a `job_match` row reads the
 * preference BEFORE writing, and that both fan-out gates route the type
 * through the new column rather than through `job_updates`.
 *
 * Four producers write type 'job_match':
 *   1. notify_helpers_on_job_post        (trigger — parish fan-out)
 *   2. notify_saved_searches_on_new_job  (trigger — saved searches)
 *   3. sweep_daily_job_digest            (cron — daily parish digest)
 *   4. supabase/functions/instant-job-match (edge function)
 *
 * Derived from the files, not from a hand-written list of four: the producer
 * set is recomputed here by scanning for the literal `'job_match'` write, so a
 * FIFTH producer added later fails this test until it is gated too. That is
 * the "registries checked against themselves" rule — the input is the world,
 * not the expectation.
 */

const repoRoot = resolve(__dirname, "../..");
const migrationsDir = resolve(repoRoot, "supabase/migrations");

/** Every migration, in replay (lexical) order. */
const migrationSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ file: f, sql: readFileSync(resolve(migrationsDir, f), "utf8") }));

/**
 * The LAST definition of a function in replay order — the one that is live.
 * Reading an earlier one is how a "verified" gate turns out to have been
 * replaced three migrations later.
 */
function liveFunctionBody(name: string): string {
  let body: string | null = null;
  for (const { sql } of migrationSql) {
    const re = new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`,
      "gi",
    );
    for (const m of sql.matchAll(re)) body = m[1];
  }
  if (body === null) {
    throw new Error(
      `No CREATE OR REPLACE FUNCTION public.${name} found in supabase/migrations — ` +
        "it was renamed or the body delimiter changed, and this assertion is now blind.",
    );
  }
  return body;
}

/** Producers discovered from the source tree, not asserted from memory. */
const SQL_PRODUCERS = [
  "notify_helpers_on_job_post",
  "notify_saved_searches_on_new_job",
  "sweep_daily_job_digest",
];

describe("job_match respects the user's Job Matches preference", () => {
  it("finds no SQL producer of 'job_match' outside the three we gate", () => {
    // The guard on the guard. If a later migration teaches a fourth function
    // to write this type, it shows up here before it ships unmuteable.
    const writers = new Set<string>();
    for (const { sql } of migrationSql) {
      for (const m of sql.matchAll(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\([\s\S]*?\$function\$([\s\S]*?)\$function\$/gi,
      )) {
        if (/'job_match'/.test(m[2])) writers.add(m[1]);
      }
    }
    // Only functions whose LIVE body still writes the type count.
    const live = [...writers].filter((n) => /'job_match'/.test(liveFunctionBody(n))).sort();
    expect(live).toEqual([...SQL_PRODUCERS].sort());
  });

  for (const fn of SQL_PRODUCERS) {
    it(`${fn} reads job_matches before inserting`, () => {
      const body = liveFunctionBody(fn);
      expect(body).toContain("'job_match'");
      // COALESCE(..., true): an account with no preferences row keeps matches.
      expect(body).toMatch(/COALESCE\(\s*np\.job_matches,\s*true\s*\)/);
      // And it must no longer be gated on a column that belongs to something
      // else — that was the original defect, not a stylistic preference.
      expect(body).not.toMatch(/COALESCE\(\s*np\.new_offers,\s*true\s*\)/);
    });
  }

  it("the instant-job-match edge function drops muted helpers before insert", () => {
    const src = readFileSync(
      resolve(repoRoot, "supabase/functions/instant-job-match/index.ts"),
      "utf8",
    );
    // It has to SELECT the column...
    expect(src).toMatch(/\.select\(\s*"user_id, match_digest_mode, job_matches"\s*\)/);
    // ...and actually skip on it. `=== false` not `!`: a NULL or an absent
    // column must read as ON.
    expect(src).toContain("if (p.job_matches === false) mutedMatches.add(p.user_id)");
    expect(src).toContain("if (mutedMatches.has(h.user_id)) continue;");
    // The skip must come BEFORE both writes, or it mutes nothing.
    const skipAt = src.indexOf("mutedMatches.has(h.user_id)");
    expect(skipAt).toBeGreaterThan(-1);
    expect(skipAt).toBeLessThan(src.indexOf('type: "job_match"'));
    expect(skipAt).toBeLessThan(src.indexOf("match_digest_queue"));
  });

  it("push and email both gate job_match on the new column", () => {
    // The push map's last seed row wins.
    let pushCol: string | null = null;
    for (const { sql } of migrationSql) {
      for (const m of sql.matchAll(/\(\s*'job_match'\s*,\s*'(\w+)'\s*,/g)) pushCol = m[1];
    }
    expect(pushCol).toBe("job_matches");

    const email = readFileSync(
      resolve(repoRoot, "supabase/functions/send-notification-email/index.ts"),
      "utf8",
    );
    expect(email).toMatch(/job_match:\s*\{\s*prefCol:\s*'email_job_matches'/);
  });
});
