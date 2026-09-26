/**
 * CLASS CHECK — every address the app hands a person opens a real page.
 *
 * Owner, 2026-09-24: the tab addresses were renamed to match the tabs
 * (/home, /posts, /jobs) with no redirects, and every retired address is to be
 * "never ever mentioned again". A list of retired addresses cannot keep that
 * promise: it names them, and it only catches the ones someone remembered.
 * This check is the other way round. It takes the routes App.tsx actually
 * serves and fails on any in-app address, anywhere we mint one, that none of
 * them serves:
 *   - app source, edge functions and api/ (tests excluded),
 *   - the universal-link claims (AASA) and the sitemap,
 *   - every SQL function as the migrations leave it (the notification links
 *     the database writes), via the same replay notificationRestatements uses.
 * And App.tsx serves no redirect-only route: a link goes to the page itself.
 *
 * Things that look like a path but are not an app address (a REST path, a
 * file in public/, a vendor API path) are listed in NOT_APP_ADDRESSES, exactly
 * and two-way: an entry nothing emits any more fails too.
 */
// @mutate src/lib/nativeLaunchRoute.ts | "/jobs", | "/my-jobs",
// @mutate supabase/functions/review-nag-cron/index.ts | surface: "/jobs" | surface: "/activity"
// @mutate supabase/migrations/20260926041132_parish_match_alerts_wait_for_early_access.sql | v_link := '/home?job=' \|\| v_job.id::text; | v_link := '/dashboard?job=' \|\| v_job.id::text;
// @mutate public/.well-known/apple-app-site-association | { "/": "/posts", "comment" | { "/": "/earnings", "comment"
// @mutate src/App.tsx | <Route path="/posts" element={ | <Route path="/posts-old" element={<Navigate to="/posts" />} /><Route path="/posts" element={
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const APP = join(REPO, "src", "App.tsx");

// @two-way src/test/everyLinkIsARealRoute.test.ts:stale NOT_APP_ADDRESSES entry
const NOT_APP_ADDRESSES: Record<string, string> = {
  "/_vercel": "Vercel's image optimiser path (src/lib/imageUrl.ts), served by Vercel",
  "/auth": "Supabase OAuth callback and GoTrue paths; stay in the browser (AASA excludes /auth/*)",
  "/:id": "ops_route_key's placeholder for an id segment",
  "/avatars": "storage object path (avatars bucket)",
  "/credentials": "storage object path (credential documents)",
  "/disputes": "storage object path (dispute evidence)",
  "/functions": "Supabase edge-function REST path",
  "/message-attachments": "storage bucket path",
  "/preview": "auth-email-hook's own admin preview endpoint",
  "/storage": "Supabase Storage path",
};

/** App.tsx routes: path pattern → element source. */
function routes(): { path: string; element: string }[] {
  const code = blankComments(readFileSync(APP, "utf8"));
  return [...code.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)].map((m) => ({
    path: m[1],
    element: m[2],
  }));
}

const PATTERNS = routes()
  .map((r) => r.path)
  .filter((p) => p !== "*")
  .map((p) => new RegExp(`^${p.replace(/:[A-Za-z_]+/g, "[^/]+")}$`));

/** A path, or a path prefix ending in "/" (a template like `/jobs/${id}`), that some route serves. */
function served(path: string): boolean {
  const probe = path.endsWith("/") && path !== "/" ? `${path}x` : path.replace(/(.)\/$/, "$1");
  return PATTERNS.some((re) => re.test(probe));
}

/** A path at the start of a string literal (JS quotes, SQL quotes) or after our own host. */
const PATH_AT_START = /(?:["'`]|louisianahelpr\.com)(\/[A-Za-z0-9_\-.:/]*)(?=[?#"'`&\s)$]|$)/g;

function misses(text: string, found: Set<string>, where: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PATH_AT_START)) {
    const path = m[1];
    if (path.startsWith("//")) continue; // protocol-relative URL
    const seg = `/${path.split("/")[1]}`;
    if (path.length > 80) continue; // base64 payload (an inlined PNG), not a path
    if (seg in NOT_APP_ADDRESSES) {
      found.add(seg);
      continue;
    }
    if (/\.[a-z0-9]+$/i.test(seg) && existsSync(join(REPO, "public", seg))) continue;
    // A route prefix used with startsWith ("/user" for /user/:userId) is served when a child of it is.
    if (!served(path) && !served(`${path}/x`)) out.push(`${where} :: ${path}`);
  }
  return out;
}

