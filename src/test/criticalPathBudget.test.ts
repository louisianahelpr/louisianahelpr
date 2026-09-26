/**
 * Q178 — the current page's own code downloads on the FIRST round, and the
 * next pages are warmed once it has loaded.
 *
 * Owner, 2026-09-23: "make sure everything is loading as fast as possible" and
 * "why wouldn't the code download immediately". Measured (production build,
 * 375, 1.6 Mbps / 150 ms RTT, 4x CPU): the landing's own chunk was requested
 * LAST, at ~3.9 s, behind ~20 rounds of JS — the entry's static graph walked
 * level by level (vite.config.ts `resolveDependencies: () => []` emptied every
 * preload list), then App.tsx's lazy PageTransition suspended the page behind
 * framer-motion. H1 at 4478 ms.
 *
 * Two halves guard it:
 *   1. The BUILT bundle: `node scripts/perf/critical-path.mjs --check` runs in
 *      bundle-size.yml and `npm run gate` against scripts/perf/critical-path-
 *      budget.json (rounds exact both ways, KB in a band). Red on origin/main
 *      before this change: page chunk in round 7, ready after 11-12 rounds.
 *      This file proves that analyser counts rounds correctly on fixtures.
 *   2. The SOURCE wiring that produces that shape, which a vitest run can see
 *      without a build: tiny entry, route preload, preload lists handed over,
 *      a PageTransition that never suspends the page, and the next-page
 *      prefetch with its Save-Data / 2G exemption.
 */
// @mutate index.html | <script type="module" src="/src/entry.ts"></script> | <script type="module" src="/src/main.tsx"></script>
// @mutate vite.config.ts | resolveDependencies: (_filename, deps) => deps, | resolveDependencies: () => [],
// @mutate src/boot/routePreload.ts | if (!before.has(link)) link.setAttribute(PAGE_PRELOAD_ATTR, ""); | void link;
// @mutate index.html |           if (t.hasAttribute("data-lh-page-preload")) return;\n | 
// @mutate src/boot/routePreload.ts | guest: [() => import("@/pages/info/Index")], | guest: [],
// @mutate src/App.tsx | const DashboardRouteSkeleton = skeletonOnDemand(() => import("@/components/DashboardRouteSkeleton")); | import DashboardRouteSkeleton from "@/components/DashboardRouteSkeleton";
// @mutate src/App.tsx | const [Animated] = useState(() => AnimatedPageTransition); | const Animated = lazy(() => import("@/components/PageTransition"));
// @mutate src/entry.ts | .then(({ prefetchLikelyNextRoutes }) => prefetchLikelyNextRoutes(hasToken(), window.location.pathname)) | .then(() => undefined)
// @mutate src/lib/routePrefetch.ts | if (isConstrainedNetwork()) return () => {}; | if (false) return () => {};
// @mutate scripts/perf/critical-path.mjs | if (got !== want) | if (got > want)
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyse, checkAgainstBudget, ROUTES } from "../../scripts/perf/critical-path.mjs";
import { blankComments } from "./helpers/blankNonCode";
import { ENTRY_ROUTE_CHUNKS } from "@/boot/routePreload";
import { LIKELY_NEXT_ROUTES, prefetchRoutesWhenIdle } from "@/lib/routePrefetch";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) => blankComments(read(p));

