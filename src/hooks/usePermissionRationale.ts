/**
 * usePermissionRationale — show a friendly "why we need this" dialog
 * BEFORE triggering the native iOS/Android permission prompt.
 *
 * Apple App Review specifically looks for this. Hitting users with a cold
 * native prompt ("Helpr Would Like to Access the Camera") with no context
 * is a common rejection reason and tanks accept rates.
 *
 * Usage:
 *   const { request } = usePermissionRationale();
 *   const granted = await request("camera", takePhoto);
 *   if (granted) {
 *     // photo was taken
 *   }
 */
import { useState, useCallback } from "react";
import { isNativePlatform } from "@/lib/nativeInit";

export type PermissionKind =
  | "camera"
  | "photos"
  | "location"
  | "declutter_location"
  | "contacts"
  | "notifications"
  | "notifications_home_screen";

interface RationaleCopy {
  icon: string;
  title: string;
  body: string;
  cta: string;
}

const COPY: Record<PermissionKind, RationaleCopy> = {
  camera: {
    icon: "📷",
    title: "Camera Access",
    body: "Helpr uses your camera to take before/after photos of jobs. Photos stay private and are only shared with the other person on the job.",
    cta: "Allow Camera",
  },
  photos: {
    icon: "🖼️",
    title: "Photo Library",
    body: "Pick existing photos from your library to show job details, completed work, or your portfolio. Helpr never reads photos you don't pick.",
    cta: "Choose from Library",
  },
  location: {
    icon: "📍",
    title: "Location",
    // Says "saved to your profile" because, as of 2026-09-06, it is: the
    // granted fix is written to profiles.latitude/longitude rather than living
    // for five minutes in memory. A rationale string that lags the behaviour
    // is the same defect class as a control that does nothing, with worse
    // consequences — so this sentence and NSLocationWhenInUseUsageDescription
    // move whenever the write path does. The last clause is a promise the
    // database keeps: get_helper_distances_from_job returns a BAND, never a
    // distance (migration 20260907051731).
    body: "We use your location to show jobs near you, rank them by how close they are, and confirm Helpr arrival. It's only checked while you're using the app, and your most recent location is saved to your profile so nearby jobs still work next time. Other people only ever see a rough distance range, never your exact location.",
    cta: "Share Location",
  },
  // Declutter's own reason for the SAME location read (useUserLocation with
  // rationale "declutter_location"): asked only when the member taps "Use my
  // location" on Declutter, never on landing, so the words are about items
  // and miles, not jobs or Helpr arrival. The saving clause is the same
  // promise as "location" above because the write path is the same one.
  declutter_location: {
    icon: "📍",
    title: "Location",
    body: "Declutter uses your location to show how far away each item is and to list the nearest items first. It's only checked while you're using the app, and your most recent location is saved to your profile. Other people never see your exact location.",
    cta: "Share Location",
  },
  contacts: {
    icon: "👥",
    title: "Contacts",
    body: "Only used if you choose to invite a friend by phone or email. Helpr doesn't upload your contacts to any server.",
    cta: "Invite Friends",
  },
  notifications: {
    icon: "🔔",
    title: "Notifications",
    // For both sides: Browse asks a member looking for work too, so it can't speak only to posters
    // (audit 2026-10-29 A2-C24).
    body: "Get notified about new jobs near you, messages, and updates on jobs you've posted or are working. You can change what you receive anytime in Settings.",
    cta: "Turn On Notifications",
  },
  // Web push (2026-10-29): iPhone and iPad Safari give web push ONLY to a site
  // added to the Home Screen (iOS 16.4+), so in a normal tab there is no prompt
  // to ask for; this sheet says how instead (src/hooks/useWebPush.ts).
  notifications_home_screen: {
    icon: "🔔",
    title: "Notifications",
    body: "To get notifications on your iPhone, add Louisiana Helpr to your Home Screen: tap the Share button, choose Add to Home Screen, then open Helpr from your Home Screen and turn notifications on.",
    cta: "Got It",
  },
};

interface State {
  open: boolean;
  kind: PermissionKind | null;
  resolve: ((granted: boolean) => void) | null;
}

let externalState: State = { open: false, kind: null, resolve: null };
const listeners = new Set<(s: State) => void>();
const setState = (next: State) => {
  externalState = next;
  listeners.forEach((fn) => fn(next));
};

// Record of which permission kinds have already shown the rationale dialog
// AND been confirmed, kept on the DEVICE (localStorage), not the tab. Audit
// 2026-10-28 part 4, F13 + F34: a Helpr's day-of steps (on my way, arrived,
// done) each read the location, and with a per-tab record the "Location"
// explainer came back on every step once the app had been reopened, four
// times in one job, ending on "Mark Complete". It explains the OS prompt the
// first time it is needed; after a yes the OS remembers the answer itself.
// We only short-circuit on confirm: if the user said "Not now," we show the
// dialog again on the next ask so they can change their mind.
const CONFIRMED_KEY = "__helpr_rationale_confirmed";

function readConfirmedSet(): Set<PermissionKind> {
  try {
    const raw = localStorage.getItem(CONFIRMED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as PermissionKind[]);
  } catch {
    // Silent by design: an unreadable record means "nothing confirmed yet",
    // so the user is shown the rationale dialog again. That is the
    // conservative direction — it can only ever ask more, never skip the
    // explanation before an OS permission prompt.
    return new Set();
  }
}

