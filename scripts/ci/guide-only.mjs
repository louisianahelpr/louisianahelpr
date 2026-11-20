#!/usr/bin/env node
/**
 * Guide fast lane (owner, 2026-11-20: a gift-guide PR waited ~5 hours behind
 * 10 PRs and ~15 queued jobs). A pull request that changes ONLY gift-guide
 * content (picks, go links, guide copy modules under src/content, guide images,
 * the sitemap, the guide data JSON under scripts/) cannot change what the app's
 * other code does, so the heavy PR jobs (Vitest shards, Coverage shards, both
 * Playwright checks, Lighthouse) skip and vitest.yml's "Guide fast lane" job
 * runs instead: typecheck, every test that reads the changed files, and the
 * sitemap drift check. Any changed path outside GUIDE_CONTENT (docs/ may ride
 * along) runs the whole suite, as before.
 *
 * Usage (CI): node scripts/ci/guide-only.mjs
 *   pull_request: diffs the checked-out merge commit against its first parent
 *   (the base tip), so the list is complete however many files the PR has.
 *   Any other event, or any error, is "not guide-only" (fail closed: the whole
 *   suite runs). CHANGED_FILES (newline-separated) overrides the diff.
 * Prints JSON {guideOnly, changed, files} and, under Actions, writes
 * guide_only=true|false to $GITHUB_OUTPUT.
 *
 * Guard: src/test/guideFastLane.test.ts (the list can never grow to cover
 * code: src/** /*.ts(x) outside src/content, tests, scripts' code, workflows).
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";

/**
 * The guide lane: gift-guide content plus the guide-only generators, checks
 * and tests that never ship in the bundle (owner via lead, 2026-11-20: "widen
 * the fast lane so real guide trains qualify"). Shipped UI code stays out:
 * src/pages/** and src/components/** (src/pages/info/giftGuides/*.tsx too),
 * src/lib/**, api/**, and every build-chain script run the full suite.
 * No script listed here is imported by shipped code or by package.json's
 * build chain (checked by src/test/guideFastLane.test.ts).
 * Globs: `**` any depth, `*` within one path segment.
 */
export const GUIDE_CONTENT = [
  // Content: picks, guide copy modules, go links, the generated search index.
  "src/content/giftGuidePicks/**",
  "src/content/giftGuide*.ts",
  "src/content/giftGuide*.json",
  "src/content/giftGuide*.mjs",
  "src/content/giftGuide*.d.mts",
  "src/content/goLinks.json",
  "src/content/goLinks.mjs",
  "src/content/goLinks.d.mts",
  // The share-image manifest api/share.ts reads: two exported Sets of slugs,
  // regenerated with the covers; data only (the guard checks it stays that way).
  "src/lib/giftGuideShareImages.mjs",
  "src/lib/giftGuideShareImages.d.mts",
  // Guide images and the sitemap the new guides go into.
  "public/gift-guides/**",
  "public/sitemap.xml",
  // Guide-only generators, data and checks (never in the bundle).
  "scripts/gift-guide-*.json",
  "scripts/gift-guide-*.mjs",
  "scripts/gift-guide-*.d.mts",
  "scripts/gift-guide-*.py",
  "scripts/giftGuide*.json",
  "scripts/giftGuide*.mjs",
  "scripts/giftGuide*.d.mts",
  "scripts/go-links.mjs",
  "scripts/go-links.d.mts",
  "scripts/check-gift-cover-*.mjs",
  // Guide-only tests and their helpers/fixtures (the fast lane runs every one).
  "src/test/giftGuide*.test.ts",
  "src/test/giftGuide*.test.tsx",
  "src/test/goLinks.test.ts",
  "src/test/helpers/giftGuide*.ts",
  "src/test/fixtures/giftGuide*.json",
];

/** May ride along with guide content without leaving the fast lane (never code). */
export const RIDE_ALONG = ["docs/**"];
// knip.json is not here on purpose: it configures the dead-code gate, so it runs the full suite.

/**
 * More picked tests than this and one job would be slower than the six shards
 * (measured 2026-11-20: 2853 test files over 6 shards, about 475 each; the
 * shards of the newest green PR run took 10-16 min), so the whole suite runs.
 */
export const MAX_FAST_TESTS = 300;

/** Tests the fast lane always runs: the guide, go-link and wish-list suites. */
export const ALWAYS_RUN = /^src\/test\/(giftGuide|goLinks|giftWish|navGiftGuides)[^/]*\.test\.tsx?$/;

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") { re += ".*"; i++; }
    else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const GUIDE_RE = GUIDE_CONTENT.map(globToRegExp);
const RIDE_RE = RIDE_ALONG.map(globToRegExp);
export const isGuideContent = (f) => GUIDE_RE.some((r) => r.test(f));

