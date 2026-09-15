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
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/* api/share.ts imports the build-time snapshot `scripts/generated/og-shell.js`
   (gitignored; written by `npm run build`). A fresh checkout has none, so the
   test writes one from index.html when — and only when — it is missing, and
   removes exactly what it wrote. A snapshot a real build left behind is used
   as-is and never overwritten. */
const GENERATED = resolve("scripts/generated/og-shell.js");
let createdSnapshot = false;
let handler: { fetch: (req: Request) => Promise<Response> };

beforeAll(async () => {
  // No network from a unit test: a job lookup always lands on the handler's
  // `unknown` branch (plain shell), even where CI has Supabase env set.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in unit tests")));
  if (!existsSync(GENERATED)) {
    mkdirSync(dirname(GENERATED), { recursive: true });
    const html = readFileSync("index.html", "utf8");
    writeFileSync(GENERATED, `export const SHELL_HTML = ${JSON.stringify(html)};\n`);
    createdSnapshot = true;
  }
  // Imported by a runtime-built path so tsc (tsconfig.app.json covers src/
  // only) does not pull api/share.ts and its build-time snapshot into the app
  // project; vitest resolves it normally.
  const sharePath = ["..", "..", "api", "share"].join("/");
  handler = (await import(/* @vite-ignore */ sharePath)).default;
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (createdSnapshot) rmSync(GENERATED);
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
