/**
 * Prod-hitting scheduled workflows never pile up on the database.
 *
 * WHAT THIS CATCHES: prod (free-tier t4g.nano) went down for a day on
 * 2026-09-13 because ~9 nightly workflows fired inside 06:00–09:20 UTC and
 * drained the disk-IO allowance. The class is "two prod-hitting crons close
 * enough to overlap", plus the two things that make it worse: a workflow that
 * can run concurrently with another prod-hitting one, and a cron that fires
 * more often than hourly (prod-errors was every 15 minutes).
 *
 * The prod-hitting set is DERIVED from the workflow files, never listed here:
 * any scheduled workflow whose non-comment lines reference the prod Supabase
 * ref/URL, the project-ref secret, the E2E Supabase URL, a PLAYWRIGHT_* env
 * var (credentials, deployed base URL; not the local WEB_SERVER flag), or a Playwright project that
 * drives prod (journeys, a11y-prod, prod-audit, race). A new workflow that
 * touches prod is covered the day it lands.
 *
 * Rules, all evaluated over a full week of fire times (day-of-week aware):
 *   1. every prod-hitting workflow declares workflow-level
 *      `concurrency: group: prod-load` with `cancel-in-progress: false`
 *      (an expression is accepted only if it yields 'prod-load' for
 *      `schedule` events);
 *   2. no cron fires more often than hourly;
 *   3. no two fires of daily-or-rarer prod-hitting crons are within 90 min
 *      of each other (circularly, across midnight and the week boundary).
 *      A recurring monitor (more than one fire per day, i.e. prod-errors)
 *      is exempt from rule 3 — hourly would violate it against itself — but
 *      must keep at least 30 min clear of every daily fire.
 *
 * EXEMPTIONS are BY NAME with a stated reason, in `EXEMPT` below, and only
 * ever lift rules 2 and 3 (frequency and spacing). An exempt workflow must
 * still declare a workflow-level concurrency group with
 * cancel-in-progress: false, and that group must NOT be prod-load — GitHub
 * keeps one pending run per group, so a high-frequency monitor parked there
 * would silently cancel a queued suite. Exemption is for a monitor whose
 * whole per-run cost is a couple of anonymous single-row requests; it is
 * never for a test suite.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// PROD_WORKFLOWS_DIR: point at another checkout's workflows for a red proof.
const WORKFLOWS = process.env.PROD_WORKFLOWS_DIR ?? resolve(__dirname, "../../.github/workflows");
const WEEK = 7 * 24 * 60;
const MIN_GAP = 90;
const MONITOR_CLEARANCE = 30;

/**
 * Workflows exempt from the frequency (rule 2) and spacing (rule 3) rules,
 * by file name, each with the reason it costs prod essentially nothing.
 * Rule 1 still applies in its stricter form (see `violations`).
 */
export const EXEMPT: Record<string, string> = {
  "uptime.yml":
    "Uptime is a monitor, not a test suite: one anonymous GET of index.html plus " +
    "one anonymous single-row select from open_jobs_browse every 10 minutes " +
    "(~6 reads an hour, less than a single page view). Spacing it to 90 min " +
    "would defeat the point — the 2026-09-13 outage lasted a day unnoticed.",
};

const PROD_SIGNALS: RegExp[] = [
  /fncmgoasalhdgfwzhsqa/,
  // A direct PostgREST call from a workflow file — how uptime.yml reads prod.
  /\/rest\/v1\//,
  /SUPABASE_PROJECT_REF/,
  /E2E_SUPABASE_URL/,
  // Credentials, deployed base URL, prod Supabase URL/key. NOT
  // PLAYWRIGHT_WEB_SERVER, which boots a local preview (the mocked happy-path).
  /\bPLAYWRIGHT_(?!WEB_SERVER\b)[A-Z_]+/,
  /--project[= ]["']?(journeys|a11y-prod|prod-audit|race)/,
];

function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\s+#.*$/, ""))
    .join("\n");
}

