/**
 * EVERY PROD-HITTING BROWSER RUN IS METERED AND BUDGETED (docs/OPEN.md Q104).
 *
 * CI browser suites were ~94% of prod REST traffic with no real users on it
 * (24 h to 09:00Z 2026-09-23; 104,445 REST requests in the 03:00Z hour; one
 * press admin session 18,035 REST calls in 29 min), and no run measured its
 * own load. So, exactly:
 *
 *  1. No spec outside the mocked happy-path suite imports `test` from
 *     "@playwright/test": it takes the metered one from e2e/prodTest.ts, whose
 *     worker fixture counts every context the browser creates.
 *  2. Every workflow JOB that runs a prod-hitting Playwright project or a
 *     metered script also runs `request-budget.mjs --label <that run>`.
 *  3. e2e/request-budgets.json names exactly those labels (two-way), and every
 *     label has a per-minute ceiling.
 *  4. The checker itself fails over budget, fails a stale (under half) budget,
 *     and merges workers by wall-clock minute before taking the peak.
 *
 * @mutate e2e/prod-audit/page-settle.spec.ts | import { test, expect } from "../prodTest"; | import { test, expect } from "@playwright/test";
 * @mutate .github/workflows/prod-audit.yml | run: node scripts/e2e/request-budget.mjs --label prod-audit | run: echo skipped
 * @mutate scripts/e2e/request-budget.mjs | else if (measured < b * STALE_FRACTION) | else if (false)
 * @mutate e2e/prodTest.ts | meter.attachBrowser(browser); | void browser;
 * @mutate scripts/e2e/request-budget.mjs | if (agg.tests > 0 && agg.total === 0) { | if (false) {
 * @mutate scripts/e2e/request-budget.mjs | (allowEmpty ? notes : failures).push( | notes.push(
 * @mutate scripts/e2e/request-budget.mjs | .replace(UUID, ":id"); | ;
 * @mutate scripts/e2e/request-budget.mjs | kv && !/^t= | kv && !/^NOPE=
 * @mutate e2e/request-budgets.json | "perTest": 135.3, | "perTest": null,
 * @mutate .github/workflows/loading-states-refresh.yml | if: ${{ !cancelled() && steps.measure.outcome == 'success' }} | env: {}
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { aggregate, judge, shapeKey, topShapes, STALE_FRACTION } from "../../scripts/e2e/request-budget.mjs";
import { RequestMeter, classify, isSignIn } from "../../e2e/requestMeter.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Playwright projects whose specs reach prod: every project but the mocked happy-path pair. */
const MOCKED_PROJECTS = new Set(["happy-path", "happy-path-webkit"]);
const configProjects = [...read("playwright.config.ts").matchAll(/^\s*name:\s*"([^"]+)"/gm)].map((m) => m[1]);
const PROD_PROJECTS = configProjects.filter((p) => !MOCKED_PROJECTS.has(p));

/** Node scripts that drive a browser against prod from a workflow, and the label each meters under. */
const METERED_SCRIPTS: Record<string, { invoke: RegExp; file: string; label: string }> = {
  press: { invoke: /run: (node scripts\/audit\/press-every-control\.mjs|bash scripts\/audit\/press-wave\.sh [\d ]+)\s*$/m, file: "scripts/audit/press-every-control.mjs", label: "press-every-control" },
  loading: { invoke: /run: npm run loading-states:measure\s*$/m, file: "scripts/audit/measure-loading-states.mjs", label: "loading-states" },
};

const workflows = readdirSync(join(ROOT, ".github/workflows")).filter((f) => f.endsWith(".yml"));

/** The jobs of a workflow, comment lines dropped: [jobName, body]. */
function jobs(text: string): [string, string][] {
  const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const start = code.search(/^jobs:\s*$/m);
  if (start < 0) return [];
  const parts = code.slice(start).split(/^(?= {2}[A-Za-z0-9_-]+:\s*$)/m).slice(1);
  return parts.map((p) => [p.split(":")[0].trim(), p]);
}

