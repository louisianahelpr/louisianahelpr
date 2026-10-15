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
  | { status: "none" }
  | { status: "ready"; lat: number; lng: number; source: GeoSource; approximate: boolean };

/**
 * `asked` stays true once the member has tapped "Use my location": the device
 * is asked once per visit (a declined OS prompt cannot be re-shown from the
 * page anyway), so the screen hides the button rather than leave a dead one.
 */
export function useDeclutterOrigin(): { origin: DeclutterOrigin; askDevice: () => void; asked: boolean; asking: boolean } {
  const [asked, setAsked] = useState(false);
  const device = useUserLocation(asked, "declutter_location");
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
      setKnown({ status: "ready", lat: fix.lat, lng: fix.lng, source: "device", approximate: false });
      return;
    }
    if (!hasProfile) {
      if (!isLoading) setKnown({ status: "none" });
      return;
    }
    let alive = true;
    deriveFallbackLocation({ latitude: lat, longitude: lng, zip_code: zip, parish })
      .then((fb) => {
        if (alive) setKnown(fb ? { status: "ready", ...fb } : { status: "none" });
      })
      .catch((err: unknown) => {
        // The ZIP lookup failed: we just don't know where they are, which the
        // screen says ("add your ZIP code ..."), so this is not an error page.
        console.warn("[declutter] could not work out a position from the profile", err);
        if (alive) setKnown({ status: "none" });
      });
    return () => {
      alive = false;
    };
  }, [hasProfile, isLoading, lat, lng, zip, parish]);

  const origin: DeclutterOrigin =
    device.status === "ready"
      ? { status: "ready", lat: device.lat, lng: device.lng, source: device.source, approximate: device.approximate }
      : known;
  return { origin, askDevice: () => setAsked(true), asked, asking: asked && device.status === "loading" };
}
