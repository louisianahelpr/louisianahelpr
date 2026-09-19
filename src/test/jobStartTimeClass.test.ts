import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { jobStartTimeLabel, FLEXIBLE_TIME_LABEL } from "@/lib/jobDate";

/**
 * THE CLASS: a job's start time reaching the screen without going through the
 * one rule — so the surface shows a blank, a raw column value, or a promise
 * the poster never made.
 *
 * Owner, 2026-09-19, with a screenshot of the job-detail dialog on /dashboard:
 * "they also need times unless they were checked off as flexible. but if it is
 * flexible the time should show flexible bc rn its just an empty block."
 *
 * Three DIFFERENT wrong answers were live at once, which is what makes this a
 * class and not a bug:
 *
 *   - `JobStatTiles` dropped the Time tile when `start_time` was null (right)
 *     but its compact row was still sized `grid-cols-3` (wrong) — so two tiles
 *     sat in three columns and the third was the owner's empty block.
 *   - `JobCardMetaRow` printed its `flexibleLabel` for ANY job with no start
 *     time, and `ScheduleTab` got the same result for free because
 *     `formatTime12(null)` returns the literal string "Flexible". Verified live
 *     on prod `fncmgoasalhdgfwzhsqa` on 2026-09-19: 184 of 260 jobs have a null
 *     `start_time` and ZERO have `is_flexible_schedule = true` — so every one of
 *     those cards stated a scheduling promise no poster had made.
 *   - Both admin surfaces printed the RAW Postgres value ("14:30:00"), so an
 *     admin reading a dispute saw a different string than the two parties did.
 *
 * The rule, in one function: `jobStartTimeLabel` (src/lib/jobDate.ts) answers a
 * clock time, or the word "Flexible" when the poster actually ticked the flag,
 * or `null` meaning RENDER NOTHING. This guard asserts the rule holds and that
 * nothing renders a job start time around it.
 *
 * The inventory is read from the source tree, never from a list in this file:
 * a new screen that prints a start time is in scope the moment it is written.
 */

const ROOT = resolve(__dirname, "../..");

/** Anything that could be a start time — deliberately wide; classified below. */
const READS_START_TIME = /(?:\.start_time\b|\bstartTime\b)/;

/** Every non-test source file. The corpus, read from disk. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== "node_modules") sourceFiles(p, out);
    } else if (/\.tsx?$/.test(p) && !/\.test\.|\.d\.ts$/.test(p)) {
      out.push(p.slice(ROOT.length + 1));
    }
  }
  return out;
}

const CORPUS = sourceFiles(join(ROOT, "src")).filter(
  // Generated types restate every column of every table; they render nothing.
  (f) => !f.startsWith("src/integrations/"),
);

const textOf = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function parse(rel: string) {
  return ts.createSourceFile(
    rel,
    textOf(rel),
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function walk(node: ts.Node, fn: (n: ts.Node) => void) {
  fn(node);
  node.forEachChild((c) => walk(c, fn));
}

/** Files that touch a start time at all — the population the rules apply to. */
const START_TIME_FILES = CORPUS.filter((f) => READS_START_TIME.test(textOf(f)));

/**
 * Every place a start time is RENDERED: a JSX expression that is a child of an
 * element (not an attribute — passing `startTime={job.start_time}` down to a
 * component is plumbing, and the component it lands in is itself in this
 * inventory). Wrapper expressions that contain nested JSX are skipped: they are
 * layout, and their own leaves are visited separately.
 *
 * A child that is a bare identifier is resolved one level through the local
 * `const` it was declared from, because `const time = …; <span>{time}</span>`
 * is the single most common shape and the one that hid the ScheduleTab defect.
 */
interface RenderSite {
  file: string;
  line: number;
  expression: string;
  resolved: string;
  viaRule: boolean;
}

function renderSites(): RenderSite[] {
  const sites: RenderSite[] = [];
  for (const rel of START_TIME_FILES) {
    if (!rel.endsWith(".tsx")) continue;
    const sf = parse(rel);
    const consts = new Map<string, string>();
    walk(sf, (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer &&
        // Bounded: a huge initializer is a component, not a display value.
        n.initializer.getText(sf).length < 400
      ) {
        consts.set(n.name.text, n.initializer.getText(sf).replace(/\s+/g, " "));
      }
    });
    walk(sf, (n) => {
      if (!ts.isJsxExpression(n) || !n.expression) return;
      if (!n.parent || !(ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) return;
      const expression = n.expression.getText(sf).replace(/\s+/g, " ");
      if (expression.includes("<")) return; // a wrapper; its leaves are visited too
      const resolved =
        ts.isIdentifier(n.expression) && consts.has(n.expression.text)
          ? `${expression} /* = */ ${consts.get(n.expression.text)}`
          : expression;
      if (!READS_START_TIME.test(resolved)) return;
      sites.push({
        file: rel,
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        expression,
        resolved,
        viaRule: resolved.includes("jobStartTimeLabel"),
      });
    });
  }
  return sites;
}

