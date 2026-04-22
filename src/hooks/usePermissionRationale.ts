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
    title: "Camera access",
    body: "Helpr uses your camera to take before/after photos of jobs and verify your ID. Photos stay private and are only shared with the matched poster or helper.",
    cta: "Allow camera",
  },
  photos: {
    icon: "🖼️",
    title: "Photo library",
    body: "Pick existing photos from your library to show job details, completed work, or your portfolio. Helpr never reads photos you don't pick.",
    cta: "Choose from library",
  },
  location: {
    icon: "📍",
    title: "Location",
    body: "We use your location to show jobs in your parish and confirm helper arrival. Location is only checked while you're using the app.",
    cta: "Share location",
  },
  contacts: {
    icon: "👥",
    title: "Contacts",
    body: "Only used if you choose to invite a friend by phone or email. Helpr doesn't upload your contacts to any server.",
    cta: "Invite friends",
  },
  notifications: {
    icon: "🔔",
    title: "Notifications",
    body: "Get notified when a helper applies, sends a message, or marks your job complete. You can change what you receive anytime in Settings.",
    cta: "Turn on notifications",
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

/**
 * Page-level hook for components that need to request a permission.
 * Returns `request(kind, onGranted)` — shows rationale, then on confirm,
 * runs the actual native API call (which triggers the OS prompt).
 */
export function usePermissionRationale() {
  const request = useCallback(
    async (
      kind: PermissionKind,
      runNativeCall: () => Promise<void> | void,
    ): Promise<boolean> => {
      return new Promise((resolve) => {
        setState({
          open: true,
          kind,
          resolve: async (confirmed: boolean) => {
            if (!confirmed) {
              resolve(false);
              return;
            }
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
