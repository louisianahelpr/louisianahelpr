/**
 * CS-004: PrivacyInfo.xcprivacy declared ProductInteraction (PostHog) and
 * CrashData (Sentry) as NOT linked to identity, while posthog.identify() sends
 * the user id and Sentry setUser() the id and email. While either call exists,
 * the matching data type must be declared Linked=true.
 *
 * @mutate ios/App/App/PrivacyInfo.xcprivacy | <true/><!-- CS-004: Sentry setUser() sends the user id and email --> | <false/>
 * @mutate ios/App/App/PrivacyInfo.xcprivacy | <true/><!-- CS-004: PostHog identify() sends the user id --> | <false/>
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = readFileSync("ios/App/App/PrivacyInfo.xcprivacy", "utf8");
const linked = (type: string) => {
  const at = manifest.indexOf(`<string>NSPrivacyCollectedDataType${type}</string>`);
  expect(at, `${type} must be declared`).toBeGreaterThan(-1);
  return /<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>/.test(manifest.slice(at, manifest.indexOf("</dict>", at)));
};

describe("privacy manifest says identified data is linked (CS-004)", () => {
  it("PostHog identify() → ProductInteraction is linked", () => {
    const identifies = /posthog\.identify\(/.test(readFileSync("src/lib/posthog.ts", "utf8"));
    expect(identifies).toBe(true);
    expect(linked("ProductInteraction")).toBe(true);
  });
  it("Sentry setUser({ id }) → CrashData is linked", () => {
    const sets = /setUser\(\{\s*id:/.test(readFileSync("src/lib/sentry.ts", "utf8"));
    expect(sets).toBe(true);
    expect(linked("CrashData")).toBe(true);
  });
});
