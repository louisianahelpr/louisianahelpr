/**
 * VN-4 (owner, 2026-09-14): sharing a job showed the OS share sheet's generic
 * compass instead of the H logo.
 *
 * The share sheet draws the icon from the HTML a link-preview fetcher gets for
 * https://www.louisianahelpr.com/jobs/<id>?ref=share — served by api/share.ts
 * (vercel.json rewrite). That HTML carried og:image as an absolute URL but the
 * favicon / apple-touch-icon links root-relative, which a fetcher reading the
 * document on its own has to resolve itself. This pins that the served share
 * HTML names every icon by absolute URL, on every branch the handler takes.
 *
 * The shell is the app's real index.html (the build snapshots dist/index.html,
 * whose head Vite leaves as-is for these tags).
 *
 * Proven able to fail 2026-09-21, on both of the handler's exits: the happy
 * path (`absolutiseIconLinks(SHELL_HTML)`) and the fail-open catch. The catch
 * was the door VN-4 could walk back through — it returned the raw shell, and
 * the four resolving cases below all miss it. Registered as two mutations so
 * neither exit can regress alone.
 */
// @mutate api/share.ts | const shell = absolutiseIconLinks(SHELL_HTML); | const shell = SHELL_HTML;
// @mutate api/share.ts | return respond(absolutiseIconLinks(SHELL_HTML)); | return respond(SHELL_HTML);
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

/* api/share.ts imports the build-time snapshot `scripts/generated/og-shell.js`
   (gitignored; written by `npm run build`). ensureOgShellSnapshot writes one
   when — and only when — it is missing, and never deletes it: this file used to
   remove the snapshot it wrote in afterAll, which broke the handler import of
   any other test file (publicRoutesServeOwnHead) running in a parallel worker. */
let handler: { fetch: (req: Request) => Promise<Response> };

beforeAll(async () => {
  // No network from a unit test: a job lookup always lands on the handler's
  // `unknown` branch (plain shell), even where CI has Supabase env set.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in unit tests")));
  ensureOgShellSnapshot(resolve("."));
  // Imported by a runtime-built path so tsc (tsconfig.app.json covers src/
  // only) does not pull api/share.ts and its build-time snapshot into the app
  // project; vitest resolves it normally.
  const sharePath = ["..", "..", "api", "share"].join("/");
  handler = (await import(/* @vite-ignore */ sharePath)).default;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const ORIGIN = "https://www.louisianahelpr.com";

async function served(path: string): Promise<string> {
  const res = await handler.fetch(new Request(`${ORIGIN}${path}`));
  expect(res.status).toBe(200);
  return res.text();
}

function iconHrefs(html: string): string[] {
  return [
    ...html.matchAll(
      /<link rel="(?:icon|shortcut icon|apple-touch-icon|apple-touch-icon-precomposed)"[^>]*\shref="([^"]*)"/g,
    ),
  ].map((m) => m[1]);
}

describe("share HTML carries absolute icon links (VN-4)", () => {
  it.each([
    // Not a UUID: answered without a database lookup ("no longer available" card).
    ["/api/share?_og=job&_id=not-a-job", "job card"],
    // A UUID whose lookup cannot complete (`unknown`): the plain shell.
    ["/api/share?_og=job&_id=00000000-0000-4000-8000-000000000000", "fallback shell"],
    ["/api/share?_og=signup&ref=abc123", "signup card"],
    ["/api/share?_og=user&_id=00000000-0000-4000-8000-000000000000", "profile card"],
    // THE HANDLER'S OWN CATCH. `resolveRoute` runs the path segment through
    // decodeURIComponent, which THROWS on a malformed escape, and the outer
    // try/catch degrades to the shell. That fail-open branch returned the
    // shell RAW until 2026-09-21 — 200, icons root-relative, the compass
    // back — and the four cases above all miss it, because every one of them
    // resolves cleanly. Any future throw in resolveMeta lands here too, so
    // this is the branch that decides whether VN-4 can come back by accident.
    ["/jobs/%ZZ", "handler catch (malformed escape)"],
  ])("%s (%s)", async (path) => {
    const html = await served(path);
    const hrefs = iconHrefs(html);
    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    for (const href of hrefs) expect(href.startsWith(`${ORIGIN}/`)).toBe(true);
    expect(html).toContain(`<link rel="apple-touch-icon" href="${ORIGIN}/apple-touch-icon.png" />`);
    expect(html).toContain(`href="${ORIGIN}/favicon-32.png"`);
    // og:image stays exactly as the shell had it — absolute, first, untouched.
    expect(html).toMatch(/<meta property="og:image" content="https:\/\/www\.louisianahelpr\.com\/og-image\.png[^"]*" \/>/);
  });

  it("every icon the shell names, and the conventional root probes, is a real file", () => {
    // A missing file is not a 404 here: the SPA rewrite answers any unknown
    // path with index.html (200 text/html), which a fetcher cannot draw.
    // /apple-touch-icon-precomposed.png answered exactly that on 2026-09-14.
    const named = iconHrefs(readFileSync("index.html", "utf8")).map((h) => h.split("?")[0]);
    const probes = ["/favicon.ico", "/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"];
    for (const path of new Set([...named, ...probes])) {
      expect(existsSync(resolve("public" + path)), `public${path}`).toBe(true);
    }
  });

  it("the shell itself still has root-relative icons (the rewrite is what makes them absolute)", () => {
    const hrefs = iconHrefs(readFileSync("index.html", "utf8"));
    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    expect(hrefs.every((h) => h.startsWith("/"))).toBe(true);
  });
});
