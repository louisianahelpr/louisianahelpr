#!/usr/bin/env node
/**
 * Generate public/sitemap.xml from the route table in src/App.tsx.
 *
 * USAGE
 * -----
 *   node scripts/generate-sitemap.mjs            # rewrite public/sitemap.xml
 *   node scripts/generate-sitemap.mjs --check    # exit 1 if it has drifted (CI)
 *   node scripts/generate-sitemap.mjs --stdout   # print, write nothing
 *
 * There is no npm alias on purpose — `package.json` is owned by another lane.
 * Run the command above directly; `--check` is wired into
 * `.github/workflows/sitemap-drift.yml`.
 *
 * WHY
 * ---
 * Nothing regenerated `public/sitemap.xml` from the route table, so it drifted
 * from the app in both directions: it advertised `/subscription` long after
 * that route was deleted (crawlers got the 404 page; the real screen is
 * `/profile?tab=subscription`), and TODO.md F-SEO-01 tracks public pages that
 * were never added. Hand-maintenance is the defect — this derives the list.
 *
 * `src/App.tsx` is read ONLY. This script never modifies application source.
 *
 * WHAT COUNTS AS A SITEMAP URL
 * ----------------------------
 * A route is included when ALL of these hold:
 *   1. it is declared as `<Route path="…" element={…}>` in src/App.tsx,
 *   2. its element does NOT contain `<Navigate` — a redirect-only path must
 *      never be advertised, crawlers should be pointed at the destination,
 *   3. its element does NOT contain `ProtectedRoute` or `AdminRoute` — an
 *      authed route yields a login redirect to a crawler, which is worse than
 *      absent,
 *   4. it is not parameterised (`:id`) or the `*` catch-all — no crawlable
 *      canonical URL exists,
 *   5. it is not in NOINDEX below (transactional / account-state screens that
 *      are public only because they must render before a session exists).
 *
 * Anything added to App.tsx as a public page is picked up automatically. That
 * is the whole point: the sitemap can no longer silently fall behind.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const APP_TSX = path.join(repoRoot, "src", "App.tsx");
const SITEMAP = path.join(repoRoot, "public", "sitemap.xml");

/** Canonical origin — must match src/lib/sitemap.test.ts. */
const ORIGIN = "https://www.louisianahelpr.com";

/**
 * Public-but-not-indexable routes, each with the reason it is excluded.
 * These render for signed-out visitors (they have to — they exist to get you
 * signed in, or to explain an account state), but none is a page a search
 * result should ever land on.
 */
const NOINDEX = {
  // /login and /signup are genuinely public, but they are auth entry points,
  // not content: thin pages with nothing for a search result to land on, and
  // the standard advice is to keep them out of the sitemap. This is a
  // judgement call, not a technical constraint — if the owner wants them
  // indexed for brand queries, delete these two lines and add weights (0.3 /
  // monthly is sensible); the file regenerates with them included.
  "/login": "auth entry point, not indexable content",
  "/signup": "auth entry point, not indexable content",
  "/signup-pending": "post-signup interstitial; meaningless without the signup that preceded it",
  "/complete-profile": "onboarding step; requires a half-finished session",
  "/account-pending": "account-state screen; only meaningful for one specific signed-in user",
  "/account-denied": "account-state screen",
  "/account-banned": "account-state screen",
  "/forgot-password": "transactional auth step, reached from /login",
  "/reset-password": "consumes a one-time token from an email; no canonical URL",
  "/payment-success": "post-checkout receipt screen, bound to one session",
};

/**
 * changefreq + priority per included path. A path with no entry still gets
 * emitted (never silently dropped) with the DEFAULT below, and is listed in
 * the run summary so someone can give it a real weight.
 */
const WEIGHTS = {
  "/": { changefreq: "weekly", priority: "1.0" },
  "/browse": { changefreq: "daily", priority: "0.8" },
  "/jobs": { changefreq: "daily", priority: "0.8" },
  "/help": { changefreq: "monthly", priority: "0.6" },
  "/support": { changefreq: "monthly", priority: "0.5" },
  "/legal": { changefreq: "monthly", priority: "0.4" },
  "/login": { changefreq: "monthly", priority: "0.3" },
  "/signup": { changefreq: "monthly", priority: "0.3" },
};
const DEFAULT_WEIGHT = { changefreq: "monthly", priority: "0.5" };

