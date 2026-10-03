/**
 * A SPEC THAT INTERCEPTS SUPABASE RUNS WITH THE SERVICE WORKER BLOCKED (Q1164).
 *
 * The production build registers a Workbox service worker whose runtimeCaching
 * sends every GET to *.supabase.co through `NetworkFirst` (vite.config.ts).
 * Once that worker claims the page, those GETs are fetched BY THE WORKER, and
 * neither `page.route` nor `context.route` sees a worker's fetch. So a spec that
 * answers Supabase from route mocks under a forged session silently reads PROD
 * with the fake token instead, and the request meter (e2e/requestMeter.mjs)
 * counts each such call twice: once for the page, once for the worker.
 *
 * Measured 2026-10-03: the `chromium` project allowed the worker, and it
 * collects e2e/visual-audit/{responsive,desktop-fill}.spec.ts, which install
 * the happy-path mocks. One of their /home loads at 1440 sent 24 reads to prod
 * that came back 401 PGRST301 ("Expected 3 parts in JWT; got 1"), each retried
 * (104 metered requests, 36 duplicate GETs; 42 and 0 with the worker blocked).
 * Those pairs and double counts were inside e2e-real-backend run 37132155495,
 * whose 410/min busiest minute and 291 duplicate GETs failed the Q104 budget
 * (nightly-red #2200).
 * press-every-control.mjs met the same worker on 2026-09-12 ("made every press
 * look like a 401") and blocked it locally; the project config never did.
 *
 * The class, from the repo's own inventory: every e2e spec that intercepts
 * Supabase traffic (the happy-path mock helpers, or its own route on a Supabase
 * URL), crossed with every Playwright project that collects it. Each such
 * project sets `serviceWorkers: "block"`, or the spec blocks it itself with
 * `test.use`. A bare `browser.newContext()` inside a test inherits the project's
 * `use` (measured: with the chromium project blocking, a bare context
 * registered 0 workers; without it, sw.js controlled the page), so the project
 * setting covers those too; an explicit `serviceWorkers: "allow"` in such a
 * spec is refused outright.
 *
 * Shared helpers that route Supabase on contexts they create themselves are
 * checked directly: such a context's own options must block the worker.
 *
 * @mutate playwright.config.ts | use: { ...devices["Desktop Chrome"], serviceWorkers: "block" }, | use: { ...devices["Desktop Chrome"] },
 * @mutate e2e/journeys/fixtures.ts | serviceWorkers: "block", |
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const CONFIG_RAW = readFileSync(join(ROOT, "playwright.config.ts"), "utf8");
const CONFIG = blankComments(CONFIG_RAW);

interface Project {
  name: string;
  testDir: string;
  testIgnore: RegExp | null;
  blocksServiceWorkers: boolean;
}

/** The object literals of `projects: [...]`, as [start, end) offsets into the (offset-preserving) blanked config. */
function projectBlocks(src: string): [number, number][] {
  const open = src.indexOf("[", src.search(/\bprojects:\s*\[/));
  const out: [number, number][] = [];
  let depth = 0;
  let objStart = -1;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") {
      depth--;
      if (depth === 0) break;
    } else if (c === "{") {
      if (depth === 1) objStart = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 1 && objStart >= 0) {
        out.push([objStart, i + 1]);
        objStart = -1;
      }
    }
  }
  return out;
}

const TOP_TEST_DIR = /^\s*testDir:\s*"([^"]+)"/m.exec(CONFIG.slice(0, CONFIG.search(/\bprojects:\s*\[/)))?.[1] ?? ".";

const PROJECTS: Project[] = projectBlocks(CONFIG).map(([s, e]) => {
  const block = CONFIG.slice(s, e);
  const raw = CONFIG_RAW.slice(s, e);
  const ignore = /\btestIgnore:\s*\/(.+)\/([a-z]*),?\s*$/m.exec(raw);
  return {
    name: /\bname:\s*"([^"]+)"/.exec(block)?.[1] ?? "?",
    testDir: (/\btestDir:\s*"([^"]+)"/.exec(block)?.[1] ?? TOP_TEST_DIR).replace(/^\.\//, "").replace(/\/$/, ""),
    testIgnore: ignore ? new RegExp(ignore[1], ignore[2]) : null,
    blocksServiceWorkers: /\bserviceWorkers:\s*"block"/.test(block),
  };
});

/** Playwright's default testMatch, which every project here uses. */
const isSpec = (rel: string) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(rel);

const collects = (p: Project, rel: string) =>
  (rel === p.testDir || rel.startsWith(`${p.testDir}/`)) && !(p.testIgnore && p.testIgnore.test(rel)) && isSpec(rel);

/**
 * A spec intercepts when it uses the happy-path mock helpers or calls a route
 * method at all. Any pattern counts, a regex literal or a variable included:
 * the worker hides its fetches from every route handler, whatever it matches.
 */
