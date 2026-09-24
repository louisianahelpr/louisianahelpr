/**
 * CS-005: Info.plist declared NSContactsUsageDescription for an API the app
 * never calls (no contacts plugin, no CNContactStore). App Review reads every
 * usage string as a claim about what the app does. Each declared usage key
 * must name the installed plugin (or native file) that needs it.
 *
 * @mutate ios/App/App/Info.plist | 	<key>NSPhotoLibraryUsageDescription</key> | 	<key>NSContactsUsageDescription</key><string>x</string>\n	<key>NSPhotoLibraryUsageDescription</key>
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const plist = readFileSync("ios/App/App/Info.plist", "utf8");
const pkg = readFileSync("package.json", "utf8");

// Usage key -> what in the repo needs it. Add a row when a plugin needs a new key.
const NEEDS: Record<string, RegExp> = {
  NSCameraUsageDescription: /"@capacitor\/camera"/,
  NSPhotoLibraryUsageDescription: /"@capacitor\/camera"/,
  NSPhotoLibraryAddUsageDescription: /"@capacitor\/camera"/,
  NSLocationWhenInUseUsageDescription: /"@capacitor\/geolocation"/,
  NSLocationAlwaysAndWhenInUseUsageDescription: /"@capacitor\/geolocation"/,
  NSFaceIDUsageDescription: /"@aparajita\/capacitor-biometric-auth"/,
  // Voice input runs through WebKit's speech APIs inside the WKWebView.
  NSMicrophoneUsageDescription: /"@capacitor\/ios"/,
  NSSpeechRecognitionUsageDescription: /"@capacitor\/ios"/,
};

describe("Info.plist usage keys (CS-005)", () => {
  const declared = [...plist.matchAll(/<key>(NS\w+UsageDescription)<\/key>/g)].map((m) => m[1]);
  it("reads the declared keys", () => {
    expect(declared.length).toBeGreaterThan(3);
  });
  it("every declared usage key has something that needs it", () => {
    const orphans = declared.filter((k) => !NEEDS[k] || !NEEDS[k].test(pkg));
    expect(orphans).toEqual([]);
  });
});
