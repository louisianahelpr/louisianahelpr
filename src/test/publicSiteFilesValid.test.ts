/**
 * The site's crawler-facing files are valid, and the doorway URLs people type
 * reach a real page.
 *
 * Measured live 2026-10-25: https://www.louisianahelpr.com/sitemap.xml failed
 * to parse (expat: "not well-formed", line 7 col 42) because its generated
 * header comment contained `--check`, and `--` is not allowed inside an XML
 * comment; /.well-known/security.txt served the app's HTML; the apex
 * louisianahelpr.com answered 307 (not permanent); /contact, /become-a-helpr,
 * /become-a-helper, /find-work and /work had no route (the app's Not Found).
 * RED on origin/main 8ca225a0e3: the sitemap, security.txt and redirect tests
 * fail.
 */
// @mutate scripts/generate-sitemap.mjs |     "     the generator's check mode in CI (an XML comment may not contain two hyphens in a row). -->", |     "     node scripts/generate-sitemap.mjs --check in CI. -->",
// @mutate vercel.json |       "destination": "https://www.louisianahelpr.com/:path",\n      "permanent": true | "destination": "https://www.louisianahelpr.com/:path",\n      "permanent": false
// @mutate vercel.json |       "source": "/contact", |       "source": "/contact-us",
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function xmlErrors(xml: string): string | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  return err ? err.textContent : null;
}

describe("public/sitemap.xml", () => {
  it("is well-formed XML", () => {
    expect(xmlErrors(read("public/sitemap.xml"))).toBeNull();
  });

  it("has no `--` inside any comment (the generator's header included)", () => {
    const xml = read("public/sitemap.xml");
    const comments = [...xml.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
    expect(comments.length).toBeGreaterThan(0);
    expect(comments.filter((c) => c.includes("--"))).toEqual([]);
  });

  it("the parse check can fail (fixture)", () => {
    expect(xmlErrors('<?xml version="1.0"?>\n<!-- run --check -->\n<urlset/>')).not.toBeNull();
  });

  it("lists real pages (inventory floor)", () => {
    expect((read("public/sitemap.xml").match(/<loc>/g) ?? []).length).toBeGreaterThan(5);
  });
});

describe("public/.well-known/security.txt (RFC 9116)", () => {
  const field = (name: string) =>
    read("public/.well-known/security.txt").match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim();

  it("names a contact", () => {
    expect(field("Contact")).toMatch(/^(mailto:|https:\/\/)/);
  });

  it("expires within a year and not within the next 30 days (renew it before then)", () => {
    const expires = Date.parse(field("Expires") ?? "");
    expect(Number.isNaN(expires)).toBe(false);
    const now = Date.now();
    expect(expires - now).toBeGreaterThan(30 * 86_400_000);
    expect(expires - now).toBeLessThanOrEqual(366 * 86_400_000);
  });
});

describe("vercel.json redirects", () => {
  const config = JSON.parse(read("vercel.json")) as {
    redirects: Array<{ source: string; destination: string; permanent?: boolean; has?: unknown[] }>;
  };

  it("the apex goes to www permanently (308, not 307)", () => {
    const apex = config.redirects.find((r) => r.destination.startsWith("https://www.louisianahelpr.com/"));
    expect(apex?.permanent).toBe(true);
  });

  it.each([
    ["/contact", "/support"],
    ["/become-a-helpr", "/signup"],
    ["/become-a-helper", "/signup"],
    ["/find-work", "/signup"],
    ["/work", "/signup"],
  ])("%s goes to %s", (source, destination) => {
    const r = config.redirects.find((x) => x.source === source);
    expect(r?.destination).toBe(destination);
    expect(r?.permanent).toBe(true);
  });

  it("no doorway redirect shadows a real app route", () => {
    const app = read("src/App.tsx");
    for (const r of config.redirects.filter((x) => !x.has)) {
      expect(app.includes(`path="${r.source}"`), `${r.source} is also an App.tsx route`).toBe(false);
    }
  });
});