/**
 * Parse `<Route path="…" element={…}` declarations out of App.tsx.
 *
 * Deliberately line-oriented and deliberately dumb: every Route in App.tsx is
 * declared on a single line, and a real parse (ts-morph/babel) would be a new
 * dependency for a file whose shape a lint rule already keeps regular. Lines
 * that are comments are skipped — App.tsx contains prose mentioning `<Route>`
 * inside comments, and counting those would invent routes.
 */
function parseRoutes(source) {
  const routes = [];
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("{/*")) continue;
    const m = line.match(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*)$/);
    if (!m) continue;
    routes.push({ path: m[1], element: m[2], line: rawLine });
  }
  return routes;
}

function classify(routes) {
  const included = [];
  const excluded = [];
  for (const r of routes) {
    const reject = (reason) => excluded.push({ path: r.path, reason });
    if (r.path === "*") { reject("catch-all (NotFound)"); continue; }
    if (r.path.includes(":")) { reject("parameterised — no canonical URL"); continue; }
    if (/<Navigate\b/.test(r.element)) { reject("redirect-only route"); continue; }
    // Custom redirect components. `<Navigate>` alone missed `/activity`
    // (ActivityLegacyRedirect); `/pay-it-forward` was removed entirely 2026-09-02,
    // which returned nothing but a <Navigate> and were being advertised to
    // search engines as real pages.
    //
    // SELF-CLOSING IS THE LOAD-BEARING HALF OF THIS TEST, not tidiness.
    // Matching the name alone would also reject
    //   <Route path="/" element={<...><MarketingRedirect>{routeEl(<Index/>)}...
    // — MarketingRedirect WRAPS the homepage's real content rather than
    // replacing it, so a name-only rule silently drops `/` from the sitemap.
    // A redirect-only element renders no children; a wrapper has them.
    if (/<[A-Z]\w*Redirect\b[^>]*\/>/.test(r.element)) { reject("redirect-only route"); continue; }
    if (/\bProtectedRoute\b/.test(r.element)) { reject("behind ProtectedRoute (auth)"); continue; }
    if (/\bAdminRoute\b/.test(r.element)) { reject("admin-only"); continue; }
    if (NOINDEX[r.path]) { reject(`noindex — ${NOINDEX[r.path]}`); continue; }
    included.push(r.path);
  }
  return { included: [...new Set(included)], excluded };
}

function render(paths, unweighted) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!-- GENERATED FILE — do not hand-edit.",
    "     Regenerate with: node scripts/generate-sitemap.mjs",
    "     Source of truth: the <Route> table in src/App.tsx (public, non-redirect,",
    "     non-parameterised routes, minus the documented NOINDEX list in that script).",
    "     Hand edits are reverted by the next run and flagged by",
    "     `node scripts/generate-sitemap.mjs --check` in CI. -->",
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const p of paths) {
    const w = WEIGHTS[p] ?? DEFAULT_WEIGHT;
    lines.push("  <url>");
    // "/" must render as the bare origin with a trailing slash, not "//".
    lines.push(`    <loc>${ORIGIN}${p === "/" ? "/" : p}</loc>`);
    lines.push(`    <changefreq>${w.changefreq}</changefreq>`);
    lines.push(`    <priority>${w.priority}</priority>`);
    lines.push("  </url>");
  }
  if (unweighted.length) {
    lines.push(
      `  <!-- Emitted with default weight (${DEFAULT_WEIGHT.priority}/${DEFAULT_WEIGHT.changefreq}):`,
      `       ${unweighted.join(", ")}`,
      "       Add an entry to WEIGHTS in scripts/generate-sitemap.mjs to tune these. -->",
    );
  }
  lines.push("</urlset>", "");
  return lines.join("\n");
}

/**
 * Reduce a sitemap document to the thing that actually matters: an ordered
 * list of `{path, changefreq, priority}`. Used by --check so comments and
 * whitespace cannot produce a false drift report.
 */