const MOCK_HELPER = /\b(?:installSupabaseMocks|mockSupabase)\s*\(/;
const ANY_ROUTE = /\.(?:route|routeFromHAR)\s*\(/;
/** A route on Supabase in a shared helper: the constant, the host, or an API path, in a string, template or regex. */
const SUPABASE_ROUTE = /\.(?:route|routeFromHAR)\s*\(\s*[^,]*?(?:SUPABASE_URL|supabase\.co|rest\\?\/v1|auth\\?\/v1|functions\\?\/v1|storage\\?\/v1)/;

const E2E_FILES = walkSource([join(ROOT, "e2e")])
  .map((f) => relative(ROOT, f))
  .map((rel) => ({ rel, code: blankComments(readFileSync(join(ROOT, rel), "utf8")) }));
const SPECS = E2E_FILES.filter((f) => isSpec(f.rel));

const INTERCEPTING = SPECS.filter((s) => MOCK_HELPER.test(s.code) || ANY_ROUTE.test(s.code));

/**
 * Shared helpers that route Supabase on a context they create themselves
 * (journeys' newUserContext): a bare project default does not reach a context
 * made with explicit options, so each such newContext must block the worker.
 */
const ROUTING_HELPERS = E2E_FILES.filter((f) => !isSpec(f.rel) && SUPABASE_ROUTE.test(f.code));

/** The argument text of every browser `.newContext(...)` call in `code` (an API `request.newContext` loads no pages). */
function newContextArgs(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/(?<!\brequest)\.newContext\s*\(/g)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
    }
    out.push(code.slice(start, i - 1));
  }
  return out;
}

const selfBlocks = (code: string) => /\btest\.use\(\s*\{[^}]*\bserviceWorkers:\s*["']block["']/.test(code);

describe("a spec that intercepts Supabase runs with the service worker blocked (Q1164)", () => {
  it("reads the real config and the real spec inventory", () => {
    expect(PROJECTS.length).toBeGreaterThan(10);
    const chromium = PROJECTS.find((p) => p.name === "chromium");
    expect(chromium?.testDir).toBe("e2e");
    // The ignore pattern survived parsing: it is what keeps chromium off the mocked suite.
    expect(chromium && collects(chromium, "e2e/happy-path/customer-post-job.spec.ts")).toBe(false);
    expect(chromium && collects(chromium, "e2e/visual-audit/responsive.spec.ts")).toBe(true);
    const happy = PROJECTS.find((p) => p.name === "happy-path");
    expect(happy && collects(happy, "e2e/happy-path/customer-post-job.spec.ts")).toBe(true);
    expect(INTERCEPTING.length).toBeGreaterThan(25);
    expect(INTERCEPTING.map((s) => s.rel)).toEqual(
      expect.arrayContaining([
        "e2e/visual-audit/responsive.spec.ts",
        "e2e/visual-audit/desktop-fill.spec.ts",
        "e2e/happy-path/customer-post-job.spec.ts",
        // A regex-literal route and a route on a variable are found too.
        "e2e/prod-audit/notification-panel-jump.spec.ts",
        "e2e/slow-network/slow-network.spec.ts",
      ]),
    );
    expect(ROUTING_HELPERS.map((f) => f.rel)).toEqual(expect.arrayContaining(["e2e/journeys/fixtures.ts", "e2e/prod-audit/harness.ts"]));
  });

  it("every shared helper that routes Supabase blocks the worker on the contexts it creates", () => {
    const offenders = ROUTING_HELPERS.flatMap((f) =>
      newContextArgs(f.code)
        .filter((args) => !/\bserviceWorkers:\s*["']block["']/.test(args))
        .map((args) => `${f.rel}: newContext(${args.replace(/\s+/g, " ").trim().slice(0, 80)})`),
    );
    expect(offenders).toEqual([]);
    // journeys' newUserContext is one of them, and it is read.
    expect(newContextArgs(ROUTING_HELPERS.find((f) => f.rel === "e2e/journeys/fixtures.ts")?.code ?? "").length).toBeGreaterThan(0);
  });

  it("every project that collects an intercepting spec blocks service workers", () => {
    const offenders: string[] = [];
    for (const spec of INTERCEPTING) {
      if (selfBlocks(spec.code)) continue;
      for (const p of PROJECTS) {
        if (collects(p, spec.rel) && !p.blocksServiceWorkers) offenders.push(`${p.name} runs ${spec.rel} with the service worker allowed`);
      }
    }
    expect(offenders, "add serviceWorkers: \"block\" to the project's use (or test.use in the spec)").toEqual([]);
  });

  it("no intercepting spec opts back in to the service worker", () => {
    const offenders = INTERCEPTING.filter((s) => /\bserviceWorkers:\s*["']allow["']/.test(s.code)).map((s) => s.rel);
    expect(offenders).toEqual([]);
  });
});
