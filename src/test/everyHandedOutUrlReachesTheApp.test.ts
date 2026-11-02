/**
 * Q2393 proof (lead 11-02): unknown URLs now answer 404 through
 * api/share.ts's `notfound` kind, so a routing mistake would 404 a REAL link.
 * This walks every URL the app hands out and asserts none falls to the
 * notfound rewrite, resolving each the way Vercel does:
 *   1. trailingSlash: false answers "/x/" with a 308 to "/x" (measured on prod
 *      2026-11-02 before this change: "/help/" did NOT match the "/help"
 *      rewrite and fell to the catch-all, so source matching is strict and a
 *      trailing-slash link needs the redirect);
 *   2. a file in public/ (copied to the site root by Vite) is served before any
 *      rewrite (measured: /robots.txt and the AASA answer with their own types
 *      under the old catch-all-to-index.html);
 *   3. else the FIRST matching rewrite (a `has` query condition must hold).
 *
 * Inventory, all from source:
 *   - every <Route path> in src/App.tsx, params filled with sample values;
 *   - the auth links: /reset-password, the confirm-link page, the /auth/v1 proxy;
 *   - the AASA's claimed paths, /.well-known/*, robots.txt, sitemap.xml, the
 *     manifest, the service workers, the offline page, /assets/*;
 *   - every app path literal in supabase/functions (email, SMS, push and
 *     in-app notification links): string literals starting "/", and the path
 *     after `${base}` in template literals, comments blanked; non-app literals
 *     (Stripe/PayPal/Meta API paths, storage keys) are listed with a reason and
 *     pinned two-way;
 *   - each one also with a trailing slash and with a query string.
 */
// @mutate vercel.json |   "trailingSlash": false\n |   "trailingSlash": true\n
// @mutate vercel.json |    {\n      "source": "/posts",\n      "destination": "/index.html"\n    },\n |
// @mutate vercel.json |    {\n      "source": "/quotes/request/:id",\n      "destination": "/index.html"\n    },\n |
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const NOTFOUND = "/api/share?_og=notfound";
const UUID = "0a1b2c3d-1111-4222-8333-444455556666";
interface Rewrite { source: string; destination: string; has?: { type: string; key: string }[] }
const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as { rewrites: Rewrite[]; trailingSlash?: boolean };

/** Vercel source -> anchored RegExp, STRICT on the trailing slash (measured, see header). */
function sourceRe(source: string): RegExp {
  const body = source
    .replace(/:(\w+)\*/g, "(?<$1>.*)")
    .replace(/:(\w+)(\([^)]*\))/g, "(?<$1>$2)")
    .replace(/:(\w+)/g, "(?<$1>[^/]+)");
  return new RegExp(`^${body}$`);
}

/** Where Vercel sends `raw`: "file", a rewrite destination, or null (platform 404). */
function served(raw: string): string | null {
  const url = new URL(raw, "https://www.louisianahelpr.com");
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) {
    if (vercel.trailingSlash !== false) return "trailing-slash-not-redirected";
    path = path.replace(/\/+$/, "");
  }
  if (path === "/" && existsSync(join(ROOT, "index.html"))) return "file";
  const file = join(ROOT, "public", decodeURIComponent(path));
  if (existsSync(file) && statSync(file).isFile()) return "file";
  for (const r of vercel.rewrites) {
    if (!sourceRe(r.source).test(path)) continue;
    if (r.has?.some((h) => h.type !== "query" || !url.searchParams.has(h.key))) continue;
    return r.destination;
  }
  return null;
}

const SAMPLE: Record<string, string> = { handle: "jane-doe", token: "tok_abc123", service: "cleaning", town: "baton-rouge" };
const fill = (route: string) => route.replace(/:(\w+)(\([^)]*\))?/g, (_m, name: string) => SAMPLE[name] ?? UUID);

const app = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
const appRoutes = [...new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]))].filter((p) => p !== "*");

