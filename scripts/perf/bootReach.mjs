/**
 * bootReach — which first-party shared modules a SIGNED-OUT cold load can reach (Q654).
 *
 * vite.config.ts's `app-shared` group captures every src/lib|hooks|... module
 * that two chunks import, and `app-shared` is on the boot path of every page.
 * A module only the signed-in pages import (useActivityData, subscriptionTiers,
 * nativePush, ...) is shared by two of THEM, so it rode into app-shared and
 * every public visitor downloaded it: Lighthouse's unused-javascript put
 * 138-146 KiB on each public route.
 *
 * This walks STATIC imports (never `import()`) from the roots a public cold
 * load starts with — src/main.tsx and the guest page of every route in
 * ENTRY_ROUTE_CHUNKS (src/boot/routePreload.ts) — and returns the shared-code
 * modules NOT reachable from them. vite.config.ts gives those their own
 * `signed-in-shared` chunk; scripts/check-deferred-vendors.mjs fails if one is
 * ever found in a chunk of the boot graph again.
 *
 * Over-approximating the reachable set is harmless (a module stays in
 * app-shared, as before); the bundler's own graph decides correctness. The
 * walk is read from source on every build, so there is no list to go stale.
 *
 * The same walk then splits that set once more (signedInSplit): the part some
 * signed-in FIRST SCREEN reaches (a page whose chunk the entry starts, the
 * ProtectedRoute gate, or a component App.tsx mounts beside every page) stays
 * in `signed-in-shared`, which those screens fetch on their first round; the
 * rest (Declutter's api, crew lifecycle, en-route tracking, admin and support
 * helpers, ...) is only ever reached from a lazy page or dialog and gets its
 * own `signed-in-deep` chunk, fetched when that page or dialog opens. Measured
 * 2026-10-17: /posts carried ~8 KB gz of it on its critical path.
 */
import fs from "node:fs";
import path from "node:path";

/** Directories vite.config.ts's `app-shared` group captures. */
export const SHARED_DIR_RE = /[\\/]src[\\/](lib|hooks|utils|contexts|integrations|config|constants)[\\/]/;

const EXTS = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];
// import/export ... from "x" and bare import "x"; `import type` / `export type` are erased and skipped.
const STATIC = /(?:^|[;\n}])\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?from\s*)?["']([^"']+)["']/g;

const toPosix = (p) => p.split(path.sep).join("/");

/**
 * Drops whole comment LINES (`//`, `/*`, ` *`), nothing else. Deliberately not a
 * regex over the text: a block-comment regex deletes real code when `/*` sits in
 * a string or a regex literal (src/test/guardsDoNotDeleteSource.test.ts). A line
 * of code is never lost; an `import` written inside a trailing comment is kept,
 * which can only widen the reachable set, the harmless direction.
 */
export function stripComments(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

function resolveSpecifier(root, from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const ext of EXTS) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return toPosix(p);
  }
  return null;
}

/** Every src module statically reachable from `roots` (absolute or repo-relative paths). */
export function staticReach(root, roots) {
  const seen = new Set();
  const stack = roots.map((r) => toPosix(path.resolve(root, r)));
  const cache = new Map();
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    if (!cache.has(file)) {
      const text = fs.readFileSync(file, "utf8");
      cache.set(file, [...text.matchAll(STATIC)].map((m) => resolveSpecifier(root, file, m[1])).filter(Boolean));
    }
    for (const dep of cache.get(file)) stack.push(dep);
  }
  return seen;
}

