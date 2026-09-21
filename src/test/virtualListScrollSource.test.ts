// The registered mutation is the COMMENT shape — the inbox's scroll source
// deleted but left as a JSX comment, which is exactly what this guard could not
// see before `blankComments` below. Killing it kills the plain deletion too.
// @mutate src/components/messages/ConversationList.tsx | scrollElementRef={containerRef} | {/* scrollElementRef={containerRef} */}
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * A `<VirtualList>` ON AN APP-SHELL ROUTE MUST VIRTUALIZE AGAINST ITS OWN
 * SCROLL CONTAINER, NOT THE WINDOW.
 *
 * The class, not the instance. Every AppShell / PageScaffold route is
 * deliberately OFF `DOCUMENT_SCROLL_ROUTES` (src/hooks/useAppShellViewport.ts)
 * and therefore runs under `html.app-shell { overflow: hidden }` plus
 * `html.app-shell body { overflow: hidden }` (src/index.css). On those routes
 * `window.scrollY` is pinned at 0 for the life of the screen. A window
 * virtualizer subscribes to exactly that number, so it mounts one viewport of
 * rows on first paint and NEVER mounts another, however far the real container
 * scrolls. The rest of the list is blank space with nothing in it.
 *
 * Measured on prod data, /messages, 29 threads, 2026-09-19:
 *
 *            mountedRows  maxIndex  container  last row bottom  reachable
 *   375  top      16          15      2320px        1280px        16/29
 *   375  scrolled 16          15      2320px        1280px        16/29   ← blank panel
 *   1440 top      18          17      2320px        1440px        18/29
 *   1440 scrolled 18          17      2320px        1440px        18/29   ← blank panel
 *
 * Thirteen conversations were unreachable at 375 and eleven at 1440 — not
 * mis-measured, not clipped: never rendered, with no scroll gesture able to
 * produce them. The fix is `scrollElementRef`, which switches VirtualList to
 * `useVirtualizer` against the real element.
 *
 * DERIVED FROM THE WORLD, NOT FROM A LIST (CLAUDE.md: a registry that is both
 * a test's input and its oracle cannot fail for a missing member). The call
 * sites under test are every `<VirtualList` in src/. The route each one lives
 * under is computed by walking App.tsx's actual route table into the actual
 * import graph, so a NEW call site on an app-shell route is caught the day it
 * is written, with nobody having to remember to add it here.
 */

const SRC = resolve(process.cwd(), "src");
const APP_TSX = join(SRC, "App.tsx");
const VIEWPORT_HOOK = join(SRC, "hooks/useAppShellViewport.ts");

const CODE_EXT = [".tsx", ".ts", ".jsx", ".js"];

// ---------------------------------------------------------------------------
// The document-scroll route list, read from the hook rather than restated.
// ---------------------------------------------------------------------------

function parseRouteArray(source: string, name: string): string[] {
  const decl = source.indexOf(`const ${name} = [`);
  if (decl === -1) throw new Error(`${name} not found in useAppShellViewport.ts`);
  const open = source.indexOf("[", decl);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "[") depth += 1;
    else if (source[i] === "]") {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error(`${name} is not a closed array literal`);
  // Both lists are written with long explanatory comments between the
  // entries, and those comments quote paths ("/profile?tab=x", "/benefits")
  // that are NOT members. Strip comments before reading the strings, or the
  // guard quietly whitelists routes the app never puts on the list.
  const body = source
    .slice(open, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const routes = [...body.matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]);
  if (routes.length === 0) throw new Error(`${name} parsed empty — the hook's shape changed`);
  return routes;
}

const hookSource = readFileSync(VIEWPORT_HOOK, "utf8");
const DOCUMENT_SCROLL_ROUTES = parseRouteArray(hookSource, "DOCUMENT_SCROLL_ROUTES");
const NATIVE_APP_SHELL_ROUTES = parseRouteArray(hookSource, "NATIVE_APP_SHELL_ROUTES");

/**
 * Is this route html-locked on ANY surface we ship?
 *
 * "Phone web == native app: ONE surface" (CLAUDE.md), so a route that is
 * document-scroll on web but app-shell on native (/browse, /legal on iOS)
 * counts as app-shell here: the defect is real in the packaged app, and a list
 * that only works in a desktop browser is not shipped.
 */
function isAppShellRoute(pathname: string): boolean {
  if (NATIVE_APP_SHELL_ROUTES.includes(pathname)) return true;
  return !DOCUMENT_SCROLL_ROUTES.some((route) =>
    route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(`${route}/`),
  );
}

// ---------------------------------------------------------------------------
// App.tsx route table → page entry modules.
// ---------------------------------------------------------------------------

const appSource = readFileSync(APP_TSX, "utf8");

/** Component identifier → the module specifier it is imported from. */
const componentModule = new Map<string, string>();
for (const m of appSource.matchAll(
  /(?:const\s+(\w+)\s*=\s*(?:lazy|lazyWithPreload)\(\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']|import\s+(\w+)\s+from\s+["']([^"']+)["'])/g,
)) {
  const name = m[1] ?? m[3];
  const spec = m[2] ?? m[4];
  if (name && spec) componentModule.set(name, spec);
}

function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // node_modules — not our graph
  for (const ext of ["", ...CODE_EXT, ...CODE_EXT.map((e) => `/index${e}`)]) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** route path → the page module(s) it renders. */
const routeEntries: { path: string; file: string }[] = [];
for (const m of appSource.matchAll(/<Route\s+path="([^"]+)"([\s\S]*?)\/>/g)) {
  const [, path, element] = m;
  if (path === "*") continue; // the 404 catch-all is document-scroll by design
  for (const c of element.matchAll(/<(\w+)[\s/>]/g)) {
    const spec = componentModule.get(c[1]);
    if (!spec || !/\/pages\//.test(spec)) continue;
    const file = resolveSpec(spec, APP_TSX);
    if (file) routeEntries.push({ path, file });
  }
}

// ---------------------------------------------------------------------------
// Import graph: every file each route can reach.
// ---------------------------------------------------------------------------

const importSpecs = (source: string): string[] => [
  ...[...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]),
  ...[...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
];

/** absolute file → the route paths that can reach it. */
const routesForFile = new Map<string, Set<string>>();
for (const { path, file } of routeEntries) {
  const seen = new Set<string>();
  const queue = [file];
  while (queue.length) {
    const current = queue.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (!routesForFile.has(current)) routesForFile.set(current, new Set());
    routesForFile.get(current)!.add(path);
    let source: string;
    try { source = readFileSync(current, "utf8"); } catch { continue; }
    for (const spec of importSpecs(source)) {
      const next = resolveSpec(spec, current);
      if (next) queue.push(next);
    }
  }
}

// ---------------------------------------------------------------------------
// Inventory: every <VirtualList> in src/.
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test" || entry.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(tsx|ts)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Comments BLANKED, not deleted, so the offsets the caller already computed
 * stay valid.
 *
 * This guard was HOLLOW without it (proved 2026-09-21): deleting the inbox's
 * `scrollElementRef={containerRef}` and leaving it as `{/* scrollElementRef=
 * {containerRef} *\/}` passed 4/4 — the window virtualizer back, 13 of 29
 * threads unreachable at 375, green. The `/* … *\/` form is blanked wherever it
 * appears in the props; the `//` form only when it is the whole line, because a
 * prop value can legitimately contain `https://`.
 */
function blankComments(props: string): string {
  return props
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^([ \t]*)\/\/.*$/gm, (m, indent: string) => indent + " ".repeat(m.length - indent.length));
}

/** The JSX props text of a `<VirtualList ...>` element starting at `from`. */
function elementProps(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) return blankComments(source.slice(from, i));
  }
  return blankComments(source.slice(from));
}

interface CallSite {
  file: string;
  line: number;
  hasScrollElementRef: boolean;
  routes: string[];
  appShellRoutes: string[];
}

const callSites: CallSite[] = [];
for (const file of walk(SRC)) {
  const source = readFileSync(file, "utf8");
  for (const m of source.matchAll(/<VirtualList[\s/>]/g)) {
    const props = elementProps(source, m.index!);
    const routes = [...(routesForFile.get(file) ?? [])].sort();
    callSites.push({
      file: relative(process.cwd(), file),
      line: source.slice(0, m.index!).split("\n").length,
      hasScrollElementRef: /\bscrollElementRef\s*=/.test(props),
      routes,
      appShellRoutes: routes.filter(isAppShellRoute),
    });
  }
}

describe("VirtualList scroll source", () => {
  it("has call sites to check (the inventory is not silently empty)", () => {
    expect(callSites.length).toBeGreaterThan(0);
  });

  it("can place every call site on a route (an unrouted one cannot be classified)", () => {
    const orphans = callSites.filter((c) => c.routes.length === 0);
    expect(
      orphans.map((c) => `${c.file}:${c.line}`),
      "these <VirtualList> call sites are not reachable from any route in App.tsx, so this guard cannot tell which scroll source they need. Route them, delete them, or teach this test why.",
    ).toEqual([]);
  });

  it("passes scrollElementRef on every app-shell (overflow:hidden) route", () => {
    const offenders = callSites
      .filter((c) => c.appShellRoutes.length > 0 && !c.hasScrollElementRef)
      .map((c) => `${c.file}:${c.line} renders under ${c.appShellRoutes.join(", ")} — html.app-shell pins window.scrollY at 0, so a window virtualizer mounts one viewport of rows and never mounts another. Pass scrollElementRef={<the scroll container's ref>}.`);
    expect(offenders).toEqual([]);
  });

  it("does not pass scrollElementRef on a purely document-scroll route", () => {
    // The inverse mistake: an element virtualizer pointed at a ref that is
    // never a scroll container renders nothing at all.
    const offenders = callSites
      .filter((c) => c.routes.length > 0 && c.appShellRoutes.length === 0 && c.hasScrollElementRef)
      .map((c) => `${c.file}:${c.line} renders only under document-scroll routes (${c.routes.join(", ")}) but passes scrollElementRef.`);
    expect(offenders).toEqual([]);
  });
});
