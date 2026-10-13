/**
 * The YAML must agree with the committed Info.plist for EVERY key the iOS
 * metadata sync writes.
 *
 * Why: `bundle exec fastlane ios sync_xcode_metadata` (ios-beta.yml and
 * deploy.yml run it before every build) and scripts/sync-ios-metadata.mjs copy
 * fastlane/ios_app_metadata.yml INTO ios/App/App/Info.plist. When the YAML is
 * stale, the sync silently reverts a reviewed plist change inside the build: on
 * 2026-10-13, cutting the 1.0.4 build, a clean worktree produced two Info.plist
 * diffs: the Face ID string went back to the pre-CS-006 wording ("before
 * cashing out your earnings", which is wrong for the app-wide lock), and a
 * NSContactsUsageDescription (CS-005: the app has no contacts API) came back.
 * faceIdStringCoversEveryUse and infoPlistUsageKeysHaveAUser read only the
 * plist, so both stayed green while the build shipped different strings.
 *
 * The key lists are READ from the two writers (not retyped here), so a key a
 * writer starts writing is compared automatically, or fails this file until it
 * is mapped.
 *
 * @mutate fastlane/ios_app_metadata.yml | when you unlock the app and before sensitive actions like cashing out. | before cashing out your earnings.
 * @mutate fastlane/ios_app_metadata.yml | NSMicrophoneUsageDescription: " | NSContactsUsageDescription: "Helpr can access contacts only if you choose to invite a friend."\n  NSMicrophoneUsageDescription: "
 * @mutate fastlane/ios_app_metadata.yml | public.app-category.lifestyle | public.app-category.social-networking
 * @mutate scripts/sync-ios-metadata.mjs | "NSMicrophoneUsageDescription", | "NSMicrophoneUsageDescription",\n  "NSContactsUsageDescription",
 * @mutate fastlane/Fastfile | upsert_plist_string.call("LSApplicationCategoryType", APP_CATEGORY_TYPE) | upsert_plist_string.call("LSApplicationCategoryType", APP_CATEGORY_TYPE)\n  upsert_plist_string.call("CFBundleExecutable", APP_ID)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { blankComments } from "./helpers/blankNonCode";

const META_TEXT = readFileSync("fastlane/ios_app_metadata.yml", "utf8");
const META = parse(META_TEXT) as {
  display: { name: string; product_name: string; category_uti: string };
  build: { uses_non_exempt_encryption: boolean };
  permission_strings: Record<string, string>;
};
const PLIST = readFileSync("ios/App/App/Info.plist", "utf8");
const SYNC_MJS = blankComments(readFileSync("scripts/sync-ios-metadata.mjs", "utf8"));
const FASTFILE = readFileSync("fastlane/Fastfile", "utf8")
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

const xmlUnescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
// Both writers use the same line-anchored read the sync uses to write.
const plistString = (key: string): string | null => {
  const m = PLIST.match(new RegExp(`<key>${key}</key>\\s*\\n\\s*<string>([^<]*)</string>`));
  return m ? xmlUnescape(m[1]) : null;
};
const plistBool = (key: string): boolean | null => {
  const m = PLIST.match(new RegExp(`<key>${key}</key>\\s*\\n\\s*<(true|false)/>`));
  return m ? m[1] === "true" : null;
};
// What the Fastfile writes: it collapses whitespace in each permission string.
const fastfileValue = (v: string) => String(v).replace(/\s+/g, " ").trim();

// Scalar Info.plist keys the writers own -> where the YAML holds the value.
const SCALAR_STRING: Record<string, string> = {
  CFBundleDisplayName: META.display.name,
  CFBundleName: META.display.product_name,
  LSApplicationCategoryType: META.display.category_uti,
};
const SCALAR_BOOL: Record<string, boolean> = {
  ITSAppUsesNonExemptEncryption: META.build.uses_non_exempt_encryption,
};

const mjsStringKeys = [...SYNC_MJS.matchAll(/upsertPlistString\(\s*"([A-Za-z0-9]+)"/g)].map((m) => m[1]);
const mjsBoolKeys = [...SYNC_MJS.matchAll(/upsertPlistBool\(\s*"([A-Za-z0-9]+)"/g)].map((m) => m[1]);
const mjsPermissionKeys = [
  ...(SYNC_MJS.match(/const PERMISSION_KEYS = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/"([A-Za-z0-9]+)"/g),
].map((m) => m[1]);
const fastfileStringKeys = [...FASTFILE.matchAll(/upsert_plist_string\.call\("([A-Za-z0-9]+)"/g)].map((m) => m[1]);
const fastfileBoolKeys = [...FASTFILE.matchAll(/upsert_plist_bool\.call\("([A-Za-z0-9]+)"/g)].map((m) => m[1]);
const yamlPermissionKeys = Object.keys(META.permission_strings);

describe("ios_app_metadata.yml agrees with the committed Info.plist for every synced key", () => {
  it("the inventory is real (readers did not silently find nothing)", () => {
    expect(mjsStringKeys.length).toBeGreaterThan(1);
    expect(mjsBoolKeys.length).toBeGreaterThan(0);
    expect(mjsPermissionKeys.length).toBeGreaterThan(5);
    expect(fastfileStringKeys.length).toBeGreaterThan(1);
    expect(fastfileBoolKeys.length).toBeGreaterThan(0);
    expect(yamlPermissionKeys.length).toBeGreaterThan(5);
  });

  it("every scalar key a writer upserts is one this file knows how to compare", () => {
    for (const k of [...mjsStringKeys, ...fastfileStringKeys]) expect(SCALAR_STRING, k).toHaveProperty(k);
    for (const k of [...mjsBoolKeys, ...fastfileBoolKeys]) expect(SCALAR_BOOL, k).toHaveProperty(k);
  });

  it("the Node sync and the Fastfile sync write the same permission keys (the YAML block)", () => {
    expect([...mjsPermissionKeys].sort()).toEqual([...yamlPermissionKeys].sort());
  });

  for (const [key, want] of Object.entries(SCALAR_STRING)) {
    it(`${key}: YAML value equals the plist value`, () => {
      expect(plistString(key)).toBe(want);
    });
  }
  for (const [key, want] of Object.entries(SCALAR_BOOL)) {
    it(`${key}: YAML value equals the plist value`, () => {
      expect(plistBool(key)).toBe(want);
    });
  }

  for (const key of yamlPermissionKeys) {
    it(`${key}: YAML string equals the plist string`, () => {
      const yamlValue = fastfileValue(META.permission_strings[key]);
      // The Node writer inserts the value into the plist without XML escaping.
      expect(yamlValue, `${key} would produce invalid XML`).not.toMatch(/[<>&]/);
      expect(plistString(key), `${key} is in the YAML but not in Info.plist: the sync would add it`).not.toBeNull();
      expect(plistString(key)).toBe(yamlValue);
    });
  }
});
