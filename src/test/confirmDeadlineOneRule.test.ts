/**
 * CLASS CHECK (Q1647) — the Helpr's day-before confirm has ONE window and ONE
 * deadline, in every layer.
 *
 * THE BUG. The owner's rule (docs/JOB-LIFECYCLE.md, approved 2026-10-08): the
 * "Confirm you'll be at the job" button turns on at midnight the day before
 * (greyed with "turns on ..." until then), and the answer is owed until 2 hours
 * before the START, when sweep_confirm_reminders_and_repost (SQL) reposts the
 * job. JobConfirmation printed that and the SQL enforced it, but
 * supabase/functions/_shared/confirmDeadline.ts still said 12 hours after the
 * window opened (noon the day before), and auto-expire-jobs reopened on that.
 * Two more client readers (confirmationOpensClock, JobTracking) each hand-rolled
 * their own copy of the window or deadline.
 *
 * THE RULE THIS HOLDS, built from the inventory of every reader:
 *   1. The SQL sweep's repost interval (newest effective definition, any
 *      dollar tag) equals CONFIRM_DEADLINE_HOURS_BEFORE_START, and the copy in
 *      it and in nudge_confirm says the same number.
 *   2. confirmDeadlineMs is exactly the SQL's instant: the start in
 *      America/Chicago minus that many hours.
 *   3. confirmDeadline.ts exports one deadline constant, not two.
 *   4. Every TS reader (client + edge) gets the deadline and the window from
 *      the shared helpers: it calls them, never subtracts hours from a start by
 *      hand, never gates on "within 24 hours", and never types the number of
 *      hours into its copy.
 *
 * @mutate supabase/functions/_shared/confirmDeadline.ts | export const CONFIRM_DEADLINE_HOURS_BEFORE_START = 2; | export const CONFIRM_DEADLINE_HOURS_BEFORE_START = 12;
 * @mutate supabase/migrations/20261008205730_confirm_reminders_nudge_and_repost.sql |     IF r.starts_at <= now() + interval '2 hours' THEN |     IF r.starts_at <= now() + interval '3 hours' THEN
 * @mutate src/components/JobConfirmation.tsx |   const deadlineMs = confirmDeadlineMs(dateNeeded, startTime); |   const deadlineMs = jobDate.getTime() - 2 * 3_600_000;
 * @mutate src/components/job-card/confirmationOpensClock.ts | new Date(confirmDeadlineMs(dateNeeded, startTime)) | new Date(opensMs + 12 * 3_600_000)
 * @mutate supabase/functions/auto-expire-jobs/index.ts | ${CONFIRM_DEADLINE_HOURS_BEFORE_START} hours before it started | 2 hours before it started
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { jobLocalStartMs } from "../../supabase/functions/_shared/cancellationFee";
import {
  CONFIRM_DEADLINE_HOURS_BEFORE_START,
  confirmDeadlineMs,
} from "../../supabase/functions/_shared/confirmDeadline";

const ROOT = resolve(__dirname, "..", "..");
const SHARED = "supabase/functions/_shared/confirmDeadline.ts";
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(relative(ROOT, p));
  }
  return out;
}

/** Comments blanked; string and template literals kept (they hold the copy). */
const code = (rel: string) => blankComments(read(rel));

const DEADLINE_COPY = /(\$\{[^}]*\}|\d+)\s*(?:hours?|hrs?)\s+before\s+(?:it\s+)?(?:the\s+)?start(?:s|ed)?\b/gi;
const CALLS_SHARED = /\b(confirmDeadlineMs|confirmOpensMs)\s*\(/;
// "Confirm window passed" in jobStatusLine is the OFFER's answer clock
// (response_deadline, owned by expire_unanswered_offers), not this one.
const MENTIONS_CONFIRM = /\bConfirm by\b|\bconfirmation opens\b/i;

/** Every non-test TS file, client or edge, that reads the day-before confirm. */
const readers = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "supabase", "functions"))]
  .filter((rel) => rel !== SHARED)
  .filter((rel) => {
    const c = code(rel);
    return CALLS_SHARED.test(c) || MENTIONS_CONFIRM.test(c) || new RegExp(DEADLINE_COPY.source, "i").test(c);
  })
  .sort();

/** The SQL layer: the newest effective definitions the migrations leave in the database. */
const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));
function sqlBody(fn: string): string {
  const d = defs.get(fn);
  if (!d) throw new Error(`no migration defines public.${fn}`);
  return blankSqlComments(d.stmt);
}

