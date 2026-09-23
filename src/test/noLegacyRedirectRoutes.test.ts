/**
 * CLASS CHECK — no old address is a redirect, and nothing we mint names one
 * (Q194, owner 2026-09-23: "The old address shouldn't be redirects, it should
 * be direct").
 *
 * The class: a page moves (a standalone screen becomes a Profile tab, a short
 * link is invented, a route is renamed), a `<Navigate>` is left at the old
 * path "so old links still land", and then every producer keeps minting the
 * old path because it still works. On 2026-09-23 that was eleven redirect
 * routes plus six short-link shapes, emitted by client code, two live SQL
 * trigger functions, six edge functions, the gift email, the Stripe return
 * URLs and 75 stored notifications.
 *
 * TWO HALVES.
 *   (a) EMITTERS. Every non-test .ts/.tsx under src/, supabase/functions/ and
 *       api/, comments blanked with the shared helper (strings kept: the path
 *       lives in one), plus the NEWEST definition of every SQL function in
 *       supabase/migrations (SQL comments blanked), plus the AASA file and the
 *       sitemap. A string that starts with a RETIRED address is a producer of
 *       a 404.
 *   (b) ROUTES. src/App.tsx declares no `<Route>` whose element is only a
 *       `<Navigate>` or a `*Redirect` component, except ALLOWED_REDIRECT_ROUTES.
 *
 * RETIRED is every path that was ever a Navigate-only / *Redirect route in
 * src/App.tsx and is not a real page today. It was derived from history with
 *   git log -p --format= -- src/App.tsx | grep -E '^[-+].*<Route\s+path="' \
 *     | grep -E '<Navigate|<[A-Za-z]+Redirect( |/|>)'
 * and the history test below re-derives it and compares EXACTLY (two-way)
 * whenever the checkout has history (skipped, visibly, in a shallow clone).
 *
 * @mutate src/components/SaveHelperButton.tsx | navigate("/profile?tab=saved_helpers") | navigate("/saved-helprs")
 * @mutate supabase/functions/instant-payout/index.ts | link: "/profile?tab=earnings", | link: "/earnings",
 * @mutate supabase/migrations/20260923152630_notification_links_point_direct_not_at_redirects.sql | has been released to your account.', 'financial_alerts', '/profile?tab=earnings'); | has been released to your account.', 'financial_alerts', '/earnings');
 * @mutate src/App.tsx | <Route path="/help" element= | <Route path="/help-center" element={<Navigate to="/help" replace />} /><Route path="/help" element=
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";

const REPO = resolve(__dirname, "..", "..");
const APP = join(REPO, "src", "App.tsx");
const MIGRATIONS = join(REPO, "supabase", "migrations");

/**
 * Every address that was ever a redirect-only route and is not a real page
 * now. A trailing "/" marks a parameterised shape (`/j/:id` → "/j/").
 */
const RETIRED = [
  "/activity", "/analytics", "/availability", "/become-a-partner", "/browse-jobs",
  "/community", "/dashboard/post-login", "/data-rights", "/earnings", "/enterprise",
  "/evacuation", "/for-business", "/gift-card", "/help-center", "/how-it-works",
  "/impact", "/j/", "/job-history", "/legal/", "/local-guide", "/m/", "/messages/",
  "/parish/", "/parishes", "/pay-it-forward", "/post-job/", "/saved-helpers",
  "/saved-helprs", "/schedule", "/settings", "/settings/profile", "/u/", "/warnings",
] as const;

/**
 * Redirect routes that may stay, each because its address was printed OUTSIDE
 * our control. Exact and two-way: an entry whose route is gone fails below.
 */
// @two-way src/test/noLegacyRedirectRoutes.test.ts:stale allowlist entry
const ALLOWED_REDIRECT_ROUTES: Record<string, string> = {
  // Empty on purpose (2026-09-23). /data-rights was kept for a claimed App
  // Store citation that nothing proves (fastlane/metadata/en-US/privacy_url.txt
  // is /privacy), and the app has not launched (owner), so it went too. An
  // entry here needs PROOF the address was printed outside our control.
};

/**
 * `file :: address` hits that are not links we mint. Exact and two-way.
 */
// @two-way src/test/noLegacyRedirectRoutes.test.ts:stale known emitter
const KNOWN_EMITTERS: Record<string, string> = {
  // Empty on purpose: nothing may name a retired address.
};

const isRetired = (path: string): string | null => {
  for (const r of RETIRED) {
    if (r.endsWith("/")) {
      if (path.startsWith(r) && path.length > r.length) return r;
    } else if (path === r || path.startsWith(`${r}/`)) {
      return r;
    }
  }
  return null;
};

/**
 * Paths at the START of a string-ish context: after a quote, after `}` (a
 * template-literal origin like `${appUrl}/earnings`) or after our domain.
 */
const PATH_AT_START = /(?:["'`]|\}|louisianahelpr\.com)(\/[A-Za-z0-9_\-/:]*)(?=[?#"'`&\s)]|$)/g;

function hitsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PATH_AT_START)) {
    const r = isRetired(m[1]);
    if (r) out.add(r);
  }
  return [...out];
}

