/**
 * GUARD (Q782, owner 2026-09-27): every writer of `public.jobs` fits the
 * database's text bounds.
 *
 * The post-job form caps a title at 32 characters and a description at 1000.
 * Nothing below the form did, so seeders, e2e fixtures, race probes and the
 * STR iCal sync wrote titles up to 63 characters (211 seed rows on prod,
 * measured 2026-09-27). Migration 20260927211133 adds the CHECKs
 * jobs_title_length / jobs_description_length. From then on an over-long title
 * is not a cosmetic defect: Postgres refuses the insert with 23514 and the
 * nightly journey that wrote it goes red.
 *
 * Three layers, held together here:
 *   1. The NEWEST migration that adds each CHECK carries the same number as the
 *      form (detailsSectionConstants.ts) and as scripts/lib/jobTextBounds.mjs,
 *      the helper every non-form writer uses.
 *   2. Every non-form writer file (an insert into jobs, found from source): a
 *      `title:` that is a literal is at most 32 characters, and one built from
 *      a template with `${...}` goes through `fitJobTitle(...)`, which throws
 *      with the title's length before Postgres can reject it mid-journey.
 *   3. An edge function builds its title from a template only with a
 *      code-point `.slice(0, 32)` (edge functions cannot import the scripts
 *      helper). Titles copied from another row (charge-recurring-visits copies
 *      the parent's) are already inside the CHECK.
 *
 *   4. Raw SQL writers (`INSERT INTO [public.]jobs (...) VALUES|SELECT`) in
 *      CI workflows, scripts, supabase/seed*.sql and e2e: a literal title or
 *      description at the column's position fits. FOUND 2026-09-27: the first
 *      db-deploy after the CHECK went red because db-smoke.yml's smoke insert
 *      titled its job '[CI smoke] post-job trigger check' (33), and
 *      supabase/seed.sql / seed-demo-data.sql held 9 more over 32.
 *      src/test/pglite is out of scope: each of those loads hand-picked
 *      migrations, never the CHECK.
 *
 * e2e/happy-path is excluded: it mocks Supabase and never reaches Postgres.
 *
 * @mutate supabase/migrations/20260927211133_jobs_title_description_length_checks.sql | CHECK (char_length(title) <= 32) | CHECK (char_length(title) <= 40)
 * @mutate supabase/migrations/20260927211133_jobs_title_description_length_checks.sql | CHECK (char_length(description) <= 1000) | CHECK (char_length(description) <= 4000)
 * @mutate scripts/lib/jobTextBounds.mjs | export const JOB_TITLE_MAX = 32; | export const JOB_TITLE_MAX = 40;
 * @mutate scripts/probes/completion-race.prod.mjs | title: fitJobTitle(`RACE-COMPLETE ${label} ${tag()}`), | title: `RACE-COMPLETE ${label} ${tag()}`,
 * @mutate e2e/journeys/abuse/idor-and-authz.spec.ts | fitJobTitle(`${E2E_TITLE_MARKER} idor ${runTag(runId, 7)}`) | `${E2E_TITLE_MARKER} idor ${runTag(runId, 7)}`
 * @mutate supabase/functions/str-ical-sync/index.ts | ${propName}`).slice(0, 32) | ${propName}`).slice(0, 40)
 * @mutate .github/workflows/db-smoke.yml | '[CI smoke] post-job triggers', | '[CI smoke] post-job trigger check',
 * @mutate supabase/seed.sql | 'QA: Payout pending past due', | 'QA: Payout pending well past its scheduled time',
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { TITLE_MAX, DESCRIPTION_MAX } from "@/components/postjob/detailsSection/detailsSectionConstants";
import { JOB_TITLE_MAX, JOB_DESCRIPTION_MAX, charLength } from "../../scripts/lib/jobTextBounds.mjs";
import { readdirSync } from "./helpers/trackedFiles";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS = join(REPO, "supabase", "migrations");

/** The bound in the NEWEST migration that adds `name`, or null. Any dollar-quote tag. */
function newestCheckBound(name: string, column: string): { file: string; n: number } | null {
  const re = new RegExp(
    String.raw`add\s+constraint\s+"?${name}"?\s+check\s*\(\s*char_length\s*\(\s*"?${column}"?\s*\)\s*<=\s*(\d+)\s*\)`,
    "gi",
  );
  let found: { file: string; n: number } | null = null;
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
    for (const m of sql.matchAll(re)) found = { file: f, n: Number(m[1]) };
  }
  return found;
}

