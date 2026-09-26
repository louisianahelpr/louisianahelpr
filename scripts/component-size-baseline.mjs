#!/usr/bin/env node
/**
 * Per-file line count of every OVERSIZED React component file in non-test src/
 * (OPEN.md Q184, "god components"). Consumed by src/test/componentSizeRatchet.test.ts,
 * which holds scripts/component-size-baseline.json exact in both directions.
 *
 * A component file is any non-test `.tsx` under src/. It is OVERSIZED when it
 * has more than THRESHOLD lines (newline count, the same number `wc -l`
 * prints). Every oversized file must be in the baseline at its exact size:
 *   - bigger than its baseline      -> fails: extract instead of growing it;
 *   - smaller than its baseline     -> fails until the baseline is lowered in
 *                                      the same commit (the gain is kept);
 *   - oversized but not baselined   -> fails: a new god component;
 *   - baselined but now <= THRESHOLD -> fails until the entry is deleted.
 *
 *   node scripts/component-size-baseline.mjs          print oversized files, biggest first
 *   node scripts/component-size-baseline.mjs --write  lower the baseline (refuses to raise or add)
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const THRESHOLD = 600;
export const BASELINE_PATH = "scripts/component-size-baseline.json";

const NOT_SOURCE_DIRS = new Set(["node_modules", "dist", "coverage", "__tests__"]);

/** Test code is out of scope: *.test.tsx, *.spec.tsx, anything under src/test/. */
export function isTestFile(rel) {
  return /\.(test|spec)\.tsx$/.test(rel) || rel.startsWith("src/test/");
}

/** Newline count — identical to `wc -l`. */
export function countLines(src) {
  let n = 0;
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

/** { scanned: number of non-test .tsx files read, sizes: { "src/…": lines } for EVERY scanned file } */
export function componentSizes(root) {
  const sizes = {};
  let scanned = 0;
  const visit = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (NOT_SOURCE_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.endsWith(".tsx")) continue;
      const rel = relative(root, full).split(sep).join("/");
      if (isTestFile(rel)) continue;
      scanned++;
      sizes[rel] = countLines(readFileSync(full, "utf8"));
    }
  };
  visit(join(root, "src"));
  return { scanned, sizes };
}

/** Only the files over THRESHOLD. */
export function oversized(sizes, threshold = THRESHOLD) {
  return Object.fromEntries(Object.entries(sizes).filter(([, n]) => n > threshold));
}

/**
 * Every disagreement between the tree and the baseline, as human-readable
 * problems. Pure, so the test can exercise each branch on a fixture as well as
 * on the real tree.
 */
export function compare(sizes, baseline, threshold = THRESHOLD) {
  const problems = [];
  const keys = new Set([...Object.keys(baseline), ...Object.keys(oversized(sizes, threshold))]);
  for (const file of [...keys].sort()) {
    const was = baseline[file];
    const is = sizes[file];
    if (was === undefined) {
      problems.push(
        `${file}: NEW god component — ${is} lines, over the ${threshold}-line threshold. Extract ` +
          `self-contained pieces (presentational subcomponents, pure helpers, a hook) until it is ` +
          `<= ${threshold}. Do not add it to ${BASELINE_PATH}.`,
      );
    } else if (is === undefined) {
      problems.push(`${file}: in ${BASELINE_PATH} but no longer exists — delete the entry.`);
    } else if (is > was) {
      problems.push(
        `${file}: GREW from ${was} to ${is} lines. It is already over ${threshold}; extract ` +
          `something to pay for the new lines instead of raising ${BASELINE_PATH}.`,
      );
    } else if (is <= threshold) {
      problems.push(
        `${file}: now ${is} lines, at or under the ${threshold}-line threshold — good. Delete its ` +
          `entry (\`node scripts/component-size-baseline.mjs --write\`) in this commit.`,
      );
    } else if (is < was) {
      problems.push(
        `${file}: SHRANK from ${was} to ${is} lines — good. Run \`node scripts/component-size-baseline.mjs ` +
          `--write\` (or set it to ${is}) in this commit so the ratchet holds the gain.`,
      );
    }
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const { scanned, sizes } = componentSizes(root);
  const over = oversized(sizes);
  const sorted = Object.fromEntries(Object.entries(over).sort(([a], [b]) => a.localeCompare(b)));
  if (process.argv.includes("--write")) {
    // Lower-only: refuse to raise an entry or add a file, so --write can never
    // be the way a god component grows or appears past the ratchet.
    const path = join(root, BASELINE_PATH);
    const was = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).files : null;
    const grew = was ? Object.entries(sorted).filter(([f, n]) => was[f] === undefined || n > was[f]) : [];
    if (grew.length) {
      console.error(
        `refusing to raise the baseline:\n${grew.map(([f, n]) => `  ${f}: ${was[f] ?? "(new)"} -> ${n}`).join("\n")}`,
      );
      process.exit(1);
    }
    const out = {
      _: `God-component ratchet, enforced by src/test/componentSizeRatchet.test.ts. Exact line count (wc -l) of every non-test src/**/*.tsx over ${THRESHOLD} lines (node scripts/component-size-baseline.mjs). Exact both ways: when a file shrinks, regenerate with \`node scripts/component-size-baseline.mjs --write\` in the same commit; never raise or add an entry.`,
      _threshold: THRESHOLD,
      files: sorted,
    };
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
  }
  const total = Object.keys(over).length;
  console.log(`${total} component files over ${THRESHOLD} lines (${scanned} non-test .tsx files scanned)`);
  if (!process.argv.includes("--write"))
    for (const [f, n] of Object.entries(over).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${f}`);
}
