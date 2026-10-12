/**
 * Owner, 2026-10-08 (Q1565, pop-up "At least 2 hours"; job 28f8cff5 posted at
 * 1:37 PM for a 2:00 PM start showed "34 minutes left" at 2:03): a new job must
 * start at least 2 hours out, and its listing closes AT the start.
 *
 * The class: one notice rule, held by every layer that can let a job through.
 *  - Post a Job paints the error and disables the CTA (useJobDerived),
 *  - the submit refuses it (useJobSubmit),
 *  - the database refuses a user insert (trg_jobs_short_notice, BEFORE INSERT,
 *    newest refuse_short_notice_job) and clamps expires_at to the start,
 *  - computeJobExpiresAt never returns an expiry after a future start.
 * The client's MIN_POST_NOTICE_MS and the trigger's interval are read from
 * source and must agree, so one layer moving alone fails here.
 *
 * @mutate src/lib/jobExpiry.ts | const MIN_POST_NOTICE_MS = 2 * 60 * 60 * 1000; | const MIN_POST_NOTICE_MS = 1 * 60 * 60 * 1000;
 * @mutate src/pages/post-job/useJobSubmit.ts |     if (isScheduleTooSoon(dateNeeded, startTime)) { |     if (false) {
 * @mutate src/lib/jobExpiry.ts |   return scheduled.getTime() > now.getTime() | return scheduled.getTime() > now.getTime() + 3_600_000
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeJobExpiresAt, isScheduleTooSoon } from "@/lib/jobExpiry";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { triggerInventory } from "./helpers/migrationTriggers";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase/migrations");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

const HOUR = 3_600_000;

function clientNoticeHours(): number {
  const m = code("src/lib/jobExpiry.ts").match(/const MIN_POST_NOTICE_MS = ([\d\s*]+);/);
  expect(m, "MIN_POST_NOTICE_MS not found in src/lib/jobExpiry.ts").not.toBeNull();
  const ms = m![1].split("*").map((n) => Number(n.trim())).reduce((a, b) => a * b, 1);
  return ms / HOUR;
}

describe("a new job needs the same 2 hours' notice in every layer (Q1565)", () => {
  const fn = effectiveDefs(MIG).get("refuse_short_notice_job");
  const body = blankSqlComments(fn?.stmt ?? "");

  it("the client notice is 2 hours", () => {
    expect(clientNoticeHours()).toBe(2);
  });

  it("the newest refuse_short_notice_job refuses under the same interval and clamps the expiry", () => {
    expect(fn, "refuse_short_notice_job has no definition in supabase/migrations").toBeDefined();
    const iv = body.match(/v_start\s*<\s*now\(\)\s*\+\s*interval\s*'(\d+)\s*hours?'/i);
    expect(iv, "the trigger no longer compares the start against now() + interval").not.toBeNull();
    expect(Number(iv![1])).toBe(clientNoticeHours());
    expect(body).toMatch(/RAISE\s+EXCEPTION\s+'job_start_too_soon'/i);
    expect(body).toMatch(/NEW\.expires_at\s*>\s*v_start\s+THEN\s+NEW\.expires_at\s*:=\s*v_start/i);
  });

  it("the trigger runs BEFORE INSERT on jobs", () => {
    const files = migrationFiles(MIG);
    expect(files.length).toBeGreaterThan(500);
    const inv = triggerInventory(files.map((name) => ({ name, sql: readFileSync(join(MIG, name), "utf8") })));
    const trg = inv.get("jobs.trg_jobs_short_notice");
    expect(trg, "trg_jobs_short_notice is not attached to public.jobs").toBeDefined();
    expect(trg!.fn).toBe("refuse_short_notice_job");
    expect(trg!.timing).toBe("BEFORE");
    expect(trg!.events).toMatch(/INSERT/);
  });

  it("Post a Job disables the CTA and the submit refuses it", () => {
    expect(code("src/pages/post-job/useJobDerived.ts")).toMatch(/return isScheduleTooSoon\(dateNeeded, startTime\);/);
    expect(code("src/pages/post-job/useJobSubmit.ts")).toMatch(
      /if \(isScheduleTooSoon\(dateNeeded, startTime\)\) \{\s*toast\.error\(SCHEDULE_TOO_SOON_COPY\);[\s\S]{0,1500}?return;/,
    );
  });

  it("isScheduleTooSoon draws the line at exactly 2 hours (job 28f8cff5's 23-minute notice included)", () => {
    const posted = new Date("2026-10-08T18:37:00Z"); // 1:37 PM Central
    expect(isScheduleTooSoon("2026-10-08", "14:00", posted, "America/Chicago")).toBe(true);
    expect(isScheduleTooSoon("2026-10-08", "15:36", posted, "America/Chicago")).toBe(true);
    expect(isScheduleTooSoon("2026-10-08", "15:37", posted, "America/Chicago")).toBe(false);
  });

  it("the listing closes AT a future start, never after it", () => {
    const posted = new Date("2026-10-08T18:37:00Z");
    for (const start of ["14:00", "15:37", "18:00"]) {
      const exp = computeJobExpiresAt("2026-10-08", start, posted, "America/Chicago");
      const [h, m] = start.split(":").map(Number);
      expect(exp).toBe(new Date(Date.UTC(2026, 9, 8, h + 5, m)).toISOString());
    }
  });
});