/** A job insert, in each shape this repo writes one. */
const INSERT_SHAPES: RegExp[] = [
  /from\(\s*["'`]jobs["'`]\s*\)\s*\.\s*(?:insert|upsert)\s*\(/, // supabase-js
  /\.post\(\s*`[^`]*\/rest\/v1\/jobs[?`]/, // Playwright request.post
  /\/rest\/v1\/jobs\?[^`]*`\s*,\s*\{\s*method:\s*["']POST["']/, // fetch POST
  /\bupsert\(\s*["']jobs["']/, // prod-seed helper
  /\brest\(\s*["']jobs["']\s*,\s*\{/, // probes' prodEnv rest("jobs", {...})
];

function writerFiles(): string[] {
  const listed = execFileSync("git", ["ls-files", "e2e", "scripts", "supabase/functions"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(?:ts|mts|mjs|js)$/.test(f) && !/\.d\.m?ts$/.test(f))
    .filter((f) => !f.startsWith("e2e/happy-path/"));
  return listed.filter((f) => {
    const code = blankComments(readFileSync(join(REPO, f), "utf8"));
    return INSERT_SHAPES.some((re) => re.test(code));
  });
}

/** The expression after `title:` up to the `,`/closer that ends the property. */
function propertyValue(code: string, from: number): string {
  let i = from;
  let depth = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < code.length && code[i] !== q) {
        if (code[i] === "\\") i++;
        else if (q === "`" && code[i] === "$" && code[i + 1] === "{") {
          let d = 1;
          i += 2;
          while (i < code.length && d > 0) {
            if (code[i] === "{") d++;
            else if (code[i] === "}") d--;
            if (d > 0) i++;
          }
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    } else if ((c === "," || c === ";") && depth === 0) break;
    i++;
  }
  return code.slice(from, i).trim();
}

interface Hit { file: string; line: number; value: string; problem: string }

function titleProblems(file: string): Hit[] {
  const code = blankComments(readFileSync(join(REPO, file), "utf8"));
  const edge = file.startsWith("supabase/functions/");
  const hits: Hit[] = [];
  for (const m of code.matchAll(/(?<![\w$.])title\s*:\s*/g)) {
    const value = propertyValue(code, m.index + m[0].length);
    const line = code.slice(0, m.index).split("\n").length;
    const literal = /^(["'])((?:\\.|(?!\1).)*)\1$/.exec(value) ?? /^`([^`$]*)`$/.exec(value);
    const text = literal ? literal[literal.length - 1] : null;
    let problem = "";
    if (text !== null && charLength(text) > JOB_TITLE_MAX) problem = `literal title is ${charLength(text)} characters`;
    else if (/^`/.test(value) && value.includes("${")) {
      problem = edge ? "template title with no .slice(0, 32)" : "template title not wrapped in fitJobTitle(...)";
    } else if (edge && value.includes("${") && !new RegExp(String.raw`\.slice\(0,\s*${JOB_TITLE_MAX}\)`).test(value)) {
      problem = "template title with no .slice(0, 32)";
    }
    if (problem) hits.push({ file, line, value: value.slice(0, 90), problem });
  }
  return hits;
}

/**
 * `title:` properties in writer files that are NOT a job's title (a
 * notification, a toast, a report). EXACT: each entry must still match a hit.
 */
const NOT_A_JOB_TITLE = new Set<string>([
  // prod-seed's notification fixtures (poster + helper inbox), not jobs rows.
  'scripts/audit/prod-seed.mjs|`SEED ${t.replace("_", " ")}`',
  // charge-recurring-visits: admin alerts and the poster's push/notification
  // titles. Its jobs insert copies parent.title, which is inside the CHECK.
  'supabase/functions/charge-recurring-visits/index.ts|"Paid recurring visit was never booked and the refund failed"',
  'supabase/functions/charge-recurring-visits/index.ts|"Recurring visit charge outcome UNKNOWN"',
  'supabase/functions/charge-recurring-visits/index.ts|"Recurring visit double-charged and the refund failed"',
  'supabase/functions/charge-recurring-visits/index.ts|"Recurring visit hit the uniqueness index and its funding could not be verified"',
  'supabase/functions/charge-recurring-visits/index.ts|"Recurring visit charged but not created, and the refund failed"',
  'supabase/functions/charge-recurring-visits/index.ts|"Recurring visit created without its application row"',
  'supabase/functions/charge-recurring-visits/index.ts|"Recurring visit funding had failures"',
  'supabase/functions/charge-recurring-visits/index.ts|"Paid recurring visit was never booked and is only partly refunded"',
  'supabase/functions/charge-recurring-visits/index.ts|"Your visit charge was refunded, less the card fee"',
  `supabase/functions/charge-recurring-visits/index.ts|"We couldn't charge for your next visit"`,
]);

/** Split a SQL tuple body at top-level commas, up to its closing `)`. */
function sqlTuple(s: string): { values: string[]; end: number } {
  const values: string[] = [];
  let depth = 0;
  let inQuote = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      cur += c;
      if (c === "'") {
        if (s[i + 1] === "'") cur += s[++i];
        else inQuote = false;
      }
      continue;
    }
    if (c === "'") inQuote = true;
    else if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) return { values: [...values, cur.trim()], end: i };
      depth--;
    } else if (c === "," && depth === 0) {
      values.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  return { values: [...values, cur.trim()], end: s.length };
}

interface SqlHit { file: string; line: number; column: string; length: number; text: string }

const SQL_INSERT = /insert\s+into\s+(?:public\.)?"?jobs"?\s*\(([^)]*)\)\s*(values|select)\s*/gi;

/** Every raw-SQL jobs insert in files that reach a Postgres carrying the CHECKs. */
function sqlWriters(): { files: string[]; inserts: number; hits: SqlHit[] } {
  const files = execFileSync("git", ["ls-files", ".github/workflows", "scripts", "supabase", "e2e"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !f.startsWith("supabase/migrations/") && !f.startsWith("e2e/happy-path/"))
    .filter((f) => /\.(?:ya?ml|sql|mjs|ts|js)$/.test(f) && !/\.d\.m?ts$/.test(f));
  const hits: SqlHit[] = [];
  const writers: string[] = [];
  let inserts = 0;
  for (const file of files) {
    const code = readFileSync(join(REPO, file), "utf8");
    let found = false;
    for (const m of code.matchAll(SQL_INSERT)) {
      const cols = m[1].split(",").map((c) => c.trim().replace(/"/g, "").toLowerCase());
      const line = code.slice(0, m.index).split("\n").length;
      let rest = code.slice(m.index + m[0].length);
      const tuples: string[][] = [];
      if (m[2].toLowerCase() === "values") {
        while (/^\s*\(/.test(rest)) {
          rest = rest.replace(/^\s*\(/, "");
          const t = sqlTuple(rest);
          tuples.push(t.values);
          rest = rest.slice(t.end + 1);
          if (!/^\s*,\s*\(/.test(rest)) break;
          rest = rest.replace(/^\s*,/, "");
        }
      } else tuples.push(sqlTuple(rest).values);
      if (cols.includes("title") || cols.includes("description")) {
        found = true;
        inserts++;
      }
      for (const [column, max] of [["title", JOB_TITLE_MAX], ["description", JOB_DESCRIPTION_MAX]] as const) {
        const idx = cols.indexOf(column);
        if (idx < 0) continue;
        for (const t of tuples) {
          const lit = /^'((?:[^']|'')*)'$/.exec(t[idx] ?? "");
          if (!lit) continue;
          const text = lit[1].replace(/''/g, "'");
          if (charLength(text) > max) hits.push({ file, line, column, length: charLength(text), text });
        }
      }
    }
    if (found) writers.push(file);
  }
  return { files: writers, inserts, hits };
}

describe("Q782: every jobs writer fits jobs_title_length / jobs_description_length", () => {
  it("the newest CHECKs, the form and jobTextBounds agree", () => {
    const title = newestCheckBound("jobs_title_length", "title");
    const description = newestCheckBound("jobs_description_length", "description");
    expect(title, "no migration adds jobs_title_length").not.toBeNull();
    expect(description, "no migration adds jobs_description_length").not.toBeNull();
    expect({ db: title!.n, form: TITLE_MAX, scripts: JOB_TITLE_MAX }).toEqual({ db: 32, form: 32, scripts: 32 });
    expect({ db: description!.n, form: DESCRIPTION_MAX, scripts: JOB_DESCRIPTION_MAX }).toEqual({
      db: 1000,
      form: 1000,
      scripts: 1000,
    });
  });

  it("the writer inventory is found from source", () => {
    const files = writerFiles();
    // Floor, not a count: 2026-09-27 found 20. Fewer means a shape stopped matching.
    expect(files.length).toBeGreaterThan(15);
    expect(files).toContain("supabase/functions/str-ical-sync/index.ts");
    expect(files).toContain("scripts/probes/completion-race.prod.mjs");
    expect(files).toContain("e2e/prod-lifecycle.spec.ts");
  });

  it("no writer builds a title that can exceed 32 characters", () => {
    const hits = writerFiles().flatMap(titleProblems);
    const unexplained = hits.filter((h) => !NOT_A_JOB_TITLE.has(`${h.file}|${h.value}`));
    expect(unexplained.map((h) => `${h.file}:${h.line} ${h.problem}: ${h.value}`)).toEqual([]);
    const stale = [...NOT_A_JOB_TITLE].filter((k) => !hits.some((h) => `${h.file}|${h.value}` === k));
    expect(stale, "NOT_A_JOB_TITLE entries that no longer match anything").toEqual([]);
  });

  it("raw SQL writers (CI smoke, seeds, probes) put a fitting literal title/description", () => {
    const { files, inserts, hits } = sqlWriters();
    // Floor, not a count: 2026-09-27 found these. Fewer means the scan stopped matching.
    expect(files).toContain(".github/workflows/db-smoke.yml");
    expect(files).toContain("supabase/seed.sql");
    expect(files).toContain("scripts/ci/race-runner.mjs");
    expect(inserts).toBeGreaterThan(20);
    expect(hits.map((h) => `${h.file}:${h.line} ${h.column} is ${h.length} characters: ${h.text}`)).toEqual([]);
  });
});
