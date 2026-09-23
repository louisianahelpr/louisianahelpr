#!/usr/bin/env node
/**
 * Per-file count of TypeScript `any` in non-test src/ (OPEN.md Q184).
 *
 * Counts `AnyKeyword` nodes in the syntax tree — every type-level `any`
 * (`: any`, `as any`, `<any>`, `any[]`, `Record<string, any>`) and nothing in
 * comments or strings. Consumed by src/test/anyRatchet.test.ts, which holds
 * scripts/any-baseline.json exact in both directions.
 *
 *   node scripts/any-baseline.mjs           print total + per-file counts
 *   node scripts/any-baseline.mjs --write   lower scripts/any-baseline.json (refuses to raise it)
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const NOT_SOURCE_DIRS = new Set(["node_modules", "dist", "coverage", "__tests__"]);

/** Test code is out of scope: *.test.*, *.spec.*, src/test/, __tests__/, harness *.gen.ts. */
export function isTestFile(rel) {
  return /\.(test|spec)\.tsx?$/.test(rel) || rel.startsWith("src/test/") || rel.endsWith(".gen.ts");
}

export function countAny(src, fileName) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, false, kind);
  let n = 0;
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) n++;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

/** { scanned: number of non-test .ts/.tsx files read, counts: { "src/…": n>0 } } */
export function countAnyByFile(root) {
  const counts = {};
  let scanned = 0;
  const visit = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (NOT_SOURCE_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      const rel = relative(root, full).split(sep).join("/");
      if (isTestFile(rel)) continue;
      scanned++;
      const n = countAny(readFileSync(full, "utf8"), entry);
      if (n > 0) counts[rel] = n;
    }
  };
  visit(join(root, "src"));
  return { scanned, counts };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const { scanned, counts } = countAnyByFile(root);
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (process.argv.includes("--write")) {
    // Lower-only: refuse to raise an entry or add a file, so --write can never
    // be the way a new `any` gets past the ratchet.
    const path = join(root, "scripts/any-baseline.json");
    const was = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).files : null;
    const grew = was ? Object.entries(sorted).filter(([f, n]) => n > (was[f] ?? 0)) : [];
    if (grew.length) {
      console.error(`refusing to raise the baseline:\n${grew.map(([f, n]) => `  ${f}: ${was[f] ?? 0} -> ${n}`).join("\n")}`);
      process.exit(1);
    }
    const out = {
      _: "`any` ratchet, enforced by src/test/anyRatchet.test.ts. Per-file AnyKeyword counts in non-test src/ (node scripts/any-baseline.mjs). Exact both ways: when you remove an `any`, regenerate with `node scripts/any-baseline.mjs --write` in the same commit; never raise an entry.",
      files: sorted,
    };
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
  }
  console.log(`${total} any in ${Object.keys(counts).length} files (${scanned} non-test files scanned)`);
  if (!process.argv.includes("--write"))
    for (const [f, n] of Object.entries(sorted).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${f}`);
}