/**
 * Mark a permission kind as already explained, so the next `request()` skips
 * the rationale dialog and goes straight to the OS prompt.
 *
 * Exported for surfaces that ARE the rationale. The push nudge toast
 * ("Turn on notifications?" · Enable) is the case this exists for: tapping
 * Enable there used to open the rationale dialog, which asked the same
 * question a second time with the same two buttons (owner, 2026-08-30: "not
 * needed. i also clicked to turn on in the toast"). The user has already been
 * told why and already said yes; the only thing left to show them is the OS
 * prompt.
 */
export function markRationaleConfirmed(kind: PermissionKind) {
  markConfirmed(kind);
}

function markConfirmed(kind: PermissionKind) {
  try {
    const set = readConfirmedSet();
    set.add(kind);
    localStorage.setItem(CONFIRMED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // localStorage unavailable in private mode / SSR — ignore.
  }
}

/**
 * A2-C23 (app audit 2026-10-28): opening the Browse map showed the "Location"
 * explainer over a blurred map although the browser had already granted
 * location. The explainer warms up the OS prompt; when the OS answer is
 * already yes there is no prompt left to explain. Only location is probed.
 */
const LOCATION_KINDS: ReadonlySet<PermissionKind> = new Set(["location", "declutter_location"]);

async function webGeolocationGranted(): Promise<boolean> {
  const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
  return status?.state === "granted";
}

async function nativeLocationGranted(): Promise<boolean> {
  // Destructured, never awaited as the plugin object (thenable assimilation).
  const { Geolocation } = await import("@capacitor/geolocation");
  const p = await Geolocation.checkPermissions();
  return p.location === "granted" || p.coarseLocation === "granted";
}

/**
 * Null when there is nothing to ask (not a location kind, or no permissions
 * API on this browser), so those callers keep the synchronous path below.
 * A probe that throws reads as "not granted": the explainer shows, which is
 * the conservative direction (it can only ask more, never skip it).
 */
function osAlreadyGranted(kind: PermissionKind): Promise<boolean> | null {
  if (!LOCATION_KINDS.has(kind)) return null;
  if (!isNativePlatform && (typeof navigator === "undefined" || !navigator.permissions?.query)) return null;
  return (isNativePlatform ? nativeLocationGranted() : webGeolocationGranted()).catch((err: unknown) => {
    console.warn("[permissions] could not read the location permission; explaining first", err);
    return false;
  });
}

/**
 * Page-level hook for components that need to request a permission.
 * Returns `request(kind, onGranted)` — shows rationale on first ask,
 * then on confirm runs the actual native API call (which triggers
 * the OS prompt). Subsequent asks for the same kind in the same
 * device skip the rationale (user has already opted in once).
 */
export function usePermissionRationale() {
  const request = useCallback(
    async (
      kind: PermissionKind,
      runNativeCall: () => Promise<void> | void,
    ): Promise<boolean> => {
      // Already confirmed this kind on this device — skip the dialog
      // and go straight to the native call.
      if (readConfirmedSet().has(kind)) {
        try {
          await runNativeCall();
          return true;
        } catch {
          // Silent by design: `runNativeCall` is the caller's own OS
          // permission request, and the overwhelmingly common rejection is
          // the user declining. `false` is the honest answer and the caller
          // owns what to show; anything worth reporting belongs there, where
          // the specific permission is known.
          return false;
        }
      }
      const probe = osAlreadyGranted(kind);
      if (!probe) return explainThenRun(kind, runNativeCall);
      const granted = await probe;
      if (granted) {
        // The OS already said yes (A2-C23): nothing to explain, and later
        // asks take the fast path above.
        markConfirmed(kind);
        try {
          await runNativeCall();
          return true;
        } catch {
          // Silent by design — same as the fast path above: `false` is the
          // honest answer and the caller owns what to show.
          return false;
        }
      }
      return explainThenRun(kind, runNativeCall);
    },
    [],
  );

  return { request };
}

/**
 * Always show the explainer for `kind`, even when it was confirmed before, and
 * run `run` only on a yes (inside the sheet's button tap). For asks that ARE
 * the moment to explain, such as web push after a job action (useWebPush.ts).
 */
export function explainPermission(kind: PermissionKind, run: () => Promise<void> | void): Promise<boolean> {
  return explainThenRun(kind, run);
}

/** Open the explainer; on a yes, record it and run the OS call. */
function explainThenRun(kind: PermissionKind, runNativeCall: () => Promise<void> | void): Promise<boolean> {
  return new Promise((resolve) => {
    setState({
      open: true,
      kind,
      resolve: async (confirmed: boolean) => {
        if (!confirmed) {
          resolve(false);
          return;
        }
        markConfirmed(kind);
        try {
          await runNativeCall();
          resolve(true);
        } catch {
          // Silent by design — same as the fast path in request(): a declined
          // OS prompt is the normal outcome, and the caller decides what to
          // do with `false`.
          resolve(false);
        }
      },
    });
  });
}

/**
 * Subscriber for the global rationale dialog component.
 * Mounted once at the app root; reads state, renders the dialog.
 */
export function usePermissionRationaleState() {
  const [state, setLocal] = useState<State>(externalState);
  const subscribe = useCallback((fn: (s: State) => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  // sync
  if (state !== externalState) setLocal(externalState);
  return { state, subscribe, copy: state.kind ? COPY[state.kind] : null, setState };
}

export const __resolveRationale = (granted: boolean) => {
  externalState.resolve?.(granted);
  setState({ open: false, kind: null, resolve: null });
};
