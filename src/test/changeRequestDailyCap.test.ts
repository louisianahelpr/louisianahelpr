/**
 * GUARD (Q1501, lh-authz-rls review of Q1254, finding e1f83f9e9#4): a change
 * request notifies the other party (every booked Helpr, for a detail change)
 * on each call, so each kind is capped at 5 per requester per job per day.
 * Behaviour: src/test/pglite/changeRequestDailyCap.pglite.mjs (OLD STATE RED,
 * applied 3x).
 *
 * THE CLASS, from the migrations: every `job_*_change_requests` table carries
 * the change_request_daily_cap BEFORE INSERT trigger, and the newest
 * definition of the trigger function keeps the cap and its exemption for
 * server context only. The schedule-change refusal has client copy.
 *
 * @mutate supabase/migrations/20261012045427_change_request_daily_cap.sql | IF v_count >= 5 THEN | IF false THEN
 * @mutate supabase/migrations/20261012045427_change_request_daily_cap.sql | CREATE TRIGGER change_request_daily_cap_tg\n  BEFORE INSERT ON public.job_schedule_change_requests | CREATE TRIGGER change_request_daily_cap_tg\n  BEFORE UPDATE ON public.job_schedule_change_requests
 * @mutate src/lib/lifecycleErrors.ts |   change_request_rate_limited: "You've asked | //   change_request_rate_limited: "You've asked
 * @mutate src/lib/scheduleChange.ts | rpcErrorMessage("request_job_schedule_change", error) ?? lifecycleErrorMessage(error) | rpcErrorMessage("request_job_schedule_change", error)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankSqlComments } from "./helpers/blankNonCode";
import { lifecycleErrorMessage } from "@/lib/lifecycleErrors";

const MIG = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
const all = files.map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8"))).join("\n");

const tables = [...new Set([...all.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(job_\w+_change_requests)\b/gi)].map((m) => m[1]))];

/** Newest body of public.<name>, any dollar tag. */
function newestBody(name: string): string {
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\bAS\\s+(\\$\\w*\\$)([\\s\\S]*?)\\1`, "gi");
  const bodies = [...all.matchAll(re)].map((m) => m[2]);
  expect(bodies.length, `no migration defines public.${name}`).toBeGreaterThan(0);
  return bodies[bodies.length - 1];
}

describe("change requests are capped per requester per job per day (Q1501)", () => {
  it("finds every change-request table (inventory floor)", () => {
    // 2026-10-12: job_schedule_change_requests, job_detail_change_requests.
    expect(tables.length).toBeGreaterThan(1);
  });

  it.each(tables)("%s carries the cap as a BEFORE INSERT trigger", (t) => {
    expect(all).toMatch(
      new RegExp(`CREATE\\s+TRIGGER\\s+change_request_daily_cap_tg\\s+BEFORE\\s+INSERT\\s+ON\\s+public\\.${t}\\s+FOR\\s+EACH\\s+ROW\\s+EXECUTE\\s+FUNCTION\\s+public\\.change_request_daily_cap\\(\\)`, "i"),
    );
  });

  it("the cap is 5 a day, serialised, exempting only server context", () => {
    const b = newestBody("change_request_daily_cap");
    expect(b).toMatch(/IF\s+public\.is_server_context\(\)\s+THEN\s+RETURN\s+NEW;/i);
    expect(b).toMatch(/pg_advisory_xact_lock/i);
    expect(b).toMatch(/created_at\s*>\s*now\(\)\s*-\s*interval\s+'24 hours'/i);
    expect(b).toMatch(/IF\s+v_count\s*>=\s*5\s+THEN/i);
    expect(b).toMatch(/RAISE\s+EXCEPTION\s+'change_request_rate_limited'/i);
  });

  it("the refusal has client copy, and the schedule-change call site reads it", () => {
    // A trigger raises it, so its words are in the shared lifecycle table.
    expect(lifecycleErrorMessage({ message: "change_request_rate_limited" })).toMatch(/a lot today/);
    const site = readFileSync(join(process.cwd(), "src/lib/scheduleChange.ts"), "utf8");
    expect(site).toMatch(/rpcErrorMessage\("request_job_schedule_change", error\) \?\? lifecycleErrorMessage\(error\)/);
  });
});
