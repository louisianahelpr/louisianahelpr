import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script, no type declarations
import { stripSqlComments } from "../../scripts/check-migration-raise-codes.mjs";

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
 * Four SQL producers write type 'job_match':
 *   1. notify_helpers_on_job_post        (trigger — parish fan-out)
 *   2. deliver_saved_search_alert        (saved searches: called only by
 *                                         the every-minute
 *                                         saved-search-alert-queue sweep;
 *                                         the trigger queues)
 *   3. sweep_daily_job_digest            (cron — daily parish digest)
 *   4. deliver_job_match                 (Q392: the job_match_queue send
 *                                         path for supabase/functions/
 *                                         instant-job-match and the parish
 *                                         fan-out's not-yet-visible users)
 * and the instant-job-match edge function drops muted users before it hands
 * its matches to enqueue_instant_job_match.
 *
 * Derived from the files, not from a hand-written list of four: the producer
 * set is recomputed here by scanning for the literal `'job_match'` write, so a
 * FIFTH producer added later fails this test until it is gated too. That is
 * the "registries checked against themselves" rule — the input is the world,
 * not the expectation.
 */

const repoRoot = resolve(__dirname, "../..");
const migrationsDir = resolve(repoRoot, "supabase/migrations");

/**
 * Every migration, in replay (lexical) order, WITH EVERY SQL COMMENT BLANKED.
 *
 * Without the blanking this whole file was satisfiable by prose. Measured
 * 2026-09-21 on 20260911201653: commenting out the live
 * `AND COALESCE(np.job_matches, true) IS TRUE` inside
 * `notify_saved_searches_on_new_job` — so every saved-search `job_match` row
 * and its push fire again for people who turned Job Matches OFF, the exact
 * decorative-toggle defect this file exists to prevent — left all six
 * assertions GREEN, because the dead comment still matched the COALESCE regex.
 *
 * `stripSqlComments` is a scanner, not a regex: `--` inside a single-quoted
 * literal is untouched, and comments are blanked rather than deleted so every
 * offset (the push-map seed scan below included) still lines up.
 */
const migrationSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({
    file: f,
    sql: stripSqlComments(readFileSync(resolve(migrationsDir, f), "utf8")) as string,
  }));

// An empty migrations directory would make every per-producer assertion below
// pass by describing nothing.
if (migrationSql.length < 50) {
  throw new Error(
    `only ${migrationSql.length} migrations found in ${migrationsDir} — this guard is reading nothing`,
  );
}

/**
 * Every `CREATE OR REPLACE FUNCTION public.<name>(...) ... AS <tag> body <tag>`
 * in one file, whatever the dollar-quote tag (`$$`, `$function$`, `$fn$`).
 * It used to match only `$function$` lazily, so a `$$` body let the match run
 * on into the NEXT function in the same file and read the wrong body (Q205b's
 * migration, 2026-09-23: CI red on three functions that were unchanged).
 */
function definitions(sql: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const head = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\(/gi;
  for (const m of sql.matchAll(head)) {
    const rest = sql.slice(m.index!);
    const open = /\bAS\s+(\$\w*\$)/i.exec(rest);
    if (!open) continue;
    const start = open.index + open[0].length;
    const end = rest.indexOf(open[1], start);
    if (end === -1) continue;
    out.push({ name: m[1], body: rest.slice(start, end) });
  }
  return out;
}

/**
 * A producer INSERTs a notifications row of type 'job_match'. Logging the word
 * into notification_logs (match_digest_queue_seed_boundary records a
 * suppressed seed row that way) produces nothing a user sees.
 */
const writesJobMatch = (body: string) =>
  /INSERT\s+INTO\s+public\.notifications\s*\([^)]*\)\s*(?:VALUES|SELECT)[\s\S]{0,600}?'job_match'/i.test(body);

/**
 * The LAST definition of a function in replay order — the one that is live.
 * Reading an earlier one is how a "verified" gate turns out to have been
 * replaced three migrations later.
 */
function liveFunctionBody(name: string): string {
  let body: string | null = null;
  for (const { sql } of migrationSql) {
    for (const d of definitions(sql)) if (d.name === name) body = d.body;
  }
  if (body === null) {
    throw new Error(
      `No CREATE OR REPLACE FUNCTION public.${name} found in supabase/migrations — ` +
        "it was renamed, and this assertion is now blind.",
    );
  }
  return body;
}

/** Producers discovered from the source tree, not asserted from memory. */
const SQL_PRODUCERS = [
  "deliver_job_match",
  "deliver_saved_search_alert",
  "notify_helpers_on_job_post",
  "sweep_daily_job_digest",
];

describe("job_match respects the user's Job Matches preference", () => {
  it("finds no SQL producer of 'job_match' outside the four we gate", () => {
    // The guard on the guard. If a later migration teaches a fourth function
    // to write this type, it shows up here before it ships unmuteable.
    const writers = new Set<string>();
    for (const { sql } of migrationSql) {
      for (const d of definitions(sql)) if (writesJobMatch(d.body)) writers.add(d.name);
    }
    // Only functions whose LIVE body still writes the type count.
    const live = [...writers].filter((n) => writesJobMatch(liveFunctionBody(n))).sort();
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
    expect(src).toMatch(/\.select\(\s*"user_id, job_matches"\s*\)/);
    // ...and actually skip on it. `=== false` not `!`: a NULL or an absent
    // column must read as ON.
    expect(src).toContain("if (p.job_matches === false) mutedMatches.add(p.user_id)");
    expect(src).toContain("if (mutedMatches.has(h.user_id)) continue;");
    // The skip must come BEFORE the one write (Q392: the queue RPC), or it
    // mutes nothing. deliver_job_match re-reads the switch at send time.
    const skipAt = src.indexOf("mutedMatches.has(h.user_id)");
    expect(skipAt).toBeGreaterThan(-1);
    expect(skipAt).toBeLessThan(src.indexOf('rpc("enqueue_instant_job_match"'));
    // It writes no notification and no digest row itself any more.
    expect(src).not.toMatch(/from\("notifications"\)|from\("match_digest_queue"\)/);
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

// Drop the Job Matches clause from the saved-search delivery path (immediate
// and deferred, V-008): every saved-search `job_match` row and its push fire
// again for accounts that turned the category OFF, including alerts that were
// waiting in saved_search_alert_queue when they turned it off.
// @mutate supabase/migrations/20260925053412_saved_search_alerts_wait_for_early_access.sql |      AND COALESCE(np.job_matches, true) IS TRUE; |      AND true;
