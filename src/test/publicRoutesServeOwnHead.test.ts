/**
 * lh-seo-web SW-001 / SW-002 (verified 2026-09-03, fixed 2026-09-25): before
 * JavaScript runs, every public route except the three share rewrites served
 * the homepage's <title>, description, og:* AND
 * `<link rel="canonical" href="https://www.louisianahelpr.com">` — telling a
 * non-JS crawler that /legal, /help, /support and /browse were duplicates of
 * the homepage. The per-route values existed only in usePageMeta's useEffect.
 *
 * THE CLASS: a public, indexable URL whose pre-JS head is not its own. This
 * guard walks public/sitemap.xml (itself generated from the App.tsx route
 * table), routes each URL through vercel.json's rewrites IN ORDER — the same
 * first-match walk Vercel does, with the visitor's query carried into the
 * destination — and reads the HTML that destination actually returns: the
 * api/share.ts handler, or the static shell for `/index.html`. Every URL must
 * come back with a self-referencing canonical and og:url, and a title,
 * description and og:title no other sitemap URL has.
 *
 * Two-way: every route the shared table (src/lib/publicPageMeta.mjs) owns and
 * every `_og=page` rewrite must resolve to a canonical that IS a sitemap URL,
 * and each table canonical must be in the sitemap — a page added on one side
 * only fails. And no page may hard-code a canonical the table owns, which is
 * how the pre-JS and post-JS values would drift apart again.
 *
 * The shell is dist/index.html when a build has left one (the real output),
 * else the source index.html (Vite leaves these head tags as they are).
 *
 * Proven red 2026-09-25 on each mutation below (and on the pre-fix tree:
 * 6 of 7 sitemap URLs served the homepage canonical).
 *
 * Q401a, the same class for the public pages kept OUT of the sitemap
 * (scripts/generate-sitemap.mjs NOINDEX): /login, /signup, /forgot-password,
 * /reset-password, /signup-pending and /account-banned served the homepage's
 * title and canonical pre-JS with the shell's "index, follow". Each must now
 * come back with noindex, its own title and a self canonical, from the table
 * its page's usePageMeta also reads. Two-way against the generator's NOINDEX
 * list (minus the routes behind <ProtectedRoute>, which no anonymous crawler
 * reaches) and against the `_og=noindex` rewrites.
 */
// @mutate vercel.json | "source": "/help", | "source": "/help-moved",
// @mutate api/share.ts | if (route.kind === "page") { | if (route.kind === "page" && url.hostname === "never") {
// @mutate src/lib/publicPageMeta.mjs | canonical: `${SITE_ORIGIN}/support`, | canonical: SITE_ORIGIN,
// @mutate src/lib/publicPageMeta.mjs | title: "Help Center — Helpr", | title: "Contact Support — Helpr",
// @mutate src/lib/publicPageMeta.mjs | canonical: `${SITE_ORIGIN}/legal?tab=privacy`, | canonical: `${SITE_ORIGIN}/legal?tab=privacy-policy`,
// @mutate src/pages/info/HelpCenter.tsx | usePageMeta(PUBLIC_PAGE_META["/help"]); | usePageMeta({ ...PUBLIC_PAGE_META["/help"], canonical: "https://www.louisianahelpr.com/help" });
// @mutate vercel.json | "source": "/forgot-password", | "source": "/forgot-password-moved",
// @mutate api/share.ts | if (route.kind === "noindex") { | if (route.kind === "noindex" && url.hostname === "never") {
// @mutate src/lib/publicPageMeta.mjs | export const NOINDEX_ROBOTS = "noindex, follow"; | export const NOINDEX_ROBOTS = "index, follow";
// @mutate src/lib/publicPageMeta.mjs | canonical: `${SITE_ORIGIN}/signup-pending`, | canonical: SITE_ORIGIN,
// @mutate api/share.ts |     robots: signup.robots,\n |
// @mutate src/pages/auth/AccountBanned.tsx | usePageMeta(NOINDEX_PAGE_META["/account-banned"]); | usePageMeta({ ...NOINDEX_PAGE_META["/account-banned"], robots: "index, follow" });
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import {
  LEGAL_PAGE_META,
  LEGAL_PATH_TAB,
  NOINDEX_PAGE_META,
  PUBLIC_PAGE_META,
  SITE_ORIGIN,
} from "../lib/publicPageMeta.mjs";
// @ts-expect-error — plain .mjs script, no type declarations
import { NOINDEX as SITEMAP_NOINDEX } from "../../scripts/generate-sitemap.mjs";

