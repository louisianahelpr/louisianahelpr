/**
 * Q965 — the served page carries ONE web app manifest link.
 *
 * vite-plugin-pwa injects `<link rel="manifest" href="/manifest.webmanifest">`
 * into the production web build whenever its `manifest` option is set, so a
 * second link written into index.html made www serve two (measured 2026-10-07:
 * `curl https://www.louisianahelpr.com/ | grep rel="manifest"` -> 2 lines).
 * Exactly one source may write it: the plugin while it has a manifest object,
 * index.html otherwise.
 *
 * @mutate index.html |     <link rel="apple-touch-icon-precomposed" href="/apple-touch-icon.png" /> |     <link rel="apple-touch-icon-precomposed" href="/apple-touch-icon.png" /><link rel="manifest" href="/manifest.webmanifest" />
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const html = readFileSync(join(root, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const vite = readFileSync(join(root, "vite.config.ts"), "utf8");

describe("one manifest link on the served page (Q965)", () => {
  const pluginWritesOne = /VitePWA\(\{[\s\S]*?\bmanifest:\s*\{/.test(vite);

  it("reads both sources (floor)", () => {
    expect(html.length).toBeGreaterThan(1000);
    expect(vite).toMatch(/VitePWA\(/);
  });

  it("index.html writes a manifest link only when the PWA plugin does not", () => {
    const inHtml = (html.match(/<link[^>]+rel=["']manifest["']/gi) ?? []).length;
    expect(inHtml + (pluginWritesOne ? 1 : 0)).toBe(1);
  });
});