export function cronsOf(src: string): string[] {
  const lines = stripComments(src).split("\n");
  const out: string[] = [];
  let inSchedule = false;
  let indent = -1;
  for (const line of lines) {
    const m = /^(\s*)schedule:\s*$/.exec(line);
    if (m) {
      inSchedule = true;
      indent = m[1].length;
      continue;
    }
    if (!inSchedule || line.trim() === "") continue;
    const lead = /^(\s*)/.exec(line)![1].length;
    if (lead <= indent) {
      inSchedule = false;
      continue;
    }
    const c = /-\s*cron:\s*["']([^"']+)["']/.exec(line);
    if (c) out.push(c[1].trim());
  }
  return out;
}

export function concurrencyOf(src: string): { group?: string; cancel?: string } {
  const lines = stripComments(src).split("\n");
  const i = lines.findIndex((l) => /^concurrency:\s*$/.test(l));
  if (i < 0) return {};
  const res: { group?: string; cancel?: string } = {};
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (l.trim() === "") continue;
    if (!/^\s/.test(l)) break;
    const g = /^\s+group:\s*(.+?)\s*$/.exec(l);
    if (g) res.group = g[1].replace(/^["']|["']$/g, "");
    const c = /^\s+cancel-in-progress:\s*(.+?)\s*$/.exec(l);
    if (c) res.cancel = c[1];
  }
  return res;
}

function expandField(field: string, lo: number, hi: number): number[] {
  const vals = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepS] = part.split("/");
    const step = stepS ? Number(stepS) : 1;
    let a: number;
    let b: number;
    if (range === "*") {
      a = lo;
      b = hi;
    } else if (range.includes("-")) {
      [a, b] = range.split("-").map(Number);
    } else {
      a = Number(range);
      b = stepS ? hi : a;
    }
    if (![a, b, step].every(Number.isInteger) || a < lo || b > hi || step < 1) {
      throw new Error(`unsupported cron field "${field}"`);
    }
    for (let v = a; v <= b; v += step) vals.add(v);
  }
  return [...vals].sort((x, y) => x - y);
}

/** Minutes-of-week (Sunday 00:00 UTC = 0) at which the cron fires. */
export function fireMinutes(cron: string): number[] {
  const f = cron.split(/\s+/);
  if (f.length !== 5) throw new Error(`cron "${cron}" must have 5 fields`);
  const [min, hour, dom, mon, dow] = f;
  // Day-of-month / month schedules cannot be laid on a weekly grid (and
  // "*/2" day-of-month fires on the 31st AND the 1st). Use day-of-week.
  if (dom !== "*" || mon !== "*") {
    throw new Error(`cron "${cron}": use day-of-week, not day-of-month/month`);
  }
  const days = expandField(dow.replace(/\b7\b/g, "0"), 0, 6);
  const out: number[] = [];
  for (const d of days)
    for (const h of expandField(hour, 0, 23))
      for (const m of expandField(min, 0, 59)) out.push(d * 1440 + h * 60 + m);
  return out.sort((a, b) => a - b);
}

function circDist(a: number, b: number): number {
  const d = Math.abs(a - b) % WEEK;
  return Math.min(d, WEEK - d);
}

