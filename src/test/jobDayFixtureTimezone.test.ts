/**
 * CLASS GUARD: a `date_needed` value is a day in AMERICA/CHICAGO, never in UTC.
 *
 * WHAT IT CATCHES (2026-09-19, eight red specs in four files — and the product
 * was correct in every one). Fixtures across the activity/step-card suite built
 * their job day as
 * `new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10)` and named
 * the result YESTERDAY. `toISOString()` is UTC. Run from US Pacific at 19:42
 * local, UTC had already rolled over, so that "yesterday" was the CURRENT
 * Central day — and every clock gate these cards read resolves in Central:
 *
 *   - `completionStalled` anchors on `scheduledEndMs`, the end of the job's
 *     CENTRAL day, so a Central-today job is not stalled: no disabled
 *     "Waiting on the Helpr…" box and no "Why?" chip
 *     (stalledNoticeDisclosure.test.tsx x2, jobStepOneRow.test.tsx x1).
 *   - `helper_cancel_booking`'s gate and `hasJobStarted` go through
 *     `jobLocalStartMs`, so a "start already passed" fixture dated UTC-tomorrow
 *     had a start two hours in the FUTURE and Cancel Job was correctly still
 *     offered — four controls where the case asserts three
 *     (jobStepOneRow.test.tsx x1).
 *   - Activity bucketing compares `jobDateMs` against `todayMs()`
 *     (src/lib/jobDate.ts), America/Chicago midnight, so "today is live" never
 *     fired and four rows bucketed to Scheduled instead of Needs You
 *     (activityBadgeListAgreement.test.tsx x3).
 *
 * The defect is TIME-OF-DAY dependent — green every morning, red after 19:00
 * Pacific — which is why it shipped. `src/lib/dateUtils.ts` had already written
 * the lesson down for app code; nothing enforced it on job days.
 *
 * HOW: the inventory is derived from source — every `.ts`/`.tsx` under `src/`
 * — and the rule is anchored on the ASSIGNMENT, not the file, so
 * `AdminExport.tsx` stamping a UTC date into a CSV filename is not an offender
 * while sitting in a file that also mentions the column. Comments are stripped
 * first, because the fixes and this header quote the broken spelling in prose.
 * The fix is `jobLocalDateISO` (src/test/helpers/jobLocalDate.ts).
 *
 * @mutate src/pages/activity/activityBadgeListAgreement.test.tsx | date_needed: jobLocalDateISO(6), | date_needed: new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10),
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const SRC = join(ROOT, "src");
/** This file states the counter-examples as literals, so it cannot judge itself. */
const SELF = "src/test/jobDayFixtureTimezone.test.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Block and line comments removed, so prose QUOTING the broken spelling is
 *  never mistaken for code. */
export function stripComments(src: string): string {
  // Was a deleting comment-stripper. A regex cannot tell it is inside a string, so a
  // `/` + `*` in a URL or regex literal opens a comment that runs to the next `*` + `/`
  // anywhere later and takes the real code between. Measured 2026-09-21: 157 of 1,054
  // source files lose real code to that chain, one of them 98% of its own.
  // `blankComments` scans left-to-right, string-aware, and blanks in place so offsets
  // survive. (SQL needs `blankSqlComments` — `--`, nesting, '' escaping, $tag$ bodies.)
  return blankComments(src);
}

/** The UTC day: `<anything>.toISOString().slice(0, 10)`. */
const UTC_DAY = /\.toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/;
/** `date_needed: <value>` / `date_needed = <value>`, to the end of its line. */
const JOB_DAY_ASSIGN = /\bdate_needed\s*[:=]\s*([^\n]*)/g;
// A bare identifier at the head of the value, up to whatever closes it —
// `Y,` inside an object literal arrives as "Y, };". A following "(" is NOT a
// terminator, so `jobLocalDateISO(-1)` is a call, not an identifier.
const BARE_IDENT = /^([A-Za-z_$][\w$]*)\s*(?:[,;)}\]]|$)/;

/**
 * Every `date_needed` value in `src` that resolves to a UTC day — either
 * inline, or through a const declared in the same file (the shape that hid
 * this for months: `const YESTERDAY = …; date_needed: YESTERDAY`).
 */
export function utcJobDayAssignments(src: string): string[] {
  const body = stripComments(src);
  const bad: string[] = [];
  for (const m of body.matchAll(JOB_DAY_ASSIGN)) {
    const rhs = m[1].trim();
    if (UTC_DAY.test(rhs)) {
      bad.push(rhs);
      continue;
    }
    const ident = BARE_IDENT.exec(rhs)?.[1];
    if (!ident) continue;
    const decl = new RegExp(`\\b(?:const|let|var)\\s+${ident}\\s*(?::[^=\\n]*)?=\\s*([^\\n]*)`).exec(body);
    if (decl && UTC_DAY.test(decl[1])) bad.push(`${ident} = ${decl[1].trim()}`);
  }
  return bad;
}

