/**
 * Test traffic never lands on the deployed site.
 *
 * WHAT THIS CATCHES: on 2026-09-14 Vercel paused the project on Hobby limits
 * (Edge Requests 3.1M of 1M, Deployment Storage 34 GB of 10 GB). Every page
 * load of this SPA is ~110-215 edge requests (vite.config.ts measures it), and
 * the nightly journeys, prod audits, a11y sweeps, the money loop and the
 * per-push mobile-viewport check all drove www.louisianahelpr.com with service
 * workers blocked — so each of them paid full price, thousands of page loads a
 * week. The class is "a test suite whose frontend is the deployed site".
 *
 * THE RULE: real backend, LOCAL frontend. Suites build this commit and serve it
 * with `vite preview` on 127.0.0.1 (.github/actions/local-preview, or
 * playwright.config.ts's webServer), against the prod Supabase env. The
 * no-mock rule is untouched: Supabase, Stripe test mode and the shared test
 * accounts are exactly as real as before; only the HTML/JS host moved.
 *
 * Derived from the world, never a registry of suites:
 *   1. every workflow file (non-comment lines) — no production-domain URL, no
 *      `vars.E2E_BASE_URL` (a repo variable could silently repoint a suite),
 *      every PLAYWRIGHT_BASE_URL / HAPPY_PATH_BASE_URL / SITE_URL / BASE is a
 *      loopback URL, and every job that runs `playwright test` or sets one of
 *      those actually starts a local server in the same job;
 *   2. playwright.config.ts, IMPORTED: with no env overrides, every project's
 *      effective baseURL is loopback;
 *   3. every source file under e2e/ and scripts/ (plus playwright.config.ts):
 *      no production-domain URL in code.
 *
 * EXEMPTIONS are by file name with a reason, and exist only for things whose
 * whole job is to ask the deployed site a question, or that write the domain
 * as data and never fetch it.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// NO_VERCEL_TRAFFIC_ROOT: point at another checkout for a red proof.
const REPO = process.env.NO_VERCEL_TRAFFIC_ROOT ?? resolve(__dirname, "../..");

/** A URL on the production web host. Not an email (`@louisianahelpr.com`). */
export const PROD_HOST = /(?<![@\w.-])(?:https?:\/\/)?(?:www\.)?louisianahelpr\.com(?![\w-])/;

// @two-way src/test/noTestTrafficOnVercel.test.ts:const staleExempt =
export const WORKFLOW_EXEMPT: Record<string, string> = {
  "uptime.yml":
    "The uptime monitor's whole purpose is to ask the real site whether it answers: one GET of " +
    "index.html every 10 minutes (plus one PostgREST row). It cannot be pointed at a local build.",
  "prod-freshness.yml":
    "Reads the build-commit meta tag out of the LIVE index.html to prove prod serves main — one " +
    "HTML GET per poll, hourly (Q271: not on push, deploys are batched). A local build would prove nothing about the deploy.",
  // sitemap-drift.yml is NOT here: it regenerates public/sitemap.xml from source
  // (scripts/generate-sitemap.mjs --check) and never fetches the site.
};

// @two-way src/test/noTestTrafficOnVercel.test.ts:const staleExempt =
export const SOURCE_EXEMPT: Record<string, string> = {
  "scripts/uptime-check.mjs": "The uptime probe itself (uptime.yml, exempt above).",
  "scripts/generate-sitemap.mjs": "Writes the domain into sitemap.xml <loc> entries as text; never fetches it.",
  "scripts/asc/fix-review-issues.mjs":
    "Sets the App Store Connect Support URL metadata value Apple reviewers open; never fetches it.",
  "e2e/happy-path/zz-runtime-probe.spec.ts":
    "Three GETs of the 2 KB AASA file per run: its headers (application/json, no redirect) are set by " +
    "vercel.json and the CDN, which a local preview cannot reproduce. The other domain strings are " +
    "deep-link normalizer inputs passed to page.evaluate, never loaded.",
  "scripts/probes/edge-boot-sweep.mjs":
    "Sends the production domain only as the CORS Origin header of an OPTIONS preflight to Supabase edge " +
    "functions (that allowlisted origin is what the probe checks); it never requests the Vercel site.",
};

const BASE_VARS = /^\s*-?\s*(PLAYWRIGHT_BASE_URL|HAPPY_PATH_BASE_URL|SITE_URL|BASE):\s*(.*?)\s*$/;
const LOOPBACK = /^["']?https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|["']?$)/;
const STARTS_LOCAL_SERVER = /\.\/\.github\/actions\/local-preview|PLAYWRIGHT_WEB_SERVER:\s*["']?1/;

function yamlCode(src: string): string[] {
  return src
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\s+#.*$/, ""));
}

/** Jobs as [name, lines] from a workflow's `jobs:` block (two-space job keys). */
function jobsOf(src: string): [string, string[]][] {
  const lines = yamlCode(src);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return [];
  const out: [string, string[]][] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) out.push([m[1], []]);
    else if (out.length) out[out.length - 1][1].push(line);
  }
  return out;
}

