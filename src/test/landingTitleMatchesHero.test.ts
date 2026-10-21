/**
 * Q2198(c), owner 2026-10-21: the browser tab and the share preview say what the
 * landing H1 says, "Louisiana's local partner.", never the old "Local Job Partner".
 * index.html (what crawlers and the first paint read) and LANDING_PAGE_META (what
 * usePageMeta sets) must agree.
 *
 * @mutate src/lib/publicPageMeta.mjs | ogTitle: "Helpr — Louisiana's local partner.", | ogTitle: "Helpr — Louisiana's Local Job Partner",
 * @mutate src/components/auth/AuthShell.tsx | eyebrow = "Louisiana's local partner.", | eyebrow = "Louisiana's Local Job Partner",
 * @mutate index.html | <meta property="og:title" content="Helpr — Louisiana's local partner." /> | <meta property="og:title" content="Helpr — Louisiana's Local Job Partner" />
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LANDING_PAGE_META } from "@/lib/publicPageMeta.mjs";

const ROOT = resolve(__dirname, "..", "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const authShell = readFileSync(join(ROOT, "src/components/auth/AuthShell.tsx"), "utf8");
const WORDS = "Helpr — Louisiana's local partner.";

describe("landing tab and share titles match the hero (Q2198)", () => {
  it("LANDING_PAGE_META carries the hero words", () => {
    expect(LANDING_PAGE_META.title).toBe(WORDS);
    expect(LANDING_PAGE_META.ogTitle).toBe(WORDS);
  });
  it("index.html's title, og:title and twitter:title carry them too", () => {
    expect(html).toContain(`<title>${WORDS}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${WORDS}" />`);
    expect(html).toContain(`<meta name="twitter:title" content="${WORDS}" />`);
    expect(html).not.toMatch(/Local Job Partner/);
  });
  it("the sign-in eyebrow says it too, in sentence case (lead 2026-10-21)", () => {
    expect(authShell).toContain(`eyebrow = "Louisiana's local partner.",`);
  });
});
