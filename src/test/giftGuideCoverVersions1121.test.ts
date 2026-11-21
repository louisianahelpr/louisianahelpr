/**
 * Every gift guide cover URL carries its file's content hash (owner 2026-11-21: "the colors on the cover need to match
 * the color when you click into the guide"). The landing showed old cover colours while the guide page showed new ones:
 * the files on www were new, but /gift-guides/covers/<slug>.webp never changed URL, so browsers and the service worker's
 * static-images cache (vite.config.ts, StaleWhileRevalidate, keyed by the full URL) kept the old art. Now
 * src/lib/giftGuideCoverVersions.mjs (scripts/gift-guide-cover-versions.mjs) holds each file's hash and the catalog and
 * the share cards add ?v=<hash>.
 *
 * @mutate src/content/giftGuideCatalog.ts | const coverUrl = (slug: string) => `${COVER_DIR}/${slug}.webp${COVER_VERSIONS[slug] ? `?v=${COVER_VERSIONS[slug]}` : ""}`; | const coverUrl = (slug: string) => `${COVER_DIR}/${slug}.webp`;
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GUIDES } from "@/content/giftGuideCatalog";
import { COVER_VERSIONS, OG_VERSIONS } from "@/lib/giftGuideCoverVersions.mjs";
import { VERSIONS_FILE, versionsSource } from "../../scripts/gift-guide-cover-versions.mjs";

const md5 = (path: string) => createHash("md5").update(readFileSync(path)).digest("hex").slice(0, 8);

describe("gift guide cover URLs carry their content hash (owner 11-21)", () => {
  it("the versions file is current with the cover and share-image folders (re-run scripts/gift-guide-cover-versions.mjs)", () => {
    expect(readFileSync(VERSIONS_FILE, "utf8")).toBe(versionsSource());
    expect(Object.keys(COVER_VERSIONS).length).toBeGreaterThan(3);
    expect(Object.keys(OG_VERSIONS).length).toBeGreaterThan(3);
  });

  it("every guide with a cover links it as /gift-guides/covers/<slug>.webp?v=<that file's hash>, and nothing else", () => {
    const withCover = GUIDES.filter((g) => g.cover?.startsWith("/gift-guides/covers/"));
    expect(withCover.length).toBeGreaterThan(3);
    for (const g of withCover) {
      const m = /^\/gift-guides\/covers\/([a-z0-9-]+)\.webp\?v=([0-9a-f]{8})$/.exec(g.cover ?? "");
      expect(m, `${g.slug}: ${g.cover}`).not.toBeNull();
      const file = `public/gift-guides/covers/${m![1]}.webp`;
      expect(existsSync(file), file).toBe(true);
      expect(m![2], g.slug).toBe(md5(file));
    }
    for (const slug of ["her", "him", "kids"]) expect(withCover.some((g) => g.slug === slug), slug).toBe(true);
  });

  it("the share cards (api/share.ts) add the same ?v= to the share JPG and the WebP cover", () => {
    const share = readFileSync("api/share.ts", "utf8");
    expect(share).toContain("/gift-guides/og/${slug}.jpg${v(OG_VERSIONS[slug])}");
    expect(share).toContain("/gift-guides/covers/${slug}.webp${v(COVER_VERSIONS[slug])}");
  });

  it("the service worker caches gift guide images by full URL, so a new ?v= is fetched fresh", () => {
    const vite = readFileSync("vite.config.ts", "utf8");
    // The static-images rule matches same-origin images and uses Workbox's default cache key (the whole URL, query
    // included); an ignoreSearch option would make it serve the old cover for the new URL.
    expect(vite).toMatch(/cacheName: "static-images"/);
    expect(vite).not.toMatch(/ignoreSearch:\s*true/);
  });
});