// ── 1. the analyser the CI budget trusts ─────────────────────────────────────
function fixture(files: Record<string, string>, html: string): string {
  const dir = mkdtempSync(join(tmpdir(), "q178-cp-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), html);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, "assets", name), body);
  return dir;
}
const PAGES = ROUTES.map((r) => `${r.chunk}-abcdefgh.js`);
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("critical-path analyser (scripts/perf/critical-path.mjs)", () => {
  it("counts the OLD shape: route chunk only after the app's static graph, then its own chain", () => {
    // entry -> app -> shell (static, 3 rounds); app lazy-imports every page
    // with no preload list; each page statically imports `shared`.
    const files: Record<string, string> = {
      "index-aaaaaaaa.js": `import{a}from"./app-aaaaaaaa.js";`,
      "app-aaaaaaaa.js": `import{s}from"./shell-aaaaaaaa.js";${PAGES.map((p) => `()=>import("./${p}");`).join("")}`,
      "shell-aaaaaaaa.js": `export const s=1;`,
      "shared-aaaaaaaa.js": `export const x=1;`,
    };
    for (const p of PAGES) files[p] = `import{x}from"./shared-aaaaaaaa.js";`;
    const dir = fixture(files, `<script type="module" crossorigin src="/assets/index-aaaaaaaa.js"></script>`);
    made.push(dir);
    const res = analyse(dir);
    expect(res.bootRounds).toBe(3);
    expect(res.entryStaticChunks).toBe(3);
    for (const r of res.routes) {
      expect(r.routeRound, r.path).toBe(4);
      expect(r.rounds, r.path).toBe(5);
    }
  });

  it("counts the NEW shape: tiny entry starts main and the page, each with its preload list, in round 2", () => {
    const table = ["assets/main-bbbbbbbb.js", "assets/shell-bbbbbbbb.js", "assets/shared-bbbbbbbb.js", ...PAGES.map((p) => `assets/${p}`)];
    const idx = (f: string) => table.indexOf(f);
    const entry =
      `import{t as e}from"./preload-helper-bbbbbbbb.js";` +
      `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=[${table.map((t) => `"${t}"`).join(",")}])))=>i.map(i=>d[i]);` +
      PAGES.map((p) => `e(()=>import(\`./${p}\`),__vite__mapDeps([${idx(`assets/${p}`)},${idx("assets/shared-bbbbbbbb.js")}]));`).join("") +
      `e(()=>import(\`./main-bbbbbbbb.js\`),__vite__mapDeps([${idx("assets/main-bbbbbbbb.js")},${idx("assets/shell-bbbbbbbb.js")}]));`;
    const files: Record<string, string> = {
      "index-bbbbbbbb.js": entry,
      "preload-helper-bbbbbbbb.js": `export const t=1;`,
      "main-bbbbbbbb.js": `import{s}from"./shell-bbbbbbbb.js";`,
      "shell-bbbbbbbb.js": `export const s=1;`,
      "shared-bbbbbbbb.js": `export const x=1;`,
    };
    for (const p of PAGES) files[p] = `import{x}from"./shared-bbbbbbbb.js";`;
    const dir = fixture(
      files,
      `<link rel="modulepreload" crossorigin href="/assets/preload-helper-bbbbbbbb.js"><script type="module" crossorigin src="/assets/index-bbbbbbbb.js"></script>`,
    );
    made.push(dir);
    const res = analyse(dir);
    expect(res.entryStaticChunks).toBe(2);
    expect(res.bootRounds).toBe(2);
    for (const r of res.routes) {
      expect(r.routeRound, r.path).toBe(2);
      expect(r.rounds, r.path).toBe(2);
    }
  });

  it("the budget fails BOTH ways: a deeper waterfall and a stale (too loose) budget", () => {
    const res = {
      entry: "index.js", entryKB: 3, entryStaticChunks: 2, htmlPreloads: [], bootRounds: 2, bootChunks: 2, bootKB: 3, bootFiles: [],
      routes: [{ path: "/", chunk: "Index", routeRound: 2, rounds: 2, chunks: 5, jsKB: 100 }],
    };
    const budget = (rounds: number, jsKB: number) => ({ entry: { staticChunks: 2, kb: 3 }, routes: { "/": { routeRound: 2, rounds, jsKB } } });
    expect(checkAgainstBudget(res, budget(2, 100))).toEqual([]);
    expect(checkAgainstBudget(res, budget(1, 100)).join()).toMatch(/REGRESSION/);
    expect(checkAgainstBudget(res, budget(3, 100)).join()).toMatch(/lower the budget/);
    expect(checkAgainstBudget(res, budget(2, 90)).join()).toMatch(/REGRESSION/);
    expect(checkAgainstBudget(res, budget(2, 120)).join()).toMatch(/lower the budget/);
  });

  it("the committed budget covers every route the analyser measures", () => {
    const budget = JSON.parse(read("scripts/perf/critical-path-budget.json")) as { routes: Record<string, unknown> };
    expect(Object.keys(budget.routes).sort()).toEqual(ROUTES.map((r) => r.path).sort());
    expect(ROUTES.length).toBeGreaterThan(3);
  });
});

// ── 2. the source wiring that produces the shape ─────────────────────────────
const PUBLIC_ROUTES: Array<[string, string]> = [
  ["/", "Index"],
  ["/browse", "DashboardGuest"],
  ["/login", "Login"],
  ["/signup", "Signup"],
];

describe("the page's own chunk is started by the entry, beside the app", () => {
  it("index.html loads the tiny entry, not main.tsx", () => {
    expect(read("index.html")).toMatch(/<script type="module" src="\/src\/entry\.ts"><\/script>/);
  });

  it("the entry and routePreload import nothing that would drag the app-shared chunk into the entry", () => {
    const entryImports = [...code("src/entry.ts").matchAll(/^\s*import\s+(?:[^"';]*from\s*)?["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(entryImports.sort()).toEqual(["./boot/guestJobsPrefetch", "./boot/routePreload", "./index.css"]);
    expect(code("src/boot/routePreload.ts")).not.toMatch(/^\s*import\s/m);
    // Q206 b: the guest /browse prefetch may import routePreload and nothing else.
    const prefetchImports = [...code("src/boot/guestJobsPrefetch.ts").matchAll(/^\s*import\s+(?:[^"';]*from\s*)?["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(prefetchImports).toEqual(["./routePreload"]);
    expect(code("src/entry.ts")).toMatch(/import\(\s*["']\.\/main["']\s*\)/);
  });

  it.each(PUBLIC_ROUTES)("%s: the entry preloads the SAME page module App.tsx lazy-loads (%s)", (path, page) => {
    const app = code("src/App.tsx");
    // Pages sit in their tab's folder (pages/info/Index, pages/home/DashboardGuest).
    const lazy = new RegExp(`import\\("\\./(pages/[\\w-]+/${page})"\\)`).exec(app);
    expect(lazy, `App.tsx lazy-loads no pages/<tab>/${page}`).not.toBeNull();
    const guest = ENTRY_ROUTE_CHUNKS[path]?.guest ?? [];
    expect(guest.map((f) => f.toString()).join("\n")).toContain(lazy![1]);
  });

  it("dynamic imports get their preload lists (vite.config.ts resolveDependencies is not emptied)", () => {
    const cfg = code("vite.config.ts");
    expect(cfg).toMatch(/resolveDependencies:\s*\(_filename,\s*deps\)\s*=>\s*deps/);
    expect(cfg).not.toMatch(/resolveDependencies:\s*\(\)\s*=>\s*\[\]/);
  });

  it("a stale PAGE chunk stays the in-app route recovery's case, not the boot watchdog's", () => {
    // The entry's page preload runs after main's (so its links are the page's
    // own), marks them, and index.html's watchdog skips marked links.
    const entry = code("src/entry.ts");
    expect(entry.indexOf('import("./main")')).toBeGreaterThan(-1);
    expect(entry.indexOf('import("./main")')).toBeLessThan(entry.indexOf("preloadEntryRoute(window.location.pathname)"));
    const pre = code("src/boot/routePreload.ts");
    expect(pre).toMatch(/link\.setAttribute\(PAGE_PRELOAD_ATTR, ""\)/);
    expect(pre).toContain('PAGE_PRELOAD_ATTR = "data-lh-page-preload"');
    expect(read("index.html")).toContain('if (t.hasAttribute("data-lh-page-preload")) return;');
  });

  it("App.tsx loads no route skeleton eagerly (they cost every cold load ~45 KB gzip)", () => {
    const app = code("src/App.tsx");
    const eager = [...app.matchAll(/^\s*import\s+\w+\s+from\s+["']@\/components\/(\w*Skeleton)["']/gm)].map((m) => m[1]);
    expect(eager).toEqual([]);
    const onDemand = [...app.matchAll(/skeletonOnDemand\(\(\) => import\("@\/components\/(\w+)"\)\)/g)].map((m) => m[1]);
    expect(onDemand.length).toBeGreaterThan(4);
  });

  it("App.tsx's PageTransition never suspends its page behind framer-motion", () => {
    const app = code("src/App.tsx");
    expect(app).not.toMatch(/const PageTransition\s*=\s*lazy\(/);
    expect(app).toMatch(/const \[Animated\] = useState\(\(\) => AnimatedPageTransition\)/);
  });
});

describe("the next pages are warmed once the current one has loaded", () => {
  it("names the likely next routes for guests and for signed-in visitors", () => {
    expect([...LIKELY_NEXT_ROUTES.guest]).toEqual(expect.arrayContaining(["/browse", "/login", "/signup"]));
    expect([...LIKELY_NEXT_ROUTES.signedIn]).toEqual(
      expect.arrayContaining(["/home", "/messages", "/jobs", "/post-job", "/profile"]),
    );
    const prefetch = code("src/lib/routePrefetch.ts");
    const all = [...LIKELY_NEXT_ROUTES.guest, ...LIKELY_NEXT_ROUTES.signedIn];
    for (const p of all) expect(prefetch, `${p} has no chunk to prefetch`).toContain(`"${p}": () => import(`);
    expect(all.length).toBeGreaterThan(7);
  });

  it("the entry schedules it after `load`", () => {
    const entry = code("src/entry.ts");
    expect(entry).toMatch(/addEventListener\(\s*["']load["']/);
    expect(entry).toContain("prefetchLikelyNextRoutes(hasToken(), window.location.pathname)");
  });

  it("skips it under Save-Data and on 2G, and schedules it otherwise", () => {
    const nav = navigator as unknown as { connection?: unknown };
    const had = Object.getOwnPropertyDescriptor(nav, "connection");
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    try {
      for (const connection of [{ saveData: true }, { effectiveType: "2g" }, { effectiveType: "slow-2g" }]) {
        Object.defineProperty(nav, "connection", { value: connection, configurable: true });
        setTimeoutSpy.mockClear();
        prefetchRoutesWhenIdle(["/login"])();
        expect(setTimeoutSpy, JSON.stringify(connection)).not.toHaveBeenCalled();
      }
      Object.defineProperty(nav, "connection", { value: { effectiveType: "4g" }, configurable: true });
      setTimeoutSpy.mockClear();
      const cancel = prefetchRoutesWhenIdle(["/login"]);
      expect(setTimeoutSpy).toHaveBeenCalled();
      cancel();
    } finally {
      setTimeoutSpy.mockRestore();
      if (had) Object.defineProperty(nav, "connection", had);
      else delete nav.connection;
    }
  });
});