/** Pure: true only when at least one guide file changed and nothing outside the lane did. */
export function isGuideOnly(changed) {
  if (!changed.length) return false;
  if (!changed.some(isGuideContent)) return false;
  return changed.every((f) => isGuideContent(f) || RIDE_RE.some((r) => r.test(f)));
}

/**
 * Strings a test (or a module it imports) would contain if it reads this file.
 * Generic names are left out on purpose: "sitemap.xml" or "OPEN.md" alone are
 * named by hundreds of tests that read other things, so those files are matched
 * by their full path only.
 */
function needlesFor(f) {
  if (!isGuideContent(f) || f === "public/sitemap.xml") return [f];
  const out = [f, basename(f)];
  const noExt = f.replace(/(\.d)?\.[a-z]+$/, "");
  if (f.startsWith("scripts/")) out.push(noExt); // "../../scripts/giftGuideRules"
  if (f.startsWith("src/")) out.push(noExt.slice(4)); // "@/content/giftGuides", "../content/giftGuides"
  if (f.startsWith("public/")) out.push(f.slice(6), dirname(f).slice(6) + "/"); // "/gift-guides/covers/x.webp"
  if (f.startsWith("src/content/giftGuidePicks/")) out.push("giftGuidePicks");
  return out.filter((n) => n.length > 4);
}

/**
 * Pure: the test files that read any changed file, directly or through a
 * src/ or scripts/ module they import (relative or `@/`, two levels deep),
 * plus ALWAYS_RUN. Over-inclusion is safe; a test is never dropped for a
 * guide-only PR that names one of its files.
 */
export function pickGuideTests(changed, testFiles, read) {
  const needles = [...new Set(changed.flatMap(needlesFor))];
  // One alternation, not a loop of includes(): a 600-file train has ~2,000 needles.
  const needleRe = new RegExp(needles.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
  const names = (src) => needleRe.test(src);
  const cache = new Map();
  const load = (p) => {
    if (!cache.has(p)) {
      let s = "";
      for (const cand of [p, `${p}.ts`, `${p}.tsx`, `${p}.mjs`, `${p}/index.ts`]) {
        try { s = read(cand); break; } catch { /* Silent by design: try the next extension; an import that never resolves is not a path to the changed files. */ }
      }
      cache.set(p, s);
    }
    return cache.get(p);
  };
  const memo = new Map();
  const viaImports = (file, src, depth) => {
    if (depth > 2) return false;
    const key = `${depth}:${file}`;
    if (memo.has(key)) return memo.get(key);
    memo.set(key, false); // an import cycle is not a path to the changed files
    const hit = viaImportsUncached(file, src, depth);
    memo.set(key, hit);
    return hit;
  };
  const viaImportsUncached = (file, src, depth) => {
    for (const m of src.matchAll(/(?:from|import\()\s*["']((?:\.{1,2}\/|@\/)[^"']+)["']/g)) {
      const spec = m[1];
      const target = spec.startsWith("@/") ? normalize(`src/${spec.slice(2)}`) : normalize(join(dirname(file), spec));
      if (!/^(scripts|src)\//.test(target) || /\.test\./.test(target)) continue;
      const s = load(target);
      if (s && (names(s) || viaImports(target, s, depth + 1))) return true;
    }
    return false;
  };
  return testFiles.filter((t) => {
    if (ALWAYS_RUN.test(t)) return true;
    const src = read(t);
    return names(src) || viaImports(t, src, 0);
  });
}

function changedFiles() {
  if (process.env.CHANGED_FILES !== undefined) return process.env.CHANGED_FILES.split("\n").map((l) => l.trim()).filter(Boolean);
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") return [];
  const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 << 20 });
  git("fetch", "--no-tags", "--depth=2", "origin", process.env.GITHUB_SHA);
  // The merge commit's first parent is the base tip: this is exactly what merging changes.
  return git("diff", "--no-renames", "--name-only", "HEAD^1", "HEAD").split("\n").map((l) => l.trim()).filter(Boolean);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let result = { guideOnly: false, changed: 0, files: [] };
  try {
    const changed = changedFiles();
    const guideOnly = isGuideOnly(changed);
    let files = [];
    if (guideOnly) {
      const tests = execFileSync("git", ["ls-files", "src"], { encoding: "utf8", maxBuffer: 64 << 20 })
        .split("\n").filter((f) => /\.test\.(ts|tsx)$/.test(f));
      files = pickGuideTests(changed, tests, (p) => readFileSync(p, "utf8"));
    }
    result = { guideOnly: guideOnly && files.length > 0 && files.length <= MAX_FAST_TESTS, changed: changed.length, files };
  } catch (e) {
    // Fail closed: an unreadable diff runs the whole suite, never less.
    process.stderr.write(`guide-only: ${e?.message ?? e} (the whole suite runs)\n`);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `guide_only=${result.guideOnly}\n`);
  process.stdout.write(JSON.stringify(result));
}