describe("the day-before confirm: one window, one deadline (Q1647)", () => {
  it("the inventory is real: client and edge readers both found", () => {
    expect(readers.length).toBeGreaterThan(4);
    expect(readers).toContain("src/components/JobConfirmation.tsx");
    expect(readers).toContain("src/components/job-card/confirmationOpensClock.ts");
    expect(readers).toContain("src/components/JobTracking.tsx");
    expect(readers).toContain("supabase/functions/auto-expire-jobs/index.ts");
  });

  it("SQL: the sweep reposts at CONFIRM_DEADLINE_HOURS_BEFORE_START before the start", () => {
    const body = sqlBody("sweep_confirm_reminders_and_repost");
    const reposts = [...body.matchAll(/starts_at\s*<=\s*now\(\)\s*\+\s*interval\s*'(\d+)\s*hours?'/gi)].map((m) => Number(m[1]));
    expect(reposts, "exactly one repost condition in sweep_confirm_reminders_and_repost").toHaveLength(1);
    expect(reposts[0]).toBe(CONFIRM_DEADLINE_HOURS_BEFORE_START);
  });

  it("SQL: every deadline the SQL copy states is the same number", () => {
    const said: Array<[string, number]> = [];
    for (const fn of ["sweep_confirm_reminders_and_repost", "nudge_confirm"]) {
      for (const m of sqlBody(fn).matchAll(/(\d+)\s*hours?\s+before\s+(?:it\s+)?(?:the\s+)?start/gi)) said.push([fn, Number(m[1])]);
    }
    expect(said.length).toBeGreaterThan(1);
    for (const [fn, n] of said) expect(n, `${fn} says ${n} hours`).toBe(CONFIRM_DEADLINE_HOURS_BEFORE_START);
  });

  it("confirmDeadlineMs is the SQL's instant: (date + start) AT TIME ZONE Chicago minus the interval", () => {
    const n = Number(/starts_at\s*<=\s*now\(\)\s*\+\s*interval\s*'(\d+)/i.exec(sqlBody("sweep_confirm_reminders_and_repost"))![1]);
    for (const [date, start] of [["2026-01-15", "10:00"], ["2026-07-04", "18:30:00"], ["2026-03-08", "03:30"], ["2026-11-01", "01:30"], ["2026-01-15", null]] as const) {
      expect(confirmDeadlineMs(date, start), `${date} ${start}`).toBe(jobLocalStartMs(date, start) - n * 3_600_000);
    }
  });

  it("the shared module exports one deadline constant", () => {
    const src = blankComments(read(SHARED));
    const consts = [...src.matchAll(/export\s+const\s+(\w+)/g)].map((m) => m[1]).sort();
    expect(consts).toEqual(["CONFIRM_DEADLINE_HOURS_BEFORE_START", "CONFIRM_OPENS_HOURS_BEFORE"]);
  });

  it("every TS reader takes the window and deadline from the shared helpers", () => {
    const bad: string[] = [];
    for (const rel of readers) {
      const c = code(rel);
      if (!CALLS_SHARED.test(c)) bad.push(`${rel}: reads the confirm window without confirmOpensMs/confirmDeadlineMs`);
      // A deadline typed into copy instead of interpolated from the constant.
      for (const m of c.matchAll(DEADLINE_COPY)) {
        if (/^\d+$/.test(m[1])) bad.push(`${rel}: types "${m[0]}" (interpolate CONFIRM_DEADLINE_HOURS_BEFORE_START)`);
      }
      // A window gated on "within 24 hours" instead of confirmOpensMs.
      if (/hoursUntil\w*\s*(<=|>)\s*24\b/.test(c)) bad.push(`${rel}: gates the confirm window on hoursUntil… vs 24`);
      if (/<=\s*24\s*\*\s*3_?600_?000/.test(c)) bad.push(`${rel}: gates the confirm window on <= 24 * 3_600_000`);
    }
    // The two that print "Confirm by …" never subtract hours from a start by hand.
    for (const rel of ["src/components/JobConfirmation.tsx", "src/components/job-card/confirmationOpensClock.ts"]) {
      const c = code(rel);
      if (!/\bconfirmDeadlineMs\s*\(/.test(c)) bad.push(`${rel}: prints a deadline without confirmDeadlineMs`);
      if (/-\s*\d+\s*\*\s*3_?600_?000/.test(c)) bad.push(`${rel}: subtracts hours from a start by hand`);
    }
    const edge = code("supabase/functions/auto-expire-jobs/index.ts");
    if (!/from\s+"\.\.\/_shared\/confirmDeadline\.ts"/.test(edge) || !/\bconfirmDeadlineMs\s*\(/.test(edge)) {
      bad.push("supabase/functions/auto-expire-jobs/index.ts: reopens without the shared confirmDeadlineMs");
    }
    expect(bad).toEqual([]);
  });
});
