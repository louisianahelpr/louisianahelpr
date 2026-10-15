/**
 * Where Declutter measures miles FROM, without asking for location on landing.
 *
 * Declutter used to call `useUserLocation(true)` on both screens, so the
 * location dialog opened the moment the tab did, with the jobs wording
 * ("show jobs near you ... confirm Helpr arrival"). Now:
 *
 *   1. On landing it uses only what it already has, and asks nobody: a fix
 *      this device gave in this session (`getCachedUserLocation`), else the
 *      position on the profile (a past grant, or the signup ZIP's area), via
 *      the same `deriveFallbackLocation` chain the job screens fall back to.
 *   2. The device is asked only when the member taps "Use my location"
 *      (`askDevice`), with Declutter's own words (permission kind
 *      `declutter_location`). The read itself is `useUserLocation`'s, so the
 *      cache, the profile write and the fallback on refusal are unchanged.
 *
 * Guarded by src/components/declutter/declutterGateAndLocation.test.tsx.
 */
import { useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { deriveFallbackLocation, getCachedUserLocation, useUserLocation, type GeoSource } from "@/hooks/useUserLocation";

export type DeclutterOrigin =
  | { status: "pending" }
  /**
   * No position. `zipOnFile` says the profile HAS a ZIP code we could not turn
   * into an area (a failed or unknown lookup), so the screen must not tell
   * the member to "add your ZIP code".
   */
  | { status: "none"; zipOnFile: boolean }
  | { status: "ready"; lat: number; lng: number; source: GeoSource; approximate: boolean };

/**
 * `asked` turns true on the first tap of "Use my location". Each tap is a new
 * attempt (`attempts`), so a member who answered "Not now", or who has since
 * turned location on in Settings, can ask again: `canAskAgain` is true once a
 * read has finished without a device fix. A declined OS prompt on iOS is not
 * shown again; asking again then gives the same Settings message, which is
 * still the honest answer.
 */
export function useDeclutterOrigin(): {
  origin: DeclutterOrigin;
  askDevice: () => void;
  asked: boolean;
  asking: boolean;
  /** True once a read finished without a device fix: offer the button again. */
  canAskAgain: boolean;
  /** Why the device read did not give a fix, once asked (null while it loads, or if it worked). */
  deviceNote: string | null;
} {
  const [attempts, setAttempts] = useState(0);
  const asked = attempts > 0;
  const device = useUserLocation(asked, "declutter_location", attempts);
  const { profile, isLoading } = useCurrentUser();
  const [known, setKnown] = useState<DeclutterOrigin>({ status: "pending" });
  // Keyed on the fields the position comes from, not the profile object, so
  // a profile refetch that changed nothing here does not redo the ZIP lookup.
  const hasProfile = !!profile;
  const lat = profile?.latitude ?? null;
  const lng = profile?.longitude ?? null;
  const zip = profile?.zip_code ?? null;
  const parish = profile?.parish ?? null;

  useEffect(() => {
    const fix = getCachedUserLocation();
    if (fix) {
      // A coarse fix is cached too: keep its own flag, so miles from it say "about".
      setKnown({ status: "ready", lat: fix.lat, lng: fix.lng, source: "device", approximate: fix.approximate });
      return;
    }
    if (!hasProfile) {
      if (!isLoading) setKnown({ status: "none", zipOnFile: false });
      return;
    }
    let alive = true;
    const zipOnFile = !!zip;
    deriveFallbackLocation({ latitude: lat, longitude: lng, zip_code: zip, parish })
      .then((fb) => {
        if (alive) setKnown(fb ? { status: "ready", ...fb } : { status: "none", zipOnFile });
      })
      .catch((err: unknown) => {
        // The ZIP lookup failed: we just don't know where they are. The screen
        // says so in those words (zipOnFile), so this is not an error page.
        console.warn("[declutter] could not work out a position from the profile", err);
        if (alive) setKnown({ status: "none", zipOnFile });
      });
    return () => {
      alive = false;
    };
  }, [hasProfile, isLoading, lat, lng, zip, parish]);

  const origin: DeclutterOrigin =
    device.status === "ready"
      ? { status: "ready", lat: device.lat, lng: device.lng, source: device.source, approximate: device.approximate }
      : known;
  // A failed read must SAY so (silent-failure review), beside the button
  // that asks again: `useUserLocation` already words the reason (denied in Settings,
  // timed out, permission declined); a read that fell back to the ZIP/parish
  // is `ready` but not from the device.
  const deviceNote =
    asked && device.status === "error"
      ? device.message
      : asked && device.status === "ready" && device.source !== "device"
        ? "We couldn't read your device's location."
        : null;
  const asking = asked && device.status === "loading";
  const gotDeviceFix = device.status === "ready" && device.source === "device";
  const canAskAgain = asked && !asking && (device.status === "error" || (device.status === "ready" && !gotDeviceFix));
  return { origin, askDevice: () => setAttempts((n) => n + 1), asked, asking, canAskAgain, deviceNote };
}
