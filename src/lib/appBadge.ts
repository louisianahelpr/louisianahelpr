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

    // MUST check permission before ANY badge mutation.
    //
    // Every mutating method on @capawesome/capacitor-badge — set, clear,
    // increase, decrease — internally calls
    // `UNUserNotificationCenter.requestAuthorization(options: .badge)` on iOS
    // (see ios/Plugin/BadgePlugin.swift:72,96,119,142 → Badge.swift:27).
    // So even `Badge.clear()` raises the OS notification prompt.
    //
    // That is what fired the permission dialog on COLD START to a logged-out
    // guest: useNavUnreadCount calls setAppIconBadge(user ? unreadCount : 0)
    // on mount, so a guest hit the `0` path → Badge.clear() → prompt, before
    // ever touching a job. iOS grants exactly ONE prompt per install, so a
    // guest tapping "Don't Allow" there permanently killed push for that
    // install (Settings-only recovery) — and a guest cannot receive push
    // anyway, since push_tokens is keyed on user_id.
    //
    // checkPermissions() is the non-prompting read, so bailing on anything but
    // "granted" means the badge only ever updates for someone who has already
    // opted in — which is the only case where a springboard badge is even
    // meaningful. The real permission ask stays where it belongs: the
    // rationale-first flow in nativePush, at a high-intent moment.
    const { display } = await Badge.checkPermissions();
    if (display !== "granted") return;

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