function sourceFiles(): string[] {
  return walkSource(["src", "supabase/functions", "api"].map((r) => join(REPO, r)))
    .map((abs) => relative(REPO, abs))
    .filter((f) => !/\.(test|spec)\.tsx?$/.test(f) && !f.startsWith("src/test/") && !f.startsWith("supabase/functions/tests/"));
}

const isRedirectOnly = (element: string) => {
  const inner = element.replace(/^\s*(?:routeEl\()?/, "").trim();
  return /^<Navigate\b/.test(inner) || /^<[A-Z]\w*Redirect\b[^>]*\/>/.test(inner);
};

/** Functions a later migration drops: the replay keeps their last body, prod has none. */
function droppedAfterDef(): (fn: string, defFile: string) => boolean {
  const dir = join(REPO, "supabase", "migrations");
  const lastDrop = new Map<string, string>();
  for (const f of migrationFiles(dir)) {
    const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
    for (const m of sql.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi)) lastDrop.set(m[1], f);
  }
  return (fn, defFile) => (lastDrop.get(fn) ?? "") > defFile;
}

describe("every in-app address opens a real page", () => {
  const found = new Set<string>();

  it("the inventories are real (floors)", () => {
    expect(PATTERNS.length).toBeGreaterThan(20);
    expect(sourceFiles().length).toBeGreaterThan(500);
    expect(effectiveDefs(join(REPO, "supabase", "migrations")).size).toBeGreaterThan(300);
    expect(served("/jobs/")).toBe(true);
    expect(served("/jobs")).toBe(true);
    expect(served("/my-jobs")).toBe(false);
  });

  it("source, edge functions and api/ link only to served routes", () => {
    const bad: string[] = [];
    for (const file of sourceFiles()) {
      const text = readSource(join(REPO, file));
      if (text === null) continue;
      let code = blankComments(text);
      if (file === "src/App.tsx") code = code.replace(/<Route\s+path="[^"]*"/g, "<Route");
      bad.push(...misses(code, found, file));
    }
    expect(bad, "point the link at a page App.tsx serves (or list a non-app path in NOT_APP_ADDRESSES)").toEqual([]);
  });

  it("the universal-link claims and the sitemap name only served routes", () => {
    const aasa = JSON.parse(readFileSync(join(REPO, "public/.well-known/apple-app-site-association"), "utf8"));
    const claimed: string[] = aasa.applinks.details.flatMap(
      (d: { components?: { "/": string; exclude?: boolean }[] }) =>
        (d.components ?? []).filter((c) => !c.exclude).map((c) => c["/"]),
    );
    expect(claimed.length).toBeGreaterThan(5);
    const bad = claimed
      .map((p) => (p.endsWith("/*") ? p.slice(0, -1) : p)) // "/jobs/*" claims "/jobs/<anything>"
      .filter((p) => p !== "/" && !served(p))
      .map((p) => `AASA :: ${p}`);
    const sitemap = readFileSync(join(REPO, "public/sitemap.xml"), "utf8");
    const locs = [...sitemap.matchAll(/<loc>https:\/\/[^/<]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(3);
    bad.push(...locs.filter((p) => !served(p.split(/[?#]/)[0])).map((p) => `sitemap :: ${p}`));
    expect(bad).toEqual([]);
  });

  it("no SQL function, as the migrations leave it, writes a link to an unserved address", () => {
    const bad: string[] = [];
    const dropped = droppedAfterDef();
    for (const [fn, def] of effectiveDefs(join(REPO, "supabase", "migrations"))) {
      if (dropped(fn, def.file)) continue;
      bad.push(...misses(blankSqlComments(def.stmt), found, `${fn} (${def.file})`));
    }
    expect(bad).toEqual([]);
  });

  it("App.tsx serves no redirect-only route", () => {
    expect(routes().filter((r) => isRedirectOnly(r.element)).map((r) => r.path)).toEqual([]);
  });

  it("NOT_APP_ADDRESSES is exact: every entry is still emitted somewhere", () => {
    expect(found.size, "the scans above did not run").toBeGreaterThan(0);
    expect(Object.keys(NOT_APP_ADDRESSES).filter((k) => !found.has(k)), "stale entry — remove it").toEqual([]);
  });
});