const AUTH_LINKS = ["/reset-password", "/reset-password?code=abc", "/signup-pending?token_hash=abc&type=signup", "/auth/v1/verify?token=abc&type=recovery", "/auth/v1/callback?code=abc"];
const STATIC = ["/.well-known/apple-app-site-association", "/.well-known/security.txt", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/sw.js", "/sw-push.js", "/sw-push-handlers.js", "/offline.html", "/favicon.ico", "/apple-touch-icon.png"];
const aasa = JSON.parse(readFileSync(join(ROOT, "public/.well-known/apple-app-site-association"), "utf8")) as { applinks: { details: { paths: string[] }[] } };
const aasaPaths = aasa.applinks.details.flatMap((d) => d.paths).filter((p) => !p.startsWith("NOT ")).map((p) => p.replace(/\/\*$/, `/${UUID}`));

/** Literals in supabase/functions that are paths but not links into this site. Exact both ways. */
const NON_APP: Record<string, string> = {
  "/inApps/v1/transactions/${encodeURIComponent(transactionId)}": "Apple App Store Server API",
  "/inApps/v1/subscriptions/${encodeURIComponent(tx.originalTransactionId)}": "Apple App Store Server API",
  "/photos": "Meta Graph API (`${pageId}/photos`)",
  "/feed": "Meta Graph API (`${pageId}/feed`)",
  "/media": "Meta Graph API (`${igUserId}/media`)",
  "/media_publish": "Meta Graph API (`${igUserId}/media_publish`)",
  "/disputes/${job.id}": "storage prefix (`${userId}/disputes/${jobId}` in proof-photos)",
  "/email-unsubscribe?e=${e}&sig=${sig}${listParam}": "the email-unsubscribe EDGE function (`${functionsBase()}/…`, served by Supabase)",
  "/preview": "auth-email-hook's own request path (url.pathname.endsWith)",
  "/release-payout": "edge function call (`${supabaseFnBase}/release-payout`)",
  "/ti/csr/": "CSP report payload path prefix, not a page",
  "/v": "PayPal API version prefix",
  "/v2/checkout/orders": "PayPal API",
  "/v2/checkout/orders/${providerOrderId}/capture": "PayPal API",
  "/v2/payments/captures/${input.providerCaptureId}/refund": "PayPal API",
  "/avatars/${userId}/": "storage object key",
  "/message-attachments/": "storage object key",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
const PATH = String.raw`\/[a-z][a-z0-9\-_/]*(?:\$\{[^}\x60]*\}[a-z0-9\-_/]*)*(?:\?[^"'\x60\s]*)?`;
const API_PREFIX = /^\/(functions|rest|storage|auth\/v1|v1|realtime|api\/|graphql)\b/;
const edgeLiterals = new Map<string, string>();
for (const f of walk(join(ROOT, "supabase/functions"))) {
  const src = blankComments(readFileSync(f, "utf8"));
  const found = [
    ...[...src.matchAll(new RegExp(`(["'\x60])(${PATH})\\1`, "gi"))].map((m) => m[2]),
    // `${appUrl}/jobs/${id}`: the path after a base inside a template literal.
    ...[...src.matchAll(new RegExp(`\x60\\$\\{[^}\x60]*\\}(${PATH})\x60`, "gi"))].map((m) => m[1]),
  ];
  for (const v of found) if (!API_PREFIX.test(v) && !edgeLiterals.has(v)) edgeLiterals.set(v, f.slice(ROOT.length + 1));
}
const edgeLinks = [...edgeLiterals.keys()].filter((v) => !(v in NON_APP))
  .map((v) => v.replace(/\$\{[^}]*\}/g, UUID).replace(/\/$/, `/${UUID}`).replace(/\/\?/, "?"));

const variants = (u: string) => {
  const [path, q] = u.split("?");
  const slash = path === "/" ? path : `${path}/`;
  return [u, `${slash}${q ? `?${q}` : ""}`, `${u}${q ? "&" : "?"}utm_source=email`];
};
const misses = (urls: string[]) => urls.flatMap(variants).map((u) => ({ u, to: served(u) }))
  .filter((r) => r.to === null || r.to === NOTFOUND || r.to === "trailing-slash-not-redirected")
  .map((r) => `${r.u} -> ${r.to}`);

describe("Q2393: every URL the app hands out reaches the app, never the 404", () => {
  it("unknown paths DO reach the 404 (the walk can tell the difference)", () => {
    expect(served("/no-such-page-q2393")).toBe(NOTFOUND);
    expect(served("/jobs/x/y/z")).toBe(NOTFOUND);
  });

  it("every App.tsx route, dynamic ones filled in", () => {
    expect(appRoutes.length).toBeGreaterThan(40);
    expect(misses(appRoutes.map(fill))).toEqual([]);
  });

  it("auth links, static files, the AASA's claimed paths and /assets/*", () => {
    expect(aasaPaths.length).toBeGreaterThan(10);
    expect(misses([...AUTH_LINKS, ...aasaPaths])).toEqual([]);
    const statics = STATIC.map((u) => `${u} -> ${served(u)}`);
    expect(statics.filter((s) => !s.endsWith("-> file"))).toEqual([]);
    expect(served("/assets/index-deadbeef.js")).toBe("/api/missing-asset");
    expect(served("/fonts/gone.woff2")).toBe("/api/missing-asset");
  });

  it("every app link built in supabase/functions (email, SMS, push, in-app)", () => {
    expect(edgeLinks.length).toBeGreaterThan(60);
    expect(misses(edgeLinks)).toEqual([]);
  });

  it("the non-app literal list is exact (each still in the source, nothing else excluded)", () => {
    const stale = Object.keys(NON_APP).filter((k) => !edgeLiterals.has(k));
    expect(stale).toEqual([]);
    expect(Object.keys(NON_APP).length).toBeGreaterThan(3);
  });
});
