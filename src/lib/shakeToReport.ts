// Shake-to-report — listens for a sharp device-motion shake on native/mobile
// and navigates the user to the support form pre-tagged as a bug report.
//
// Detection: spikes in accelerationIncludingGravity magnitude past a threshold.
// Throttled to fire at most once every 5 seconds.

let cleanupFn: (() => void) | null = null;

const THRESHOLD = 22;     // ~2.2g — clearly intentional, not a pocket bump
const COOLDOWN_MS = 5000;

// Never ask for motion access while the user is signing in or being gated —
// shake-to-report is an in-app shortcut, so the prompt has no context there.
const AUTH_ROUTES = [
  "/login",
  "/signup",
  "/signup-pending",
  "/forgot-password",
  "/reset-password",
  "/complete-profile",
  "/account-pending",
  "/account-denied",
  "/account-banned",
];

export function initShakeToReport(onShake: () => void) {
  if (typeof window === "undefined" || cleanupFn) return;

  // iOS 13+ requires explicit permission for DeviceMotion. We request it
  // lazily on the first user-gesture page nav so we don't get blocked.
  type DeviceMotionEventWithPermission = typeof DeviceMotionEvent & {
    requestPermission?: () => Promise<string>;
  };
  const DM = (window as { DeviceMotionEvent?: DeviceMotionEventWithPermission }).DeviceMotionEvent;
  const needsPermission = DM && typeof DM.requestPermission === "function";

  let lastFired = 0;
  const handler = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);
    if (mag < THRESHOLD) return;
    const now = Date.now();
    if (now - lastFired < COOLDOWN_MS) return;
    lastFired = now;
    onShake();
  };

  const attach = () => {
    window.addEventListener("devicemotion", handler);
    cleanupFn = () => {
      window.removeEventListener("devicemotion", handler);
      cleanupFn = null;
    };
  };

  if (needsPermission) {
    // iOS rejects requestPermission() outside a user gesture, so the ask has
    // to ride a tap — but NOT any tap, anywhere, from app boot. That version
    // fired on whatever the user touched first, which for a new arrival is the
    // email field on the login screen: their very first interaction with Helpr
    // was an unexplained "Would Like to Access Motion and Orientation" system
    // prompt, for a bug-reporting shortcut they had not been told about and
    // cannot use until they are signed in. Observed on an iOS 26 simulator.
    //
    // So the tap listener is only armed once the app says the user is actually
    // inside (see main.tsx — armed after auth, not at boot), and it ignores
    // taps on the auth routes as a second guard in case that call site moves.
    const onFirstTap = async () => {
      if (AUTH_ROUTES.some((r) => window.location.pathname.startsWith(r))) return;
      window.removeEventListener("touchend", onFirstTap);
      try {
        const res = await DM.requestPermission!();
        if (res === "granted") attach();
      } catch { /* user denied — silent */ }
    };
    window.addEventListener("touchend", onFirstTap);
  } else {
    attach();
  }
}

export function disposeShakeToReport() {
  cleanupFn?.();
}
