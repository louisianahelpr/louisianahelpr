/**
 * CLASS GUARD (Q174): every HTTP cron tags its pg_net request id, and the
 * failure sweep attributes by that tag alone.
 *
 * THE BUG (prod, 2026-09-23). sweep_cron_http_failures() read EVERY
 * net._http_response row and named the cron by start-time proximity, so manual
 * pg_net probes were filed as cron failures: "arrival-confirm-reminder ...
 * Timeout of 400 ms" (that cron waits 30000 ms) and "money-reconciliation
 * returned 500" (manual ?include_seed=1 POSTs at 07:52/07:54/08:12Z). pg_net
 * keeps no URL or header with the response, so the only exact link is the
 * request id: 20260923162402 records it per cron (cron_http_tag) and the sweep
 * JOINs on it, ignoring untagged responses. Behaviour (a tagged 500 is filed
 * under its job, an untagged 500 is not): src/test/pglite/cronHttpTag.pglite.mjs.
 *
 * THE CLASS, from the migrations (src/test/helpers/cronHttpJobs.ts): every
 * job a cron.schedule call leaves scheduled whose command calls net.http_post.
 * 26 on 2026-09-23, equal to the 26 HTTP crons measured live on 2026-09-22.
 *
 * Checks, two-way:
 *   - scheduled at or before 20260923162402: the job is on that migration's
 *     list, and every name on the list is such a job (its rewrite wraps every
 *     live net.http_post command, the list is what it reports against);
 *   - scheduled after it: the command itself calls
 *     public.cron_http_tag(q.request_id, '<its own jobname>');
 *   - any cron_http_tag('<name>') in a cron command names the job it is
 *     scheduled under;
 *   - the rewrite is unfiltered, idempotent and tags with r.jobname;
 *   - the NEWEST sweep_cron_http_failures INNER-joins cron_http_requests and
 *     has no proximity fallback left.
 *
 * @mutate supabase/migrations/20260923162402_cron_http_request_ids.sql |       JOIN public.cron_http_requests tag ON | LEFT JOIN public.cron_http_requests tag ON
 * @mutate supabase/migrations/20260923162402_cron_http_request_ids.sql |     'auto-tip-charge', |     'auto-tip-charge-gone',
 * @mutate supabase/migrations/20260923162402_cron_http_request_ids.sql |        AND command NOT LIKE '%cron_http_tag(%' |        AND true
 * @mutate supabase/migrations/20260923162402_cron_http_request_ids.sql |      WHERE command LIKE '%net.http_post(%' |      WHERE command LIKE '%net.http_post(%' AND jobname LIKE 'auto-%'
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { cronEvents, httpCronJobs } from "./helpers/cronHttpJobs";

const MIG = join(process.cwd(), "supabase", "migrations");
const Q174 = "20260923162402_cron_http_request_ids.sql";
const files = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((file) => ({ file, sql: readFileSync(join(MIG, file), "utf8") }));
const q174 = files.find((f) => f.file === Q174);
const q174Sql = q174 ? blankSqlComments(q174.sql) : "";

/** The v_expected ARRAY[...] of the rewrite. */
const listed = new Set(
  [...(/v_expected\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/.exec(q174Sql)?.[1] ?? "").matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]),
);

const wrapperFor = (name: string) =>
  new RegExp(String.raw`public\.cron_http_tag\s*\(\s*q\.request_id\s*,\s*'${name}'\s*\)\s*FROM\s*\(`);

// Newest definition of the sweep, any dollar tag.
const FN_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?sweep_cron_http_failures\s*\(\s*\)[\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\1/gi;
let sweepFile = "";
let sweep = "";
for (const { file, sql } of files) {
  for (const m of blankSqlComments(sql).matchAll(FN_RE)) {
    sweepFile = file;
    sweep = m[2];
  }
}

describe("HTTP crons tag their request id (Q174)", () => {
  const all = httpCronJobs(files);

  it("reads the inventory from the migrations (floor)", () => {
    expect(q174, `${Q174} must exist`).toBeDefined();
    expect(all.size).toBeGreaterThan(20);
    expect(all.has("auto-release-payment")).toBe(true); // 20260831190419's VALUES loop
    expect(all.has("money-reconciliation")).toBe(true); // a literal cron.schedule
    expect(all.has("sweep-cron-http-failures")).toBe(false); // SQL-only, never an HTTP cron
    expect(listed.size).toBeGreaterThan(20);
  });

  it("every HTTP cron goes through the tag: on the rewrite's list, or wrapped in its own command", () => {
    const upToQ174 = httpCronJobs(files.filter((f) => f.file <= Q174));
    const unwrapped = [...all]
      .filter(([name, call]) => (call.file <= Q174 ? !listed.has(name) : !wrapperFor(name).test(call.args)))
      .map(([name, call]) => `${name} (scheduled in ${call.file})`);
    const stale = [...listed].filter((n) => !upToQ174.has(n)).sort();
    expect({ unwrapped, stale }).toEqual({ unwrapped: [], stale: [] });
  });

  it("a tag in a cron command names the job it is scheduled under", () => {
    const wrong: string[] = [];
    for (const e of cronEvents(files)) {
      if (e.kind !== "schedule") continue;
      for (const m of e.call.args.matchAll(/cron_http_tag\s*\(\s*[^,]+,\s*'([a-z0-9-]+)'/g)) {
        if (m[1] !== e.call.jobname) wrong.push(`${e.call.jobname} tags as ${m[1]} (${e.call.file})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("the rewrite covers every live net.http_post command, once, under its own name", () => {
    expect(q174Sql).toMatch(/WHERE command LIKE '%net\.http_post\(%'\s+AND command NOT LIKE '%cron_http_tag\(%'\s+ORDER BY/);
    expect(q174Sql).toMatch(/format\(E'SELECT public\.cron_http_tag\(q\.request_id, %L\)\\n  FROM \(%s\\n\) AS q\(request_id\);',\s*r\.jobname, v_body\)/);
    expect(q174Sql).toMatch(/cron\.alter_job\(job_id := r\.jobid, command := v_new\)/);
  });

  it("the newest sweep attributes by request id only and ignores untagged responses", () => {
    expect(sweepFile).toBe(Q174);
    expect(sweep).toMatch(/FROM net\._http_response resp\s+(?:--[^\n]*\n\s*)*JOIN public\.cron_http_requests tag ON tag\.request_id = resp\.id/);
    expect(sweep).not.toMatch(/LEFT\s+JOIN\s+public\.cron_http_requests/i);
    expect(sweep).not.toMatch(/job_run_details|nearest|proximity/i);
    expect(sweep).toMatch(/v_job := r\.tagged_job;/);
  });
});
