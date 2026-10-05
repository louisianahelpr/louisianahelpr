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
import { signedInOnlyModules, stripComments } from "./perf/bootReach.mjs";

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
  {
    pkg: "@capgo/capacitor-social-login",
    why: "PD-011: web never uses it and native only on an Apple/Google tap; src/lib/socialAuth.ts loads it with import()",
  },
];

/**
 * FIRST-PARTY modules that only a lazy feature reads, found the same way as
 * DEFERRED_PACKAGES: by the source files a chunk's sourcemap lists, never by
 * a chunk name (Q1158, 2026-10-03).
 *
 * vite.config.ts's `app-shared` group captures every src/lib module that two
 * chunks share, and puts it on the boot path of every page. pdfDocument.ts is
 * shared by the two PDF exports (Home History, Work Record), so it went there,
 * and with it helprMarkPng.ts: a 32 KB base64 crest that compresses badly
 * (~24 KB brotli), read by nothing but a PDF export. The `pdf-documents`
 * group now keeps both with their importers. A prefix check on
 * `pdf-documents-*` could not catch the regression it exists for: with the
 * group gone there IS no such chunk, the crest is back inside app-shared, and
 * a prefix scan passes having seen nothing. So the files themselves are looked
 * for in every reached chunk's sources.
 */
