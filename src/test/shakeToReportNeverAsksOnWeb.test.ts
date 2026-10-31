/**
 * LEAD-SHAKE-PROMPT (owner, 10-31, twice):
 *  1. iPhone Safari asked "louisianahelpr.com Would Like to Access Motion and
 *     Orientation" on the first tap of every visit: shake-to-report called
 *     DeviceMotionEvent.requestPermission on the website.
 *  2. Setting the iPhone down after adding 3 photos in Sell a bunch fired it
 *     (one jolt over ~2.2g), jumped to Contact Support and lost the work.
 *
 * Proved here, with the real module and a fake DeviceMotionEvent:
 *  - WEB: no path asks for motion (boot, a tap, the switch), and nothing listens.
 *    CLASS: DeviceMotionEvent / DeviceOrientationEvent appear in exactly one
 *    source file (src/lib/shakeToReport.ts), so no other web path can ask.
 *  - APP: off by default (boot and a tap ask nothing); the Settings switch asks
 *    and turns it on.
 *  - A put-down (one hard jolt and its ringing) never fires; several hard swings do.
 *  - A shake never leaves a screen with unsaved input (Sell, a typed field, a
 *    photo preview, a chosen file).
 *
 * @mutate src/lib/shakeToReport.ts |   return isNativePlatform && typeof window !== "undefined" && !!motionApi(); |   return typeof window !== "undefined" && !!motionApi();
 * @mutate src/lib/shakeToReport.ts |     return window.localStorage.getItem(PREF_KEY) === "on"; |     return true;
 * @mutate src/lib/shakeToReport.ts | export const SHAKE_PEAKS = 4; | export const SHAKE_PEAKS = 1;
 * @mutate src/lib/shakeToReport.ts | export const THRESHOLD = 32; | export const THRESHOLD = 22;
 * @mutate src/lib/shakeToReport.ts |     if (pageHasUnsavedInput()) return; |
 * @mutate src/lib/shakeToReport.ts |   SELL_ONE_PATH, |
 * @mutate src/lib/shakeToReport.ts |   if (doc.querySelector('input[type="file"], img[src^="blob:"], [contenteditable="true"]')) return true; |
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

let native = false;
vi.mock("@/lib/nativeInit", () => ({
  get isNativePlatform() {
    return native;
  },
}));

const requestPermission = vi.fn(async () => "granted");
const listeners: string[] = [];

async function load() {
  vi.resetModules();
  return import("@/lib/shakeToReport");
}

function motion(mag: number) {
  const e = new Event("devicemotion") as Event & { accelerationIncludingGravity: { x: number; y: number; z: number } };
  e.accelerationIncludingGravity = { x: 0, y: 0, z: mag };
  window.dispatchEvent(e);
}

let clock = 1_000_000;
beforeEach(() => {
  native = false;
  requestPermission.mockClear();
  listeners.length = 0;
  window.localStorage.clear();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/home");
  (window as unknown as { DeviceMotionEvent: unknown }).DeviceMotionEvent = Object.assign(function DeviceMotionEvent() {}, { requestPermission });
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type: string, ...rest: unknown[]) => {
    listeners.push(type);
    return (add as (...a: unknown[]) => void)(type, ...rest);
  });
  clock = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
});
afterEach(async () => {
  (await import("@/lib/shakeToReport")).turnOffShakeToReport();
  vi.restoreAllMocks();
});

describe("the website never asks for motion access", () => {
  it("boot, a tap and the switch ask nothing and listen to nothing", async () => {
    const m = await load();
    m.initShakeToReport(() => {});
    window.dispatchEvent(new Event("touchend"));
    expect(m.isShakeToReportSupported()).toBe(false);
    expect(await m.turnOnShakeToReport()).toBe(false);
    window.localStorage.setItem("lh-shake-to-report", "on");
    m.initShakeToReport(() => {});
    window.dispatchEvent(new Event("touchend"));
    await Promise.resolve();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(listeners).not.toContain("devicemotion");
    expect(listeners).not.toContain("touchend");
  });

  it("CLASS: only shakeToReport.ts touches the motion APIs", () => {
    const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(500);
    const users = files.filter((f) => /\bDevice(Motion|Orientation)Event\b|\bdevicemotion\b/.test(blankComments(readFileSync(join(process.cwd(), f), "utf8"))));
    expect(users).toEqual(["src/lib/shakeToReport.ts"]);
  });
});

describe("in the app it is off until the member turns on the switch", () => {
  it("boot and a tap ask nothing by default", async () => {
    native = true;
    const m = await load();
    m.initShakeToReport(() => {});
    window.dispatchEvent(new Event("touchend"));
    await Promise.resolve();
    expect(m.isShakeToReportOn()).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(listeners).not.toContain("devicemotion");
  });

  it("the switch asks, turns it on and remembers", async () => {
    native = true;
    const m = await load();
    m.initShakeToReport(() => {});
    expect(await m.turnOnShakeToReport()).toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(m.isShakeToReportOn()).toBe(true);
    expect(listeners).toContain("devicemotion");
  });
});

describe("a put-down never fires; a real shake does, but never over unsaved input", () => {
  async function armed() {
    native = true;
    const m = await load();
    const onShake = vi.fn();
    m.initShakeToReport(onShake);
    await m.turnOnShakeToReport();
    return { m, onShake };
  }
  function shake() {
    for (let i = 0; i < 5; i++) {
      clock += 150;
      motion(38);
    }
  }

  it("one hard jolt with its ringing (a put-down) does not fire", async () => {
    const { onShake } = await armed();
    for (const mag of [70, 45, 30, 20, 12, 10]) {
      clock += 16;
      motion(mag);
    }
    clock += 2000;
    motion(60);
    expect(onShake).not.toHaveBeenCalled();
  });

  it("swings under ~3.2g do not fire", async () => {
    const { onShake } = await armed();
    for (let i = 0; i < 8; i++) {
      clock += 150;
      motion(25);
    }
    expect(onShake).not.toHaveBeenCalled();
  });

  it("several hard swings on a plain screen fire once", async () => {
    const { onShake } = await armed();
    shake();
    expect(onShake).toHaveBeenCalledTimes(1);
  });

  it("never on Sell, a typed field, a photo preview or a chosen file", async () => {
    const { m, onShake } = await armed();
    window.history.replaceState(null, "", "/declutter/sell");
    shake();
    window.history.replaceState(null, "", "/home");
    document.body.innerHTML = '<img src="blob:https://x/1" alt="">';
    clock += 6000;
    shake();
    document.body.innerHTML = '<input type="file">';
    clock += 6000;
    shake();
    document.body.innerHTML = "<textarea></textarea>";
    (document.querySelector("textarea") as HTMLTextAreaElement).value = "my couch";
    clock += 6000;
    shake();
    expect(onShake).not.toHaveBeenCalled();
    document.body.innerHTML = "";
    expect(m.pageHasUnsavedInput()).toBe(false);
  });
});
