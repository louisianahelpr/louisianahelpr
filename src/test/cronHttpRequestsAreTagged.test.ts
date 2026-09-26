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
 * request id: 20260923170422 records it per cron (cron_http_tag) and the sweep
 * JOINs on it, ignoring untagged responses. Behaviour (a tagged 500 is filed
 * under its job, an untagged 500 is not): src/test/pglite/cronHttpTag.pglite.mjs.
 *
 * THE CLASS, from the migrations (src/test/helpers/cronHttpJobs.ts): every
 * job a cron.schedule call leaves scheduled whose command calls net.http_post.
 * 26 on 2026-09-23, equal to the 26 HTTP crons measured live on 2026-09-22.
 *
 * Checks, two-way:
 *   - scheduled at or before 20260923170422: the job is on that migration's
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
 * Q207(2) + Q218 (20260923172145), same class: an HTTP cron outcome nobody
 * reads. Behaviour: src/test/pglite/cronCatchUpHttpOutcome.pglite.mjs (red on
 * the state before: 15 checks). Structurally, on the NEWEST definitions:
 *   - run_missed_cron_catch_up keeps on its claim the request id the job's own
 *     command tagged in that transaction ('caught_up' alone = only queued);
 *   - sweep_cron_http_failures reads unchecked caught-up runs against
 *     net._http_response and turns a failed one into 'catch_up_failed' with a
 *     'cron-missed-slot' error;
 *   - it lists ACTIVE cron.job rows calling net.http_post without
 *     cron_http_tag( as 'cron-http-untagged', and both reach its Slack post;
 *   - sweep_silent_cron_failures only ingests responses a cron tagged.
 *
 * @mutate supabase/migrations/20260924132850_cron_log_keys_survive_pg_net_id_reuse.sql | AND j.command NOT LIKE '%cron_http_tag(%' | AND false
 * @mutate supabase/migrations/20260924132850_cron_log_keys_survive_pg_net_id_reuse.sql | JOIN public.cron_http_requests t ON t.request_id = resp.id | LEFT JOIN public.cron_http_requests t ON t.request_id = resp.id
 * @mutate supabase/migrations/20260925155322_catch_up_candidates_one_scan.sql | WHERE h.jobname = r.jobname AND h.created_at = now(); | WHERE false;
 * @mutate supabase/migrations/20260924132850_cron_log_keys_survive_pg_net_id_reuse.sql | action          = CASE WHEN v_ok THEN action ELSE 'catch_up_failed' END, | action = action,
 * @mutate supabase/migrations/20260924132850_cron_log_keys_survive_pg_net_id_reuse.sql | IF cardinality(v_parts) > 0 THEN | IF v_errors > 0 THEN
 *
 * @mutate supabase/migrations/20260924132850_cron_log_keys_survive_pg_net_id_reuse.sql |       JOIN public.cron_http_requests tag ON | LEFT JOIN public.cron_http_requests tag ON
 * @mutate supabase/migrations/20260923170422_cron_http_request_ids.sql |     'auto-tip-charge', |     'auto-tip-charge-gone',
 * @mutate supabase/migrations/20260923170422_cron_http_request_ids.sql |        AND command NOT LIKE '%cron_http_tag(%' |        AND true
 * @mutate supabase/migrations/20260923170422_cron_http_request_ids.sql |      WHERE command LIKE '%net.http_post(%' |      WHERE command LIKE '%net.http_post(%' AND jobname LIKE 'auto-%'
 *
 * Q287 (20260923215732): the 'cron-http-untagged' ledger item closes itself.
 * The NEWEST ops_alert_condition keeps a 'cron-http-untagged' branch asking
 * cron.job with the sweep's own predicate (active, net.http_post(, no
 * cron_http_tag(, name = jobname else 'jobid <n>'); 'cron-missed-slot' has no
 * branch (manual by design). Behaviour, red without the migration (8 checks):
 * src/test/pglite/cronHttpUntaggedCloseRule.pglite.mjs.
 *
 * @mutate supabase/migrations/20260925155922_admin_queue_alerts_close_themselves.sql |   ELSIF p_source = 'cron-http-untagged' AND v_job IS NOT NULL THEN |   ELSIF p_source = 'cron-http-untagged-gone' AND v_job IS NOT NULL THEN
 * @mutate supabase/migrations/20260925155922_admin_queue_alerts_close_themselves.sql |          AND j.active\n |          AND true\n
 * @mutate supabase/migrations/20260925155922_admin_queue_alerts_close_themselves.sql |          AND j.command NOT LIKE '%cron_http_tag(%'); |          AND true);
 *
 * Q316 (20260924035844): ops_alert_normalise turns digits into '#', so
 * cleanup-7d and cleanup-30d shared one 'cron-http-untagged' item and the close
 * rule judged only the last job. Follow-up 20260924041136: the fingerprint is
 * ONE function, ops_alert_fingerprint, appending the raw job name for that
 * source only; ops_alert_apply (writer) and ops_alert_verify's companions path
 * (reader, which had rebuilt md5 without the suffix) both call it, so they
 * cannot drift. Behaviour: src/test/pglite/cronUntaggedFingerprint.pglite.mjs
 * (NEW_MIGRATION=skip: 4 FAIL; FOLLOWUP=skip: 2 companions FAIL).
 *
 * @mutate supabase/migrations/20260924041136_q316_shared_ops_alert_fingerprint.sql | WHEN s.src = 'cron-http-untagged' AND | WHEN s.src = 'cron-http-untagged-gone' AND
 * @mutate supabase/migrations/20260924041136_q316_shared_ops_alert_fingerprint.sql | THEN '\|job:' \|\| p_job ELSE | THEN '' ELSE
 * @mutate supabase/migrations/20260924041136_q316_shared_ops_alert_fingerprint.sql | CASE WHEN jsonb_typeof(e.tags) = 'object' THEN e.tags ->> 'job' END) AS fp | NULL) AS fp
 * @mutate supabase/migrations/20260924041136_q316_shared_ops_alert_fingerprint.sql | v_fp := public.ops_alert_fingerprint(p_source_kind, p_source, p_title, p_sample_ref ->> 'job'); | v_fp := md5(p_source_kind \|\| '\|' \|\| v_source \|\| '\|' \|\| v_title);
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { cronEvents, httpCronJobs } from "./helpers/cronHttpJobs";

