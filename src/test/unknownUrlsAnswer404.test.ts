/**
 * Q2393 (lead 2026-10-25, item 14): unknown URLs answered HTTP 200 (the in-app
 * Not Found page served as the shell with 200), because vercel.json's last
 * rewrite sent EVERY unmatched path to /index.html, so crawlers indexed them as
 * real pages. Now vercel.json sends only the paths src/App.tsx declares to the
 * shell, and everything else to api/share.ts's `notfound` kind, which returns
 * the same shell (the SPA still renders NotFound) with status 404 and
 * X-Robots-Tag: noindex. Static files are served before any rewrite, so they
 * are untouched.
 *
 * Inventory from source, both ways: every <Route path> in App.tsx (except the
 * "*" NotFound) has its own rewrite to the shell ahead of the catch-all, and
 * every rewrite to the shell is an App.tsx route (a removed route stops
 * answering 200).
 */
// @mutate vercel.json |       "destination": "/api/share?_og=notfound" |       "destination": "/index.html"
// @mutate api/share.ts |  if (url.searchParams.get("_og") === "notfound") return respond(absolutiseIconLinks(SHELL_HTML), undefined, 404); |  if (url.searchParams.get("_og") === "notfound") return respond(absolutiseIconLinks(SHELL_HTML), undefined, 200);
// @mutate vercel.json |    {\n      "source": "/home",\n      "destination": "/index.html"\n    },\n |
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

const ROOT = resolve(__dirname, "../..");
interface Rewrite { source: string; destination: string; has?: { type: string; key: string }[] }
const vercel = JSON.parse(readFileSync(resolve(ROOT, "vercel.json"), "utf8")) as { rewrites: Rewrite[] };
const app = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");
const appPaths = [...new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]))].filter((p) => p !== "*");
const NOTFOUND = "/api/share?_og=notfound";

/** Vercel source pattern -> anchored RegExp (`:name`, `:name(re)`, `:name*`, raw groups). */
function sourceRe(source: string): RegExp {
  const body = source
    .replace(/:(\w+)\*/g, "(?<$1>.*)")
    .replace(/:(\w+)(\([^)]*\))/g, "(?<$1>$2)")
    .replace(/:(\w+)/g, "(?<$1>[^/]+)");
  return new RegExp(`^${body}/?$`);
}
/** The first rewrite Vercel applies to a path (no query conditions). */
function destFor(path: string): string | null {
  for (const r of vercel.rewrites) {
    if (r.has?.length) continue;
    if (sourceRe(r.source).test(path)) return r.destination;
  }
  return null;
}

let handler: { fetch: (req: Request) => Promise<Response> };
beforeAll(async () => {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in unit tests")));
  ensureOgShellSnapshot(ROOT);
  const sharePath = ["..", "..", "api", "share"].join("/");
  handler = (await import(/* @vite-ignore */ sharePath)).default;
});
afterAll(() => { vi.unstubAllGlobals(); });

describe("Q2393: unknown URLs answer 404, known routes still get the app", () => {
  it("the catch-all (last rewrite) goes to the notfound kind, and only it", () => {
    const last = vercel.rewrites[vercel.rewrites.length - 1];
    expect(last).toEqual({ source: "/((?!api/|_vercel/|assets/|fonts/).*)", destination: NOTFOUND });
    expect(vercel.rewrites.filter((r) => r.destination === NOTFOUND)).toHaveLength(1);
  });

  it("every App.tsx route has its own rewrite to the app ahead of the catch-all, and nothing else does", () => {
    expect(appPaths.length).toBeGreaterThan(40);
    const shell = vercel.rewrites.filter((r) => r.destination === "/index.html").map((r) => r.source);
    expect([...shell].sort()).toEqual([...appPaths].sort());
  });

  it("measured paths land where they should", () => {
    expect(destFor("/no-such-page-lane-c")).toBe(NOTFOUND);
    expect(destFor("/become-a-helpr/x")).toBe(NOTFOUND);
    expect(destFor("/home")).toBe("/index.html");
    expect(destFor("/rentals/listings/abc/edit")).toBe("/index.html");
    expect(destFor("/help")).toBe("/api/share?_og=page&_id=help");
    expect(destFor("/assets/gone.js")).toBe("/api/missing-asset");
  });

  it("api/share answers the notfound kind with the shell, status 404 and noindex", async () => {
    const res = await handler.fetch(new Request("https://www.louisianahelpr.com/api/share?_og=notfound"));
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await res.text()).toMatch(/<div id="root"/);
    const page = await handler.fetch(new Request("https://www.louisianahelpr.com/api/share?_og=page&_id=help"));
    expect(page.status).toBe(200);
    expect(page.headers.get("X-Robots-Tag")).toBeNull();
  });
});
