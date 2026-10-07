/**
 * A hire offer's answer-by time is never after the job's start (owner,
 * 2026-10-05: "23h 58m left for them to confirm" on a job that started in 4
 * minutes).
 *
 * THE CLASS: every SQL function the migrations leave in the database that
 * writes a NON-NULL `jobs.response_deadline` must bound it by
 * `job_offer_cutoff` (the job's start, or the end of a date-only job's day),
 * and the start moving under a live offer must pull the deadline with it
 * (`offer_deadline_follows_start`). Read from the EFFECTIVE definitions
 * (effectiveFunctionDefs: newest CREATE plus later rewrites, any dollar tag),
 * so a later migration that restates accept_application with the old
 * `response_deadline = p_deadline` fails here.
 *
 * Proven able to fail on the ORIGINAL bug, not only on a fixture: the same
 * predicate run over the migrations BEFORE 20261005184940 must find
 * accept_application writing the client's p_deadline unbounded.
 *
 * Behaviour (real Postgres): src/test/pglite/offerDeadlineBeforeStart.pglite.mjs
 * (17 PASS on the fix; 10 FAIL with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261007032040_accept_offer_deadline_floor.sql |          response_deadline = v_deadline | response_deadline = p_deadline
 * @mutate supabase/migrations/20261007032040_accept_offer_deadline_floor.sql | now() + interval '55 minutes'),\n    v_cutoff); | now() + interval '55 minutes')\n    );
 * @mutate supabase/migrations/20261005184940_offer_deadline_before_start.sql | CREATE TRIGGER zzzz_offer_deadline_follows_start | CREATE TRIGGER zzzz_offer_deadline_follows_start_off
 * @mutate supabase/migrations/20261006022526_crew_unconfirmed_spot_never_blocks_completion.sql | v_cap_ended := v_locked.response_deadline >= public.job_offer_cutoff(v_locked.date_needed, v_locked.start_time); | v_cap_ended := false;
 * @mutate supabase/migrations/20261005184940_offer_deadline_before_start.sql |       NEW.response_deadline := LEAST(public.job_offer_cutoff(NEW.date_needed, NEW.start_time), now() + interval '48 hours'); |       NEW.response_deadline := LEAST(NEW.response_deadline, public.job_offer_cutoff(NEW.date_needed, NEW.start_time));
 * @mutate src/lib/offerDeadline.ts | const cappedByStart = !!cutoff && cutoff.getTime() < chosen; | const cappedByStart = false;
 * @mutate src/lib/offerDeadline.ts | export const OFFER_MIN_LEAD_MINUTES = 15; | export const OFFER_MIN_LEAD_MINUTES = 5;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import {
  jobOfferCutoff,
  offerResponseDeadline,
  OFFER_MAX_WINDOW_HOURS,
  OFFER_MIN_LEAD_MINUTES,
} from "@/lib/offerDeadline";

const DIR = "supabase/migrations";
const FIX = "20261005184940";

/** Functions that write a non-NULL response_deadline without the start bound. */
function unboundedWriters(defs: ReturnType<typeof effectiveDefs>): string[] {
  const bad: string[] = [];
  for (const [name, def] of defs) {
    const body = blankSqlComments(def.stmt);
    for (const m of body.matchAll(/\bresponse_deadline\s*=\s*([^,;\n]+)/gi)) {
      const rhs = m[1].trim();
      if (/^null\b/i.test(rhs)) continue;
      // A comparison inside WHERE / IF, not an assignment.
      const before = body.slice(Math.max(0, m.index! - 12), m.index!);
      if (/\b(and|or|where|if|when)\s+(\w+\.)?$/i.test(before)) continue;
      // The value must be a variable this function bounded by the cutoff.
      const v = rhs.replace(/[\s)]+$/, "");
      const bound = new RegExp(`\\b${v}\\s*:=\\s*LEAST\\s*\\([^;]*\\bv_cutoff\\b`, "i").test(body)
        && /\bv_cutoff\s*:=\s*public\.job_offer_cutoff\s*\(/i.test(body);
      if (!bound) bad.push(`${name}: response_deadline = ${rhs}`);
    }
  }
  return bad;
}

