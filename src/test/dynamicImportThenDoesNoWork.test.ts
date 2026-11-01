/**
 * A query's read never runs inside `import(...).then(...)` (Sentry JAVASCRIPT-54, 11-01).
 *
 * In the build, Vite wraps a dynamic import AND the `.then(...)` chained straight onto it in its preload helper
 * (`__vitePreload(() => import("./x.js").then(cb), deps)`), and that helper ends in `.catch(onPreloadError)`. So a
 * read made inside `cb` that fails (an RPC error, a closed feature) is dispatched as `vite:preloadError`: main.tsx's
 * handler treats it as a broken chunk, may reload the page, and when it calls preventDefault() the promise resolves
 * `undefined`. TanStack Query refuses undefined data: '["shops","mine"] data is undefined' on /declutter (the
 * owner's iPhone, release 5519aa04c1), from CreateSheet's
 *   queryFn: () => import("@/lib/shops/api").then((m) => m.fetchMyShopId())
 * The fix keeps the import alone in its own loader (`const shopsApi = () => import("@/lib/shops/api")`) and makes
 * the read on its result, outside the wrapper. Measured in the build: `queryFn:()=>R().then(e=>e.fetchMyShopId())`,
 * with R the wrapped import.
 *
 * 1. No `queryFn` / `mutationFn` makes a call inside an `import(...).then` callback (zero, exact).
 * 2. Nowhere else either (B65, 2026-11-01): the 16 non-query sites pinned on 2026-11-01 each got a loader. Some made real
 *    reads or writes in the wrapper (the inbox's blocked-user read, Post a Job's repair-request read, the Senior
 *    Mode session write, the refetch after a held sign-in), so a failed one could reload the page.
 *
 * 3. Every loader goes through loadModule (B68, 2026-11-01): when main.tsx's handler prevents a preload error to
 *    start a recovery reload, Vite resolves the import with `undefined`, and a site reading it threw unhandled
 *    TypeErrors (language.ts at boot, the toast facade) or toasted a failure during the reload. loadModule()
 *    returns null then, and its Promise<T | null> type makes every caller handle it (src/lib/loadModule.test.ts).
 *    Bare loaders left: routePreload.ts's preload list (it warms chunks, never reads them) and the entry's Declutter
 *    prefetch (the entry imports nothing from src/lib; it reads `m?.`).
 *
 * @mutate src/components/create/CreateSheet.tsx | queryFn: () => shopsApi().then((m) => (m ? m.fetchMyShopId() : untilReload())), | queryFn: () => import("@/lib/shops/api").then((m) => m.fetchMyShopId()),
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts | queryFn: () => rentalsApi().then((m) => (m ? m.fetchMyProperties(uid) : untilReload())), | queryFn: () => import("@/lib/rentals/api").then((m) => m.fetchMyProperties(uid)),
 * @mutate src/pages/messages/messagesData/loadConversations.ts |   const blockedPromise = userBlocks().then( |   const blockedPromise = import("@/lib/userBlocks").then(
 * @mutate src/lib/sonnerFacade.ts |   loading = sonnerReal().then( |   loading = import("sonner-real").then(
 * @mutate src/lib/i18n/language.ts | const esModule = () => loadModule(() => import("./es")); | const esModule = () => import("./es");
 * @mutate src/lib/enRouteLocation.ts |         .catch((err: unknown) => { |         .then((err: unknown) => {
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import ts from "typescript";

const ROOT = join(__dirname, "..", "..");

type Hit = { file: string; line: number; inQueryFn: boolean };

/** Every `import(...).then(cb)` whose callback makes a call, in one file's source. */
export function importThenWork(file: string, src: string): Hit[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: Hit[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "then" &&
      ts.isCallExpression(node.expression.expression) &&
      node.expression.expression.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const cb = node.arguments[0];
      let calls = false;
      const scan = (x: ts.Node) => {
        if (ts.isCallExpression(x) || ts.isNewExpression(x)) calls = true;
        if (!calls) ts.forEachChild(x, scan);
      };
      if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) scan(cb.body);
      if (calls) {
        let inQueryFn = false;
        for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
          if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && /^(queryFn|mutationFn)$/.test(p.name.text)) inQueryFn = true;
        }
        hits.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, inQueryFn });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

