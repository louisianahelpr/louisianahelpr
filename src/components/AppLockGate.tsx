import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getBiometryLabel,
  isBiometricPromptOpen,
  requireBiometric,
} from "@/lib/biometricGate";
import {
  APP_LOCK_DEMO,
  APP_LOCK_DEMO_EMAIL,
  clearBackgroundedAt,
  isAppLockEnabled,
  isAppLockSupported,
  readBackgroundedAt,
  recordBackgroundedAt,
  shouldLockOnFreshStart,
  shouldLockOnResume,
} from "@/lib/appLock";
import { ensureHydrated } from "@/lib/safeStorage";
import { useAuthReady } from "@/hooks/useAuthReady";

/**
 * AppLockGate — Face ID / Touch ID cover over the whole app.
 *
 * Renders nothing unless the user opted in (Profile → Security). Only ever
 * gates a SIGNED-IN session: there is nothing to protect for a guest, and
 * locking the public browse surface would just look broken.
 *
 * TWO DISTINCT COVERS, which used to be conflated:
 *
 *   - the LOCK (`locked`) — the real thing. Full screen, says what it is and
 *     whose account it is, and needs a biometric to pass. Raised on a genuine
 *     cold start, and on a foreground past the grace window.
 *
 *   - the PRIVACY SHIELD (`covered`) — an opaque panel with no copy and
 *     nothing to tap. Raised whenever the app merely stops being frontmost, so
 *     the iOS app-switcher snapshot shows the Helpr mark rather than the user's
 *     jobs and messages, and dropped again the moment we are frontmost. It is
 *     NOT a lock and never prompts.
 *
 * Conflating them is what produced the owner's complaint ("Does not need to
 * lock every time I swipe out"): every notification-shade pull and every app
 * switch raised the full lock. `appStateChange` on iOS is
 * didBecomeActive/willResignActive, which fires for the shade, Control Centre,
 * a call banner, and the Face ID sheet itself — none of which are
 * backgrounding. The lock now keys off `pause`/`resume`
 * (didEnterBackground/willEnterForeground) and a persisted timestamp; see
 * lib/appLock.ts for the full analysis.
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const { user: authUser, isReady: authReady } = useAuthReady();
  const supported = isAppLockSupported();

  // DEV harness only — see APP_LOCK_DEMO in lib/appLock.ts. The gate is a no-op
  // for a signed-out visitor by design, so `?app_lock_demo=1` stands in a fake
  // session and lets the whole background/resume lifecycle be driven and
  // measured in a browser. Both constants fold to `false`/unused in production,
  // where this collapses to plain `authUser` / `authReady`.
  const user =
    authUser ?? (APP_LOCK_DEMO ? ({ email: APP_LOCK_DEMO_EMAIL } as { email: string }) : null);
  const isReady = authReady || APP_LOCK_DEMO;

  // Start from the durable decision, not from "always locked". On a genuine
  // cold start shouldLockOnFreshStart() returns true; on a WKWebView
  // content-process reload inside the grace window it returns false, which is
  // the entire fix.
  const [locked, setLocked] = useState(() => supported && shouldLockOnFreshStart());
  const [covered, setCovered] = useState(false);
  const [checking, setChecking] = useState(false);
  const [biometryLabel, setBiometryLabel] = useState<string | null>(null);

  // Has durable storage been mirrored back into localStorage yet? Until it
  // has, `isAppLockEnabled()` can read a false negative — see below.
  const [hydrated, setHydrated] = useState(!supported);

  /** Has the automatic prompt already fired for this JS context? */
  const hasAutoPrompted = useRef(false);
  const promptOpen = useRef(false);

  // The lifecycle listeners are registered ONCE and read the user from here.
  //
  // They used to list `user` as an effect dependency, so every token refresh
  // tore the listeners down and re-registered them asynchronously (dynamic
  // import + `await addListener`). A resume landing inside that window was
  // dropped entirely — the cover stayed up with no prompt behind it, which is
  // exactly the "stuck on the Unlock screen" state the owner screenshotted.
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

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
    if (!supported) return;
    let cancelled = false;
    void ensureHydrated().then(() => {
      if (cancelled) return;
      if (shouldLockOnFreshStart()) setLocked(true);
      // Grace spent: this start already consumed the stored timestamp, so
      // don't leave it lying around for a later decision to re-use.
      else clearBackgroundedAt();
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  // Which biometric will the OS actually offer? Labelling only — the button
  // falls back to a neutral "Unlock" rather than guessing.
  //
  // Gated on the opt-in so the plugin chunk and its `checkBiometry()` round
  // trip stay off the launch path for everyone who never turned the lock on;
  // `hydrated` re-runs it once the durable setting is known.
  useEffect(() => {
    if (!supported || !isAppLockEnabled()) return;
    let cancelled = false;
    void getBiometryLabel().then((label) => {
      if (!cancelled) setBiometryLabel(label);
    });
    return () => {
      cancelled = true;
    };
  }, [supported, hydrated]);

  /**
   * @param auto true when the gate raised the prompt itself (cold start /
   *   resume) rather than the user tapping Unlock.
   */
  const attemptUnlock = useCallback(async ({ auto = false } = {}) => {
    // DEV harness only: there is no OS sheet on the web and requireBiometric()
    // is a pass-through there, so an automatic prompt would unlock the instant
    // it locked and make the state impossible to observe. Leaving the screen up
    // models the real "user dismissed the sheet" state; the button still works.
    if (auto && APP_LOCK_DEMO) return;
    // Guard against stacking prompts: a second OS prompt over the first
    // cancels it, which would leave the user stuck on a locked screen they
    // can't dismiss.
    if (promptOpen.current) return;
    promptOpen.current = true;
    setChecking(true);
    try {
      const ok = await requireBiometric("Unlock Louisiana Helpr");
      // requireBiometric returns TRUE when no biometric is enrolled, so a user
      // who enabled the lock and later removed Face ID is not bricked out.
      if (ok) {
        setLocked(false);
        setCovered(false);
        // Spent. Leaving it behind would let a later cold start read a
        // still-fresh timestamp.
        clearBackgroundedAt();
      }
    } finally {
      promptOpen.current = false;
      setChecking(false);
    }
  }, []);

  // Signed out — nothing to lock.
  //
  // Gated on `isReady`, not just on `user`. `useAuthReady` reports
  // `{ user: null, isReady: false }` for the first few milliseconds of every
  // launch while it restores the session; treating that as "signed out" used
  // to unlock the app before auth resolved, after which nothing ever put the
  // cover back — the cold-start prompt only fires on a locked render.
  useEffect(() => {
    if (!supported || !isReady) return;
    if (user) return;
    setLocked(false);
    setCovered(false);
    // Explicit sign-out must not bank grace time for whoever signs in next.
    clearBackgroundedAt();
    // Signing back IN on this same launch must not then demand a biometric:
    // the user just proved themselves with a password or an OAuth round-trip,
    // which is strictly stronger than the lock.
    hasAutoPrompted.current = true;
  }, [supported, isReady, user]);

  // Cold start: prompt as soon as we know there's a session to protect.
  //
  // Fires at most once per JS context (`hasAutoPrompted`). The resume path
  // below prompts on its own, so this only ever needs to cover the launch it
  // was written for — and must NOT fire when the shield goes up on the way
  // out, which is how pulling down the notification shade used to demand
  // Face ID for a two-second peek.
  useEffect(() => {
    if (!supported || !hydrated || !isReady || !user) return;
    if (!locked || hasAutoPrompted.current) return;
    hasAutoPrompted.current = true;
    void attemptUnlock({ auto: true });
  }, [supported, hydrated, isReady, user, locked, attemptUnlock]);

  // ── Lifecycle ──────────────────────────────────────────────────────────
  //
  // Registered once, never re-registered (see userRef above).
  //
  // Three events, three different jobs. On web the Capacitor App plugin
  // synthesises all three from `visibilitychange`
  // (node_modules/@capacitor/app/dist/esm/web.js), so this is one code path
  // for both platforms rather than a native branch and a web branch that
  // drift apart.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    const removers: Array<() => void> = [];

    void (async () => {
      try {
        const { App } = await import("@capacitor/app");

        const add = async (
          event: "appStateChange" | "pause" | "resume",
          handler: (info: { isActive: boolean }) => void,
        ) => {
          // The plugin's `pause`/`resume` carry no payload; the cast keeps one
          // helper for all three rather than three near-identical blocks.
          const handle = await (
            App.addListener as unknown as (
              e: string,
              h: (info: { isActive: boolean }) => void,
            ) => Promise<{ remove: () => Promise<void> }>
          )(event, handler);
          if (cancelled) {
            void handle.remove();
            return;
          }
          removers.push(() => void handle.remove());
        };

        // 1. appStateChange — PRIVACY SHIELD ONLY. Never locks, never prompts.
        //
        //    On iOS this is didBecomeActive/willResignActive, which fires for
        //    the notification shade, Control Centre, a call banner, a share
        //    sheet, and the biometric sheet. Treating any of those as
        //    "backgrounded" is the bug this rewrite removes.
        await add("appStateChange", ({ isActive }) => {
          if (isActive) {
            setCovered(false);
            return;
          }
          // Our own biometric sheet (or a payout confirmation's) resigns
          // active. Shielding then would flash a full-screen panel over the
          // dialog the user is confirming.
          if (isBiometricPromptOpen()) return;
          if (isAppLockEnabled() && userRef.current) setCovered(true);
        });

        // 2. pause — the app ACTUALLY went to the background
        //    (didEnterBackground). This is the only event that may start the
        //    grace clock.
        await add("pause", () => {
          if (!isAppLockEnabled() || !userRef.current) return;
          recordBackgroundedAt();
          setCovered(true);
        });

        // 3. resume — willEnterForeground. Fires BEFORE didBecomeActive, so
        //    the decision is made before the shield comes down.
        await add("resume", () => {
          if (!isAppLockEnabled() || !userRef.current) {
            setCovered(false);
            return;
          }
          if (shouldLockOnResume(readBackgroundedAt())) {
            setLocked(true);
            setCovered(false);
            void attemptUnlock({ auto: true });
          } else {
            // Inside the grace window — drop the cover without a prompt.
            setLocked(false);
            setCovered(false);
            clearBackgroundedAt();
          }
        });
      } catch {
        /* plugin unavailable — leave the app usable rather than stuck locked */
      }
    })();

    return () => {
      cancelled = true;
      removers.forEach((remove) => remove());
    };
  }, [supported, attemptUnlock]);

  if (!supported) return <>{children}</>;

  // The full lock UI only renders once we KNOW there is a session behind it.
  // While auth is still resolving we show the wordless shield instead — it
  // would be dishonest to say "signed in as…" before we know who, and the
  // panel must stay opaque either way.
  const showLock = locked && isReady && Boolean(user);
  const showShield = !showLock && (covered || locked);

  if (!showLock && !showShield) return <>{children}</>;

  const email = user?.email ?? null;
  const unlockLabel = biometryLabel ? `Unlock with ${biometryLabel}` : "Unlock";
  const explainer = biometryLabel
    ? `You're still signed in — ${biometryLabel} reopens your account without a password.`
    : "You're still signed in — unlocking reopens your account without a password.";

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
      {showShield ? (
        // Wordless privacy shield. aria-hidden + no focusable content: it is a
        // snapshot cover, not a screen, and announcing "app locked" every time
        // the user glances at Control Centre would be noise.
        <div
          aria-hidden
          data-app-lock="shield"
          className="bg-premium-page pointer-events-none fixed inset-0 z-[100] flex items-center justify-center"
        >
          <img
            src="/helpr-splash-icon.png"
            alt=""
            /* opacity-80, not 70: the project bans bare opacity below 80 as a
               state signal because it drags text under WCAG AA. Nothing here is
               text — this is a decorative mark on the privacy shield, alt="" —
               but 80 sits inside the allowed range and reads identically, which
               beats carrying a lint exception for a purely cosmetic value. */
            className="h-20 w-20 object-contain opacity-80"
          />
        </div>
      ) : (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="app-lock-title"
          data-app-lock="locked"
          // PHONE: IDENTITY CENTRED, ACTION BOTTOM-ANCHORED, GAP CAPPED.
          // sm+ : one centred column.
          //
          // The owner chose this shape explicitly, shown both alternatives
          // side by side: "Centre block, button stays at bottom."
          //
          // WHAT WAS WRONG. The mark/title/explainer used to be pinned to the
          // TOP, on the theory that the middle had to be kept clear for the
          // iOS Face ID sheet. Measured (393x852): the explainer finished at
          // y=217 — 25% down — and the next pixel of content was the e-mail at
          // y=743. A 525px hole, 62% of the screen. Owner: "Move the top info
          // to the center."
          //
          // THE TENSION, STATED HONESTLY, because the next person to touch
          // this will otherwise "fix" it back. Let F be the free space left
          // after the identity block (I) and the account+action block (B):
          //
          //     topMargin + gap = F,  so  gap = F - topMargin
          //
          // Centring the identity in the space above a bottom-flush action
          // means topMargin == gap == F/2. At 393x852 that is 282.7px of
          // nothing in the middle — and the ONLY way to shrink it is to raise
          // topMargin, i.e. push the identity DOWN, away from centre. Centred
          // block + bottom-flush action + small gap cannot all be true on a
          // tall phone; it is arithmetic, not a layout bug. This is the same
          // shape the job-detail sheet was rebuilt to escape (see the history
          // block in dashboard/JobDetailDialog.tsx, where a 92dvh sheet with
          // the CTA welded to the bottom stranded 364.7px above it): pinning
          // content to an edge relocates emptiness rather than removing it.
          //
          // WHAT WE DO ABOUT IT. The gap is not left to grow — the lower
          // spacer is capped at `max-h-56` (14rem / 224px) and the surplus is
          // handed to the UPPER spacer, where it becomes ordinary top-of-screen
          // margin instead of an interior hole. Two consequences, both wanted:
          //
          //   · the gap is bounded FOREVER. It is 224px on every phone tall
          //     enough to hit the cap and cannot exceed it on any future
          //     device, where the uncapped version grew without limit
          //     (282.7px at 852, 322.7 at 932, 456.7 on a 1200-tall window).
          //   · the cap makes the gap smaller than the top margin (224 vs
          //     341.4 at 393x852, a 0.66 ratio), so proximity groups the block
          //     WITH the action below it instead of leaving two equidistant
          //     clusters. That ratio is what stops it reading as a hole.
          //
          // Measured identity-block centres with the cap in place: 42.5% at
          // 320x568, 49.5% at 375x812, 51.9% at 393x852, 56.0% at 430x932 —
          // centred at every real phone size, which is what was asked for.
          //
          // 14rem was chosen over tighter caps deliberately: 13rem drops the
          // 393x852 centre to 53.8% and 12rem to 55.6%, buying a smaller gap
          // by pushing the block off the centre the owner asked for.
          //
          // `min-h-full` on the inner column (rather than `justify-center` on
          // this scroller) is deliberate: centring a flex container's child
          // directly makes overflow unreachable above the top edge. The column
          // grows past the viewport instead, so a very short window scrolls
          // normally rather than clipping the heading away. The spacers are
          // `flex-1` off a zero basis, so they collapse first and the content
          // is never what gets squeezed. In practice it never scrolls —
          // verified down to 320x360 with the safe-area insets applied.
          className="bg-premium-page fixed inset-0 z-[100] overflow-y-auto px-6"
          style={{
            paddingTop: "max(var(--safe-area-top, 0px), 1rem)",
            paddingBottom: "max(var(--safe-area-bottom, 0px), 1rem)",
          }}
        >
          <div className="flex min-h-full w-full flex-col items-center sm:justify-center">
            {/* Upper spacer — uncapped, so every pixel the lower one refuses
                lands here as top margin rather than as an interior hole. */}
            <div aria-hidden className="w-full flex-1 sm:hidden" />

            {/* What this screen is. The old version shipped the mark and a bare
                "Unlock" button with no words at all: it never said the app was
                locked, whose account it was, or what the button would do. iOS's
                own sheet names itself, but it appears AFTER the tap (and not at
                all if the user cancelled once), so the screen underneath has to
                stand on its own. */}
            <div className="flex w-full max-w-sm shrink-0 flex-col items-center text-center">
              {/* The real Helpr mark, not a generic padlock glyph. */}
              <img
                src="/helpr-splash-icon.png"
                alt=""
                aria-hidden
                className="h-16 w-16 object-contain"
              />
              <h1 id="app-lock-title" className="text-page-title mt-4">
                Louisiana Helpr is locked
              </h1>
              <p
                className="mt-2 max-w-[30ch] font-serif text-ds-13 italic"
                style={{ color: "hsl(var(--olivewood) / 0.85)" }}
              >
                {explainer}
              </p>
            </div>

            {/* Lower spacer — THE gap. Capped, per the block comment above:
                it grows to centre the identity and then stops at 14rem. */}
            <div aria-hidden className="max-h-56 w-full flex-1 sm:hidden" />

            {/* Whose account, and the single action. Bottom-flush on the phone
                (the scroller's own safe-area padding is the only thing under
                it, so the home indicator never overlaps the button); on sm+
                there is no spacer, so `mt-10` supplies the step instead. */}
            <div className="flex w-full max-w-sm shrink-0 flex-col items-center gap-3 sm:mt-10">
              {email && (
                <p
                  className="max-w-full break-words text-center font-sans text-ds-12"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  Signed in as{" "}
                  <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                    {email}
                  </span>
                </p>
              )}
              {/* Glossy primary (btn-grad-primary via variant="primary"); default
                  size is h-14, comfortably over the 44px minimum target. */}
              <Button
                variant="primary"
                className="w-full"
                onClick={() => void attemptUnlock()}
                disabled={checking}
              >
                {checking ? "Unlocking…" : unlockLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