function normalize(xml) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => {
    const block = m[1];
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? "";
    return {
      path: loc ? new URL(loc).pathname : "",
      changefreq: block.match(/<changefreq>([^<]+)<\/changefreq>/)?.[1] ?? "",
      priority: block.match(/<priority>([^<]+)<\/priority>/)?.[1] ?? "",
    };
  });
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const toStdout = args.includes("--stdout") || args.includes("--dry-run");

  const source = fs.readFileSync(APP_TSX, "utf8");
  const routes = parseRoutes(source);
  if (routes.length === 0) {
    // A regex that silently matches nothing would happily emit an empty
    // sitemap. Fail loudly instead — this is the exact silent-no-op class of
    // bug the audit standard is about.
    console.error("ERROR: parsed 0 <Route> declarations from src/App.tsx — the parser is broken, not the app.");
    process.exit(1);
  }

  const { included, excluded } = classify(routes);
  if (included.length === 0) {
    console.error("ERROR: classified 0 public routes — refusing to write an empty sitemap.");
    process.exit(1);
  }

  // Deterministic order: highest priority first, then alphabetical. A stable
  // order keeps the diff empty when nothing actually changed.
  const sorted = [...included].sort((a, b) => {
    const pa = Number((WEIGHTS[a] ?? DEFAULT_WEIGHT).priority);
    const pb = Number((WEIGHTS[b] ?? DEFAULT_WEIGHT).priority);
    return pb - pa || a.localeCompare(b);
  });
  const unweighted = sorted.filter((p) => !WEIGHTS[p]);
  const xml = render(sorted, unweighted);

  if (toStdout) {
    process.stdout.write(xml);
    console.error(`\n[stdout mode] ${sorted.length} public URL(s); ${excluded.length} route(s) excluded.`);
    return;
  }

  const current = fs.existsSync(SITEMAP) ? fs.readFileSync(SITEMAP, "utf8") : null;

  if (checkOnly) {
    // Compare the URL SET and their weights, NOT the raw bytes. A byte
    // comparison would fail on a hand-written explanatory comment or on
    // whitespace, which is noise, not drift — and a gate that cries wolf gets
    // ignored or deleted. What actually matters is: does the sitemap advertise
    // exactly the app's public routes, with the intended weights?
    const before = normalize(current ?? "");
    const after = normalize(xml);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      console.log(`sitemap.xml is up to date (${sorted.length} public URLs).`);
      return;
    }
    console.error("DRIFT: public/sitemap.xml does not match the route table in src/App.tsx.");
    console.error("Regenerate it with:  node scripts/generate-sitemap.mjs\n");
    const beforePaths = before.map((u) => u.path);
    const missing = after.filter((u) => !beforePaths.includes(u.path)).map((u) => u.path);
    const stale = before.filter((u) => !sorted.includes(u.path)).map((u) => u.path);
    const reweighted = after
      .filter((u) => {
        const b = before.find((x) => x.path === u.path);
        return b && (b.priority !== u.priority || b.changefreq !== u.changefreq);
      })
      .map((u) => u.path);
    if (missing.length) console.error(`  public routes MISSING from the sitemap: ${missing.join(", ")}`);
    if (stale.length) console.error(`  sitemap entries that are NOT public routes (404 or auth-gated): ${stale.join(", ")}`);
    if (reweighted.length) console.error(`  changefreq/priority differ: ${reweighted.join(", ")}`);
    process.exit(1);
  }

  fs.writeFileSync(SITEMAP, xml);
  console.log(`${current === xml ? "Unchanged" : "Wrote"} ${path.relative(repoRoot, SITEMAP)} — ${sorted.length} public URL(s):`);
  for (const p of sorted) console.log(`  ${p}`);
  console.log(`\nExcluded ${excluded.length} route(s):`);
  for (const e of excluded) console.log(`  ${e.path.padEnd(28)} ${e.reason}`);
  if (unweighted.length) {
    console.log(`\nNOTE: no WEIGHTS entry for ${unweighted.join(", ")} — emitted at the default weight.`);
  }
}

// Exported for testing (parseRoutes/classify are the whole risk surface — a
// regex that quietly stops matching would emit a plausible-looking, wrong
// sitemap). Importing this module must not run the generator, hence the guard.
export { parseRoutes, classify, render, normalize, NOINDEX, WEIGHTS };

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) main();