const ROOT = resolve(__dirname, "..", "..");
const SHELL_SOURCE = existsSync(resolve(ROOT, "dist/index.html"))
  ? resolve(ROOT, "dist/index.html")
  : resolve(ROOT, "index.html");
const SHELL = readFileSync(SHELL_SOURCE, "utf8");

let handler: { fetch: (req: Request) => Promise<Response> };

beforeAll(async () => {
  // No network: the page branch needs none, and a stray lookup must not pass.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in unit tests")));
  ensureOgShellSnapshot(ROOT);
  // Runtime-built path so tsc (tsconfig.app.json covers src/ only) does not
  // pull api/share.ts into the app project; vitest resolves it normally.
  const sharePath = ["..", "..", "api", "share"].join("/");
  handler = (await import(/* @vite-ignore */ sharePath)).default;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/* ── inventory ─────────────────────────────────────────────────────────── */

const sitemap = readFileSync(resolve(ROOT, "public/sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

/** "https://www.louisianahelpr.com/" and "…com" name the same page. */
function norm(url: string): string {
  const u = new URL(url);
  return u.pathname === "/" && !u.search ? u.origin : u.origin + u.pathname + u.search;
}
const sitemapUrls = new Set(locs.map(norm));

interface Rewrite {
  source: string;
  destination: string;
  has?: { type: string; key: string; value?: string }[];
}
const vercel = JSON.parse(readFileSync(resolve(ROOT, "vercel.json"), "utf8")) as { rewrites: Rewrite[] };

/** Vercel source pattern → anchored RegExp (`:name`, `:name*`, raw groups). */
function sourceRe(source: string): RegExp {
  const body = source
    .replace(/:(\w+)\*/g, "(?<$1>.*)")
    .replace(/:(\w+)/g, "(?<$1>[^/]+)");
  return new RegExp(`^${body}$`);
}

/** First rewrite that matches, as Vercel applies them (filesystem aside). */
function rewriteFor(url: URL): { dest: string } | null {
  for (const r of vercel.rewrites) {
    const m = url.pathname.match(sourceRe(r.source));
    if (!m) continue;
    if (r.has?.some((h) => h.type !== "query" || !url.searchParams.has(h.key))) continue;
    const dest = r.destination.replace(/:(\w+)\*?/g, (_x, name: string) => m.groups?.[name] ?? "");
    return { dest };
  }
  return null;
}

/** The HTML a non-JS client receives for `url`. */
async function servedHead(rawUrl: string): Promise<string> {
  const url = new URL(rawUrl);
  const rw = rewriteFor(url);
  if (!rw || rw.dest === "/index.html") return SHELL;
  expect(rw.dest.startsWith("/api/share"), `${rawUrl} rewrites to ${rw.dest}`).toBe(true);
  // Vercel carries the visitor's query into the rewrite destination.
  const target = new URL(SITE_ORIGIN + rw.dest);
  for (const [k, v] of url.searchParams) if (!target.searchParams.has(k)) target.searchParams.set(k, v);
  const res = await handler.fetch(new Request(target.toString()));
  expect(res.status).toBe(200);
  return res.text();
}

function head(html: string) {
  const one = (re: RegExp) => html.match(re)?.[1] ?? null;
  return {
    robots: one(/<meta name="robots" content="([^"]*)"/),
    title: one(/<title>([\s\S]*?)<\/title>/),
    canonical: one(/<link rel="canonical" href="([^"]*)"/),
    description: one(/<meta name="description" content="([^"]*)"/),
    ogUrl: one(/<meta property="og:url" content="([^"]*)"/),
    ogTitle: one(/<meta property="og:title" content="([^"]*)"/),
    ogDescription: one(/<meta property="og:description" content="([^"]*)"/),
  };
}

