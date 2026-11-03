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
 * Q1289 (land ONLY after Apple approves 1.0.4): the listing is live, so the
 * switch is true and index.html carries the Smart App Banner with the
 * apple_id from fastlane/ios_app_metadata.yml; every reader is still gated.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { APP_STORE_LISTING_LIVE } from "@/lib/appStore";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";
import { readAppleId } from "../../scripts/lib/appStoreLive.mjs";

const REPO = resolve(__dirname, "..", "..");
const SRC = join(REPO, "src");

const APPLE_ACCOUNT_SUBSCRIPTIONS = "https://apps.apple.com/account/subscriptions";

const appFiles = () =>
  walkSource([SRC]).filter(
    (f) => /\.tsx?$/.test(f) && !f.startsWith(join(SRC, "test") + "/") && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts"),
  );

describe("Q1124: App Store links and badges stay hidden until the listing is live", () => {
  it("the listing is live (Q1289, after Apple approved 1.0.4)", () => {
    expect(APP_STORE_LISTING_LIVE).toBe(true);
  });

  it("index.html carries the Smart App Banner with the App Store Connect apple_id", () => {
    // Strip HTML comments until none is left (a removal can join pieces into a new one).
    let html = readFileSync(join(REPO, "index.html"), "utf8");
    let prevLen: number;
    do {
      prevLen = html.length;
      html = html.replace(/<!--[\s\S]*?-->/g, "");
    } while (html.length !== prevLen);
    expect(html.length).toBeGreaterThan(1000);
    const appleId = readAppleId(readFileSync(join(REPO, "fastlane/ios_app_metadata.yml"), "utf8"));
    expect(appleId).toMatch(/^\d{9,12}$/);
    if (!APP_STORE_LISTING_LIVE) expect(html).not.toMatch(/<meta\s+name="apple-itunes-app"/);
    else expect(html).toContain(`<meta name="apple-itunes-app" content="app-id=${appleId}, app-argument=helpr://" />`);
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
      .filter((f) => {
        // Apple's own manage-subscriptions page (src/lib/appleSubscriptions.ts, Q1797) is
        // not our listing: it is live whatever the listing state, so only that exact URL is
        // taken out before the check.
        const text = blankComments(readFileSync(f, "utf8")).split(APPLE_ACCOUNT_SUBSCRIPTIONS).join("");
        return /\b(?:apps|itunes)\.apple\.com\b/.test(text);
      })
      .map((f) => relative(REPO, f));
    expect(own).toEqual([]);
  });
});

// @mutate src/lib/appStore.ts | export const APP_STORE_LISTING_LIVE: boolean = true; | export const APP_STORE_LISTING_LIVE: boolean = false;
// @mutate index.html | content="app-id=6754470134, app-argument=helpr://" | content="app-id=1111111111, app-argument=helpr://"
// @mutate src/components/Footer.tsx |             {APP_STORE_LISTING_LIVE && ( |             {true && (
// @mutate src/components/ForceUpdateGate.tsx |           {APP_STORE_LISTING_LIVE && ( |           {true && (
