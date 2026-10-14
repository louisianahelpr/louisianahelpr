/*
 * On iOS, the en-route tracker falling back to a foreground-only watch is a
 * BUILD defect (1.0.4 build 7119 shipped without BackgroundLocationPlugin in
 * the app target and nobody saw it). The fallback must stay, and it must log
 * once per process to error_logs. Android has no native plugin: not logged.
 * A permission refusal is a user choice: not logged.
 *
 * @mutate src/lib/enRouteLocation.ts | reportIosFallback(e); | void e;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  platform: "ios",
  startError: { code: "UNIMPLEMENTED", message: '"BackgroundLocation" plugin is not implemented on ios' } as unknown,
  report: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => state.platform },
  registerPlugin: () => ({
    addListener: () => Promise.reject(state.startError),
    start: () => Promise.reject(state.startError),
    stop: () => Promise.resolve(),
    drain: () => Promise.resolve({ positions: [] }),
    isAvailable: () => Promise.reject(state.startError),
  }),
}));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: true }));
vi.mock("@/lib/errorLogger", () => ({ report: state.report }));
vi.mock("@capacitor/geolocation", () => ({
  Geolocation: { watchPosition: () => Promise.resolve("watch-1"), clearWatch: () => Promise.resolve() },
}));

import { startEnRouteWatch, _resetIosFallbackReportForTests } from "./enRouteLocation";

async function runWatch() {
  const modes: string[] = [];
  const h = startEnRouteWatch({ onPosition: () => {}, onMode: (m) => modes.push(m) });
  await vi.waitFor(() => expect(modes.length).toBeGreaterThan(0));
  h.stop();
  // Let stop()'s own clearWatch import settle before the next watch starts.
  // Observed 2026-10-14: without this pause the second watch's dynamic import
  // got the REAL @capacitor/geolocation (its web shim threw, mode "denied").
  await new Promise((r) => setTimeout(r, 0));
  return modes;
}

describe("enRouteLocation: the iOS fallback is loud (once) and still falls back", () => {
  beforeEach(() => {
    state.report.mockReset();
    state.platform = "ios";
    state.startError = { code: "UNIMPLEMENTED", message: "not implemented" };
    _resetIosFallbackReportForTests();
  });

  it("iOS + plugin missing: falls back to foreground AND reports once per process", async () => {
    expect(await runWatch()).toEqual(["foreground"]);
    expect(await runWatch()).toEqual(["foreground"]);
    expect(state.report).toHaveBeenCalledTimes(1);
    const [err, opts] = state.report.mock.calls[0];
    expect(String((err as Error).message)).toMatch(/BackgroundLocation plugin is missing from this iOS build/);
    expect(opts).toMatchObject({ severity: "error", tags: { source: "enRouteLocation.iosFallback" }, context: { code: "UNIMPLEMENTED" } });
  });

  it("iOS + some other start failure: still reported, named as a start failure", async () => {
    state.startError = new Error("boom");
    expect(await runWatch()).toEqual(["foreground"]);
    expect(state.report).toHaveBeenCalledTimes(1);
    expect(String((state.report.mock.calls[0][0] as Error).message)).toMatch(/failed to start on iOS/);
  });

  it("Android: the fallback is expected and NOT reported", async () => {
    state.platform = "android";
    expect(await runWatch()).toEqual(["foreground"]);
    expect(state.report).not.toHaveBeenCalled();
  });

  it("iOS permission refused: a user choice, mode denied, NOT reported", async () => {
    state.startError = { code: "PERMISSION_DENIED" };
    expect(await runWatch()).toEqual(["denied"]);
    expect(state.report).not.toHaveBeenCalled();
  });
});
