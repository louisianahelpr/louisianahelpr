#!/usr/bin/env node
/**
 * check-deferred-vendors — the CI check for the class behind a 70 kB regression.
 *
 * THE DEFECT. `src/main.tsx` defers Sentry and PostHog on purpose:
 *
 *     import("./lib/sentry"), import("./lib/posthog")
 *
 * behind an idle callback, and its comment says why — "loading them before the
 * first frame was costing us ~4s of FCP on slow connections". `errorLogger.ts`
 * guards the same hazard internally, with its own comment: "Static imports
 * here would pull ~100KB of vendor code into the entry chunk ... defeating the
 * deferred init."
 *
 * Both were correct, and both were defeated anyway. `ForgotPassword.tsx:13`
 * did `import { captureException } from "@/lib/sentry"` — ONE line, in a route
 * nobody associates with startup cost. Rollup hoists a module imported both
 * statically and dynamically into the shared chunk, so all of @sentry/react
 * landed on the critical path and the deferral bought nothing. Measured on the
 * real build, 2026-09-22: 461 kB gzip across 50 chunks before first paint;
 * 391 kB across 49 after the single import was routed through errorLogger.
 *
 * WHY THIS READS `dist/`, NOT `src/`. A source grep for `@/lib/sentry` would
 * have caught this one instance and nothing else. The hazard is TRANSITIVE:
 * any module the entry reaches statically may pull a deferred vendor in
 * through any depth of intermediate import, and the offender need not name it.
 * The built graph is the only place the truth is unambiguous — the same reason
 * CLAUDE.md says to verify CSS claims against `dist/assets/*.css` and never
 * the dev server. So this walks the real static import graph of the real
 * entry chunk, and a new deferred vendor is caught however it arrives.
 *
 * FAILS LOUDLY ON ITS OWN BLINDNESS. If the entry cannot be found, or the walk
 * reaches no chunks, that is a FAILURE, not a pass. A check whose scan breaks
 * and then reports success is the failure mode this repo has been bitten by
 * repeatedly (registries checked against themselves, guards green for months).
 *
 *   node scripts/check-deferred-vendors.mjs
 *   node scripts/check-deferred-vendors.mjs --json
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";

const DIST = "dist";
const ASSETS = `${DIST}/assets`;

/**
 * Chunks that must never be reachable by STATIC import from the entry.
 *
 * Keyed on the chunk-name prefixes `vite.config.ts` assigns — main.tsx's own
 * comment relies on those literal names ("`vite.config.ts` names those chunks
 * literally `sentry-*.js` and `posthog-*.js`"), so this list is anchored to the
 * same fact the deferral is.
 */
const DEFERRED = [
  { prefix: "sentry-", why: 'main.tsx defers it: import("./lib/sentry") in an idle callback' },
  { prefix: "posthog-", why: 'main.tsx defers it: import("./lib/posthog") in an idle callback' },
];

/**
 * Packages that must never be reachable by STATIC import from the entry, found
 * by what a chunk CONTAINS rather than what it is called.
 *
 * framer-motion has no `manualChunks` name (vite.config.ts explains why it must
 * not get one), so rolldown names its chunks after whichever module it picks —
 * `proxy-*.js`, `AnimatePresence-*.js` today, anything tomorrow. A prefix would
 * be a guess. Instead each chunk's hidden sourcemap (`sourcemap: "hidden"`, so
 * every build emits `<chunk>.js.map`) lists the node_modules files inside it,
 * and a chunk carrying any file of the package counts, however it was named or
 * merged.
 *
 * framer-motion was on the critical path until 2026-09-22 through
 * index → DashboardTitleBar → NotificationPanel → proxy (+38 kB gzip); it now
 * loads when the bell's panel opens (src/components/notificationPanel/useFramerMotion.ts).
 */
const DEFERRED_PACKAGES = [
  {
    pkg: "framer-motion",
    why: "only animated surfaces need it; NotificationPanel loads it on open via useFramerMotion",
  },
];

const json = process.argv.includes("--json");
const fail = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };

if (!existsSync(`${DIST}/index.html`)) {
  fail(`no ${DIST}/index.html — run \`npm run build\` first. ` +
       `This check reads the BUILT graph on purpose; there is nothing to check without it.`);
}

const html = readFileSync(`${DIST}/index.html`, "utf8");
const m = html.match(/src="\/assets\/(index-[^"]+\.js)"/);
if (!m) fail(`could not find the entry script in ${DIST}/index.html — the build layout changed. ` +
             `Fix this check rather than deleting it: it cannot see anything right now.`);
const entry = m[1];

