/**
 * Q1124 — no App Store link or badge shows while the listing is not live.
 *
 * Owner, 2026-10-04: hide every App Store link and badge until the app is
 * approved; the listing for id 6754470134 404s (src/lib/appStore.ts has the
 * probes). Before this: index.html shipped the Smart App Banner meta (Mobile
 * Safari's banner pointed at the dead listing), the Footer drew an Apple
 * "coming soon" chip, and ForceUpdateGate's primary button linked to the 404.
 *
 * Held here, from the source:
 *   - APP_STORE_LISTING_LIVE is the one switch; while it is false,
 *   - index.html carries no apple-itunes-app meta (comments ignored);
 *   - every app file that reads APP_STORE_URL also reads the switch, and no
 *     file hard-codes an apps.apple.com / itunes.apple.com URL of its own.
 * Restoring them with the real ID is the launch checklist item Q1276.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { APP_STORE_LISTING_LIVE } from "@/lib/appStore";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const SRC = join(REPO, "src");

const appFiles = () =>
  walkSource([SRC]).filter(
    (f) => /\.tsx?$/.test(f) && !f.startsWith(join(SRC, "test") + "/") && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts"),
  );

describe("Q1124: App Store links and badges stay hidden until the listing is live", () => {
  it("the listing is not live yet", () => {
    expect(APP_STORE_LISTING_LIVE).toBe(false);
  });

  it("index.html has no Smart App Banner meta while it is not live", () => {
    const html = readFileSync(join(REPO, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
    expect(html.length).toBeGreaterThan(1000);
    if (!APP_STORE_LISTING_LIVE) expect(html).not.toMatch(/<meta\s+name="apple-itunes-app"/);
  });

  it("every reader of APP_STORE_URL is gated by the switch", () => {
    const readers = appFiles()
      .filter((f) => !f.endsWith(join("lib", "appStore.ts")))
      .map((f) => ({ f: relative(REPO, f), code: blankComments(readFileSync(f, "utf8")) }))
      .filter((x) => x.code.includes("APP_STORE_URL"));
    expect(readers.map((r) => r.f).sort()).toEqual(["src/components/Footer.tsx", "src/components/ForceUpdateGate.tsx"]);
    for (const r of readers) expect(r.code, r.f).toMatch(/APP_STORE_LISTING_LIVE\s*&&/);
  });

  it("no file hard-codes its own store URL", () => {
    const files = appFiles();
    expect(files.length).toBeGreaterThan(800);
    const own = files
      .filter((f) => !f.endsWith(join("lib", "appStore.ts")))
      .filter((f) => /(apps|itunes)\.apple\.com/.test(blankComments(readFileSync(f, "utf8"))))
      .map((f) => relative(REPO, f));
    expect(own).toEqual([]);
  });
});

// @mutate src/lib/appStore.ts | export const APP_STORE_LISTING_LIVE: boolean = false; | export const APP_STORE_LISTING_LIVE: boolean = true;
// @mutate src/components/Footer.tsx |             {APP_STORE_LISTING_LIVE && ( |             {true && (
// @mutate src/components/ForceUpdateGate.tsx |           {APP_STORE_LISTING_LIVE && ( |           {true && (
