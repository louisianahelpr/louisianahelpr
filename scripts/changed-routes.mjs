#!/usr/bin/env node
/**
 * Which app routes does this change touch? (working-forwards change 2, owner 2026-09-12)
 *
 * Builds the src/ import graph, maps each <Route path> in App.tsx to its page
 * module, and prints the route patterns whose page transitively imports a
 * changed file. Global files (App.tsx, main.tsx, index.css, components/ui/*)
 * mean every route. Used by `npm run check:changed`, which runs the visual
 * sweep's gates (button geometry, new-tab destinations, error boundaries, axe)
 * on only those screens.
 *
 *   node scripts/changed-routes.mjs [--base origin/main] [--json]
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const argv = process.argv.slice(2);
const base = argv.includes("--base") ? argv[argv.indexOf("--base") + 1] : "origin/main";

const sh = (c) => { try { return execSync(c, { cwd: ROOT, encoding: "utf8" }); } catch { /* no merge base or no remote: treat as no committed diff */ return ""; } };
const changed = new Set(
  [sh(`git diff --name-only ${base}...HEAD`), sh("git diff --name-only HEAD"), sh("git ls-files --others --exclude-standard")]
    .join("\n").split("\n").map((s) => s.trim()).filter((f) => f.startsWith("src/") && !/\.test\.tsx?$/.test(f)),
);

const GLOBAL = [/^src\/App\.tsx$/, /^src\/main\.tsx$/, /^src\/index\.css$/, /^src\/components\/ui\//, /^src\/components\/AppShell\.tsx$/];

// ---- import graph ----------------------------------------------------------
const files = [];
(function walk(d) {
  for (const n of readdirSync(join(ROOT, d))) {
    const p = join(d, n);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(n) && !/\.test\./.test(n)) files.push(p);
  }
})("src");
const resolveSpec = (from, spec) => {
  let p;
  if (spec.startsWith("@/")) p = join("src", spec.slice(2));
  else if (spec.startsWith(".")) p = join(dirname(from), spec);
  else return null;
  for (const c of [p, `${p}.tsx`, `${p}.ts`, `${p}.jsx`, `${p}.js`, join(p, "index.tsx"), join(p, "index.ts")]) {
    if (existsSync(join(ROOT, c)) && statSync(join(ROOT, c)).isFile()) return c;
  }
  return null;
};
// routePrefetch.ts warms other routes' chunks with import(); that is not a
// render dependency, and following it made every route depend on every page.
const PREFETCH_ONLY = new Set(["src/lib/routePrefetch.ts"]);
const deps = new Map();
for (const f of files) {
  if (PREFETCH_ONLY.has(f)) { deps.set(f, new Set()); continue; }
  const src = readFileSync(join(ROOT, f), "utf8");
  const out = new Set();
  for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) {
    const r = resolveSpec(f, m[1]);
    if (r) out.add(r);
  }
  deps.set(f, out);
}
const closure = (entry) => {
  const seen = new Set([entry]);
  const stack = [entry];
  while (stack.length) for (const d of deps.get(stack.pop()) ?? []) if (!seen.has(d)) { seen.add(d); stack.push(d); }
  return seen;
};

// ---- routes → page modules -------------------------------------------------
const app = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
const compFile = new Map();
for (const m of app.matchAll(/const\s+(\w+)\s*=\s*\w+\(\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']/g)) {
  const r = resolveSpec("src/App.tsx", m[2]);
  if (r) compFile.set(m[1], r);
}
for (const m of app.matchAll(/import\s+(\w+)\s+from\s+["']([^"']+)["']/g)) {
  const r = resolveSpec("src/App.tsx", m[2]);
  if (r) compFile.set(m[1], r);
}
const routes = [];
for (const m of app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)) {
  const comps = [...m[2].matchAll(/<(\w+)/g)].map((x) => x[1]).filter((c) => compFile.has(c));
  routes.push({ path: m[1], files: comps.map((c) => compFile.get(c)) });
}

const isGlobal = [...changed].some((f) => GLOBAL.some((re) => re.test(f)));
const affected = isGlobal
  ? routes.map((r) => r.path)
  : routes.filter((r) => r.files.some((pf) => [...closure(pf)].some((d) => changed.has(d)))).map((r) => r.path);

const result = { base, changed: [...changed], global: isGlobal, routes: [...new Set(affected)] };
if (argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
else console.log(result.routes.join("\n"));
