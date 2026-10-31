// Shake-to-report — listens for a sharp device-motion shake in the native app
// and navigates the user to the support form pre-tagged as a bug report.
//
// Detection: spikes in accelerationIncludingGravity magnitude past a threshold.
// Throttled to fire at most once every 5 seconds.
//
// LEAD-SHAKE-PROMPT (owner, 10-31): iPhone Safari asked "louisianahelpr.com
// Would Like to Access Motion and Orientation" on the first tap of EVERY visit
// (Safari does not remember the answer per site). So:
//   - the website never runs shake-to-report and never asks (isNativePlatform);
//   - in the app it is OFF until the member turns on the switch in
//     You > Settings > Account and security, which explains it; the motion ask
//     rides that tap. Guard: src/test/shakeToReportNeverAsksOnWeb.test.ts.

import { isNativePlatform } from "@/lib/nativeInit";
import { SELL_ONE_PATH } from "@/lib/declutter/sellChooser";

let cleanupFn: (() => void) | null = null;
let shakeHandler: (() => void) | null = null;
let armedTap: (() => void) | null = null;

// A real shake, not a put-down (owner, 10-31: setting the phone down after
// adding 3 photos in Sell a bunch fired it and lost the work). A put-down is ONE
// jolt; a shake is several hard swings back and forth. So: at least SHAKE_PEAKS
// separate peaks over THRESHOLD (~3.2g, was one peak over ~2.2g), each at least
// PEAK_GAP_MS apart, all inside SHAKE_WINDOW_MS.
export const THRESHOLD = 32;
export const SHAKE_PEAKS = 4;
export const PEAK_GAP_MS = 80;
export const SHAKE_WINDOW_MS = 1200;
const COOLDOWN_MS = 5000;

// Screens where a member builds something (posting, selling, editing, writing
// to support). A shake there never fires, and neither does one on any screen
// with typed text, a chosen file or a photo preview (pageHasUnsavedInput):
// the report opens a new page, which would throw that work away.
const FORM_ROUTES = [
  // Every Sell flow (one item, a bunch, moving out, the chooser) lives under this path.
  SELL_ONE_PATH,
  "/post-job",
  // The two quote forms (App.tsx /quotes/request/:id, /quotes/send/:id); /quotes alone is the retired hub redirect.
  "/quotes/request/",
  "/quotes/send/",
  "/support",
  "/messages",
  "/rentals/listings/",
];
const PREF_KEY = "lh-shake-to-report";

// Never ask for motion access while the user is signing in or being gated —
// shake-to-report is an in-app shortcut, so the prompt has no context there.
const AUTH_ROUTES = [
  "/login",
  "/signup",
  "/signup-pending",
  "/forgot-password",
  "/reset-password",
  "/complete-profile",
  "/account-banned",
];

type DeviceMotionEventWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<string>;
};

function motionApi(): DeviceMotionEventWithPermission | undefined {
  return (window as { DeviceMotionEvent?: DeviceMotionEventWithPermission }).DeviceMotionEvent;
}

/** The switch exists only in the native app; the website never offers it. */
export function isShakeToReportSupported(): boolean {
  return isNativePlatform && typeof window !== "undefined" && !!motionApi();
}

/** Off unless the member turned it on in the app. Always off on the website. */
export function isShakeToReportOn(): boolean {
  if (!isShakeToReportSupported()) return false;
  try {
    return window.localStorage.getItem(PREF_KEY) === "on";
  } catch {
    // Storage blocked: treat as off (the default), so nothing asks for motion.
    return false;
  }
}

function savePref(on: boolean) {
  try {
    if (on) window.localStorage.setItem(PREF_KEY, "on");
    else window.localStorage.removeItem(PREF_KEY);
  } catch {
    // Storage blocked: the switch still works for this session; it just isn't remembered.
  }
}

/** True when leaving this screen would lose something the member made. */
export function pageHasUnsavedInput(doc: Document = document, path: string = window.location.pathname): boolean {
  if (FORM_ROUTES.some((r) => path.startsWith(r)) || /\/(edit|new)(\/|$)/.test(path)) return true;
  if (doc.querySelector('input[type="file"], img[src^="blob:"], [contenteditable="true"]')) return true;
  const fields = doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  for (const f of Array.from(fields)) {
    const type = (f.getAttribute("type") ?? "text").toLowerCase();
    if (["hidden", "checkbox", "radio", "submit", "button", "reset", "range", "color"].includes(type)) continue;
    if (f.value.trim() !== "") return true;
  }
  return false;
}

/** Counts hard swings; returns true once a sample completes a real shake. */
export function makeShakeDetector(now: () => number = Date.now) {
  let peaks: number[] = [];
  let lastFired = -Infinity;
  return (mag: number): boolean => {
    if (mag < THRESHOLD) return false;
    const t = now();
    if (t - lastFired < COOLDOWN_MS) return false;
    peaks = peaks.filter((p) => t - p <= SHAKE_WINDOW_MS);
    if (peaks.length && t - peaks[peaks.length - 1] < PEAK_GAP_MS) return false;
    peaks.push(t);
    if (peaks.length < SHAKE_PEAKS) return false;
    peaks = [];
    lastFired = t;
    return true;
  };
}

function attach() {
  if (cleanupFn) return;
  const isShake = makeShakeDetector();
  const handler = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);
    if (!isShake(mag)) return;
    if (pageHasUnsavedInput()) return;
    shakeHandler?.();
  };
  window.addEventListener("devicemotion", handler);
  cleanupFn = () => {
    window.removeEventListener("devicemotion", handler);
    cleanupFn = null;
  };
}

async function askForMotion(): Promise<boolean> {
  const DM = motionApi();
  if (!DM) return false;
  if (typeof DM.requestPermission !== "function") return true;
  try {
    return (await DM.requestPermission()) === "granted";
  } catch {
    // The throw IS the member declining (or iOS refusing outside a tap): it stays off.
    return false;
  }
}

/**
 * Boot: remember what a shake does; listen only in the app and only when the
 * member turned it on. iOS wants motion access to ride a tap, so an opted-in
 * member's first tap (outside the auth screens) re-arms it on each launch.
 */
export function initShakeToReport(onShake: () => void) {
  if (typeof window === "undefined") return;
  shakeHandler = onShake;
  if (!isShakeToReportOn() || cleanupFn || armedTap) return;
  const DM = motionApi();
  if (DM && typeof DM.requestPermission === "function") {
    const onFirstTap = async () => {
      if (AUTH_ROUTES.some((r) => window.location.pathname.startsWith(r))) return;
      window.removeEventListener("touchend", onFirstTap);
      armedTap = null;
      if (await askForMotion()) attach();
    };
    armedTap = () => window.removeEventListener("touchend", onFirstTap);
    window.addEventListener("touchend", onFirstTap);
  } else {
    attach();
  }
}

/** The Settings switch turning on (a tap, so iOS may ask). False when declined or unsupported. */
export async function turnOnShakeToReport(): Promise<boolean> {
  if (!isShakeToReportSupported()) return false;
  if (!(await askForMotion())) return false;
  savePref(true);
  attach();
  return true;
}

export function turnOffShakeToReport() {
  savePref(false);
  armedTap?.();
  armedTap = null;
  cleanupFn?.();
}

export function disposeShakeToReport() {
  cleanupFn?.();
}