function sourceHits(): string[] {
  const hits = new Set<string>();
  const roots = ["src", "supabase/functions", "api"].map((r) => join(REPO, r));
  for (const abs of walkSource(roots)) {
    const file = relative(REPO, abs);
    if (/\.(test|spec)\.tsx?$/.test(file) || file.startsWith("src/test/")) continue;
    const text = readSource(abs);
    if (text === null) continue;
    let code = blankComments(text);
    // App.tsx's own <Route path="…"> declarations are half (b)'s business.
    if (file === "src/App.tsx") code = code.replace(/<Route\s+path="[^"]*"/g, "<Route");
    for (const r of hitsIn(code)) hits.add(`${file} :: ${r}`);
  }
  for (const file of ["public/.well-known/apple-app-site-association", "public/sitemap.xml"]) {
    const text = readFileSync(join(REPO, file), "utf8");
    // AASA comments are prose; only the claimed paths are links.
    const scanned = file.endsWith("association")
      ? JSON.stringify(JSON.parse(text).applinks.details.map((d: { paths: string[] }) => d.paths))
      : text;
    for (const r of hitsIn(scanned)) hits.add(`${file} :: ${r}`);
  }
  return [...hits].sort();
}

/** function name -> body of its NEWEST definition (any dollar-quote tag). */
function newestFunctionBodies(): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>();
  const def = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, file), "utf8"));
    for (const m of sql.matchAll(def)) {
      const rest = sql.slice(m.index!);
      const open = /\bAS\s+(\$\w*\$)/i.exec(rest);
      if (!open) continue;
      const start = open.index + open[0].length;
      const end = rest.indexOf(open[1], start);
      if (end === -1) continue;
      out.set(m[1].toLowerCase(), { file, body: rest.slice(start, end) });
    }
  }
  return out;
}

function sqlHits(bodies: Map<string, { file: string; body: string }>): string[] {
  const hits: string[] = [];
  for (const [fn, { file, body }] of bodies) {
    // plpgsql's own `--` comments inside the body are blanked already.
    for (const r of hitsIn(body)) hits.push(`${fn} (${file}) :: ${r}`);
  }
  return hits.sort();
}

/** `<Route path>` → element source, for every route in App.tsx. */
function routes(): { path: string; element: string }[] {
  const code = blankComments(readFileSync(APP, "utf8"));
  const out: { path: string; element: string }[] = [];
  for (const m of code.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)) {
    out.push({ path: m[1], element: m[2] });
  }
  return out;
}

/** An element that renders nothing but a redirect. */
const isRedirectOnly = (element: string) => {
  const inner = element.replace(/^\s*(?:routeEl\()?/, "").trim();
  return /^<Navigate\b/.test(inner) || /^<[A-Z]\w*Redirect\b[^>]*\/>/.test(inner);
};

describe("Q194 — every link is direct; no legacy redirect routes", () => {
  it("the inventories are real (floors)", () => {
    expect(routes().length).toBeGreaterThan(25);
    expect(newestFunctionBodies().size).toBeGreaterThan(300);
    expect(walkSource([join(REPO, "src")]).length).toBeGreaterThan(500);
  });

  it("(a) no source file, email or edge function mints a retired address", () => {
    const hits = sourceHits();
    const unexpected = hits.filter((h) => !(h in KNOWN_EMITTERS));
    expect(unexpected, "link to the CURRENT page instead (e.g. /profile?tab=earnings, not /earnings)").toEqual([]);
    const stale = Object.keys(KNOWN_EMITTERS).filter((k) => !hits.includes(k));
    expect(stale, "stale known emitter — remove it").toEqual([]);
  });

  it("(a) no SQL function's newest definition writes a retired address", () => {
    expect(sqlHits(newestFunctionBodies())).toEqual([]);
  });

  it("(b) App.tsx has no redirect-only route outside the allowlist", () => {
    const redirects = routes().filter((r) => isRedirectOnly(r.element)).map((r) => r.path);
    expect(redirects.filter((p) => !(p in ALLOWED_REDIRECT_ROUTES))).toEqual([]);
    const stale = Object.keys(ALLOWED_REDIRECT_ROUTES).filter((p) => !redirects.includes(p));
    expect(stale, "stale allowlist entry — the route is gone, remove it").toEqual([]);
  });

  it("(b) no retired address is a route at all, except an allowlisted one", () => {
    const back = routes()
      .map((r) => r.path)
      .filter((p) => !(p in ALLOWED_REDIRECT_ROUTES))
      .filter((p) => isRetired(p.replace(/:[A-Za-z_]+|\*/g, "x")));
    expect(back, "a retired address is back as a route: drop it from RETIRED only if it is a real page now").toEqual([]);
  });

  const shallow = (() => {
    try {
      return execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: REPO }).toString().trim() !== "false";
    } catch {
      return true;
    }
  })();

  it.skipIf(shallow)("RETIRED equals App.tsx history's redirect routes minus today's real pages (two-way)", () => {
    const log = execFileSync("git", ["log", "-p", "--format=", "--", "src/App.tsx"], {
      cwd: REPO,
      maxBuffer: 512 * 1024 * 1024,
    }).toString();
    const ever = new Set<string>();
    for (const line of log.split("\n")) {
      if (!/^[-+].*<Route\s+path="/.test(line)) continue;
      if (!/<Navigate|<[A-Za-z]+Redirect( |\/|>)/.test(line)) continue;
      if (/MarketingRedirect fallback/.test(line)) continue; // wraps a real page
      ever.add(/path="([^"]+)"/.exec(line)![1]);
    }
    const live = routes();
    const realNow = new Set(live.filter((r) => !isRedirectOnly(r.element)).map((r) => r.path));
    const derived = [...ever]
      .filter((p) => !realNow.has(p))
      .map((p) => p.replace(/\/(?::[A-Za-z_]+|\*)$/, "/"))
      .sort();
    expect([...RETIRED].sort()).toEqual(derived);
  });
});