/** The files a public cold load starts from, read from routePreload.ts. */
export function publicRoots(root) {
  const src = stripComments(fs.readFileSync(path.join(root, "src/boot/routePreload.ts"), "utf8"));
  const protectedSpec = src.match(/const\s+protectedRoute\s*=\s*\(\)\s*=>\s*import\(\s*["']@\/([^"']+)["']/)?.[1];
  const specs = new Set();
  for (const block of src.matchAll(/guest:\s*\[([^\]]*)\]/g)) {
    for (const m of block[1].matchAll(/import\(\s*["']@\/([^"']+)["']\s*\)/g)) specs.add(m[1]);
    if (/\bprotectedRoute\b/.test(block[1]) && protectedSpec) specs.add(protectedSpec);
  }
  const roots = [...specs].map((s) => resolveSpecifier(root, root + "/src/x.ts", "@/" + s));
  if (roots.length < 5 || roots.some((r) => !r)) {
    throw new Error(`bootReach: read ${roots.length} guest roots from routePreload.ts (expected 5+, all resolvable). Fix the scan.`);
  }
  return [path.join(root, "src/main.tsx"), ...roots];
}

/**
 * Components App.tsx mounts beside EVERY page, each a lazy chunk fetched once
 * the page has settled. scripts/check-deferred-vendors.mjs walks the same
 * ones (its ROUTE_ROOTS) and fails if any of their built closures carries a
 * `signed-in-deep` module, so a root missing here is caught on the build.
 */
export const EVERY_PAGE_ROOTS = [
  "src/components/MobileNav.tsx",
  "src/components/PageTransition.tsx",
  "src/components/ScrollToTop.tsx",
  "src/components/feedback/SuccessMomentHost.tsx",
  "src/pages/info/Legal.tsx",
];

/** Every first screen: each page in ENTRY_ROUTE_CHUNKS (guest and signed in), protectedRoute, EVERY_PAGE_ROOTS. */
export function firstScreenRoots(root) {
  const src = stripComments(fs.readFileSync(path.join(root, "src/boot/routePreload.ts"), "utf8"));
  const table = src.match(/export const ENTRY_ROUTE_CHUNKS[\s\S]*?\n\};/)?.[0];
  if (!table) throw new Error("bootReach: no ENTRY_ROUTE_CHUNKS table in src/boot/routePreload.ts. Fix the scan.");
  const specs = new Set([...table.matchAll(/import\(\s*["']@\/([^"']+)["']\s*\)/g)].map((m) => m[1]));
  const protectedSpec = src.match(/const\s+protectedRoute\s*=\s*\(\)\s*=>\s*import\(\s*["']@\/([^"']+)["']/)?.[1];
  if (protectedSpec) specs.add(protectedSpec);
  const roots = [...specs].map((s) => resolveSpecifier(root, root + "/src/x.ts", "@/" + s));
  if (roots.length < 10 || roots.some((r) => !r) || !protectedSpec) {
    throw new Error(`bootReach: read ${roots.length} first-screen roots from routePreload.ts (expected 10+, all resolvable, protectedRoute among them). Fix the scan.`);
  }
  for (const r of EVERY_PAGE_ROOTS) {
    if (!fs.existsSync(path.join(root, r))) throw new Error(`bootReach: EVERY_PAGE_ROOTS names ${r}, which does not exist. Fix the list.`);
  }
  return [...roots, ...EVERY_PAGE_ROOTS.map((r) => toPosix(path.join(root, r)))];
}

/**
 * signedInOnly split by whether any first screen statically reaches it:
 * `firstScreen` rides in `signed-in-shared`, `deep` in `signed-in-deep`.
 * Over-approximating the reach is harmless here too (a module stays in
 * signed-in-shared, as before).
 */
export function signedInSplit(root) {
  const { signedInOnly } = signedInOnlyModules(root);
  const reach = staticReach(root, firstScreenRoots(root));
  const firstScreen = new Set([...signedInOnly].filter((f) => reach.has(f)));
  const deep = new Set([...signedInOnly].filter((f) => !reach.has(f)));
  return { signedInOnly, firstScreen, deep };
}

/** Shared-code modules (the `app-shared` directories) that no public cold load reaches. */
export function signedInOnlyModules(root) {
  const reach = staticReach(root, publicRoots(root));
  const all = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/\.(test|spec)\./.test(e.name) && SHARED_DIR_RE.test(toPosix(p))) all.push(toPosix(p));
    }
  };
  walk(path.join(root, "src"));
  return { signedInOnly: new Set(all.filter((f) => !reach.has(f))), reachable: reach, sharedModules: all.length };
}