/** Static `import ... from "./x.js"` only. A dynamic `import("./x.js")` is the POINT and never matches. */
const STATIC_IMPORT = /(?:^|[;\s}])(?:import|export)\s*(?:[^'"]*?from\s*)?["']\.\/([^"']+\.js)["']/g;

const reached = new Set();
const parent = new Map();
const walk = (file) => {
  if (reached.has(file)) return;
  reached.add(file);
  let src;
  try { src = readFileSync(`${ASSETS}/${file}`, "utf8"); } catch { return; }
  for (const hit of src.matchAll(STATIC_IMPORT)) {
    if (!parent.has(hit[1])) parent.set(hit[1], file);
    walk(hit[1]);
  }
};
walk(entry);

if (reached.size < 2) {
  fail(`the static-import walk reached ${reached.size} chunk(s) from ${entry}. ` +
       `That is not a lean bundle, it is a broken scan — the import syntax changed. Fix the walk.`);
}

// The path back to the entry, so the message names the line to fix.
const chainTo = (f) => {
  const out = [f];
  let cur = f;
  while (parent.has(cur) && out.length < 12) { cur = parent.get(cur); out.push(cur); }
  return out.reverse().join(" → ");
};

const bytes = (f) => gzipSync(readFileSync(`${ASSETS}/${f}`)).length;
const all = readdirSync(ASSETS).filter((f) => f.endsWith(".js"));
const violations = [];
for (const { prefix, why } of DEFERRED) {
  for (const chunk of all.filter((f) => f.startsWith(prefix))) {
    if (reached.has(chunk)) violations.push({ chunk, why, gzip: bytes(chunk), chain: chainTo(chunk) });
  }
}

/** node_modules package names inside a chunk, from its hidden sourcemap. */
const packagesIn = (file) => {
  let map;
  try { map = JSON.parse(readFileSync(`${ASSETS}/${file}.map`, "utf8")); } catch { return null; }
  const out = new Set();
  for (const src of map.sources ?? []) {
    const hit = src.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (hit) out.add(hit[1]);
  }
  return out;
};

for (const { pkg, why } of DEFERRED_PACKAGES) {
  const carriers = all.filter((f) => packagesIn(f)?.has(pkg));
  // Blindness check: the package is a live dependency used by lazy routes, so
  // it must be found SOMEWHERE in the build. Zero carriers means the maps are
  // missing or the path shape changed — the scan sees nothing, which is a failure.
  if (!carriers.length) {
    fail(`found no chunk containing ${pkg} in any sourcemap under ${ASSETS}. ` +
         `Either the .js.map files are no longer emitted or the package left the bundle. ` +
         `If it left, remove it from DEFERRED_PACKAGES; otherwise fix the scan.`);
  }
  for (const chunk of carriers) {
    if (reached.has(chunk)) violations.push({ chunk, why: `${pkg}: ${why}`, gzip: bytes(chunk), chain: chainTo(chunk) });
  }
}

let critRaw = 0, critGz = 0;
for (const f of reached) { const b = readFileSync(`${ASSETS}/${f}`); critRaw += b.length; critGz += gzipSync(b).length; }

const summary = {
  entry,
  criticalPathChunks: reached.size,
  criticalPathGzipKb: +(critGz / 1024).toFixed(1),
  criticalPathRawKb: +(critRaw / 1024).toFixed(1),
  violations,
};

if (json) { console.log(JSON.stringify(summary, null, 2)); if (violations.length) process.exit(1); process.exit(0); }

console.log(`entry:         ${entry}`);
console.log(`critical path: ${reached.size} chunks, ${(critGz / 1024).toFixed(0)} kB gzip (${(critRaw / 1024).toFixed(0)} kB raw)`);

if (violations.length) {
  console.error(`\n✗ ${violations.length} deferred vendor chunk(s) are on the critical path:\n`);
  for (const v of violations) {
    console.error(`  ${v.chunk}  (+${(v.gzip / 1024).toFixed(1)} kB gzip before first paint)`);
    console.error(`    ${v.why}`);
    console.error(`    reached statically: ${v.chain}`);
    console.error(`    FIX: find the static import of it in that chain and make it dynamic at that`);
    console.error(`         boundary (Sentry/PostHog: route the call through \`report()\` in`);
    console.error(`         src/lib/errorLogger.ts; framer-motion: load it on demand, as`);
    console.error(`         src/components/notificationPanel/useFramerMotion.ts does). Do not add it to an allow list.\n`);
  }
  process.exit(1);
}

console.log(`\n✓ no deferred vendor (${[...DEFERRED.map((d) => d.prefix + "*"), ...DEFERRED_PACKAGES.map((d) => d.pkg)].join(", ")}) is statically reachable from the entry`);
