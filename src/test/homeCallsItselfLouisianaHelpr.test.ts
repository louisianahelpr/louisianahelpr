/**
 * Owner 2026-10-30: Google refused branding verification because the sign-in app is named "Louisiana Helpr" and the
 * home page called itself "Helpr". The site's NAME is Louisiana Helpr everywhere a crawler reads it, and once in
 * plain visible text on the page. "Helpr" alone stays for the worker role, the H logo and the company's legal name.
 * The two home-screen labels (apple-mobile-web-app-title, the manifest's short_name) stay "Helpr" on purpose: they sit
 * under an icon, where 15 characters is at risk of being cut off. That is not checked here, so the owner can change it.
 *
 * @mutate index.html | <meta name="application-name" content="Louisiana Helpr" /> | <meta name="application-name" content="Helpr" />
 * @mutate index.html | <meta property="og:site_name" content="Louisiana Helpr" /> | <meta property="og:site_name" content="Helpr" />
 * @mutate index.html | <meta name="author" content="Louisiana Helpr" /> | <meta name="author" content="Helpr" />
 * @mutate index.html | "@type": "WebSite", | "@type": "WebPage",
 * @mutate src/components/Footer.tsx | © {new Date().getFullYear()} Louisiana Helpr · Helpr LLC | © {new Date().getFullYear()} Helpr LLC
 * @mutate src/pages/info/Index.tsx | name: "Louisiana Helpr", | name: "Helpr",
 * @mutate vite.config.ts | name: "Louisiana Helpr", | name: "Helpr — Louisiana Help Marketplace",
 * @mutate src/hooks/usePageMeta.ts | document.title = "Louisiana Helpr"; | document.title = "Helpr";
 * @mutate src/hooks/usePageTitle.ts | document.title = "Louisiana Helpr"; | document.title = "Helpr";
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const html = read("index.html");
const NAME = "Louisiana Helpr";

/** Every JSON-LD block index.html serves, parsed: a crawler reads these without running the app. */
const jsonLd = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
  (m) => JSON.parse(m[1]) as { "@type": string; name: string; legalName?: string },
);

describe("the home page calls itself Louisiana Helpr", () => {
  it("the raw HTML's site-name tags say the name", () => {
    expect(html).toContain(`<meta name="application-name" content="${NAME}" />`);
    expect(html).toContain(`<meta property="og:site_name" content="${NAME}" />`);
    expect(html).toContain(`<meta name="author" content="${NAME}" />`);
  });

  it("every business entity in the raw HTML carries the name, and the company keeps its legal name", () => {
    expect(jsonLd.length).toBeGreaterThan(1);
    for (const entity of jsonLd) expect(entity.name, entity["@type"]).toBe(NAME);
    expect(jsonLd.find((e) => e["@type"] === "Organization")?.legalName).toBe("Helpr LLC");
    expect(jsonLd.map((e) => e["@type"]), "the block that names the site").toContain("WebSite");
  });

  it("the page's own schema and the tab's fallback title say it after JavaScript runs", () => {
    expect(read("src/pages/info/Index.tsx")).toContain(`name: "${NAME}",`);
    expect(read("src/hooks/usePageMeta.ts")).toContain(`document.title = "${NAME}";`);
    expect(read("src/hooks/usePageTitle.ts")).toContain(`document.title = "${NAME}";`);
  });

  it("the footer shows it once as plain text, and still names the company", () => {
    const footer = read("src/components/Footer.tsx");
    expect(footer).toContain(`© {new Date().getFullYear()} ${NAME} · Helpr LLC`);
    expect(footer.split(NAME).length - 1).toBe(1);
  });

  it("the installed web app's full name says it", () => {
    expect(read("vite.config.ts")).toContain(`name: "${NAME}",`);
  });

  it("the logo is left alone: the emblem still has no wordmark beside it", () => {
    expect(read("src/components/Navbar.tsx")).toContain(`<HelprMark to="/" size="md" emblemOnly />`);
  });
});
