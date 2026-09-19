/**
 * HARNESS VACUITY (class (c)) — is the thing that reports green actually
 * exercising anything?
 *
 * Two real cases from 2026-09-19:
 *   - Playwright's browsers were NOT INSTALLED on this machine. Every local
 *     nightly that reported green did so without ever starting a browser.
 *   - The edge Supabase mock recorded WRITE filters but silently dropped READ
 *     filters, so no test could tell a seed-scoped sweep from an unscoped one.
 *     Partly fixed (`scenario.readQueries`); `is/lte/gte/lt/gt/limit/order`
 *     are STILL chainable no-ops, so a test can still assert the absence of a
 *     clause the mock never records and be green either way.
 *
 * Both sides of every check here are derived from the world: what the config
 * asks for vs what is on disk; what the mock records vs what the edge
 * functions actually call.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { REPO, read, exists, c } from "./lib.mjs";

const findings = [];
const add = (severity, id, msg, detail) => findings.push({ severity, id, msg, detail });

// ── 1. Playwright browsers: required-by-config vs present-on-disk ────────────
async function playwrightBrowsers() {
  if (!exists("playwright.config.ts")) return;
  const src = read("playwright.config.ts");
  // Device name -> engine comes from PLAYWRIGHT'S OWN registry, not a list
  // here: "Desktop Chrome" is chromium and "iPhone 13" is webkit, and a
  // hand-written mapping is exactly the registry antipattern this repo has
  // been bitten by nine times.
  let devices = {};
  try {
    ({ devices } = await import("playwright-core"));
  } catch {
    try {
      ({ devices } = await import("@playwright/test"));
    } catch {
      return;
    }
  }
  const wanted = new Set();
  for (const m of src.matchAll(/devices\[["']([^"']+)["']\]/g)) {
    const engine = devices[m[1]]?.defaultBrowserType;
    if (engine) wanted.add(engine);
  }
  for (const m of src.matchAll(/browserName:\s*["'](\w+)["']/g)) wanted.add(m[1].toLowerCase());
  if (!wanted.size) return;
  // PLAYWRIGHT_BROWSERS_PATH, when set, is where playwright looks — full stop.
  const cacheDirs = (
    process.env.PLAYWRIGHT_BROWSERS_PATH
      ? [process.env.PLAYWRIGHT_BROWSERS_PATH]
      : [
          path.join(process.env.HOME ?? "", "Library/Caches/ms-playwright"),
          path.join(process.env.HOME ?? "", ".cache/ms-playwright"),
        ]
  ).filter((d) => d && fs.existsSync(d));
  const onDisk = cacheDirs.flatMap((d) => fs.readdirSync(d));
  const missing = [...wanted].filter((w) => !onDisk.some((d) => d.startsWith(w + "-")));
  if (missing.length)
    add(
      "fail",
      "harness/playwright-browsers",
      `playwright.config.ts needs ${[...wanted].sort().join(", ")} but ${missing.join(", ")} is not installed — any "green" browser run on this machine ran no browser.`,
      "npx playwright install " + missing.join(" "),
    );
}

// ── 2. The vacuity tracer must still be wired into the one shared setupFile ──
function tracerWired() {
  if (!exists("src/test/setup.ts") || !read("src/test/setup.ts").includes("LH_VACUITY_TRACE"))
    add("fail", "harness/tracer", "src/test/setup.ts no longer wires the vacuity tracer — the mechanism can be silently disabled.");
}

// ── 3. Mock clauses that are chainable no-ops ────────────────────────────────
/** A method whose body is exactly `return this;` records nothing. */
function noopBuilderMethods(rel) {
  if (!exists(rel)) return [];
  const sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true);
  const out = [];
  const visit = (n) => {
    if (ts.isMethodDeclaration(n) && n.body && ts.isIdentifier(n.name)) {
      const stmts = n.body.statements;
      if (
        stmts.length === 1 &&
        ts.isReturnStatement(stmts[0]) &&
        stmts[0].expression &&
        stmts[0].expression.kind === ts.SyntaxKind.ThisKeyword
      )
        out.push(n.name.text);
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return out;
}

function edgeFunctionsUsing(methods) {
  const dir = path.join(REPO, "supabase", "functions");
  if (!fs.existsSync(dir)) return new Map();
  const hits = new Map();
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (!/\.ts$/.test(e.name)) continue;
      const src = fs.readFileSync(p, "utf8");
      for (const m of methods)
        if (new RegExp(`\\.${m}\\s*\\(`).test(src))
          (hits.get(m) ?? hits.set(m, new Set()).get(m)).add(path.relative(REPO, p).split(path.sep).join("/"));
    }
  }
  return hits;
}

function mockNoops() {
  const MOCK = "src/test/edge/mocks/supabase.ts";
  const noops = noopBuilderMethods(MOCK).filter((m) => !/^(then|catch|finally)$/.test(m));
  if (!noops.length) return;
  const hits = edgeFunctionsUsing(noops);
  const used = noops.filter((m) => hits.has(m));
  if (used.length)
    add(
      "warn",
      "harness/mock-silent-clauses",
      `${MOCK}: ${used.join(", ")} are chainable no-ops that record nothing, yet ${used
        .map((m) => `${hits.get(m).size} edge function(s) call .${m}()`)
        .join("; ")}. A test asserting the PRESENCE or ABSENCE of those clauses is green either way.`,
      [...new Set(used.flatMap((m) => [...hits.get(m)]))].slice(0, 8).join("\n  "),
    );
}

// ── 4. Config that no longer does what its comment says ─────────────────────
function deadVitestPoolOptions() {
  if (!exists("vitest.config.ts")) return;
  const src = read("vitest.config.ts");
  if (!src.includes("poolOptions")) return;
  const vitestVer = JSON.parse(read("node_modules/vitest/package.json")).version;
  if (Number(vitestVer.split(".")[0]) >= 4)
    add(
      "warn",
      "harness/vitest-pooloptions-dead",
      `vitest.config.ts sets test.poolOptions.threads.maxThreads, which Vitest ${vitestVer} REMOVED ("DEPRECATED \`test.poolOptions\` was removed in Vitest 4"). The 2-thread RAM cap that comment defends is not being applied; runs default to one worker per core on an 8 GB Mac.`,
      "Move maxThreads/minThreads to the top level of `test`.",
    );
}

export async function preflight() {
  findings.length = 0;
  await playwrightBrowsers();
  tracerWired();
  mockNoops();
  deadVitestPoolOptions();
  return findings;
}

export { c };
