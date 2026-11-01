/**
 * deploy.yml (the App Store release lane) runs
 *   cp ios/PrivacyInfo.xcprivacy ios/App/App/PrivacyInfo.xcprivacy
 *   cp ios/App.entitlements      ios/App/App/App.entitlements
 * before archiving, so the mirror copies under ios/ are what ships. On
 * 2026-11-01 the mirror manifest lacked AudioData and EmailsOrTextMessages
 * (added to the active file by b09764d04b) and said "not linked" for the user
 * id PostHog and Sentry send: a deploy.yml build would have shipped the stale
 * manifest. Each mirror must equal the file it is copied over.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// @mutate ios/PrivacyInfo.xcprivacy | <string>NSPrivacyCollectedDataTypeAudioData</string> | <string>NSPrivacyCollectedDataTypeOtherAudio</string>
// @mutate ios/App.entitlements | <key>com.apple.developer.applesignin</key> | <key>com.apple.developer.applesignin.off</key>

const ROOT = join(__dirname, "..", "..");
const deploy = readFileSync(join(ROOT, ".github", "workflows", "deploy.yml"), "utf8");
const PAIRS = [...deploy.matchAll(/^\s*cp (ios\/\S+)\s+(ios\/App\/App\/\S+)\s*$/gm)].map((m) => [m[1], m[2]] as const);

describe("the ios/ mirror files deploy.yml copies over the active ones are identical to them", () => {
  it("reads the copy lines from the real workflow", () => {
    expect(PAIRS.length).toBeGreaterThan(1);
    expect(PAIRS.map((p) => p[0])).toEqual(expect.arrayContaining(["ios/PrivacyInfo.xcprivacy", "ios/App.entitlements"]));
  });

  it.each(PAIRS)("%s equals %s", (mirror, active) => {
    expect(readFileSync(join(ROOT, mirror), "utf8")).toBe(readFileSync(join(ROOT, active), "utf8"));
  });
});
