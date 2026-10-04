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