const decode = (s: string | null) =>
  s === null ? null : s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/* ── the guard ─────────────────────────────────────────────────────────── */

describe("every sitemap URL serves its own head before JavaScript (SW-001/SW-002)", () => {
  it("has an inventory to check", () => {
    expect(locs.length).toBeGreaterThan(5);
  });

  it("each URL: self canonical + og:url, and a title/description/og:title no other URL has", async () => {
    const heads = await Promise.all(locs.map(async (loc) => ({ loc, h: head(await servedHead(loc)) })));
    const failures: string[] = [];
    for (const { loc, h } of heads) {
      const self = norm(loc);
      if (!h.canonical || norm(decode(h.canonical)!) !== self) failures.push(`${loc}: canonical ${h.canonical}`);
      if (!h.ogUrl || norm(decode(h.ogUrl)!) !== self) failures.push(`${loc}: og:url ${h.ogUrl}`);
    }
    for (const field of ["title", "description", "ogTitle", "ogDescription"] as const) {
      const seen = new Map<string, string>();
      for (const { loc, h } of heads) {
        const v = h[field];
        if (!v) { failures.push(`${loc}: no ${field}`); continue; }
        if (seen.has(v)) failures.push(`${loc}: ${field} duplicates ${seen.get(v)}: ${v}`);
        else seen.set(v, loc);
      }
    }
    expect(failures).toEqual([]);
  });

  it("two-way: every table route and every page rewrite canonicalises to a sitemap URL, and every table canonical is listed", async () => {
    const tablePaths = [...Object.keys(PUBLIC_PAGE_META), "/legal", ...Object.keys(LEGAL_PATH_TAB)];
    const pageRewrites = vercel.rewrites
      .filter((r) => r.destination.includes("_og=page"))
      .map((r) => r.source);
    expect(pageRewrites.length).toBeGreaterThan(5);
    const failures: string[] = [];
    for (const path of new Set([...tablePaths, ...pageRewrites])) {
      const h = head(await servedHead(SITE_ORIGIN + path));
      const canonical = decode(h.canonical);
      if (!canonical || !sitemapUrls.has(norm(canonical))) failures.push(`${path}: canonical ${canonical} not in sitemap`);
      if (canonical && norm(canonical) === SITE_ORIGIN) failures.push(`${path}: canonical is the homepage`);
    }
    const tableCanonicals = [
      ...Object.values(PUBLIC_PAGE_META).map((m) => m.canonical),
      ...Object.values(LEGAL_PAGE_META).map((m) => m.canonical),
    ];
    for (const c of tableCanonicals) if (!sitemapUrls.has(norm(c))) failures.push(`table canonical ${c} missing from sitemap`);
    expect(failures).toEqual([]);
  });

  it("no page hard-codes a canonical the shared table owns (pre-JS and post-JS would drift)", () => {
    const owned = new Set([
      ...Object.values(PUBLIC_PAGE_META).map((m) => m.canonical),
      ...Object.values(LEGAL_PAGE_META).map((m) => m.canonical),
      ...Object.values(NOINDEX_PAGE_META).map((m) => m.canonical),
    ]);
    const files = walkSource([resolve(ROOT, "src")]).filter((f) => !/\.test\.|\/test\//.test(f));
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const file of files) {
      const code = blankComments(readFileSync(file, "utf8"));
      for (const m of code.matchAll(/canonical:\s*["'`](https:\/\/www\.louisianahelpr\.com[^"'`]*)["'`]\s*[,}\n]/g)) {
        if (owned.has(m[1])) hits.push(`${file.slice(ROOT.length + 1)}: ${m[1]}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

/* ── Q401a: the public pages kept out of the sitemap ─────────────────── */

const APP = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");
/** Generator NOINDEX routes an anonymous crawler never renders: they sit behind <ProtectedRoute>. */
const PROTECTED_NOINDEX = ["/complete-profile", "/payment-success"];
const noindexPaths = Object.keys(NOINDEX_PAGE_META) as Array<keyof typeof NOINDEX_PAGE_META>;

/** The page component file a route renders, derived from App.tsx (route element -> lazy import). */
/** Every RegExp metacharacter, backslash included, escaped. */
const escapeRe = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");

function pageFileFor(path: string): string {
  const route = APP.match(new RegExp(`<Route path="${escapeRe(path)}" element=\\{[^\\n]*?<(\\w+) />`));
  expect(route, `no <Route path="${path}"> in App.tsx`).toBeTruthy();
  const imp = APP.match(new RegExp(`const ${route![1]} = lazyWithPreload\\(\\(\\) => import\\("\\./([^"]+)"\\)\\)`));
  expect(imp, `no lazy import for ${route![1]}`).toBeTruthy();
  return resolve(ROOT, "src", `${imp![1]}.tsx`);
}

describe("Q401a: every public noindex page serves noindex, its own title and a self canonical before JavaScript", () => {
  it("two-way: the table covers exactly the generator's public NOINDEX routes and the _og=noindex rewrites", () => {
    expect(noindexPaths.length).toBeGreaterThan(5);
    expect([...noindexPaths, ...PROTECTED_NOINDEX].sort()).toEqual(Object.keys(SITEMAP_NOINDEX).sort());
    for (const p of PROTECTED_NOINDEX) {
      expect(APP, `${p} is exempt only while it is behind <ProtectedRoute>`).toMatch(
        new RegExp(`<Route path="${escapeRe(p)}" element=\\{[^\\n]*<ProtectedRoute>`),
      );
    }
    const rewrites = vercel.rewrites
      .filter((r) => r.destination.includes("_og=noindex"))
      .map((r) => r.source)
      .sort();
    expect(rewrites).toEqual([...noindexPaths].sort());
    for (const p of noindexPaths) expect(sitemapUrls.has(SITE_ORIGIN + p), `${p} must stay out of the sitemap`).toBe(false);
  });

  it("each: noindex, the table's own title and description, a self canonical and og:url — never the homepage's", async () => {
    const shell = head(SHELL);
    const failures: string[] = [];
    const titles = new Map<string, string>();
    for (const [path, rawUrl] of [
      ...noindexPaths.map((p) => [p, SITE_ORIGIN + p] as const),
      ["/signup", `${SITE_ORIGIN}/signup?ref=abc123`] as const,
      ["/reset-password", `${SITE_ORIGIN}/reset-password?code=one-time-code`] as const,
    ]) {
      const want = NOINDEX_PAGE_META[path as keyof typeof NOINDEX_PAGE_META];
      const h = head(await servedHead(rawUrl));
      if (h.robots !== "noindex, follow") failures.push(`${rawUrl}: robots ${h.robots}`);
      if (decode(h.canonical) !== want.canonical) failures.push(`${rawUrl}: canonical ${h.canonical}`);
      if (decode(h.ogUrl) !== want.canonical) failures.push(`${rawUrl}: og:url ${h.ogUrl}`);
      if (norm(want.canonical) !== norm(SITE_ORIGIN + path)) failures.push(`${path}: table canonical ${want.canonical} is not self`);
      if (h.title === shell.title || h.canonical === shell.canonical) failures.push(`${rawUrl}: homepage head`);
      if (!rawUrl.includes("?")) {
        if (decode(h.title) !== want.title) failures.push(`${rawUrl}: title ${h.title}`);
        if (decode(h.description) !== want.description) failures.push(`${rawUrl}: description ${h.description}`);
        const t = decode(h.title)!;
        if (titles.has(t)) failures.push(`${rawUrl}: title duplicates ${titles.get(t)}`);
        titles.set(t, rawUrl);
      }
    }
    expect(failures).toEqual([]);
  });

  it("each page passes its table entry to usePageMeta, so the values agree after JavaScript", () => {
    const missing: string[] = [];
    for (const p of noindexPaths) {
      const file = pageFileFor(p);
      const code = blankComments(readFileSync(file, "utf8"));
      if (!code.includes(`usePageMeta(NOINDEX_PAGE_META["${p}"]);`)) missing.push(`${file.slice(ROOT.length + 1)} (${p})`);
    }
    expect(missing).toEqual([]);
  });
});