const DEFERRED_MODULES = [
  { file: "src/lib/helprMarkPng.ts", why: "a 32 KB base64 crest only the PDF exports embed (vite.config.ts pdf-documents group)" },
  { file: "src/lib/pdfDocument.ts", why: "the PDF document builder (Home History, Work Record exports); vite.config.ts pdf-documents group" },
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
// Q178: the entry (src/entry.ts) is now tiny and reaches the app shell —
// main.tsx and everything it imports statically, the graph this check has
// always meant — through a DYNAMIC import fired on its first tick, with the
// whole static closure preloaded. That chunk is a root too; walking the entry
// alone would reach only the preload helper and pass having checked nothing.
// (The per-route page chunks the entry also starts are not roots, exactly as
// before: each is fetched only on its own route.)
{
  const entrySrc = readFileSync(`${ASSETS}/${entry}`, "utf8");
  const mainChunk = [...entrySrc.matchAll(/import\(\s*["'`]\.\/(main-[^"'`]+\.js)["'`]\s*\)/g)].map((x) => x[1])[0];
  if (!mainChunk) {
    fail(`${entry} has no dynamic import of main-*.js — the boot layout changed (see src/entry.ts). ` +
         `Fix this walk rather than deleting it: without that root it cannot see the app.`);
  }
  parent.set(mainChunk, entry);
  walk(mainChunk);
}

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

/** first-party src/ files inside a chunk, from its hidden sourcemap. */
const sourcesIn = (file) => {
  let map;
  try { map = JSON.parse(readFileSync(`${ASSETS}/${file}.map`, "utf8")); } catch { return null; }
  return new Set((map.sources ?? []).map((src) => {
    const hit = src.match(/(?:^|\/)(src\/.+)$/);
    return hit ? hit[1] : src;
  }));
};

for (const { file, why } of DEFERRED_MODULES) {
  const carriers = all.filter((f) => sourcesIn(f)?.has(file));
  // Blindness check, as for packages: the module is live code, so SOME chunk
  // must carry it. None means the maps are gone or the path shape changed.
  if (!carriers.length) {
    fail(`found no chunk whose sourcemap lists ${file}. Either the .js.map files are no longer ` +
         `emitted, the path shape changed, or the module was deleted (then remove it from DEFERRED_MODULES).`);
  }
  for (const chunk of carriers) {
    if (reached.has(chunk)) violations.push({ chunk, why: `${file}: ${why}`, gzip: bytes(chunk), chain: chainTo(chunk) });
  }
}

// ── Signed-in-only shared code (Q654) ─────────────────────────────────────
// vite.config.ts's `app-shared` group is on the boot path of every page. A
// src/lib|hooks|... module that no signed-OUT cold load reaches (static imports
// from main.tsx and each guest first screen, scripts/perf/bootReach.mjs) must
// not ride in it: useActivityData, subscriptionTiers, nativePush and ~150 more
// did, and every public visitor downloaded them (Lighthouse unused-javascript
// 138-146 KiB per public route). They live in `signed-in-shared-*` now. Read from
// the built chunks' sourcemaps, so a deleted group, a changed `test` or a module
// the walk and the bundler disagree about is caught however it arrives.
{
  const { signedInOnly } = signedInOnlyModules(process.cwd());
  const rel = (abs) => abs.slice(process.cwd().length + 1);
  const wanted = new Set([...signedInOnly].map(rel));
  const carriers = all.filter((f) => [...(sourcesIn(f) ?? [])].some((src) => wanted.has(src)));
  // Blindness check: those modules are live code, so the build must hold them SOMEWHERE.
  if (wanted.size < 50 || !carriers.length) {
    fail(`bootReach found ${wanted.size} signed-in-only shared modules and ${carriers.length} chunk(s) carrying them. ` +
         `Either the walk is blind (src/boot/routePreload.ts changed shape) or the .js.map files are gone. Fix the scan.`);
  }
  for (const chunk of carriers.filter((f) => reached.has(f))) {
    const mods = [...(sourcesIn(chunk) ?? [])].filter((src) => wanted.has(src));
    violations.push({
      chunk,
      why: `${mods.length} module(s) no signed-out cold load reaches are on the boot path, e.g. ${mods.slice(0, 3).join(", ")}`,
      gzip: bytes(chunk),
      chain: chainTo(chunk),
    });
  }
}

// ── Route closures (Q1172) ────────────────────────────────────────────────
// The boot walk above stops at the app shell; each FIRST SCREEN then loads its
// own page chunk and that chunk's static closure before it can draw. framer-motion
// rode two of them: /home through BrowseTasksFeed -> SwipeableJobCard (~40 kB
// brotli before its first draw) and the dock through MobileNav -> NavQuickMenu /
// SharedLayoutPill (the dock arrived ~1 s after its page). So every route in
// ENTRY_ROUTE_CHUNKS (src/boot/routePreload.ts: the screens whose chunk the
// entry starts on the first round) plus MobileNav is walked too, and each
// closure is held to the same deferred packages. The route list is READ from
// routePreload.ts, never copied here, so a new first screen is covered on arrival.
const routeSrc = stripComments(readFileSync("src/boot/routePreload.ts", "utf8"));
const routeBlock = routeSrc.match(/export const ENTRY_ROUTE_CHUNKS[\s\S]*?\n\};/);
if (!routeBlock) fail("could not find ENTRY_ROUTE_CHUNKS in src/boot/routePreload.ts — fix this scan rather than deleting it.");
const routeSpecifiers = new Set([...routeBlock[0].matchAll(/import\(\s*["']@\/([^"']+)["']\s*\)/g)].map((x) => x[1]));
// `protectedRoute` is declared above the table as one shared loader.
for (const x of routeSrc.matchAll(/const\s+protectedRoute\s*=\s*\(\)\s*=>\s*import\(\s*["']@\/([^"']+)["']/g)) routeSpecifiers.add(x[1]);
const ROUTE_ROOTS = [...routeSpecifiers].map((spec) => ({ label: spec, name: spec.split("/").pop() }));
// The dock is a lazy chunk of its own, started with every signed-in page.
ROUTE_ROOTS.push({ label: "components/MobileNav", name: "MobileNav" });
if (ROUTE_ROOTS.length < 8) {
  fail(`read only ${ROUTE_ROOTS.length} first-screen roots from routePreload.ts (expected 8+). The scan is blind; fix it.`);
}

/**
 * First-screen closures that STILL carry a deferred package, as `root: package`.
 * Exact both ways: a root listed here that is clean fails as stale (lower the
 * list in the commit that fixes it), and a root that is red and not listed fails
 * as a regression. Each entry is open work with its own Q in docs/OPEN.md.
 */
// @two-way scripts/check-deferred-vendors.mjs:(stale entry: remove it, the baseline is exact)
// Empty since Q1299 (2026-10-05): Messages' SwipeableConversationRow and
// PostJob's PhotoUpload Reorder now load framer-motion on demand
// (ConversationSwipeLayer.tsx, PhotoReorderGrid.tsx).
const KNOWN_ROUTE_CLOSURE_VIOLATIONS = {};

const routeFound = [];
for (const { label, name } of ROUTE_ROOTS) {
  const re = new RegExp(`^${name}-[\\w-]{6,}\\.js$`);
  const rootChunk = all.find((f) => re.test(f));
  if (!rootChunk) fail(`no built chunk for first-screen root ${label} (expected ${name}-<hash>.js). Fix this scan; do not drop the root.`);
  const par = new Map([[rootChunk, null]]);
  const queue = [rootChunk];
  while (queue.length) {
    const f = queue.shift();
    let text;
    try { text = readFileSync(`${ASSETS}/${f}`, "utf8"); } catch { continue; }
    for (const hit of text.matchAll(STATIC_IMPORT)) if (!par.has(hit[1])) { par.set(hit[1], f); queue.push(hit[1]); }
  }
  if (par.size < 2) fail(`the closure of ${rootChunk} has ${par.size} chunk(s); the import syntax changed. Fix the walk.`);
  const chainFrom = (f) => { const out = [f]; let cur = f; while (par.get(cur)) { cur = par.get(cur); out.push(cur); } return out.reverse().join(" → "); };
  for (const { pkg, why } of DEFERRED_PACKAGES) {
    for (const chunk of [...par.keys()].filter((f) => packagesIn(f)?.has(pkg))) {
      routeFound.push({ label, pkg, chunk, why: `${pkg}: ${why}`, gzip: bytes(chunk), chain: chainFrom(chunk) });
    }
  }
}
const known = KNOWN_ROUTE_CLOSURE_VIOLATIONS;
for (const v of routeFound) {
  if (known[v.label] !== v.pkg) violations.push({ chunk: v.chunk, why: `first screen ${v.label}: ${v.why}`, gzip: v.gzip, chain: v.chain });
}
for (const [label, pkg] of Object.entries(known)) {
  if (!ROUTE_ROOTS.some((r) => r.label === label)) violations.push({ chunk: label, why: `KNOWN_ROUTE_CLOSURE_VIOLATIONS lists ${label}, which is not a first-screen root (stale entry: remove it)`, gzip: 0, chain: label });
  else if (!routeFound.some((v) => v.label === label && v.pkg === pkg)) violations.push({ chunk: label, why: `KNOWN_ROUTE_CLOSURE_VIOLATIONS lists ${label}: ${pkg}, but its closure is now clean (stale entry: remove it, the baseline is exact)`, gzip: 0, chain: label });
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
    console.error(`         src/components/notificationPanel/useFramerMotion.ts does; a src/lib module`);
    console.error(`         app-shared captured: give it its own codeSplitting group in vite.config.ts,`);
    console.error(`         as \`pdf-documents\` does). Do not add it to an allow list.\n`);
  }
  process.exit(1);
}

console.log(`\n✓ no signed-in-only shared module is on the boot path (bootReach.mjs vs the built sourcemaps)`);
console.log(`\n✓ no first-screen closure (${ROUTE_ROOTS.length} roots from ENTRY_ROUTE_CHUNKS + MobileNav) carries a deferred package beyond the ${Object.keys(known).length} known`);
console.log(`\n✓ no deferred vendor (${[...DEFERRED.map((d) => d.prefix + "*"), ...DEFERRED_PACKAGES.map((d) => d.pkg), ...DEFERRED_MODULES.map((d) => d.file)].join(", ")}) is statically reachable from the entry`);
