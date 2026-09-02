import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * The four cases the owner asked to see, driven end to end through the real
 * hook rather than a mocked one — the decision IS the feature, so mocking
 * `useVersionCheck` would test nothing but JSX.
 *
 * Only two things are faked, and both are things that do not exist in jsdom:
 * the platform flag (`isNativePlatform`, a module-scope const read from
 * `window.Capacitor`) and the `@capacitor/app` plugin's `getInfo()`. The
 * settings read goes through the real `lib/minSupportedBuild.ts` against a
 * mocked PostgREST call, so the fail-open path exercised here is the shipped
 * one.
 *
 * Case 4 is the one worth reading twice. It is the OPPOSITE of the default
 * instinct for a gate, and the reason is that this gate cannot be un-stuck
 * remotely: if a failed settings read blocked the app, a Supabase blip would
 * brick every install at once and the fix would need App Review — the exact
 * situation force-update exists to rescue.
 */

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const getInfo = vi.fn<(...args: unknown[]) => unknown>();
const addListener = vi.fn<(...args: unknown[]) => unknown>(async () => ({ remove: vi.fn() }));
vi.mock("@capacitor/app", () => ({
  App: {
    getInfo: (...args: unknown[]) => getInfo(...args),
    addListener: (...args: unknown[]) => addListener(...args),
  },
}));

let native = true;
vi.mock("@/lib/nativeInit", () => ({
  get isNativePlatform() {
    return native;
  },
}));

import { ForceUpdateGate } from "./ForceUpdateGate";
import { resetMinSupportedBuildCache } from "@/lib/minSupportedBuild";

const APP_MARKER = "the app rendered";
const renderGate = () =>
  render(
    <ForceUpdateGate>
      <div>{APP_MARKER}</div>
    </ForceUpdateGate>,
  );

/** The app is reachable — the only outcome that matters for a fail-open case. */
const expectAppRendered = async () => {
  await waitFor(() => expect(screen.getByText(APP_MARKER)).toBeInTheDocument());
  expect(screen.queryByText(/Update Helpr to continue/i)).not.toBeInTheDocument();
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  native = true;
  rpc.mockReset();
  getInfo.mockReset();
  addListener.mockClear();
  resetMinSupportedBuildCache();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // The shipping binary. CFBundleVersion 5906 / MARKETING_VERSION 1.0.4 —
  // ios/App/App/Info.plist:24 and ios/App/App.xcodeproj/project.pbxproj.
  getInfo.mockResolvedValue({ name: "Helpr", id: "com.louisianahelpr.app", build: "5906", version: "1.0.4" });
});

afterEach(() => {
  warn.mockRestore();
});

describe("ForceUpdateGate — the four cases", () => {
  it("1. build ABOVE the minimum: the app loads", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: 5000 }], error: null });
    renderGate();
    await expectAppRendered();
  });

  it("1b. build EQUAL to the minimum: the app loads (the threshold is inclusive)", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: 5906 }], error: null });
    renderGate();
    await expectAppRendered();
  });

  it("2. build BELOW the minimum: blocked, and the app is not rendered behind it", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: 6000 }], error: null });
    renderGate();
    await waitFor(() =>
      expect(screen.getByText(/Update Helpr to continue/i)).toBeInTheDocument(),
    );
    // Unmounted, not hidden — a build we have decided is broken must stop
    // polling, stop writing, and stop showing account data in the app switcher.
    expect(screen.queryByText(APP_MARKER)).not.toBeInTheDocument();
  });

  it("3. min_supported_build = 0: the gate is off and the app loads", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: 0 }], error: null });
    renderGate();
    await expectAppRendered();
  });

  it("4. the settings read FAILS: the app loads — fail open", async () => {
    rpc.mockRejectedValue(new Error("network down"));
    renderGate();
    await expectAppRendered();
  });

  it("4b. the RPC returns an error object: the app loads", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    renderGate();
    await expectAppRendered();
  });

  it("4c. the column has not deployed yet: the app loads", async () => {
    rpc.mockResolvedValue({ data: [{ platform_fee_percent: 15 }], error: null });
    renderGate();
    await expectAppRendered();
  });
});

describe("ForceUpdateGate — the other ways it must let people in", () => {
  it("never blocks on the web, and does not even ask", async () => {
    native = false;
    // Deliberately armed to block. The web app has no build number, updates on
    // reload, and hosts /admin — which is where the threshold gets lowered
    // again. Blocking it would take out the fix.
    rpc.mockResolvedValue({ data: [{ min_supported_build: 999_999 }], error: null });
    renderGate();
    await expectAppRendered();
    expect(rpc).not.toHaveBeenCalled();
    expect(getInfo).not.toHaveBeenCalled();
  });

  it("does not block when the build number cannot be read", async () => {
    getInfo.mockRejectedValue(new Error("unimplemented"));
    rpc.mockResolvedValue({ data: [{ min_supported_build: 999_999 }], error: null });
    renderGate();
    await expectAppRendered();
  });

  it("does not block on a dotted CFBundleVersion it cannot honestly compare", async () => {
    getInfo.mockResolvedValue({ build: "1.0.4", version: "1.0.4" });
    rpc.mockResolvedValue({ data: [{ min_supported_build: 6000 }], error: null });
    renderGate();
    await expectAppRendered();
  });

  it("re-checks on foreground, not only on a cold start", async () => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: 0 }], error: null });
    renderGate();
    await expectAppRendered();
    await waitFor(() =>
      expect(addListener).toHaveBeenCalledWith("resume", expect.any(Function)),
    );
  });
});

describe("ForceUpdateGate — the block screen is not a dead end", () => {
  beforeEach(() => {
    rpc.mockResolvedValue({ data: [{ min_supported_build: 6000 }], error: null });
  });

  it("offers the App Store as the primary, glossy action", async () => {
    renderGate();
    const link = await screen.findByRole("link", { name: /Update on the App Store/i });
    expect(link).toHaveAttribute("href", "https://apps.apple.com/us/app/helpr/id6754470134");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    // Gloss asserted by CLASS here only because jsdom computes no gradients;
    // the real assertion is the computed `background-image` read in Chrome,
    // per the two documented ways this app has silently lost the gloss.
    expect(link.className).toContain("btn-grad-primary");
  });

  it("offers support with the diagnosis pre-filled, so the block is reachable past", async () => {
    renderGate();
    const support = await screen.findByRole("link", { name: /admin@louisianahelpr\.com/i });
    const href = support.getAttribute("href") ?? "";
    expect(href.startsWith("mailto:admin@louisianahelpr.com")).toBe(true);
    expect(decodeURIComponent(href)).toContain("Installed build: 5906");
    expect(decodeURIComponent(href)).toContain("Required build: 6000");
  });

  it("shows both numbers in plain text for a user reading them out", async () => {
    renderGate();
    expect(await screen.findByText(/Installed build 5906 · requires 6000/)).toBeInTheDocument();
  });

  it("offers no way to continue into the app — the owner asked for a hard block", async () => {
    renderGate();
    await screen.findByText(/Update Helpr to continue/i);
    expect(screen.queryByText(/continue anyway|skip|dismiss|not now/i)).not.toBeInTheDocument();
  });

  it("is announced as a modal dialog with a name", async () => {
    renderGate();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName(/Update Helpr to continue/i);
  });
});
