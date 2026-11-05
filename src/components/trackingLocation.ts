import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ArrivalVerdict } from "@/lib/arrivalGate";
import { isNativePlatform } from "@/lib/nativeInit";
import type { usePermissionRationale } from "@/hooks/usePermissionRationale";
import type { JobTrackingModel } from "./JobTracking";

/**
 * The open tracker's location reads and its arrival-verdict mirror (Q806, 2026-11-05: moved verbatim out of
 * JobTracking.tsx; no logic change). JobTracking calls this on every render with its own permission pre-prompt, the
 * en-route watch's last fix and its stamp setter, exactly the values the closures used to capture in place.
 */
export function trackingLocation({ requestPermission, lastEnRouteFixRef, setJobStamps }: {
  requestPermission: ReturnType<typeof usePermissionRationale>["request"];
  lastEnRouteFixRef: MutableRefObject<{ lat: number; lng: number; at: number } | null>;
  setJobStamps: Dispatch<SetStateAction<JobTrackingModel["jobStamps"]>>;
}) {
  const getLocation = async (): Promise<{ lat: number; lng: number } | null> => {
    if (!isNativePlatform && !navigator.geolocation) return null;
    let location: { lat: number; lng: number } | null = null;
    // Pre-prompt before the first OS dialog this session, so the helper
    // sees a friendly "we use your location to confirm arrival" message
    // before iOS shows its system alert.
    await requestPermission("location", async () => {
      // On native (iOS/Android) read through the Capacitor Geolocation
      // plugin only — falling through to the WKWebView navigator.geolocation
      // shim fires a SECOND "localhost would like to use your location"
      // prompt on top of the OS-native one.
      if (isNativePlatform) {
        try {
          const { Geolocation } = await import("@capacitor/geolocation");
          const pos = await Geolocation.getCurrentPosition({ timeout: 10000 });
          location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch {
          /* denied / unavailable — leave location null */
        }
        return;
      }
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            resolve();
          },
          () => resolve(),
          { timeout: 10000 },
        );
      });
    });
    return location;
  };

  /**
   * Same read as `getLocation`, but it KEEPS THE REASON it failed.
   *
   * `getLocation` deliberately swallows every failure into `null` because its
   * caller (the `arrived` transition) proceeds either way — the claim is
   * stamped whether or not a fix arrives. The retry below is the opposite: a
   * failed fix is the ONLY thing it has to report, and "we couldn't get your
   * location" is useless to a helper whose real problem is that they tapped
   * Don't Allow. Permission-denied gets its own sentence naming Settings.
   */
  const getLocationOutcome = async (): Promise<
    { lat: number; lng: number } | { error: "denied" | "unavailable" }
  > => {
    if (!isNativePlatform && !navigator.geolocation) return { error: "unavailable" };
    let location: { lat: number; lng: number } | null = null;
    let denied = false;
    await requestPermission("location", async () => {
      if (isNativePlatform) {
        try {
          const { Geolocation } = await import("@capacitor/geolocation");
          const pos = await Geolocation.getCurrentPosition({ timeout: 15000, maximumAge: 30000 });
          location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch (e) {
          // Capacitor surfaces a denial as a message, not a code, on iOS.
          const msg = String((e as { message?: string } | null)?.message ?? e ?? "");
          if (/denied|permission|authorized|authoriz/i.test(msg)) denied = true;
        }
        return;
      }
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            resolve();
          },
          (err) => {
            // 1 === PERMISSION_DENIED
            if (err?.code === 1) denied = true;
            resolve();
          },
          { timeout: 15000, maximumAge: 30000 },
        );
      });
    });
    if (location) return location;
    // A one-shot fix can time out while the en-route watch is still receiving
    // positions (seen on prod 2026-09-14: a helper 2,099 mi away got "we
    // couldn't get your location" and the RPC was never called, while the
    // status line above read "2099 mi from job"). Use the watch's own last
    // point if it is under a minute old — the SERVER still measures the
    // distance and refuses anything outside 500ft, so this can only turn a
    // vague "no location" into the real answer.
    const recent = lastEnRouteFixRef.current;
    if (!denied && recent && Date.now() - recent.at < 60_000) return { lat: recent.lat, lng: recent.lng };
    return { error: denied ? "denied" : "unavailable" };
  };

  /**
   * WRITE A VERDICT ONTO THE MIRRORED STAMPS.
   *
   * ONE place, because both callers of `mark_helper_arrival` (the Arrived
   * transition and the Location retry) have to apply the same three facts in
   * the same order, and they used to disagree: the transition stamped
   * `arrivalVerifiedAt` unconditionally — on a bare claim as well as a verified
   * one — which painted the tracker's proof line "Arrival GPS-verified" for a
   * helper whose phone had produced no fix at all.
   *
   * Never DOWNGRADES: every field is `prev ?? …`, matching the RPC, which
   * cannot un-verify an arrival either (20260919155016).
   */
  const applyArrivalVerdict = (v: ArrivalVerdict) => {
    const nowIso = new Date().toISOString();
    setJobStamps((prev) => ({
      ...prev,
      // ALWAYS: the check-in is recorded on every call now. This is the stamp
      // that makes the poster's "Confirm they've arrived" control appear, so
      // failing to mirror it here is what leaves the Helpr staring at a CTA
      // telling them to ask for a tap the other side cannot yet offer.
      arrivedAt: prev.arrivedAt ?? nowIso,
      // ONLY when the server actually measured them at the job.
      arrivalVerifiedAt: v.verified ? (prev.arrivalVerifiedAt ?? nowIso) : prev.arrivalVerifiedAt,
      nearMissAt: v.basis === "near_miss" ? (prev.nearMissAt ?? nowIso) : prev.nearMissAt,
      posterConfirmedArrivalAt: v.posterConfirmed
        ? (prev.posterConfirmedArrivalAt ?? nowIso)
        : prev.posterConfirmedArrivalAt,
    }));
  };

  /* `retryArrivalVerification` LIVED HERE and is gone (owner, 2026-09-19).
     The "Try my location again" chip it backed is removed from the action row;
     the same operation now runs from the pull-to-refresh gesture on My Jobs,
     in `src/lib/arrivalRefresh.ts`, gated on an arrival that is recorded and
     unverified. That module carries the reasoning, the conservatism rules, and
     the note on why the replacement had to exist before the chip could go.

     `getLocationOutcome` and `applyArrivalVerdict` above are UNCHANGED and
     still have their other caller — the "I've arrived" transition — so nothing
     was deleted with this beyond the retry itself. */

  return { getLocation, getLocationOutcome, applyArrivalVerdict };
}
