/**
 * NB-003: every UIBackgroundModes entry in Info.plist is a capability claim in
 * the binary. Each must have native code that services it, or the claim is
 * inert (and App Review can ask why it is there). `remote-notification` sat
 * there with no didReceiveRemoteNotification:fetchCompletionHandler: anywhere.
 *
 * NB-016: en-route tracking must use the native watch, not a WebView timer
 * iOS suspends in the background.
 *
 * @mutate src/components/JobTracking.tsx |     const watch = startEnRouteWatch({ |     setInterval(() => {}, 45_000); const watch = startEnRouteWatch({
 * @mutate ios/App/App/Info.plist | \t\t\t<string>location</string>\n | \t\t\t<string>remote-notification</string>\n\t\t\t<string>location</string>\n
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const plist = readFileSync(resolve(ROOT, "ios/App/App/Info.plist"), "utf8");
const swift = readdirSync(resolve(ROOT, "ios/App/App"))
  .filter((f) => f.endsWith(".swift"))
  .map((f) => readFileSync(resolve(ROOT, "ios/App/App", f), "utf8"))
  .join("\n");

// mode -> the native symbol that services it
const HANDLER: Record<string, RegExp> = {
  location: /allowsBackgroundLocationUpdates\s*=\s*true/,
  "remote-notification": /didReceiveRemoteNotification[^)]*fetchCompletionHandler/,
};

function modes(): string[] {
  const m = plist.match(/<key>UIBackgroundModes<\/key>\s*<array>([\s\S]*?)<\/array>/);
  return m ? [...m[1].matchAll(/<string>([^<]+)<\/string>/g)].map((x) => x[1]) : [];
}

describe("every iOS background mode has native code behind it (NB-003)", () => {
  it("each declared mode is known and serviced", () => {
    const declared = modes();
    // Inventory floor: en-route tracking needs `location`.
    expect(declared.length).toBeGreaterThan(0);
    expect(declared).toContain("location");
    for (const m of declared) {
      expect(HANDLER[m], `no handler rule for background mode "${m}"`).toBeDefined();
      expect(swift, `background mode "${m}" has no native handler`).toMatch(HANDLER[m]);
    }
  });
});

describe("en-route tracking is the native watch, not a WebView timer (NB-016)", () => {
  it("JobTracking starts startEnRouteWatch and runs no setInterval", () => {
    const code = readFileSync(resolve(ROOT, "src/components/JobTracking.tsx"), "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*)/.test(l))
      .join("\n");
    expect(code).toMatch(/startEnRouteWatch\(/);
    expect(code).not.toMatch(/setInterval\(/);
  });
});