/** Every (workflow job, label) a run step needs a budget step for, and whether that JOB has one. */
function requiredBudgetSteps(): { wf: string; label: string; has: boolean }[] {
  const out: { wf: string; label: string; has: boolean }[] = [];
  for (const file of workflows) {
    for (const [job, code] of jobs(read(`.github/workflows/${file}`))) {
      const wf = `${file} ${job}`;
      const labels = new Set<string>();
      for (const m of code.matchAll(/npx playwright test[^\n]*--project=(\S+)/g)) {
        const p = m[1];
        if (p === "${{" || p.startsWith("${{")) labels.add("${{ matrix.project }}");
        else if (!MOCKED_PROJECTS.has(p)) labels.add(p);
      }
      for (const s of Object.values(METERED_SCRIPTS)) if (s.invoke.test(code)) labels.add(s.label);
      for (const label of labels) {
        const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out.push({ wf, label, has: new RegExp(`run: node scripts/e2e/request-budget\\.mjs --label ${esc}( --dir \\S+)?\\s*$`, "m").test(code) });
      }
    }
  }
  return out;
}

describe("backend request budgets (Q104)", () => {
  it("reads a real config: the prod projects are found", () => {
    expect(PROD_PROJECTS.length).toBeGreaterThan(4);
    expect(PROD_PROJECTS).toContain("journeys");
    expect(PROD_PROJECTS).toContain("prod-audit");
  });

  it("no prod-hitting e2e file takes `test` from @playwright/test directly", () => {
    const files = walk(join(ROOT, "e2e")).map((f) => relative(ROOT, f));
    const offenders: string[] = [];
    let metered = 0;
    for (const f of files) {
      if (f.startsWith("e2e/happy-path/") || f === "e2e/prodTest.ts") continue;
      const code = blankComments(read(f));
      for (const m of code.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
        if (m[1]) continue;
        const names = m[2].split(",").map((n) => n.trim()).filter((n) => n && !n.startsWith("type "));
        const takesTest = names.some((n) => /^test(\s+as\s+\w+)?$/.test(n));
        if (!takesTest) continue;
        if (m[3] === "@playwright/test") offenders.push(f);
        else if (/(^|\/)prodTest$/.test(m[3])) metered++;
      }
    }
    expect(offenders, "an unmetered spec's prod load is invisible to the budget: import { test } from e2e/prodTest.ts").toEqual([]);
    expect(metered, "almost nothing imports the metered test — the scan is broken").toBeGreaterThan(20);
  });

  it("the metered test really wraps the worker's browser", () => {
    const src = blankComments(read("e2e/prodTest.ts"));
    expect(src).toMatch(/meter\.attachBrowser\(browser\);/);
    expect(src).toMatch(/scope:\s*"worker",\s*auto:\s*true/);
    expect(src).toMatch(/export \* from "@playwright\/test";/);
  });

  it("every metered script meters the browser it launches", () => {
    for (const s of Object.values(METERED_SCRIPTS)) {
      const src = blankComments(read(s.file));
      expect(src, s.file).toMatch(new RegExp(`new RequestMeter\\("${s.label}"\\)`));
      expect(src, s.file).toMatch(/requestMeter\.attachBrowser\(browser\);/);
    }
  });

  it("every prod-hitting run step is followed by its budget step", () => {
    const req = requiredBudgetSteps();
    expect(req.length, "found almost no prod-hitting run steps — the workflow scan is broken").toBeGreaterThan(6);
    expect(req.filter((r) => !r.has).map((r) => `${r.wf}: ${r.label}`)).toEqual([]);
  });

  it("a red budget step never skips a later step: every step after it carries its own `if:`", () => {
    // A step with no `if:` runs only on success(), so an over-budget run would
    // skip it: a verdict step placed there (loading-states-refresh's baseline
    // check) would go unjudged on exactly the runs that are already red.
    const unguarded: string[] = [];
    let budgetJobs = 0;
    for (const file of workflows) {
      for (const [job, code] of jobs(read(`.github/workflows/${file}`))) {
        const steps = code.split(/^(?= {6}- )/m).slice(1);
        const at = steps.findIndex((s) => /run: node scripts\/e2e\/request-budget\.mjs\b/.test(s));
        if (at < 0) continue;
        budgetJobs++;
        for (const s of steps.slice(at + 1)) {
          if (!/^\s+if:\s*\S/m.test(s)) unguarded.push(`${file} ${job}: ${s.split("\n")[0].trim().slice(0, 80)}`);
        }
      }
    }
    expect(budgetJobs, "found almost no budget steps — the workflow scan is broken").toBeGreaterThan(8);
    expect(unguarded, "these steps are skipped whenever the budget step is red").toEqual([]);
  });

  it("the budgets file names exactly the metered labels, each with a ceiling", () => {
    const { budgets } = JSON.parse(read("e2e/request-budgets.json")) as { budgets: Record<string, { ceilingPerMinute?: number }> };
    const used = new Set<string>();
    for (const r of requiredBudgetSteps()) {
      if (r.label === "${{ matrix.project }}") {
        // The matrix entries of that workflow are the labels.
        const text = read(`.github/workflows/${r.wf.split(" ")[0]}`);
        for (const m of text.matchAll(/^\s*-?\s*project:\s*(\S+)\s*$/gm)) used.add(m[1]);
      } else used.add(r.label);
    }
    const listed = new Set(Object.keys(budgets).filter((k) => k !== "*"));
    expect([...listed].sort()).toEqual([...used].sort());
    for (const k of listed) {
      const c = budgets[k].ceilingPerMinute ?? budgets["*"].ceilingPerMinute;
      expect(typeof c, `${k} has no per-minute ceiling`).toBe("number");
    }
  });

  it("the checker fails over budget, fails a stale budget, and notes an uncalibrated one", () => {
    const agg = aggregate([
      { label: "x", total: 300, byClass: { rest: 300 }, signIns: 2, duplicates: 0, tests: 3, minutes: { "10": 150, "11": 50 }, topDuplicates: {}, startedAt: 0, endedAt: 1 },
      // A second worker in the SAME minute: the peak is the merged minute.
      { label: "x", total: 100, byClass: { rpc: 100 }, signIns: 0, duplicates: 0, tests: 1, minutes: { "10": 100 }, topDuplicates: {}, startedAt: 0, endedAt: 1 },
    ]).x;
    expect(agg.peakPerMinute).toBe(250);
    expect(agg.perTest).toBe(100);
    expect(judge(agg, { ceilingPerMinute: 249 }).failures.join()).toMatch(/over the 249\/min ceiling/);
    expect(judge(agg, { ceilingPerMinute: 250, perTest: 99, signIns: 2 }).failures.join()).toMatch(/perTest 100 is over its budget 99/);
    expect(judge(agg, { ceilingPerMinute: 250, perTest: 100 / STALE_FRACTION + 1, signIns: 2 }).failures.join()).toMatch(/stale budget/);
    const ok = judge(agg, { ceilingPerMinute: 250, perTest: 120, signIns: 2 });
    expect(ok.failures).toEqual([]);
    const cal = judge(agg, { ceilingPerMinute: 250, perTest: null, signIns: null });
    expect(cal.failures).toEqual([]);
    expect(cal.notes.join()).toMatch(/perTest not calibrated; measured 100/);
    expect(judge(agg, {}).failures.join()).toMatch(/no ceilingPerMinute/);
    // Q104 review: tests ran, meter saw nothing -> red, never a quiet note.
    const hollow = { ...agg, total: 0, peakPerMinute: 0, perTest: 0, tests: 3 };
    expect(judge(hollow, { ceilingPerMinute: 400, perTest: null, signIns: null }).failures.join()).toMatch(/meter is not attached/);
  });

  it("the meter classifies backend requests and ignores everything else", () => {
    expect(classify("https://abc.supabase.co/rest/v1/jobs?select=id")).toBe("rest");
    expect(classify("https://abc.supabase.co/rest/v1/rpc/get_x")).toBe("rpc");
    expect(classify("https://abc.supabase.co/auth/v1/user")).toBe("auth");
    expect(classify("https://abc.supabase.co/functions/v1/f")).toBe("functions");
    expect(classify("https://abc.supabase.co/storage/v1/object/a")).toBe("storage");
    expect(classify("wss://abc.supabase.co/realtime/v1/websocket")).toBe("realtime");
    expect(classify("http://127.0.0.1:4173/assets/app.js")).toBeNull();
    expect(isSignIn("https://abc.supabase.co/auth/v1/token?grant_type=password", "POST")).toBe(true);
    expect(isSignIn("https://abc.supabase.co/auth/v1/token?grant_type=refresh_token", "POST")).toBe(false);
    const m = new RequestMeter("t");
    const seen = new Map<string, number>();
    m.record("https://abc.supabase.co/rest/v1/jobs?a=1", "GET", 1000, seen);
    m.record("https://abc.supabase.co/rest/v1/jobs?a=1", "GET", 2000, seen);
    m.record("https://abc.supabase.co/rest/v1/jobs?a=1", "GET", 2000, new Map());
    m.record("http://127.0.0.1/x", "GET", 2000, seen);
    expect([m.total, m.duplicates]).toEqual([3, 1]);
  });
});

