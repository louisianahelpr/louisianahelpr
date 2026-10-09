import { useCallback, useRef, useState } from "react";
import { signOutWithPushCleanup } from "@/lib/authSignOut";

type SignOutResult = Awaited<ReturnType<typeof signOutWithPushCleanup>>;

export interface SignOutActionOptions {
  /** Omitted: this device only (the helper's default). "global": every device. */
  scope?: "global" | "local";
  /** Runs once sign-out has finished (navigate away, toast on error, close a dialog). */
  after?: (result: SignOutResult | undefined) => void | Promise<void>;
}

/**
 * The one way a PRESSED Log Out / Sign Out button signs out.
 *
 * Owner, 2026-10-09: "I pressed Log Out and nothing happened." The Log Out
 * dialog closed on the press, then sign-out awaited the network with nothing
 * on screen. `signOutWithPushCleanup` now caps every network step; this hook is
 * the other half: `signingOut` is true from the press until sign-out finishes,
 * so the button reads "Logging Out…" and is disabled, and a second press while
 * the first is running is ignored (the ref, not the state, guards it: two taps
 * in one frame both see the stale `false` state).
 *
 * Callers bind `signingOut` to `disabled` AND the label; the class guard
 * src/test/signOutButtonsShowProgress.test.ts checks every caller does.
 */
export function useSignOutAction() {
  const [signingOut, setSigningOut] = useState(false);
  const pending = useRef(false);

  const signOut = useCallback(async ({ scope, after }: SignOutActionOptions = {}) => {
    if (pending.current) return undefined;
    pending.current = true;
    setSigningOut(true);
    try {
      // Never `{ scope: undefined }`: the helper spreads the options over its
      // "local" default, and an explicit undefined would erase it.
      const result = await signOutWithPushCleanup(scope ? { scope } : undefined);
      try {
        await after?.(result);
      } catch (err) {
        // Sign-out itself finished; only the follow-up (a navigate, a toast)
        // threw. Reported, never an unhandled rejection from a click handler.
        console.error("[signOut] the after-sign-out step threw", err);
        void import("@/lib/errorLogger")
          .then(({ report }) => report(err, { severity: "error", tags: { area: "auth", op: "signOutAfter" } }))
          .catch(() => { /* Silent by design: the logger itself failed to load; the console line above still says it. */ });
      }
      return result;
    } finally {
      pending.current = false;
      setSigningOut(false);
    }
  }, []);

  return { signingOut, signOut };
}
