import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { requireBiometric } from "@/lib/biometricGate";
import { isAppLockEnabled, shouldLockOnResume } from "@/lib/appLock";
import { ensureHydrated } from "@/lib/safeStorage";
import { isNativePlatform } from "@/lib/nativeInit";
import { useAuthReady } from "@/hooks/useAuthReady";

/**
 * AppLockGate — Face ID / Touch ID cover over the whole app.
 *
 * Renders nothing unless the user opted in (Profile → Security). When locked it
 * covers the app with an opaque panel, so account data is not readable behind
 * it and does not appear in the iOS app switcher.
 *
 * Locks on:
 *   - cold start (a fresh mount with a signed-in session), and
 *   - resume from background past the grace period (see appLock.ts).
 *
 * Only gates a SIGNED-IN session: there is nothing to protect for a guest, and
 * locking the public browse surface would just look broken.
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuthReady();

  // Start locked when the setting is on and someone is signed in, so a cold
  // start never paints account data before the prompt.
  const [locked, setLocked] = useState(() => isNativePlatform && isAppLockEnabled());

  // Re-check AFTER durable storage hydrates.
  //
  // Found on device: the flag lives in Capacitor Preferences (NSUserDefaults)
  // and is mirrored back into localStorage by safeStorage.hydrate(), which
  // main.tsx deliberately races against first paint for startup speed. So the
  // synchronous read in useState above can return null even though the user
  // HAS enabled the lock — which is exactly what happens after WebKit evicts
  // localStorage (the very scenario the Preferences mirror exists for), or
  // after a reinstall. The lock then silently disabled itself, which is worse
  // than not shipping one. Awaiting the (memoized) hydrate closes that window.
  useEffect(() => {
    if (!isNativePlatform) return;
    let cancelled = false;
    void ensureHydrated().then(() => {
      if (cancelled) return;
      if (isAppLockEnabled()) setLocked(true);
    });
    return () => { cancelled = true; };
  }, []);
  const [checking, setChecking] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  /** Has the cold-start auto-prompt already fired this launch? */
  const hasAutoPrompted = useRef(false);
  const promptOpen = useRef(false);

  const attemptUnlock = useCallback(async () => {
    // Guard against stacking prompts: appStateChange can fire more than once,
    // and a second OS prompt over the first cancels it, which would leave the
    // user stuck on a locked screen they can't dismiss.
    if (promptOpen.current) return;
    promptOpen.current = true;
    setChecking(true);
    try {
      const ok = await requireBiometric("Unlock Louisiana Helpr");
      // requireBiometric returns TRUE when no biometric is enrolled, so a user
      // who enabled the lock and later removed Face ID is not bricked out.
      if (ok) {
        setLocked(false);
        backgroundedAt.current = null;
      }
    } finally {
      promptOpen.current = false;
      setChecking(false);
    }
  }, []);

  // Cold start: prompt as soon as we know there's a session to protect.
  //
  // DELIBERATE (owner decision, 2026-08-08): every fresh MOUNT prompts, even if
  // the user backgrounded only seconds ago. A WebView remount is
  // indistinguishable from a genuine cold start, and the only way to tell them
  // apart is to persist the background timestamp — which would let a stale
  // timestamp from just before an app kill skip the lock on a real cold start.
  // For a control guarding payouts we accept an occasional extra prompt rather
  // than a hole in the guarantee. Do NOT "fix" this by persisting the
  // timestamp without revisiting that tradeoff. (Observed re-prompting after a
  // ~5s background in the simulator; may be a simctl resume artifact rather
  // than real-device behaviour — unverified on hardware.)
  useEffect(() => {
    if (!isNativePlatform) return;
    if (!user) {
      // Signed out (or still resolving) — nothing to lock. Clear so a later
      // sign-in on this same launch doesn't inherit a stale locked state.
      setLocked(false);
      return;
    }
    // Auto-prompt ONLY on the first locked render of this launch (the cold
    // start), never on later locked transitions.
    //
    // This effect used to list `locked` as a dependency, so it re-ran every
    // time the cover went up — including the `setLocked(true)` in the
    // appStateChange handler that covers the app on the way OUT. The result:
    // pulling down the notification shade raised the cover, this effect saw
    // locked=true and fired Face ID immediately, so a two-second peek at
    // notifications demanded biometrics. The 60s grace window in
    // shouldLockOnResume never got a say, because the prompt happened on
    // BACKGROUND, not on resume.
    //
    // The resume path already prompts correctly on its own (see the
    // appStateChange listener below), so this only ever needed to cover the
    // cold-start case it was written for.
    if (isAppLockEnabled() && locked && !hasAutoPrompted.current) {
      hasAutoPrompted.current = true;
      void attemptUnlock();
    }
  }, [user, locked, attemptUnlock]);

  // Resume from background.
  useEffect(() => {
    if (!isNativePlatform) return;
    let cancelled = false;
    let remove: (() => void) | undefined;

    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) {
            backgroundedAt.current = Date.now();
            // Cover immediately on the way OUT so the app-switcher snapshot
            // shows the lock panel, not the user's jobs and messages.
            if (isAppLockEnabled() && user) setLocked(true);
            return;
          }
          // A null timestamp here means we never actually backgrounded, so this
          // is NOT a resume — do not lock.
          //
          // Found on device: presenting the Face ID sheet (from this gate's own
          // toggle, or from any requireBiometric() money action like instant
          // payout) fires `isActive: true` with NO preceding `isActive: false`.
          // Passing the still-null timestamp into shouldLockOnResume hit its
          // cold-start branch, so authenticating immediately re-locked the app
          // and prompted AGAIN — an endless double-prompt on every biometric
          // action. Cold start is already covered by the mount effect above;
          // this listener only ever handles genuine background→foreground.
          if (backgroundedAt.current === null) return;

          if (shouldLockOnResume(backgroundedAt.current) && user) {
            setLocked(true);
            void attemptUnlock();
          } else {
            // Inside the grace window — drop the cover without a prompt.
            setLocked(false);
            backgroundedAt.current = null;
          }
        });
        if (cancelled) { handle.remove(); return; }
        remove = () => handle.remove();
      } catch {
        /* plugin unavailable — leave the app usable rather than stuck locked */
      }
    })();

    return () => {
      cancelled = true;
      remove?.();
    };
  }, [user, attemptUnlock]);

  if (!locked) return <>{children}</>;

  return (
    <>
      {/* Children stay mounted so unlocking restores the exact prior screen and
          in-flight queries, rather than remounting the whole tree. */}
      <div aria-hidden className="pointer-events-none select-none opacity-0">
        {children}
      </div>
      {/* bg-premium-page is a CLASS, not a design token — there is no
          `--premium-page` variable, so an inline hsl(var(--premium-page))
          would render transparent and leak account data behind the lock. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="App locked"
        // Content is anchored in thirds rather than dead-centred, and the
        // container carries the top safe-area inset.
        //
        // `justify-center` with no inset put the heading exactly where iOS
        // draws the Face ID sheet, so on shorter devices the two collided —
        // observed on an iPhone 17 Pro simulator, not theoretical. Pinning the
        // mark + heading to the upper third and the button to the lower third
        // leaves the OS somewhere to land.
        className="bg-premium-page fixed inset-0 z-[100] flex flex-col items-center px-8"
        style={{
          paddingTop: "max(var(--safe-area-top, 0px), 1rem)",
          paddingBottom: "max(var(--safe-area-bottom, 0px), 1rem)",
        }}
      >
        {/* Upper third — the mark, and nothing else.
            The heading and subline were removed deliberately (owner decision):
            iOS is about to present its own Face ID sheet, which names itself and
            states what it wants, so a greeting underneath it is a second voice
            saying less. The old subline ("your jobs and payouts") also only
            described half the app — every account both posts and works, and a
            poster has no payouts — so it read as slightly wrong to whichever
            side of the app you were using that day.

            The h1 survives as sr-only: a screen-reader user still needs the
            screen to announce itself, and the emblem is decorative. */}
        <div className="flex flex-1 flex-col items-center justify-end pb-6">
          {/* The real Helpr mark, not a generic padlock glyph. */}
          <img
            src="/helpr-splash-icon.png"
            alt=""
            aria-hidden
            className="h-20 w-20 object-contain"
          />
          <h1 className="sr-only">Louisiana Helpr is locked</h1>
        </div>

        {/* Lower third — the single action. */}
        <div className="flex flex-1 flex-col items-center justify-start pt-2">
          <Button variant="primary" onClick={() => void attemptUnlock()} disabled={checking}>
            {checking ? "Unlocking…" : "Unlock"}
          </Button>
        </div>
      </div>
    </>
  );
}