function fmt(m: number): string {
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][Math.floor(m / 1440)];
  const h = String(Math.floor((m % 1440) / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${day} ${h}:${mm}`;
}

export interface Wf {
  file: string;
  src: string;
  crons: string[];
}

/**
 * `VITE_SUPABASE_URL` / `_PROJECT_ID` assignments are build-time constants
 * the bundle needs to mount at all; on their own they say nothing about
 * traffic (ui-sweep.yml bakes them in and mocks every Supabase call). A
 * workflow that really drives prod also carries credentials, the project-ref
 * secret or a prod Playwright project, and is caught by those.
 */
function signalText(src: string): string {
  return stripComments(src)
    .split("\n")
    .filter((l) => !/^\s*VITE_SUPABASE_(URL|PROJECT_ID):/.test(l))
    .join("\n");
}

export function prodHitting(wfs: Wf[]): Wf[] {
  return wfs.filter((w) => w.crons.length > 0 && PROD_SIGNALS.some((re) => re.test(signalText(w.src))));
}

export function violations(wfs: Wf[]): string[] {
  const out: string[] = [];
  const prod = prodHitting(wfs);

  // Rule 1: concurrency.
  for (const w of prod) {
    const { group, cancel } = concurrencyOf(w.src);
    if (EXEMPT[w.file]) {
      // Exempt from frequency/spacing, NOT from having its own safe group.
      if (!group) out.push(`${w.file}: exempt workflows still need a workflow-level concurrency group`);
      else if (group === "prod-load")
        out.push(`${w.file}: exempt workflows must NOT sit in prod-load (a frequent run there cancels queued suites)`);
      if (cancel !== "false") {
        out.push(`${w.file}: concurrency cancel-in-progress is "${cancel ?? "(unset)"}", must be false`);
      }
      continue;
    }
    // The hourly monitor has its own group: GitHub keeps only ONE pending run
    // per group, so an hourly run in prod-load would cancel a heavy suite that
    // is queued behind an overrunning one. It is tiny and 30 min clear anyway.
    const literal = group === "prod-load" || (w.file === "prod-errors.yml" && group === "prod-errors");
    const scheduleExpr =
      !!group && /github\.event_name\s*==\s*'schedule'\s*&&\s*'prod-load'/.test(group);
    if (!literal && !scheduleExpr) {
      out.push(`${w.file}: workflow-level concurrency group is "${group ?? "(none)"}", not prod-load`);
    }
    if (cancel !== "false") {
      out.push(`${w.file}: concurrency cancel-in-progress is "${cancel ?? "(unset)"}", must be false`);
    }
  }

  // Rule 2: nothing more often than hourly; Rule 3: spacing.
  const daily: { file: string; at: number }[] = [];
  const monitors: { file: string; at: number }[] = [];
  for (const w of prod) {
    if (EXEMPT[w.file]) continue;
    for (const cron of w.crons) {
      let fires: number[];
      try {
        fires = fireMinutes(cron);
      } catch (e) {
        out.push(`${w.file}: ${(e as Error).message}`);
        continue;
      }
      for (let i = 0; i < fires.length; i++) {
        const gap = circDist(fires[i], fires[(i + 1) % fires.length]);
        if (fires.length > 1 && gap < 60) {
          out.push(`${w.file}: cron "${cron}" fires every ${gap} min (more often than hourly)`);
          break;
        }
      }
      const perDay = fires.length / new Set(fires.map((m) => Math.floor(m / 1440))).size;
      const bucket = perDay > 1 ? monitors : daily;
      for (const at of fires) bucket.push({ file: w.file, at });
    }
  }
  daily.sort((a, b) => a.at - b.at);
  for (let i = 0; i < daily.length; i++) {
    const a = daily[i];
    const b = daily[(i + 1) % daily.length];
    if (daily.length > 1 && circDist(a.at, b.at) < MIN_GAP) {
      out.push(
        `${a.file} (${fmt(a.at)}) and ${b.file} (${fmt(b.at)}) are ${circDist(a.at, b.at)} min apart (< ${MIN_GAP})`,
      );
    }
  }
  const seen = new Set<string>();
  for (const m of monitors) {
    for (const d of daily) {
      const key = `${m.file}|${d.file}`;
      if (!seen.has(key) && circDist(m.at, d.at) < MONITOR_CLEARANCE) {
        seen.add(key);
        out.push(`${m.file} (${fmt(m.at)}) fires ${circDist(m.at, d.at)} min from ${d.file} (${fmt(d.at)})`);
      }
    }
  }
  return out;
}

function loadWorkflows(): Wf[] {
  return readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((file) => {
      const src = readFileSync(join(WORKFLOWS, file), "utf8");
      return { file, src, crons: cronsOf(src) };
    });
}

// @mutate .github/workflows/prod-audit.yml | group: prod-load | group: prod-audit-nightly
describe("prod-hitting workflow schedules", () => {
  const wfs = loadWorkflows();

  it("derives a non-trivial prod-hitting set from the workflow files", () => {
    const names = prodHitting(wfs).map((w) => w.file);
    // Sanity floor, not a registry: these are known to hit prod today, so a
    // broken derivation (e.g. a regex that matches nothing) cannot go green.
    for (const f of ["prod-audit.yml", "e2e-journeys.yml", "prod-errors.yml", "db-drift-detect.yml", "uptime.yml"]) {
      expect(names).toContain(f);
    }
  });

  it("every exemption names a real prod-hitting workflow and carries a reason", () => {
    const names = prodHitting(wfs).map((w) => w.file);
    for (const [file, reason] of Object.entries(EXEMPT)) {
      // A stale exemption is worse than none: it would silently cover a file
      // that no longer exists while the guard reports green.
      expect(names, `${file} is exempt but is not classified prod-hitting`).toContain(file);
      expect(reason.length, `${file} exemption needs a stated reason`).toBeGreaterThan(40);
    }
  });

  it("no overlaps, prod-load concurrency on each, nothing more often than hourly", () => {
    expect(violations(wfs)).toEqual([]);
  });

  it("can fail: the pre-2026-09-14 shape is red", () => {
    const bad: Wf[] = [
      {
        file: "a.yml",
        src: `on:\n  schedule:\n    - cron: "10 9 * * *"\nconcurrency:\n  group: x\n  cancel-in-progress: true\nenv:\n  PLAYWRIGHT_POSTER_EMAIL: y\n`,
        crons: ["10 9 * * *"],
      },
      {
        file: "b.yml",
        src: `on:\n  schedule:\n    - cron: "40 8 * * *"\nconcurrency:\n  group: prod-load\n  cancel-in-progress: false\n# fncmgoasalhdgfwzhsqa\nx: E2E_SUPABASE_URL\n`,
        crons: ["40 8 * * *"],
      },
      {
        file: "c.yml",
        src: `on:\n  schedule:\n    - cron: "*/15 * * * *"\nconcurrency:\n  group: prod-load\n  cancel-in-progress: false\nx: SUPABASE_PROJECT_REF\n`,
        crons: ["*/15 * * * *"],
      },
    ];
    const v = violations(bad);
    expect(v.some((s) => s.includes("a.yml: workflow-level concurrency group"))).toBe(true);
    expect(v.some((s) => s.includes("cancel-in-progress is \"true\""))).toBe(true);
    expect(v.some((s) => s.includes("30 min apart"))).toBe(true);
    expect(v.some((s) => s.includes("every 15 min"))).toBe(true);
    // Comment-only or build-constant-only references do not make a workflow prod-hitting.
    expect(prodHitting([{ file: "d.yml", src: "# fncmgoasalhdgfwzhsqa\n", crons: ["0 5 * * *"] }])).toEqual([]);
    expect(prodHitting([{ file: "d3.yml", src: "env:\n  PLAYWRIGHT_WEB_SERVER: \"1\"\n", crons: ["0 5 * * *"] }])).toEqual([]);
    expect(
      prodHitting([
        { file: "d2.yml", src: "env:\n  VITE_SUPABASE_URL: https://fncmgoasalhdgfwzhsqa.supabase.co\n", crons: ["0 5 * * *"] },
      ]),
    ).toEqual([]);
    // The exemption lifts frequency/spacing ONLY, and only by name.
    const tenMin = 'on:\n  schedule:\n    - cron: "*/10 * * * *"\nx: /rest/v1/open_jobs_browse\n';
    const wf = (file: string, concurrency: string): Wf => ({
      file,
      src: `${tenMin}concurrency:\n${concurrency}`,
      crons: ["*/10 * * * *"],
    });
    // Same file shape, not named in EXEMPT -> still red on frequency.
    expect(violations([wf("not-exempt.yml", "  group: prod-load\n  cancel-in-progress: false\n")]).some((v) => v.includes("every 10 min"))).toBe(true);
    // Named in EXEMPT with its own group -> green.
    expect(violations([wf("uptime.yml", "  group: uptime\n  cancel-in-progress: false\n")])).toEqual([]);
    // Exempt but parked in prod-load -> red (it would cancel queued suites).
    expect(violations([wf("uptime.yml", "  group: prod-load\n  cancel-in-progress: false\n")]).some((v) => v.includes("must NOT sit in prod-load"))).toBe(true);
    // Exempt but cancelling in progress -> red.
    expect(violations([wf("uptime.yml", "  group: uptime\n  cancel-in-progress: true\n")]).some((v) => v.includes("cancel-in-progress"))).toBe(true);

    // Day-of-week aware: same time on different days is not a collision.
    expect(
      violations([
        { file: "e.yml", src: "concurrency:\n  group: prod-load\n  cancel-in-progress: false\nPLAYWRIGHT_X", crons: ["17 3 * * 1"] },
        { file: "f.yml", src: "concurrency:\n  group: prod-load\n  cancel-in-progress: false\nPLAYWRIGHT_X", crons: ["17 3 * * 2"] },
      ]),
    ).toEqual([]);
  });
});
