/**
 * Q1501: a booked job's change requests (date/time, and the details) are
 * capped at five asks per job per asker in any 24 hours, because every ask
 * notifies the other side and replaces the last one.
 *
 * Executable proof: src/test/pglite/changeRequestDailyCap.pglite.mjs (OLD STATE
 * RED: six asks, six notices; NEW: the sixth refused and nothing sent; chain
 * 3x). This file pins the NEWEST definitions so a later restatement of either
 * RPC cannot drop the cap silently, and checks the date/time ask's refusal has
 * words on screen.
 *
 * @mutate supabase/migrations/20261012044739_change_request_daily_cap.sql |          AND r.created_at > now() - interval '24 hours') >= 5 THEN\n    RAISE EXCEPTION 'schedule_change_rate_limited'; |          AND r.created_at > now() - interval '24 hours') >= 500 THEN\n    RAISE EXCEPTION 'schedule_change_rate_limited';
 * @mutate supabase/migrations/20261012044739_change_request_daily_cap.sql |  WHERE r.job_id = v_job.id AND r.requested_by = v_uid\n         AND r.created_at > now() - interval '24 hours') >= 5 THEN\n    RAISE EXCEPTION 'detail_change_rate_limited'; |  WHERE r.job_id = v_job.id AND r.requested_by = v_uid\n         AND r.created_at > now() - interval '24 days') >= 5 THEN\n    RAISE EXCEPTION 'detail_change_rate_limited';
 * @mutate supabase/migrations/20261012044739_change_request_daily_cap.sql |     RAISE EXCEPTION 'detail_change_rate_limited'; |     NULL;
 * @mutate src/lib/lifecycleErrors.ts |     schedule_change_rate_limited: | schedule_change_rate_limited_x:
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrors";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

function newestFunction(name: string): string {
  const header = `CREATE OR REPLACE FUNCTION public.${name}(`;
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = blankSqlComments(readFileSync(`${dir}/${files[i]}`, "utf8"));
    const at = sql.lastIndexOf(header);
    if (at < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(at))?.[1];
    if (!tag) throw new Error(`${name}: no dollar-quote tag`);
    const open = sql.indexOf(tag, at);
    return sql.slice(at, sql.indexOf(tag, open + tag.length) + tag.length);
  }
  return "";
}

const CASES = [
  { rpc: "request_job_schedule_change", table: "job_schedule_change_requests", code: "schedule_change_rate_limited", notify: "INSERT INTO public.notifications" },
  { rpc: "request_job_detail_change", table: "job_detail_change_requests", code: "detail_change_rate_limited", notify: "INSERT INTO public.notifications" },
];

describe("Q1501: change requests are capped at five per job per day", () => {
  it("inventory: both RPCs exist", () => {
    for (const c of CASES) expect(newestFunction(c.rpc).length, c.rpc).toBeGreaterThan(2000);
  });

  for (const c of CASES) {
    it(`${c.rpc}: counts the asker's own asks on this job in the last 24 hours, refuses the sixth`, () => {
      const body = newestFunction(c.rpc);
      const cap = new RegExp(
        `IF \\(SELECT count\\(\\*\\) FROM public\\.${c.table} r\\s+WHERE r\\.job_id = v_job\\.id AND r\\.requested_by = v_uid\\s+AND r\\.created_at > now\\(\\) - interval '24 hours'\\) >= 5 THEN\\s+RAISE EXCEPTION '${c.code}';`,
      );
      expect(body).toMatch(cap);
      const at = body.search(cap);
      // After the job row is locked (serialised per job), before anything is written or sent.
      expect(body.indexOf("FOR UPDATE")).toBeLessThan(at);
      expect(body.indexOf(`UPDATE public.${c.table} r`)).toBeGreaterThan(at);
      expect(body.indexOf(c.notify)).toBeGreaterThan(at);
    });
  }

  it("the date/time ask (the one a screen calls) has words for the refusal", () => {
    expect(RPC_ERROR_COPY.request_job_schedule_change?.schedule_change_rate_limited).toMatch(/five times in the last day/);
  });
});