describe("Q104 calibration: budgets written from the first metered runs", () => {
  it("every calibrated label has numeric perTest and an integer signIns, and the calibrated set is exact", () => {
    const { budgets } = JSON.parse(read("e2e/request-budgets.json")) as {
      budgets: Record<string, { perTest?: number | null; signIns?: number | null }>;
    };
    const calibrated = Object.entries(budgets)
      .filter(([k, b]) => k !== "*" && (b.perTest != null || b.signIns != null))
      .map(([k]) => k)
      .sort();
    // EXACT, two-way: a label calibrated from a measured run (2026-09-23, run
    // ids in the file's _calibrated note) cannot silently go back to null, and
    // a new one is written here in the same commit.
    expect(calibrated).toEqual(["journeys", "journeys-webkit", "loading-states", "press-every-control", "privacy", "prod-audit", "slow-network"]);
    for (const k of calibrated) {
      const b = budgets[k];
      expect(typeof b.perTest, `${k}.perTest`).toBe("number");
      expect(b.perTest!).toBeGreaterThan(0);
      expect(Number.isInteger(b.signIns), `${k}.signIns`).toBe(true);
    }
  });
});

describe("Q104: the summary's repeated-GET list names endpoints, not accounts", () => {
  it("folds account ids and the avatar cache-buster into one shape", () => {
    const a = "GET /rest/v1/user_blocks?select=blocker_id%2Cblocked_id&or=%28blocker_id.eq.71c56dfb-b326-4010-b960-b18dd3966e7f%2Cblocked_id.eq.71c56dfb-b326-4010-b960-b18dd3966e7f%29";
    const b = a.replace(/71c56dfb-b326-4010-b960-b18dd3966e7f/g, "437de07d-1bd7-46c8-a451-6b46aa3bcad5");
    expect(shapeKey(a)).toBe(shapeKey(b));
    expect(shapeKey(a)).not.toMatch(/71c56dfb/);
    expect(shapeKey("GET /storage/v1/object/public/avatars/71c56dfb-b326-4010-b960-b18dd3966e7f/avatar.jpg?t=1789245690811"))
      .toBe("GET /storage/v1/object/public/avatars/:id/avatar.jpg");
    // Only the numeric cache-buster goes: a real filter is kept.
    expect(shapeKey("GET /rest/v1/jobs?t=abc&status=eq.open")).toBe("GET /rest/v1/jobs?t=abc&status=eq.open");
    const top = topShapes({ [a]: 61, [b]: 80, "GET /auth/v1/user": 100 });
    expect(top[0]).toEqual([shapeKey(a), 141]);
    expect(top[1]).toEqual(["GET /auth/v1/user", 100]);
  });
});

describe("Q104 review: the budget step is red when nothing was measured", () => {
  it("a label with no sample fails the run (and --allow-empty is the only way past it)", () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-empty-"));
    const script = resolve(__dirname, "..", "..", "scripts", "e2e", "request-budget.mjs");
    const red = spawnSync(process.execPath, [script, "--label", "prod-audit", "--dir", dir], { encoding: "utf8" });
    expect(red.status, red.stdout + red.stderr).not.toBe(0);
    const allowed = spawnSync(process.execPath, [script, "--label", "prod-audit", "--dir", dir, "--allow-empty"], { encoding: "utf8" });
    expect(allowed.status, allowed.stdout + allowed.stderr).toBe(0);
  });
});
