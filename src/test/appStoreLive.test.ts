// @mutate scripts/lib/appStoreLive.mjs |   const appleLive = pageOk && lookupOk; |   const appleLive = pageOk \|\| lookupOk;
// @mutate scripts/lib/appStoreLive.mjs |   if (appleId && repo.urlId && repo.urlId !== appleId) { |   if (false) {
// @mutate scripts/lib/appStoreLive.mjs |   const noComments = indexHtml.replace(/<!--[\s\S]*?-->/g, ""); |   const noComments = indexHtml;
//
// `npm run launch:appstore` (Q1289) is the launch-day step that says when the
// App Store links come back. It must say "not live" until Apple answers BOTH
// probes, must never call a listing live on a missing page or an empty lookup, and
// must catch the repo naming a different app id than App Store Connect.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readAppleId, readBundleId, readRepoState, judgeAppStore } from "../../scripts/lib/appStoreLive.mjs";

const ROOT = resolve(__dirname, "../..");
const META = readFileSync(resolve(ROOT, "fastlane/ios_app_metadata.yml"), "utf8");
const APP_STORE_TS = readFileSync(resolve(ROOT, "src/lib/appStore.ts"), "utf8");
const INDEX_HTML = readFileSync(resolve(ROOT, "index.html"), "utf8");

const ID = readAppleId(META) as string;
const live = { resultCount: 1, results: [{ trackId: Number(ID), bundleId: "com.Helpr" }] };

describe("launch:appstore reads the real repo", () => {
  it("App Store Connect's apple_id and the repo's store URL name the same app", () => {
    expect(ID).toMatch(/^\d{9,12}$/);
    expect(readBundleId(META)).toBe("com.Helpr");
    const repo = readRepoState(APP_STORE_TS, INDEX_HTML);
    expect(repo.urlId).toBe(ID);
    expect(repo.listingLive).not.toBeNull();
  });

  it("today's repo with Apple's 404 + empty lookup is 'not-live', not inconsistent", () => {
    const repo = readRepoState(APP_STORE_TS, INDEX_HTML);
    const r = judgeAppStore({ appleId: ID, bundleId: "com.Helpr", repo, page: { status: 404 }, lookup: { resultCount: 0, results: [] } });
    expect(r.verdict).toBe(repo.listingLive ? "inconsistent" : "not-live");
  });
});

describe("judgeAppStore", () => {
  const hidden = { url: `https://apps.apple.com/us/app/helpr/id${ID}`, urlId: ID, listingLive: false, bannerId: null };
  const shown = { ...hidden, listingLive: true, bannerId: ID };

  it("needs BOTH the page and the lookup before calling it live", () => {
    expect(judgeAppStore({ appleId: ID, bundleId: "com.Helpr", repo: hidden, page: { status: 200 }, lookup: { resultCount: 0, results: [] } }).verdict).toBe("not-live");
    expect(judgeAppStore({ appleId: ID, bundleId: "com.Helpr", repo: hidden, page: { status: 404 }, lookup: live }).verdict).toBe("not-live");
  });

  it("live at Apple + hidden in the repo = flip-now, with the steps", () => {
    const r = judgeAppStore({ appleId: ID, bundleId: "com.Helpr", repo: hidden, page: { status: 200 }, lookup: live });
    expect(r.verdict).toBe("flip-now");
    expect(r.steps.join("\n")).toContain(`app-id=${ID}`);
    expect(r.steps.length).toBeGreaterThan(2);
  });

  it("live at Apple + shown in the repo = live-and-shipped", () => {
    expect(judgeAppStore({ appleId: ID, bundleId: "com.Helpr", repo: shown, page: { status: 200 }, lookup: live }).verdict).toBe("live-and-shipped");
  });

  it("a different id in the repo, or links shown while Apple 404s, is inconsistent", () => {
    expect(judgeAppStore({ appleId: ID, bundleId: "com.Helpr", repo: { ...hidden, urlId: "1111111111" }, page: { status: 404 }, lookup: null }).verdict).toBe("inconsistent");
    expect(judgeAppStore({ appleId: ID, bundleId: "com.Helpr", repo: shown, page: { status: 404 }, lookup: null }).verdict).toBe("inconsistent");
  });

  it("a commented-out banner is not a banner", () => {
    const html = `<head><!-- <meta name="apple-itunes-app" content="app-id=${ID}, app-argument=helpr://" /> --></head>`;
    expect(readRepoState(APP_STORE_TS, html).bannerId).toBeNull();
  });
});
