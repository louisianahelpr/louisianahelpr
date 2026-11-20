/**
 * L14 (iOS design audit 11-16): the repo's iOS build number is at least the last build sent to Apple, and every
 * file that carries it agrees.
 *
 * Why: main carried build 7112 (Info.plist hard-coded it; the project and capacitor.config agreed) while the
 * server's minimum supported build was 7117, so every Simulator or local build from main stopped at "Update Helpr
 * to continue" (ForceUpdateGate). 1.0.4 build 7601 went to Apple on 11-03, and the minimum is raised only to
 * builds that shipped, so a repo floor at the newest submitted build clears it. This guard never reads or changes
 * the server minimum (the gate stays as it is).
 *
 * Info.plist reads the build from the project ($(CURRENT_PROJECT_VERSION)) so there is one number, and an
 * xcodebuild CURRENT_PROJECT_VERSION= override reaches the built app.
 *
 * @mutate fastlane/ios_app_metadata.yml | current_project_version: "7602" | current_project_version: "7112"
 * @mutate ios/App/App/Info.plist | <string>$(CURRENT_PROJECT_VERSION)</string> | <string>7112</string>
 * @mutate capacitor.config.ts | build: '7602', | build: '7112',
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

/** The newest build submitted to App Store Connect (1.0.4 build 7601, 11-03 8:36 PM). Raise it with each submission. */
const LAST_SUBMITTED_BUILD = 7601;

const yaml = readFileSync("fastlane/ios_app_metadata.yml", "utf8");
const pbxproj = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");
const plist = readFileSync("ios/App/App/Info.plist", "utf8");
const capConfig = blankComments(readFileSync("capacitor.config.ts", "utf8"));

const yamlBuild = Number(yaml.match(/^\s*current_project_version:\s*"(\d+)"/m)?.[1]);
const projectBuilds = [...pbxproj.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
const capBuild = Number(capConfig.match(/\bbuild:\s*'(\d+)'/)?.[1]);
const plistBuild = plist.match(/<key>CFBundleVersion<\/key>\s*\n\s*<string>([^<]*)<\/string>/)?.[1];

describe("iOS build number is at the last submitted build (L14)", () => {
  it("found every build number (inventory)", () => {
    expect(projectBuilds.length).toBeGreaterThan(1);
    expect(Number.isInteger(yamlBuild)).toBe(true);
    expect(Number.isInteger(capBuild)).toBe(true);
    expect(plistBuild).toBeTruthy();
  });

  it("the YAML floor is at least the last submitted build", () => {
    expect(yamlBuild).toBeGreaterThanOrEqual(LAST_SUBMITTED_BUILD);
  });

  it("the project, capacitor.config and the YAML carry the same build", () => {
    for (const b of projectBuilds) expect(b).toBe(yamlBuild);
    expect(capBuild).toBe(yamlBuild);
  });

  it("Info.plist reads the build from the project instead of hard-coding a number", () => {
    expect(plistBuild).toBe("$(CURRENT_PROJECT_VERSION)");
  });
});