/**
 * `formatTime12` answers the literal string "Flexible" for a null time
 * (TimePickerSelect.tsx). That is correct for the time PICKER, whose
 * "flexible" is a real option, and a lie everywhere a job row is displayed:
 * a job with no start time has not thereby become flexible. So no file that
 * handles a job start time may reach for it.
 */
function formatTime12Offenders(): { file: string; line: number; call: string }[] {
  const out: { file: string; line: number; call: string }[] = [];
  for (const rel of START_TIME_FILES) {
    const sf = parse(rel);
    walk(sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      if (n.expression.getText(sf) !== "formatTime12") return;
      const args = n.arguments.map((a) => a.getText(sf)).join(", ");
      if (!READS_START_TIME.test(args)) return;
      out.push({
        file: rel,
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        call: `formatTime12(${args})`,
      });
    });
  }
  return out;
}

// @mutate src/components/profile/ScheduleTab.tsx | const time = jobStartTimeLabel(job.start_time, job.is_flexible_schedule); | const time = formatTime12(job.start_time);

describe("job start time — one rule, every surface", () => {
  it("reads a real corpus (floor, so an empty inventory cannot pass)", () => {
    // The repo has ~890 non-test source files; this floor only has to prove the
    // walk found the tree, not to track its exact size.
    expect(CORPUS.length).toBeGreaterThan(400);
    // And a real population of start-time handlers inside it.
    expect(START_TIME_FILES.length).toBeGreaterThan(15);
  });

  it("finds the screens that actually print a start time (floor)", () => {
    const sites = renderSites();
    // Browse card, job-detail dialog, checkout summary, profile schedule and
    // both admin panels are all in here. If this drops to zero the detector has
    // stopped working and every assertion below would pass vacuously.
    expect(sites.length).toBeGreaterThan(3);
    expect(new Set(sites.map((s) => s.file)).size).toBeGreaterThan(2);
  });

  it("renders no job start time except through jobStartTimeLabel", () => {
    const offenders = renderSites()
      .filter((s) => !s.viaRule)
      .map((s) => `${s.file}:${s.line}  ${s.expression}`);
    expect(
      offenders,
      "These print a job start time without the shared rule, so they can show a " +
        "raw column value, a blank, or an invented 'Flexible'. Route them through " +
        "jobStartTimeLabel (src/lib/jobDate.ts).",
    ).toEqual([]);
  });

  it("never formats a job start time with formatTime12 (it invents 'Flexible' on null)", () => {
    const offenders = formatTime12Offenders().map((o) => `${o.file}:${o.line}  ${o.call}`);
    expect(
      offenders,
      "formatTime12(null) returns the literal string 'Flexible'. On a job row " +
        "that is a scheduling promise the poster never made — use jobStartTimeLabel.",
    ).toEqual([]);
  });

  it("the shared rule itself answers the three cases", () => {
    // 1. A clock time is a clock time, on a 12-hour clock, both flag states.
    expect(jobStartTimeLabel("14:30:00", false)).toBe("2:30 PM");
    expect(jobStartTimeLabel("14:30:00", true)).toBe("2:30 PM");
    expect(jobStartTimeLabel("00:05", false)).toBe("12:05 AM");
    expect(jobStartTimeLabel("12:00", false)).toBe("12:00 PM");
    // 2. No time + the poster's own flag → the word.
    expect(jobStartTimeLabel(null, true)).toBe(FLEXIBLE_TIME_LABEL);
    expect(jobStartTimeLabel("", true)).toBe(FLEXIBLE_TIME_LABEL);
    // The legacy sentinel IN the time column means the same thing.
    expect(jobStartTimeLabel("flexible", false)).toBe(FLEXIBLE_TIME_LABEL);
    // 3. No time and no flag → NOTHING. Not "Flexible", not a dash, not "".
    expect(jobStartTimeLabel(null, false)).toBeNull();
    expect(jobStartTimeLabel(null, null)).toBeNull();
    expect(jobStartTimeLabel(undefined, undefined)).toBeNull();
    expect(jobStartTimeLabel("", false)).toBeNull();
    // Garbage in the column is not a time either — and must not become one.
    expect(jobStartTimeLabel("not-a-time", false)).toBeNull();
    expect(jobStartTimeLabel("25:00", false)).toBeNull();
  });

  it("never answers an empty or whitespace-only string (that IS the empty block)", () => {
    const inputs: (string | null | undefined)[] = [
      null, undefined, "", "   ", "flexible", "00:00", "09:15", "23:59", "garbage", "25:00", "12:60",
    ];
    expect(inputs.length).toBeGreaterThan(8);
    for (const flag of [true, false, null, undefined]) {
      for (const input of inputs) {
        const label = jobStartTimeLabel(input, flag);
        if (label === null) continue;
        expect(label.trim(), `jobStartTimeLabel(${JSON.stringify(input)}, ${flag})`).not.toBe("");
      }
    }
  });
});
