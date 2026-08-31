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

export type PermissionKind = "camera" | "photos" | "location" | "contacts" | "notifications";

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
    body: "Helpr uses your camera to take before/after photos of jobs and verify your ID. Photos stay private and are only shared with the matched poster or Helpr.",
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
    body: "We use your location to show jobs near you and confirm Helpr arrival. Location is only checked while you're using the app.",
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
    body: "Get notified when a Helpr applies, sends a message, or marks your job complete. You can change what you receive anytime in Settings.",
    cta: "Turn On Notifications",
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

// Session-scoped record of which permission kinds have already shown
// the rationale dialog AND been confirmed. We only short-circuit on
// confirm — if the user said "Not now," we'll show the dialog again
// on the next ask so they can change their mind.
const SESSION_KEY = "__helpr_rationale_confirmed";

function readConfirmedSet(): Set<PermissionKind> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as PermissionKind[]);
  } catch {
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
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // sessionStorage unavailable in private mode / SSR — ignore.
  }
}

/**
 * Page-level hook for components that need to request a permission.
 * Returns `request(kind, onGranted)` — shows rationale on first ask,
 * then on confirm runs the actual native API call (which triggers
 * the OS prompt). Subsequent asks for the same kind in the same
 * session skip the rationale (user has already opted in once).
 */
export function usePermissionRationale() {
  const request = useCallback(
    async (
      kind: PermissionKind,
      runNativeCall: () => Promise<void> | void,
    ): Promise<boolean> => {
      // Already confirmed this kind in this session — skip the dialog
      // and go straight to the native call.
      if (readConfirmedSet().has(kind)) {
        try {
          await runNativeCall();
          return true;
        } catch {
          return false;
        }
      }
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
              resolve(false);
            }
          },
        });
      });
    },
    [],
  );

  return { request };
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