describe("offer answer-by never after the job's start (server)", () => {
  const after = effectiveDefs(DIR);

  it("every function writing a non-null response_deadline bounds it by job_offer_cutoff", () => {
    const writers = [...after.values()].filter((d) => /\bresponse_deadline\s*=/i.test(blankSqlComments(d.stmt)));
    // Inventory floor: the writer/clearer set is a dozen functions today.
    expect(writers.length).toBeGreaterThan(5);
    expect(unboundedWriters(after)).toEqual([]);
  });

  it("can fail: the migrations before the fix have accept_application writing p_deadline unbounded", () => {
    const before = effectiveDefs(DIR, { before: FIX });
    expect(unboundedWriters(before).some((b) => b.startsWith("accept_application:"))).toBe(true);
  });

  it("accept_application refuses a hire into a job starting within the minimum lead, with the client's numbers", () => {
    const body = blankSqlComments(after.get("accept_application")!.stmt);
    expect(body).toMatch(new RegExp(`v_cutoff\\s*<=\\s*now\\(\\)\\s*\\+\\s*interval\\s*'${OFFER_MIN_LEAD_MINUTES} minutes'`));
    expect(body).toMatch(/RAISE EXCEPTION 'job_starts_too_soon'/);
    expect(body.match(new RegExp(`interval '${OFFER_MAX_WINDOW_HOURS} hours'`, "g"))?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("the start moving under a live offer pulls the deadline with it (trigger attached, fires last)", () => {
    const files = migrationFiles(DIR);
    const sql = files.map((f) => blankSqlComments(readFileSync(`${DIR}/${f}`, "utf8"))).join("\n");
    expect(sql).toMatch(/CREATE TRIGGER zzzz_offer_deadline_follows_start\s+BEFORE UPDATE OF date_needed, start_time ON public\.jobs/);
    const fn = blankSqlComments(after.get("offer_deadline_follows_start")!.stmt);
    expect(fn).toMatch(/NEW\.response_deadline\s*:=\s*LEAST\(NEW\.response_deadline,\s*public\.job_offer_cutoff\(NEW\.date_needed, NEW\.start_time\)\)/);
  });
});

describe("a window ended by the job's start is not a strike (lh-money-escrow review, finding 1)", () => {
  it("expire_unanswered_offers files no strike when the answer-by was the start", () => {
    const body = blankSqlComments(effectiveDefs(DIR).get("expire_unanswered_offers")!.stmt);
    expect(body).toMatch(/v_cap_ended\s*:=\s*v_locked\.response_deadline\s*>=\s*public\.job_offer_cutoff\(v_locked\.date_needed, v_locked\.start_time\);/);
    expect(body).toMatch(/v_no_strike\s*:=\s*v_cap_ended\b/);
    expect(body).toMatch(/v_crew_no_strike\s*:=\s*v_crew_cap\b/);
  });
  it("a window that was the old start follows a start moved later", () => {
    const fn = blankSqlComments(effectiveDefs(DIR).get("offer_deadline_follows_start")!.stmt);
    expect(fn).toMatch(/NEW\.response_deadline\s*:=\s*LEAST\(public\.job_offer_cutoff\(NEW\.date_needed, NEW\.start_time\), now\(\) \+ interval '48 hours'\)/);
  });
});

describe("offer answer-by never after the job's start (client mirror)", () => {
  const at = (iso: string) => new Date(iso);

  it("a job starting in 30 min, 24 h chosen: the deadline is the start", () => {
    // 2024-10-05 13:20 CDT = 18:20Z; the job starts 13:50 CDT.
    const r = offerResponseDeadline(24, { date_needed: "2024-10-05", start_time: "13:50:00" }, at("2024-10-05T18:20:00Z"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cappedByStart).toBe(true);
      expect(r.deadline.toISOString()).toBe("2024-10-05T18:50:00.000Z");
    }
  });

  it("a job starting in 4 min is refused (the owner's live case)", () => {
    const r = offerResponseDeadline(24, { date_needed: "2024-10-05", start_time: "13:50:00" }, at("2024-10-05T18:46:00Z"));
    expect(r.ok).toBe(false);
  });

  it("a job ten days out keeps the chosen window; a year is capped at 48 h", () => {
    const now = at("2024-10-05T18:00:00Z");
    const r = offerResponseDeadline(4, { date_needed: "2024-10-15", start_time: "09:00:00" }, now);
    expect(r.ok && r.deadline.getTime() - now.getTime()).toBe(4 * 3_600_000);
    const y = offerResponseDeadline(24 * 365, { date_needed: "2024-12-15", start_time: "09:00:00" }, now);
    expect(y.ok && y.deadline.getTime() - now.getTime()).toBe(OFFER_MAX_WINDOW_HOURS * 3_600_000);
  });

  it("a date-only job runs to the end of its day in Chicago, across a DST change", () => {
    expect(jobOfferCutoff("2026-10-06", null)?.toISOString()).toBe("2026-10-07T05:00:00.000Z");
    // 2026-11-01 is the fall-back day: the next midnight is CST (UTC-6).
    expect(jobOfferCutoff("2026-11-01", null)?.toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });

  it("never returns a deadline after the start, across a sweep of starts and windows", () => {
    const now = at("2026-10-05T18:00:00Z");
    let checked = 0;
    for (let mins = -120; mins <= 72 * 60; mins += 17) {
      const start = new Date(now.getTime() + mins * 60_000);
      const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(start);
      const p = (t: string) => local.find((x) => x.type === t)!.value;
      const job = { date_needed: `${p("year")}-${p("month")}-${p("day")}`, start_time: `${p("hour")}:${p("minute")}:00` };
      for (const h of [1, 2, 4, 8, 12, 24, 48]) {
        const r = offerResponseDeadline(h, job, now);
        if (r.ok) expect(r.deadline.getTime()).toBeLessThanOrEqual(jobOfferCutoff(job.date_needed, job.start_time)!.getTime());
        else expect(mins).toBeLessThanOrEqual(OFFER_MIN_LEAD_MINUTES);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
