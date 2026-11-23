/**
 * Q1124 + Q1289 — App Store links and badges follow the ONE switch, and the
 * switch follows Apple.
 *
 * Owner, 2026-10-04: hide every App Store link and badge until the app is
 * approved (the listing for id 6754470134 404'd). Apple released 1.0.4 on
 * 2026-11-19, and on 2026-11-23 the site still hid every link (audit NL-04):
 * curl -sIL of APP_STORE_URL answered 200 and the iTunes lookup had
 * resultCount 1, yet APP_STORE_LISTING_LIVE was false and index.html had no
 * Smart App Banner.
 *
 * Held here, from the source:
 *   - the listing is live (APP_STORE_LISTING_LIVE true; `npm run
 *     launch:appstore` is the probe that says so, verdict live-and-shipped);
 *   - index.html carries the Smart App Banner meta with the SAME numeric id
 *     as APP_STORE_URL and as fastlane's apple_id (comments ignored), and
 *     carries none while the switch is off;
 *   - every app file that reads APP_STORE_URL also reads the switch, and no
 *     file hard-codes an apps.apple.com / itunes.apple.com URL of its own.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { APP_STORE_LISTING_LIVE, APP_STORE_URL } from "@/lib/appStore";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const SRC = join(REPO, "src");

const APPLE_ACCOUNT_SUBSCRIPTIONS = "https://apps.apple.com/account/subscriptions";

const appFiles = () =>
  walkSource([SRC]).filter(
    (f) => /\.tsx?$/.test(f) && !f.startsWith(join(SRC, "test") + "/") && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts"),
  );

function indexHtmlWithoutComments(): string {
  // Strip HTML comments until none is left (a removal can join pieces into a new one).
  let html = readFileSync(join(REPO, "index.html"), "utf8");
  let prevLen: number;
  do {
    prevLen = html.length;
    html = html.replace(/<!--[\s\S]*?-->/g, "");
  } while (html.length !== prevLen);
  return html;
}

describe("Q1124/Q1289: App Store links and badges follow the listing", () => {
  it("the listing is live (Apple released 1.0.4 on 2026-11-19)", () => {
    expect(APP_STORE_LISTING_LIVE).toBe(true);
  });

  it("index.html carries the Smart App Banner with the store URL's id and fastlane's apple_id, only while live", () => {
    const html = indexHtmlWithoutComments();
    expect(html.length).toBeGreaterThan(1000);
    const banners = [...html.matchAll(/<meta\s+name="apple-itunes-app"\s+content="([^"]*)"/g)].map((m) => m[1]);
    if (!APP_STORE_LISTING_LIVE) {
      expect(banners).toEqual([]);
      return;
    }
    const appleId = readFileSync(join(REPO, "fastlane/ios_app_metadata.yml"), "utf8").match(
      /^\s*apple_id:\s*"?(\d{6,12})"?\s*$/m,
    )?.[1];
    const urlId = APP_STORE_URL.match(/\/id(\d+)$/)?.[1];
    expect(appleId).toMatch(/^\d{9,12}$/);
    expect(urlId).toBe(appleId);
    expect(banners).toEqual([`app-id=${appleId}, app-argument=helpr://`]);
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
// @mutate index.html |     <meta name="apple-itunes-app" content="app-id=6754470134, app-argument=helpr://" /> |     <meta name="apple-itunes-app" content="app-id=6754470135, app-argument=helpr://" />
// @mutate src/components/Footer.tsx |             {APP_STORE_LISTING_LIVE && ( |             {true && (
// @mutate src/components/ForceUpdateGate.tsx |           {APP_STORE_LISTING_LIVE && ( |           {true && (
