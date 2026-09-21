import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * No anon-reachable open-jobs surface may return a street address.
 *
 * This is the regression test TODO.md's F-DISC-01 has asked for since the
 * leak was first closed, and its absence was the only reason that entry
 * stayed open. Both halves of the fix are long shipped — the leaky view is
 * gone (`20260618120000:64` drops `public.open_jobs_safe`) and the ranked
 * feed wraps the column (`public.mask_job_location(location) AS location`) —
 * but nothing stopped a later migration from quietly handing back the raw
 * value again. `CREATE OR REPLACE FUNCTION` makes that a one-word edit in a
 * file nobody diffs closely, and the result is invisible: the feed keeps
 * working, the addresses just get more precise.
 *
 * The exposure is real, not theoretical. The live post path still writes the
 * full street to `jobs.location` (`src/pages/postjob/jobSubmitHelpers.ts`),
 * so the data is there to leak; it is latent only because current rows
 * happen to carry no street numbers. A single job posted with a house number
 * would publish that address to every logged-out visitor.
 *
 * FILENAMES-AND-TEXT ONLY, deliberately, for the same reason
 * migrationVersions.test.ts is: no database, no network, no Supabase CLI, so
 * it runs on every push in milliseconds. A PGlite version could execute the
 * masking for real, but `@electric-sql/pglite` is intentionally not a
 * dependency of this repo, so such a test could never run in CI — which is
 * exactly where this guard has to fire.
 *
 * FOUND HOLLOW 2026-09-21, shape (1) "satisfiable by a comment". It passed
 * 4/4 with `get_public_open_jobs` returning `j.location` RAW — every
 * logged-out visitor served the street address F-DISC-01 is about — because
 * the removed call was left behind as `-- public.mask_job_location(j.location)`
 * and `/mask_job_location\s*\(/` matched the dead comment. Every migration is
 * now read comment-BLANKED, and the inventories are floored.
 */
// @mutate supabase/migrations/20260904203654_browse_hides_jobs_above_helper_credential_tier.sql | j.category::text,\n         public.mask_job_location(j.location) AS location, | j.category::text,\n         j.location AS location, -- public.mask_job_location(j.location)

const migrationsDir = resolve(__dirname, "../../supabase/migrations");

/**
 * Blank every SQL comment, preserving byte offsets and line count. `--` inside
 * a single-quoted literal is data, not a comment, and is left alone.
 */
export function blankSqlComments(sql: string): string {
  const out = sql.split("");
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") { out[i] = " "; i++; }
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      for (let k = i; k < stop; k++) if (sql[k] !== "\n") out[k] = " ";
      i = stop;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** Every migration, oldest first — the order Postgres applies them in. */
function migrationsInOrder(): { name: string; sql: string }[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: blankSqlComments(readFileSync(resolve(migrationsDir, name), "utf8")) }));
}

/**
 * The text of every `CREATE [OR REPLACE] FUNCTION public.<name>` body in a
 * file, keyed by function name. Bodies are dollar-quoted (`$$`, `$fn$`,
 * `$function$`), so the tag that opens the body is the tag that closes it.
 */
function functionBodies(sql: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const name = m[1].toLowerCase();
    const open = sql.slice(m.index).match(/\$([a-z0-9_]*)\$/i);
    if (!open) continue;
    const tag = open[0];
    const bodyStart = m.index + (open.index ?? 0) + tag.length;
    const bodyEnd = sql.indexOf(tag, bodyStart);
    if (bodyEnd === -1) continue;
    // A later definition in the same file supersedes an earlier one.
    out.set(name, sql.slice(m.index, bodyEnd));
  }
  return out;
}

/** The LAST definition of each function across the whole migration history. */
function latestDefinitions(): Map<string, { file: string; body: string }> {
  const latest = new Map<string, { file: string; body: string }>();
  for (const { name, sql } of migrationsInOrder()) {
    for (const [fn, body] of functionBodies(sql)) latest.set(fn, { file: name, body });
  }
  return latest;
}

/**
 * Functions whose EXECUTE is granted to `anon` and not later revoked.
 * Grants and revokes are replayed in migration order so a function that was
 * opened and then closed again does not count as exposed.
 */
function anonExecutable(): Set<string> {
  const granted = new Set<string>();
  for (const { sql } of migrationsInOrder()) {
    const stmts = sql.split(";");
    for (const stmt of stmts) {
      const m = stmt.match(/\b(GRANT|REVOKE)\s+(?:ALL|EXECUTE)[\s\S]*?ON\s+FUNCTION\s+public\.([a-z0-9_]+)/i);
      if (!m) continue;
      // `REVOKE ... FROM PUBLIC, anon` and `GRANT ... TO anon, authenticated`
      // both mention anon; PUBLIC implies anon too.
      if (!/\b(anon|public)\b/i.test(stmt.split(/\bTO\b|\bFROM\b/i).slice(1).join(" "))) continue;
      const fn = m[2].toLowerCase();
      if (m[1].toUpperCase() === "GRANT") granted.add(fn);
      else granted.delete(fn);
    }
  }
  return granted;
}

