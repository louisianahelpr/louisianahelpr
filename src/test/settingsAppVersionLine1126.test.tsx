/**
 * OTA live updates (11-26): the owner's first live-update test needs something on screen that changes when an OTA
 * bundle is applied. Settings ends with a small grey "Version 1.0.6 (8901) · Updated Nov 26, 2:15 AM" line in the
 * native app: the version and build come from the store binary (App.getInfo), "Updated" from the running web bundle's
 * OTA number (__OTA_BUNDLE__, UTC yyyymmddHHMMSS), shown in Central time. The website shows nothing.
 *
 * @mutate src/components/profile/SettingsTab.tsx |       <AppVersionLine /> |       {null}
 * @mutate src/components/profile/SettingsTab.tsx | timeZone: "America/Chicago" | timeZone: "UTC"
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@capacitor/app", () => ({ App: { getInfo: async () => ({ version: "1.0.6", build: "8901", id: "x", name: "Helpr" }) } }));

import { AppVersionLine, bundleTimeLabel } from "@/components/profile/SettingsTab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { Capacitor?: unknown }).Capacitor;
});

describe("Settings app version line (OTA)", () => {
  it("formats the OTA bundle number in Central time, 12-hour", () => {
    expect(bundleTimeLabel("20261126081500")).toBe("Nov 26, 2:15 AM");
    expect(bundleTimeLabel("dev")).toBeNull();
  });

  it("shows version, build and the bundle time in the native app", async () => {
    (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    vi.stubGlobal("__OTA_BUNDLE__", "20261126081500");
    render(<AppVersionLine />);
    expect(await screen.findByText("Version 1.0.6 (8901) · Updated Nov 26, 2:15 AM")).toBeTruthy();
  });

  it("shows nothing on the website", async () => {
    vi.stubGlobal("__OTA_BUNDLE__", "20261126081500");
    const { container } = render(<AppVersionLine />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-settings-version]")).toBeNull();
  });

  it("sits at the very bottom of Settings, after Log out", () => {
    const src = readFileSync(resolve(__dirname, "../components/profile/SettingsTab.tsx"), "utf8");
    expect(src).toMatch(/testId="logout"[^]*?<\/section>\s*<AppVersionLine \/>\s*<\/ProfileTabBody>/);
  });
});
