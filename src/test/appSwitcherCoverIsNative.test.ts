/*
 * CLASS CHECK — the app-switcher snapshot is covered natively, for every user
 * (OA-008, owner 2026-09-27: "Cover for everyone").
 *
 * iOS takes the app-switcher snapshot right after willResignActive. The JS
 * shield in AppLockGate only runs when App Lock is on and races the snapshot
 * through the WebView, so a chat or payout screen could sit in the switcher.
 *
 * THE CHECK. In AppDelegate.swift, applicationWillResignActive adds a cover
 * view to the window with no condition beyond "not already covered" and "a
 * window exists" (no lock, setting or user check), and
 * applicationDidBecomeActive removes it.
 *
 * @mutate ios/App/App/AppDelegate.swift | window.addSubview(cover) | _ = cover
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "..", "..", "ios/App/App/AppDelegate.swift"), "utf8");

/** Body of `func <name>(`, found by brace matching, comments blanked. */
function body(name: string): string {
  const start = SRC.indexOf(`func ${name}(`);
  if (start < 0) return "";
  const open = SRC.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}" && --depth === 0) {
      return SRC.slice(open + 1, i).replace(/\/\/[^\n]*/g, "");
    }
  }
  return "";
}

describe("the app-switcher snapshot is covered natively for every user (OA-008)", () => {
  const resign = body("applicationWillResignActive");
  const active = body("applicationDidBecomeActive");

  it("willResignActive adds a cover view to the window", () => {
    expect(resign).toMatch(/\bwindow\.addSubview\(\s*cover\s*\)/);
    expect(resign).toMatch(/UIImage\(named:\s*"Splash"\)/);
  });

  it("the cover is unconditional: no lock, setting or user check gates it", () => {
    expect(resign).not.toMatch(/\b(lock|Lock|UserDefaults|enabled|isEnabled|settings?|user)\b/);
  });

  it("didBecomeActive removes the cover", () => {
    expect(active).toMatch(/\.removeFromSuperview\(\)/);
  });
});