const MIG = join(process.cwd(), "supabase", "migrations");
const Q174 = "20260923170422_cron_http_request_ids.sql";
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

/** Newest definition of public.<name>(), any dollar tag, comments blanked. */
function newest(name: string): { file: string; body: string } {
  const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?${name}\s*\(\s*\)[\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\1`, "gi");
  let found = { file: "", body: "" };
  for (const { file, sql } of files) {
    for (const m of blankSqlComments(sql).matchAll(re)) found = { file, body: m[2] };
  }
  return found;
}
const { file: sweepFile, body: sweep } = newest("sweep_cron_http_failures");

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
    expect(q174Sql).toMatch(/format\(E'SELECT public\.cron_http_tag\(q\.request_id, %L\)\\n {2}FROM \(%s\\n\) AS q\(request_id\);',\s*r\.jobname, v_body\)/);
    expect(q174Sql).toMatch(/cron\.alter_job\(job_id := r\.jobid, command := v_new\)/);
  });

  it("the newest sweep attributes by request id only and ignores untagged responses", () => {
    expect(sweepFile >= Q174, sweepFile).toBe(true);
    expect(sweep).toMatch(/FROM net\._http_response resp\s+(?:--[^\n]*\n\s*)*JOIN public\.cron_http_requests tag ON tag\.request_id = resp\.id/);
    expect(sweep).not.toMatch(/LEFT\s+JOIN\s+public\.cron_http_requests/i);
    expect(sweep).not.toMatch(/job_run_details|nearest|proximity/i);
    expect(sweep).toMatch(/v_job := r\.tagged_job;/);
  });
});

describe("the outcome of a caught-up HTTP cron and untagged HTTP crons are seen (Q207 part 2, Q218)", () => {
  const catchUp = newest("run_missed_cron_catch_up");
  const silent = newest("sweep_silent_cron_failures");

  it("reads the newest definitions (floor)", () => {
    for (const f of [catchUp, silent]) expect(f.body.length).toBeGreaterThan(1000);
    expect(sweep.length).toBeGreaterThan(1000);
  });

  it("run_missed_cron_catch_up keeps the request id its job's command tagged in that transaction", () => {
    const b = catchUp.body;
    expect(b).toMatch(/SELECT\s+max\(h\.request_id\)\s+INTO\s+v_request_id\s+FROM\s+public\.cron_http_requests\s+h\s+WHERE\s+h\.jobname\s*=\s*r\.jobname\s+AND\s+h\.created_at\s*=\s*now\(\)\s*;/i);
    expect(b).toMatch(/UPDATE\s+public\.cron_catchup_runs\s+SET\s+request_id\s*=\s*v_request_id\s+WHERE\s+jobname\s*=\s*r\.jobname\s+AND\s+slot\s*=\s*r\.slot/i);
    // Captured after the EXECUTE, never inside its exception block.
    expect(b.search(/max\(h\.request_id\)/i)).toBeGreaterThan(b.search(/\bEXECUTE\s+regexp_replace\(\s*r\.command/i));
    // Reset per job, so one job's id never lands on the next claim.
    expect(b).toMatch(/LOOP\s+v_detail\s*:=\s*NULL;\s*v_request_id\s*:=\s*NULL;/i);
  });

  it("sweep_cron_http_failures turns a failed caught-up HTTP run into catch_up_failed and alerts", () => {
    expect(sweep).toMatch(/FROM\s+public\.cron_catchup_runs\s+c\s+LEFT\s+JOIN\s+net\._http_response\s+resp\s+ON\s+resp\.id\s*=\s*c\.request_id/i);
    expect(sweep).toMatch(/c\.action\s*=\s*'caught_up'\s+AND\s+c\.request_id\s+IS\s+NOT\s+NULL\s+AND\s+c\.http_checked_at\s+IS\s+NULL/i);
    // No response at all counts too, once pg_net has had its chance.
    expect(sweep).toMatch(/resp\.id\s+IS\s+NOT\s+NULL\s+OR\s+c\.decided_at\s*<\s*now\(\)\s*-\s*interval\s*'\d+ hours?'/i);
    expect(sweep).toMatch(/r\.status_code\s+BETWEEN\s+200\s+AND\s+299\s+AND\s+r\.timed_out\s+IS\s+NOT\s+TRUE/i);
    expect(sweep).toMatch(/action\s*=\s*CASE\s+WHEN\s+v_ok\s+THEN\s+action\s+ELSE\s+'catch_up_failed'\s+END/i);
    expect(sweep).toMatch(/'source',\s*'cron-missed-slot'/);
  });

  it("sweep_cron_http_failures files every ACTIVE untagged HTTP cron once a day", () => {
    expect(sweep).toMatch(/FROM\s+cron\.job\s+j\s+WHERE\s+j\.active\s+AND\s+j\.command\s+LIKE\s+'%net\.http_post\(%'\s+AND\s+j\.command\s+NOT\s+LIKE\s+'%cron_http_tag\(%'/i);
    expect(sweep).toMatch(/e\.tags->>'source'\s*=\s*'cron-http-untagged'[\s\S]*?e\.created_at\s*>=\s*date_trunc\('day',\s*now\(\)\)/i);
    expect(sweep).toMatch(/jsonb_build_object\('source',\s*'cron-http-untagged'/);
  });

  it("both reach the one Slack post", () => {
    for (const names of ["v_catchup_names", "v_untagged_names"]) {
      expect(sweep).toMatch(new RegExp(String.raw`v_parts\s*:=\s*v_parts\s*\|\|\s*format\([^;]*array_to_string\(${names}`, "i"));
    }
    expect(sweep).toMatch(/IF\s+cardinality\(v_parts\)\s*>\s*0\s+THEN\s+BEGIN\s+PERFORM\s+net\.http_post\(/i);
  });

  it("sweep_silent_cron_failures only counts responses to a request a cron tagged", () => {
    const ingest = /INSERT\s+INTO\s+public\.cron_run_log[\s\S]*?ON\s+CONFLICT/i.exec(silent.body)?.[0] ?? "";
    expect(ingest).toMatch(/FROM\s+net\._http_response\s+resp\s+JOIN\s+public\.cron_http_requests\s+(\w+)\s+ON\s+\1\.request_id\s*=\s*resp\.id/i);
    expect(ingest).not.toMatch(/LEFT\s+JOIN\s+public\.cron_http_requests/i);
  });
});

describe("an untagged-cron ledger item closes itself (Q287)", () => {
  /** Newest ops_alert_condition(...) (it takes arguments), any dollar tag, comments blanked. */
  const cond = (() => {
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?ops_alert_condition\s*\([^)]*\)[\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\1/gi;
    let found = { file: "", body: "" };
    for (const { file, sql } of files) {
      for (const m of blankSqlComments(sql).matchAll(re)) found = { file, body: m[2] };
    }
    return found;
  })();
  /** The body of one ELSIF/IF branch, up to the next ELSIF or END IF at branch level. */
  const branch = (label: string) =>
    new RegExp(String.raw`p_source\s*=\s*'${label}'[\s\S]*?(?=\n\s{2}ELSIF\b|\n\s{2}END IF;)`).exec(cond.body)?.[0] ?? "";

  it("reads the newest ops_alert_condition (floor)", () => {
    expect(cond.file >= "20260923215732", cond.file).toBe(true);
    expect(cond.body.length).toBeGreaterThan(5000);
    // the branches before it survived the restatement
    for (const s of ["detect_stuck_payments", "cron-dead", "user-report", "user-error-screen"]) {
      expect(cond.body).toContain(`'${s}'`);
    }
  });

  it("'cron-http-untagged' is still failing exactly while the sweep would file it again", () => {
    const b = branch("cron-http-untagged");
    expect(b).toMatch(/^p_source\s*=\s*'cron-http-untagged'\s+AND\s+v_job\s+IS\s+NOT\s+NULL\s+THEN/);
    expect(b).toMatch(/IF\s+p_probe_only\s+THEN\s+RETURN\s+true;\s+END\s+IF;/i);
    expect(b).toMatch(/RETURN\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+cron\.job\s+j\s+WHERE\s+coalesce\(j\.jobname,\s*'jobid '\s*\|\|\s*j\.jobid\)\s*=\s*v_job\s+AND\s+j\.active\s+AND\s+j\.command\s+LIKE\s+'%net\.http_post\(%'\s+AND\s+j\.command\s+NOT\s+LIKE\s+'%cron_http_tag\(%'\s*\)\s*;/i);
    // the name it compares is the one the sweep files under
    expect(sweep).toMatch(/coalesce\(j\.jobname,\s*'jobid '\s*\|\|\s*j\.jobid\)\s+AS\s+jobname/i);
  });

  it("'cron-missed-slot' has no branch: it stays manual by design", () => {
    expect(cond.body).not.toMatch(/'cron-missed-slot'/);
  });
});

describe("one ledger item per untagged cron, digits kept (Q316)", () => {
  /** Newest definition of public.<name>(...), any dollar tag, comments blanked. */
  const newestFn = (name: string) => {
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?${name}\s*\([\s\S]*?\)\s*RETURNS[\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\1`, "gi");
    let found = { file: "", body: "" };
    for (const { file, sql } of files) {
      for (const m of blankSqlComments(sql).matchAll(re)) found = { file, body: m[2] };
    }
    return found;
  };
  const fpFn = newestFn("ops_alert_fingerprint");
  const apply = newestFn("ops_alert_apply");
  const verify = newestFn("ops_alert_verify");

  it("reads the newest definitions (floor)", () => {
    expect(fpFn.file >= "20260924041136", fpFn.file).toBe(true);
    expect(apply.file >= "20260924041136", apply.file).toBe(true);
    expect(verify.file >= "20260924041136", verify.file).toBe(true);
    expect(apply.body.length).toBeGreaterThan(1500);
    expect(verify.body.length).toBeGreaterThan(2000);
    expect(apply.body).toMatch(/ON\s+CONFLICT\s*\(\s*fingerprint\s*\)/i);
  });

  it("ops_alert_fingerprint keeps the old shape and appends the raw job for 'cron-http-untagged' only", () => {
    const b = fpFn.body;
    // every source keeps md5(kind|source|normalised title), so open items keep matching
    expect(b).toMatch(/md5\(\s*p_source_kind\s*\|\|\s*'\|'\s*\|\|\s*s\.src\s*\|\|\s*'\|'\s*\|\|\s*coalesce\(nullif\(public\.ops_alert_normalise\(p_title\),\s*''\),\s*'\(no message\)'\)/i);
    expect(b).toMatch(/left\(coalesce\(nullif\(btrim\(p_source\),\s*''\),\s*'unknown'\),\s*120\)\s+AS\s+src/i);
    // scoped to that one source, and the raw name, never normalised
    expect(b).toMatch(/CASE\s+WHEN\s+s\.src\s*=\s*'cron-http-untagged'\s+AND\s+p_job\s+IS\s+NOT\s+NULL\s+THEN\s+'\|job:'\s*\|\|\s*p_job\s+ELSE\s+''\s+END/i);
    expect(b).not.toMatch(/ops_alert_normalise\s*\(\s*p_job/i);
  });

  it("the writer and the companions reader both use it, and neither builds its own md5", () => {
    expect(apply.body).toMatch(/v_fp\s*:=\s*public\.ops_alert_fingerprint\(\s*p_source_kind\s*,\s*p_source\s*,\s*p_title\s*,\s*p_sample_ref\s*->>\s*'job'\s*\)\s*;/i);
    expect(apply.body).not.toMatch(/\bmd5\s*\(/i);
    const comp = /WITH\s+comp\s+AS\s*\(([\s\S]*?)\)\s*SELECT\s+count/i.exec(verify.body)?.[1] ?? "";
    expect(comp).toMatch(/public\.ops_alert_fingerprint\(\s*'error_logs'\s*,\s*src\s*,\s*split_part\(coalesce\(e\.message,\s*''\),\s*' — ',\s*1\)\s*,\s*CASE\s+WHEN\s+jsonb_typeof\(e\.tags\)\s*=\s*'object'\s+THEN\s+e\.tags\s*->>\s*'job'\s+END\s*\)\s+AS\s+fp/i);
    expect(verify.body).not.toMatch(/\bmd5\s*\(/i);
  });
});