describe("anon open-jobs surfaces never return a raw street address", () => {
  const latest = latestDefinitions();

  it("reads a real inventory (an empty walk would pass every check below)", () => {
    // Floors on the CONSTRUCTS, not the file count: a parser that silently
    // matched nothing would make the sweep below vacuous.
    expect(migrationsInOrder().length, "no migrations parsed").toBeGreaterThan(100);
    expect(latest.size, "no CREATE FUNCTION bodies parsed").toBeGreaterThan(100);
    expect(anonExecutable().size, "no anon EXECUTE grants parsed").toBeGreaterThan(5);
    // The comment blanker is load-bearing; prove it on both shapes.
    expect(blankSqlComments("SELECT 1; -- mask_job_location(x)\nSELECT 2;")).not.toMatch(/mask_job_location/);
    expect(blankSqlComments("SELECT '-- not a comment' AS s;")).toContain("-- not a comment");
  });

  // The two RPCs that actually serve logged-out visitors. Named explicitly
  // rather than only swept for, so a rename or a deletion fails loudly here
  // instead of silently shrinking the generic check below to nothing.
  const KNOWN_ANON_JOB_FEEDS = ["get_public_open_jobs", "get_ranked_open_jobs"];

  it.each(KNOWN_ANON_JOB_FEEDS)("%s still masks the location column", (fn) => {
    const def = latest.get(fn);
    expect(def, `${fn} has no CREATE FUNCTION in supabase/migrations`).toBeDefined();
    expect(
      def!.body,
      `${fn} (latest definition in ${def!.file}) no longer calls mask_job_location. ` +
        `This RPC is granted to anon, so its location column is published to every ` +
        `logged-out visitor. See TODO.md F-DISC-01.`,
    ).toMatch(/mask_job_location\s*\(/i);
  });

  /**
   * The generalisation, and the half that catches the NEXT one: any function
   * anon can execute that returns a `location` column must mask it. A raw
   * `location` is permitted only behind an `auth.uid()` test — the ranked
   * feed legitimately hands the exact address to the one helper a job has
   * been offered to.
   */
  it("no anon-executable job feed returns an unmasked location column", () => {
    const anon = anonExecutable();
    const offenders: string[] = [];
    let feedsExamined = 0;
    for (const fn of anon) {
      const def = latest.get(fn);
      if (!def) continue;
      const returnsLocation = /RETURNS\s+TABLE\s*\([\s\S]*?\blocation\s+text\b/i.test(def.body);
      if (!returnsLocation) continue;
      // "Is this an open-JOBS feed?" is decided by the return signature, not
      // by whether the body mentions `public.jobs` — `get_top_helpers_by_parish`
      // joins jobs to count completed work while its `location` comes from
      // `profiles`, and it must not be caught here. `date_needed` and `budget`
      // are columns only a job row has, so requiring one of them alongside
      // `location text` identifies a job feed exactly.
      //
      // The distinction is not cosmetic. `jobs.location` is filled by the post
      // form with a full street address and is what F-DISC-01 is about.
      // `profiles.location` is free text a helper writes about themselves and
      // is deliberately public in the helper directory; masking it would be
      // wrong, not safer. (Worth knowing separately: that RPC is granted to
      // anon and is called from nowhere in `src/` — a dead public surface,
      // reported rather than silently allowlisted here.)
      const returnsJobColumn = /RETURNS\s+TABLE\s*\([\s\S]*?\b(date_needed\s+date|budget\s+numeric)\b/i.test(def.body);
      if (!returnsJobColumn) continue;
      feedsExamined++;
      const masks = /mask_job_location\s*\(/i.test(def.body);
      const gatedOnCaller = /auth\.uid\s*\(\s*\)/i.test(def.body);
      if (!masks && !gatedOnCaller) offenders.push(`${fn} (${def.file})`);
    }
    expect(
      offenders,
      "These anon-executable functions return a `location text` column without " +
        "mask_job_location and without an auth.uid() gate, so a job posted with a " +
        "house number would publish that street address publicly:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
    // Floor the sweep itself: zero feeds examined means the signature filter
    // stopped matching and this assertion proved nothing.
    expect(feedsExamined, "the anon job-feed sweep matched no function at all").toBeGreaterThanOrEqual(
      KNOWN_ANON_JOB_FEEDS.length,
    );
  });

  /**
   * `open_jobs_safe` was anon-SELECTable and returned the raw column; it was
   * dropped, and it must stay dropped. A view has no RLS of its own, so
   * re-creating it re-opens the leak without touching either RPC above.
   */
  it("the open_jobs_safe view is never re-created after its DROP", () => {
    const files = migrationsInOrder();
    const dropIdx = files.findIndex((f) => /DROP\s+VIEW\s+(IF\s+EXISTS\s+)?public\.open_jobs_safe/i.test(f.sql));
    expect(dropIdx, "the DROP VIEW public.open_jobs_safe migration is missing").toBeGreaterThanOrEqual(0);
    const recreated = files
      .slice(dropIdx + 1)
      .filter((f) => /CREATE\s+(OR\s+REPLACE\s+)?VIEW\s+public\.open_jobs_safe/i.test(f.sql))
      .map((f) => f.name);
    expect(recreated, `open_jobs_safe was re-created after being dropped`).toEqual([]);
  });
});
