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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

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
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
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

const ALL = walk(SRC).map((f) => relative(ROOT, f));
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
    const offenders = JOB_DAY_FILES.flatMap((f) =>
      utcJobDayAssignments(read(f)).map((v) => `${f}: ${v}`),
    );
    expect(
      offenders,
      "a job day is a day in America/Chicago. `.toISOString().slice(0, 10)` is the UTC day, " +
        "which after ~19:00 Central already names TOMORROW — use jobLocalDateISO " +
        "(src/test/helpers/jobLocalDate.ts)",
    ).toEqual([]);
  });
});
