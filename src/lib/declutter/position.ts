/**
 * The device's position for a photo taken "at the address" (porch pickup, a
 * Helpr's pickup and drop-off). The server compares it with the private point
 * and stores only the distance; this never leaves the device otherwise.
 * Rejects with Error("location_required") when location is off or refused,
 * on the web and in the app alike (the plugin's own message is logged, never
 * shown: lh-silent-failure review #7, 2026-10-16).
 */
import { isNativePlatform } from "@/lib/nativeInit";

export async function currentPosition(): Promise<{ lat: number; lng: number }> {
  if (isNativePlatform) {
    const { Geolocation } = await import("@capacitor/geolocation");
    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12_000 });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (e) {
      console.warn("[currentPosition] native location failed:", e);
      const refused = new Error("location_required") as Error & { cause?: unknown };
      refused.cause = e;
      throw refused;
    }
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error("location_required")),
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  });
}