export function workflowViolations(files: Record<string, string>): string[] {
  const v: string[] = [];
  for (const [file, src] of Object.entries(files)) {
    if (WORKFLOW_EXEMPT[file]) continue;
    const code = yamlCode(src);
    for (const line of code) {
      if (PROD_HOST.test(line)) v.push(`${file}: targets the production domain: ${line.trim()}`);
      if (/vars\.E2E_BASE_URL/.test(line)) {
        v.push(`${file}: reads vars.E2E_BASE_URL, which can repoint a suite at the deployed site: ${line.trim()}`);
      }
      const b = BASE_VARS.exec(line);
      if (b && !LOOPBACK.test(b[2])) {
        v.push(`${file}: ${b[1]} must be a loopback URL served by a local build, got: ${b[2] || "(block value)"}`);
      }
    }
    for (const [job, lines] of jobsOf(src)) {
      const body = lines.join("\n");
      const runsBrowser = /(^|\s)(npx\s+)?playwright\s+test\b/m.test(body);
      const setsBase = lines.some((l) => BASE_VARS.test(l));
      if ((runsBrowser || setsBase) && !STARTS_LOCAL_SERVER.test(body)) {
        v.push(
          `${file} job "${job}": drives a frontend but starts no local server ` +
            "(add `uses: ./.github/actions/local-preview`, or PLAYWRIGHT_WEB_SERVER: \"1\")",
        );
      }
    }
  }
  return v;
}

/** Code lines of a JS/TS/shell source with line comments and block-comment lines dropped. */
function sourceCode(src: string): string[] {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\/\*|\*|#)/.test(l))
    .map((l) => l.replace(/\s\/\/.*$/, ""));
}

export function sourceViolations(files: Record<string, string>): string[] {
  const v: string[] = [];
  for (const [rel, src] of Object.entries(files)) {
    if (SOURCE_EXEMPT[rel]) continue;
    for (const line of sourceCode(src)) {
      if (PROD_HOST.test(line)) v.push(`${rel}: loads the production domain: ${line.trim()}`);
    }
  }
  return v;
}

/**
 * Directories under the walked roots that are BUILD OUTPUT, not source. They
 * are gitignored, so they exist only after a build — which is exactly the
 * order CI runs things in (`build` then `test` in one job), and why this guard
 * went red on main without a single tracked file changing.
 *
 * `scripts/generated/og-shell.js` is a snapshot of the app's own index.html,
 * canonical `https://www.louisianahelpr.com` tag and all. That URL is the
 * PRODUCT's, not a test target — the thing this guard exists to catch is a
 * spec or harness pointing test traffic at the deployed site, and a generated
 * copy of the page we ship cannot do that.
 */
const GENERATED_DIRS = new Set(["generated"]);

function walk(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".") || GENERATED_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.test(name)) out.push(p);
  }
  return out;
}

function readAll(paths: string[]): Record<string, string> {
  return Object.fromEntries(paths.map((p) => [relative(REPO, p), readFileSync(p, "utf8")]));
}