/*
 * THE INVENTORY INCLUDES e2e/, ADDED 2026-09-21 — it was `src/` only, and that
 * is exactly where the bomb this guard is named for went off.
 *
 * `e2e/happy-path/browse-feed-completeness.spec.ts` hardcoded
 * `date_needed: "2026-09-20"`. `useDashboardFilters` drops any job dated before
 * today, so at midnight on 2026-09-21 the spec's nine jobs vanished and it went
 * red on main with nothing changed. `appstore-screenshots.spec.ts` carried four
 * more (2026-09-10..14) and had been quietly expiring since the 15th — still
 * PASSING the whole time, because an empty state renders perfectly well, while
 * capturing App Store screenshots of an app doing nothing.
 *
 * The Playwright specs are the most fixture-dense code in the repo and were the
 * one place this guard could not see. That is not a coincidence worth leaving:
 * a floor that excludes the densest source of the defect is a floor that will
 * keep reporting clean.
 */
const ALL = [...walk(SRC), ...walk(join(ROOT, "e2e"))].map((f) => relative(ROOT, f));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const JOB_DAY_FILES = ALL.filter((f) => f !== SELF && stripComments(read(f)).includes("date_needed"));

describe("a job day is Central, never UTC", () => {
  it("the inventory is real — it walks src/ and finds files that carry a job day", () => {
    // Both floors are deliberate: an empty walk and an empty match set are the
    // two ways this guard could pass while checking nothing.
    expect(ALL.length, "walk(src) returned nothing — the scanner is broken").toBeGreaterThan(500);
    expect(JOB_DAY_FILES.length, "nothing in src/ carries date_needed — the matcher is broken")
      .toBeGreaterThan(20);
  });

  it("the matcher catches both shapes, and does not cry wolf", () => {
    // POSITIVE — inline, and via a const one hop away.
    expect(utcJobDayAssignments('x = { date_needed: new Date().toISOString().slice(0, 10) };')).toHaveLength(1);
    expect(
      utcJobDayAssignments(
        'const Y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);\nx = { date_needed: Y, };',
      ),
    ).toHaveLength(1);
    // NEGATIVE — a UTC slice that is NOT a job day (AdminExport's CSV filename
    // sat in a file that also mentions the column), a Central-resolved day, and
    // the broken spelling quoted in a comment.
    expect(utcJobDayAssignments('const f = `x-${new Date().toISOString().slice(0, 10)}.csv`;\nq.eq("date_needed", d);')).toEqual([]);
    expect(utcJobDayAssignments('x = { date_needed: jobLocalDateISO(-1) };')).toEqual([]);
    expect(utcJobDayAssignments('// date_needed: new Date().toISOString().slice(0, 10)\nx = 1;')).toEqual([]);
  });

  it("no job day in src/ is built from toISOString().slice(0, 10)", () => {
    /*
     * SCOPED TO src/, as the name says — and deliberately NOT widened with the
     * inventory on 2026-09-21.
     *
     * The two rules in this file protect different things. THIS one is about
     * the ZONE: a job day is a day in America/Chicago, and the UTC day after
     * ~19:00 Central already names tomorrow, so production code that computes a
     * day this way shows the wrong date to a real person.
     *
     * The Playwright fixtures do `new Date(Date.now() + 2 * 86_400_000)
     * .toISOString().slice(0, 10)` — a RELATIVE day two days out. A one-day UTC
     * skew there moves a fixture from "+2 days" to "+3 days", which no
     * assertion depends on and which can never put it in the past. Flagging
     * them would be noise, and noise is how a guard gets switched off.
     *
     * The AGEING rule below IS widened to e2e/, because that is the failure
     * that actually happened there.
     */
    const offenders = JOB_DAY_FILES.filter((f) => f.startsWith("src/")).flatMap((f) =>
      utcJobDayAssignments(read(f)).map((v) => `${f}: ${v}`),
    );
    expect(
      offenders,
      "a job day is a day in America/Chicago. `.toISOString().slice(0, 10)` is the UTC day, " +
        "which after ~19:00 Central already names TOMORROW — use jobLocalDateISO " +
        "(src/test/helpers/jobLocalDate.ts)",
    ).toEqual([]);
  });

  /* ── THE SECOND WAY A JOB DAY GOES WRONG: IT AGES ────────────────────────
     The UTC check above is about the ZONE. This one is about the CALENDAR.

     `ConfirmedSection.test.tsx` hardcoded `date_needed: "2026-09-20"`. On
     2026-09-14, when it was written, that was comfortably in the future and
     both of its tests passed. On 2026-09-20 it became TODAY, its 09:00 start
     passed, `hasJobStarted` correctly hid the Cancel Job chip, and two tests
     went red against a product doing exactly what it was specified to do.

     Nothing caught it, because a literal date is not a timezone bug and the
     file is otherwise perfectly written. It is a TIME BOMB: green on the day
     it lands, red on a date nobody chose, in a file nobody touched, blamed on
     whatever commit happens to be passing through.

     The rule: a job day that must be in the future is written RELATIVE.
     A clearly-historical literal (2020-01-01) or a clearly-absurd one
     (2099-01-01) is fine and common — those are deliberately, permanently on
     one side of now, and ConfirmedSection's own "past start" and "future job"
     cases use exactly those. What is banned is the middle: a real date near
     the era the repo is being written in, which is future today and past
     later. */
  /**
   * Files whose `date_needed` literals are PURE ORDERING DATA and never meet
   * "now". Listed here, in the guard, deliberately — not as a per-file opt-out
   * marker, because an escape hatch a file can grant itself is how a rule
   * quietly stops applying (the profile shell shipped a 12px defect through
   * exactly that shape on 2026-09-20).
   *
   * WHY THE EXEMPTION IS REAL. A literal only ages into a bomb if something
   * compares it to the current date. `resolveWorkDayRange` picks the min and
   * max of a set; the stalled queue orders rows. Neither asks "is this past?",
   * so the VALUES are arbitrary and only their relative order is asserted.
   *
   * This list was written after the first sweep converted them anyway and
   * broke both files: the fixture moved with America/Chicago's clock while the
   * expected string stayed frozen, so at 22:20 Pacific — already tomorrow in
   * Chicago — every range came back one day late. The guard was right about the
   * class and wrong about these members.
   *
   * To add an entry you must say which assertion proves the date never meets
   * `now`. "It looked fine" is not a reason.
   */
  const ORDERING_ONLY = new Map<string, string>([
    [
      "src/lib/workRecordDocument.test.ts",
      "resolveWorkDayRange returns min/max of the set; the assertions are on " +
        "ordering and formatted month names, never on past-vs-future",
    ],
    [
      "src/components/admin/adminStalledJobs/stalledQueue.test.ts",
      "the queue's row ORDER is asserted; staleness comes from the nudge " +
        "timestamps, not from date_needed vs today",
    ],
  ]);

  const DATE_LITERAL = /\bdate_needed\s*[:=]\s*["'`](\d{4})-(\d{2})-(\d{2})["'`]/g;

  /* Safe means "cannot cross now", and that is a distance from TODAY, not a
     fixed year — a hardcoded year threshold would itself age. A literal is
     safe if it is already more than a year in the past (it can never become
     future) or more than five years out (it will not arrive while this code
     lives). Everything between is the time-bomb window. */
  const DAY_MS = 86_400_000;
  const nowMs = Date.now();
  const PAST_SAFE_MS = nowMs - 365 * DAY_MS;
  const FUTURE_SAFE_MS = nowMs + 5 * 365 * DAY_MS;
  const isTimeBomb = (y: string, m: string, d: string) => {
    const t = Date.parse(`${y}-${m}-${d}T00:00:00Z`);
    return Number.isFinite(t) && t > PAST_SAFE_MS && t < FUTURE_SAFE_MS;
  };

  it("no job day is a hardcoded date that will age from future to past", () => {
    const offenders: string[] = [];
    for (const f of JOB_DAY_FILES) {
      if (ORDERING_ONLY.has(f)) continue;
      for (const m of stripComments(read(f)).matchAll(DATE_LITERAL)) {
        if (!isTimeBomb(m[1], m[2], m[3])) continue;
        offenders.push(`${f}: date_needed: "${m[1]}-${m[2]}-${m[3]}"`);
      }
    }
    expect(
      offenders,
      "a job day literal in the present era is a time bomb: future when written, past " +
        "later, red on a day nobody chose. Use jobLocalDateISO(n) for a relative day, or a " +
        "literal more than a year past / more than five years out when the test needs a " +
        "fixed side of now:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("every ordering-only exemption still exists and still carries date_needed", () => {
    // An exemption for a file that is gone, renamed, or no longer carries a
    // job day is a licence nobody is using — and the next person reads it as
    // evidence that the rule was considered here. Make it rot loudly.
    for (const [f, reason] of ORDERING_ONLY) {
      expect(existsSync(resolve(ROOT, f)), `exempted file no longer exists: ${f}`).toBe(true);
      expect(
        stripComments(read(f)),
        `${f} is exempted from the job-day rule but no longer carries a date_needed literal — ` +
          `delete the exemption`,
      ).toMatch(/\bdate_needed\s*[:=]/);
      expect(reason.length, `${f}'s exemption has no stated reason`).toBeGreaterThan(40);
    }
  });

  it("that matcher can actually fail, and does not cry wolf on the safe literals", () => {
    // Floors: the check is worthless if it matches nothing or matches everything.
    const bomb = 'date_needed: "2026-09-20"';
    const past = 'date_needed: "2020-01-01"';
    const future = 'date_needed: "2099-01-01"';
    const hits = (src: string) =>
      [...src.matchAll(DATE_LITERAL)].filter((m) => isTimeBomb(m[1], m[2], m[3])).length;
    expect(hits(bomb), "the real 2026-09-20 bomb must be caught").toBe(1);
    expect(hits(past), "a permanently-historical literal is legitimate").toBe(0);
    expect(hits(future), "a permanently-future literal is legitimate").toBe(0);
  });
});