// Non-query sites that still read inside the wrapper. Empty since B65 (11-01); exact both ways if one is ever pinned.
// @two-way src/test/dynamicImportThenDoesNoWork.test.ts:still pinned but no longer reads inside import().then
const KNOWN_IMPORT_THEN_WORK: Record<string, number> = {};

describe("no read runs inside Vite's dynamic-import wrapper", () => {
  const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f) && !f.startsWith("src/test/") && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts"));
  const hits = files.flatMap((f) => {
    const src = readFileSync(join(ROOT, f), "utf8");
    return src.includes("import(") ? importThenWork(f, src) : [];
  });

  it("reads the tree and sees the pattern (cannot pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(1000);
    // The loaders the fixed sites use: a dynamic import kept alone in its own arrow, called later.
    const loaders = files.filter((f) => /^const \w+ = \(\) => loadModule\(\(\) => import\(/m.test(readFileSync(join(ROOT, f), "utf8")));
    expect(loaders.length).toBeGreaterThan(25);
    const bad = importThenWork("x.ts", 'const q = { queryFn: () => import("@/a").then((m) => m.f()) };');
    expect(bad).toEqual([{ file: "x.ts", line: 1, inQueryFn: true }]);
    expect(importThenWork("y.ts", 'const a = () => import("@/a"); const q = { queryFn: () => a().then((m) => m.f()) };')).toEqual([]);
    expect(importThenWork("z.ts", 'const a = () => import("@/a").then((m) => m.default);')).toEqual([]);
  });

  it("no queryFn or mutationFn reads inside import().then", () => {
    expect(hits.filter((h) => h.inQueryFn).map((h) => `${h.file}:${h.line}`)).toEqual([]);
  });

  it("the other sites are exactly the pinned ones", () => {
    const counts: Record<string, number> = {};
    for (const h of hits.filter((x) => !x.inQueryFn)) counts[h.file] = (counts[h.file] ?? 0) + 1;
    const problems: string[] = [];
    for (const [f, n] of Object.entries(counts)) {
      if ((KNOWN_IMPORT_THEN_WORK[f] ?? 0) < n) problems.push(`${f}: ${n} read(s) inside import().then, pinned ${KNOWN_IMPORT_THEN_WORK[f] ?? 0}: load the module alone, then call`);
    }
    for (const [f, n] of Object.entries(KNOWN_IMPORT_THEN_WORK)) {
      if ((counts[f] ?? 0) < n) problems.push(`${f}: still pinned but no longer reads inside import().then (${counts[f] ?? 0} < ${n}): lower it`);
    }
    expect(problems).toEqual([]);
  });

  it("every loader goes through loadModule, so a prevented preload makes its site do nothing", () => {
    const bare: string[] = [];
    for (const f of files) {
      // routePreload only warms chunks; the entry may not import src/lib (criticalPathBudget) and reads `m?.`.
      if (f === "src/boot/routePreload.ts" || f === "src/entry.ts" || f === "src/lib/loadModule.ts") continue;
      const src = readFileSync(join(ROOT, f), "utf8");
      if (!src.includes("import(")) continue;
      src.split("\n").forEach((l, i) => {
        if (/^(export )?const \w+ = (async )?\(\) => import\(/.test(l)) bare.push(`${f}:${i + 1}`);
      });
    }
    expect(bare).toEqual([]);
    // The en-route watch clear had no catch at all.
    const enRoute = readFileSync(join(ROOT, "src/lib/enRouteLocation.ts"), "utf8");
    expect(enRoute).toMatch(/void geolocationModule\(\)\s*\.then\(\(m\) => m\?\.Geolocation\.clearWatch\([^\n]*\)\)\s*\.catch\(/);
  });
});