describe("test traffic never lands on the deployed site", () => {
  const wfDir = join(REPO, ".github/workflows");
  const workflows = Object.fromEntries(
    readdirSync(wfDir)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => [f, readFileSync(join(wfDir, f), "utf8")]),
  );

  it("no workflow targets the production domain or runs a frontend suite without a local server", () => {
    expect(workflowViolations(workflows)).toEqual([]);
  });

  it("no e2e spec, helper, script or the Playwright config loads the production domain", () => {
    const files = readAll([
      ...walk(join(REPO, "e2e"), /\.(ts|tsx|mjs|js|cjs)$/),
      ...walk(join(REPO, "scripts"), /\.(ts|mjs|js|cjs|sh)$/),
      join(REPO, "playwright.config.ts"),
    ]);
    expect(Object.keys(files).length).toBeGreaterThan(50);
    expect(sourceViolations(files)).toEqual([]);
  });

  it("every Playwright project's default baseURL is a local build", () => {
    // The config is loaded by Node itself (type-stripped), exactly as Playwright
    // resolves it, with every env override removed — what a workflow that sets
    // nothing, or a local `npx playwright test`, would actually drive.
    const env = { ...process.env };
    for (const k of ["PLAYWRIGHT_BASE_URL", "VERCEL_URL", "HAPPY_PATH_BASE_URL", "HAPPY_PATH_PORT"]) delete env[k];
    const out = execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        "-e",
        'import(process.argv[1]).then((m) => { const c = m.default; process.stdout.write(JSON.stringify((c.projects ?? []).map((p) => ({ name: p.name, baseURL: p.use?.baseURL ?? c.use?.baseURL })))); })',
        join(REPO, "playwright.config.ts"),
      ],
      { cwd: REPO, env, encoding: "utf8", timeout: 60_000 },
    );
    const projects = JSON.parse(out) as { name: string; baseURL?: string }[];
    expect(projects.length).toBeGreaterThan(5);
    expect(projects.filter((p) => !p.baseURL || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(p.baseURL))).toEqual([]);
  }, 90_000);

  it("every exemption names a file that exists and gives a reason", () => {
    for (const [file, reason] of Object.entries(WORKFLOW_EXEMPT)) {
      expect(workflows[file], `${file} is exempt but does not exist`).toBeDefined();
      expect(reason.length).toBeGreaterThan(40);
    }
    for (const [file, reason] of Object.entries(SOURCE_EXEMPT)) {
      expect(() => statSync(join(REPO, file)), `${file} is exempt but does not exist`).not.toThrow();
      expect(reason.length).toBeGreaterThan(40);
    }
    // TWO-WAY: an exempt file whose CODE no longer names the production host
    // is excused for nothing — and would silently excuse the next prod URL
    // written there.
    const staleExempt = [
      ...Object.keys(WORKFLOW_EXEMPT).filter(
        (f) => !workflows[f] || !yamlCode(workflows[f]).some((l) => PROD_HOST.test(l)),
      ),
      ...Object.keys(SOURCE_EXEMPT).filter((f) => {
        const abs = join(REPO, f);
        return !existsSync(abs) || !sourceCode(readFileSync(abs, "utf8")).some((l) => PROD_HOST.test(l));
      }),
    ];
    expect(staleExempt.map((f) => `stale baseline entry ${f} — remove it (lower the baseline)`)).toEqual([]);
  });

  it("can fail: the shapes that paused the project on 2026-09-14 are red", () => {
    const journeys = [
      "jobs:",
      "  journeys:",
      "    env:",
      "      PLAYWRIGHT_BASE_URL: ${{ vars.E2E_BASE_URL || 'https://www.louisianahelpr.com' }}",
      "    steps:",
      "      - run: npx playwright test --project=journeys --workers=1",
    ].join("\n");
    const lighthouse = "jobs:\n  lh:\n    steps:\n      - with:\n          urls: |\n            https://www.louisianahelpr.com/browse\n";
    const noServer = "jobs:\n  a:\n    env:\n      PLAYWRIGHT_BASE_URL: http://127.0.0.1:4173\n    steps:\n      - run: npx playwright test --project=prod-audit\n";
    const v = workflowViolations({ "e2e-journeys.yml": journeys, "lighthouse.yml": lighthouse, "x.yml": noServer });
    expect(v.some((s) => s.startsWith("e2e-journeys.yml: targets the production domain"))).toBe(true);
    expect(v.some((s) => s.includes("vars.E2E_BASE_URL"))).toBe(true);
    expect(v.some((s) => s.includes("PLAYWRIGHT_BASE_URL must be a loopback URL"))).toBe(true);
    expect(v.some((s) => s.startsWith("lighthouse.yml: targets the production domain"))).toBe(true);
    expect(v.some((s) => s.includes('x.yml job "a": drives a frontend but starts no local server'))).toBe(true);

    // The fixed shape is green; exempt workflows and comments do not count.
    const fixed = [
      "jobs:",
      "  journeys:",
      "    env:",
      "      PLAYWRIGHT_BASE_URL: http://127.0.0.1:4173",
      "    steps:",
      "      # used to drive https://www.louisianahelpr.com",
      "      - uses: ./.github/actions/local-preview",
      "      - run: npx playwright test --project=journeys --workers=1",
    ].join("\n");
    expect(workflowViolations({ "e2e-journeys.yml": fixed })).toEqual([]);
    expect(workflowViolations({ "uptime.yml": "jobs:\n  c:\n    env:\n      SITE_URL: https://www.louisianahelpr.com/\n" })).toEqual([]);

    // A spec's own fallback to the deployed site is red; an email is not.
    const spec = 'const BASE_URL =\n  process.env.PLAYWRIGHT_BASE_URL ||\n  "https://www.louisianahelpr.com";\n';
    expect(sourceViolations({ "e2e/smoke.spec.ts": spec })).toHaveLength(1);
    expect(sourceViolations({ "scripts/a.mjs": 'const E = "eli.test.helper@louisianahelpr.com"; // https://www.louisianahelpr.com' })).toEqual([]);
  });
});

// The shape that paused the Vercel project on 2026-09-14, in the file every
// suite inherits its host from: the default baseURL falling back to the
// deployed site instead of the local `vite preview` build.
// @mutate playwright.config.ts | process.env.HAPPY_PATH_BASE_URL \|\| `http://127.0.0.1:${HAPPY_PATH_PORT}`; | process.env.HAPPY_PATH_BASE_URL \|\| "https://www.louisianahelpr.com";
