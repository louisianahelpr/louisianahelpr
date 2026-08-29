#!/usr/bin/env node
/**
 * Dead edge-function guard.
 *
 * knip can see dead *modules*, but it cannot see a dead *edge function*: every
 * `supabase/functions/<name>/index.ts` is an entry point by definition — it is
 * invoked over HTTP by name, never imported. That blind spot is exactly how the
 * four business-seat functions sat dead for weeks before anyone noticed.
 *
 * So we check the other direction: for each deployed function, is its name
 * mentioned anywhere that could actually invoke it — client code, e2e, scripts,
 * CI workflows, supabase/config.toml, a cron/net.http_post call in a migration,
 * or another edge function? SQL comments are stripped first, because four of the
 * six functions below are "referenced" only inside `--` comments.
 *
 * Anything currently unreferenced is listed in KNOWN_UNREFERENCED with a reason.
 * That list is a ratchet, not a mute: a NEW unreferenced function fails CI, and
 * an entry that becomes referenced again also fails, so the list cannot rot.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const FUNCTIONS_DIR = join(root, "supabase/functions");

/**
 * Functions with no invocation site anywhere in the repo, as of 2026-08-25.
 * Reported, not deleted — each needs an owner decision, and this codebase has
 * feature-flagged work that looks unreferenced but is not.
 */
const KNOWN_UNREFERENCED = {
};

const SEARCH_ROOTS = ["src", "e2e", "scripts", ".github", "supabase/migrations", "supabase/config.toml"];
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|sql|toml|yml|yaml|json|sh|html)$/;

function walk(p, out = []) {
  let st;
  try {
    st = statSync(p);
  } catch {
    return out;
  }
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) {
      if (e === "node_modules" || e === "dist" || e === ".git") continue;
      walk(join(p, e), out);
    }
  } else if (TEXT_EXT.test(p)) {
    out.push(p);
  }
  return out;
}

/**
 * Comment lines do not invoke anything, and most of the stale references to
 * these functions live in prose. Only whole comment lines are dropped — a
 * trailing `//` strip would eat `https://…/functions/v1/<name>` URLs, which are
 * real invocation sites.
 */
const stripCommentLines = (text) =>
  text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("--") || t.startsWith("#"));
    })
    .join("\n");

const haystack = [];
for (const r of SEARCH_ROOTS) {
  for (const file of walk(join(root, r))) {
    // This guard names every known-unreferenced function; don't let it vouch for them.
    if (file.endsWith("check-dead-edge-functions.mjs")) continue;
    haystack.push(stripCommentLines(readFileSync(file, "utf8")));
  }
}

const fnDirs = readdirSync(FUNCTIONS_DIR).filter(
  (d) => d !== "_shared" && statSync(join(FUNCTIONS_DIR, d)).isDirectory(),
);
// Edge functions invoke each other too; _shared is scanned as part of no function.
const fnSources = new Map(
  fnDirs.map((d) => [
    d,
    walk(join(FUNCTIONS_DIR, d))
      .map((f) => stripCommentLines(readFileSync(f, "utf8")))
      .join("\n"),
  ]),
);
const sharedSource = walk(join(FUNCTIONS_DIR, "_shared"))
  .map((f) => stripCommentLines(readFileSync(f, "utf8")))
  .join("\n");

const unreferenced = [];
for (const name of fnDirs) {
  const hit =
    haystack.some((h) => h.includes(name)) ||
    sharedSource.includes(name) ||
    [...fnSources].some(([other, src]) => other !== name && src.includes(name));
  if (!hit) unreferenced.push(name);
}

const unexpected = unreferenced.filter((n) => !(n in KNOWN_UNREFERENCED));
const revived = Object.keys(KNOWN_UNREFERENCED).filter((n) => !unreferenced.includes(n));
const missing = Object.keys(KNOWN_UNREFERENCED).filter((n) => !fnDirs.includes(n));

let failed = false;
if (unexpected.length) {
  failed = true;
  console.error("✗ Edge functions with no invocation site anywhere in the repo:\n");
  for (const n of unexpected) console.error(`    supabase/functions/${n}`);
  console.error(
    "\n  Either wire it up, delete it, or — if it is genuinely reachable in a way\n" +
      "  this check cannot see — add it to KNOWN_UNREFERENCED in\n" +
      `  ${relative(root, join(root, "scripts/check-dead-edge-functions.mjs"))} with a one-line reason.`,
  );
}
if (revived.length || missing.length) {
  failed = true;
  console.error(
    "\n✗ KNOWN_UNREFERENCED is stale — remove these entries:\n" +
      [...revived.map((n) => `    ${n} (now referenced)`), ...missing.map((n) => `    ${n} (function no longer exists)`)].join("\n"),
  );
}

if (failed) process.exit(1);
console.log(
  `✓ ${fnDirs.length} edge functions checked; ${unreferenced.length} known-unreferenced, 0 new.`,
);
