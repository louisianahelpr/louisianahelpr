// Shake-to-report — listens for a sharp device-motion shake on native/mobile
// and navigates the user to the support form pre-tagged as a bug report.
//
// Detection: spikes in accelerationIncludingGravity magnitude past a threshold.
// Throttled to fire at most once every 5 seconds.

let cleanupFn: (() => void) | null = null;

const THRESHOLD = 22;     // ~2.2g — clearly intentional, not a pocket bump
const COOLDOWN_MS = 5000;

export function initShakeToReport(onShake: () => void) {
  if (typeof window === "undefined" || cleanupFn) return;

  // iOS 13+ requires explicit permission for DeviceMotion. We request it
  // lazily on the first user-gesture page nav so we don't get blocked.
  const DM = (window as any).DeviceMotionEvent;
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
    // Defer permission ask until the first tap — iOS rejects calls outside a gesture.
    const onFirstTap = async () => {
      window.removeEventListener("touchend", onFirstTap);
      try {
        const res = await DM.requestPermission();
        if (res === "granted") attach();
      } catch { /* user denied — silent */ }
    };
    window.addEventListener("touchend", onFirstTap, { once: true });
  } else {
    attach();
  }
}

export function disposeShakeToReport() {
  cleanupFn?.();
}
