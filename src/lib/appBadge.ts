/**
 * Springboard (app-icon) badge bridge.
 *
 * The in-app Messages tab badge is rendered in the DOM (see MobileNav), but
 * the OS home-screen icon badge is a separate, native-only surface. This
 * helper drives that icon badge off the live unread count so the app behaves
 * like every other messaging app: the dock icon carries the unread number
 * even while the app is closed.
 *
 * All calls are best-effort and native-only:
 *   - No-op on web (there is no springboard).
 *   - Guarded by Badge.isSupported() so a device/permission that doesn't
 *     support badges never throws on a hot path.
 *   - Swallows errors — a failed badge update must never break navigation
 *     or message sending.
 */
import { isNativePlatform } from "@/lib/nativeInit";

export async function setAppIconBadge(count: number): Promise<void> {
  if (!isNativePlatform) return;
  try {
    const { Badge } = await import("@capawesome/capacitor-badge");
    const { isSupported } = await Badge.isSupported();
    if (!isSupported) return;
    const safe = Math.max(0, Math.floor(count) || 0);
    if (safe === 0) {
      await Badge.clear();
    } else {
      await Badge.set({ count: safe });
    }
  } catch {
    /* best-effort — the springboard badge isn't worth failing a render */
  }
}

export async function clearAppIconBadge(): Promise<void> {
  return setAppIconBadge(0);
}
