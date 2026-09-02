import { Button } from "@/components/ui/button";
import { APP_STORE_URL } from "@/lib/appStore";
import { useVersionCheck } from "@/hooks/useVersionCheck";

/**
 * ForceUpdateGate — "Update Helpr to continue", the one lever that works while
 * a bad build sits in App Review.
 *
 * The rest of the reasoning lives where the decision is made
 * (hooks/useVersionCheck.ts for the build number and the web carve-out,
 * lib/minSupportedBuild.ts for why every failure fails OPEN). This file is
 * only the screen, and it has exactly two jobs beyond looking right.
 *
 * ── 1. IT DOES NOT RENDER THE APP BEHIND IT ──────────────────────────────
 * `AppLockGate` keeps its children mounted at `opacity-0` so unlocking
 * restores the exact prior screen and its in-flight queries. This does the
 * opposite and unmounts them, because the two covers are not the same kind of
 * thing. A lock is a pause in a session the user will resume in seconds; this
 * is terminal — the only way past it is installing a new binary, which
 * restarts the process anyway. Keeping the tree alive underneath would buy
 * nothing and cost real things: a blocked build is a build we have decided is
 * broken, and leaving it mounted lets it keep polling, keep writing, keep
 * firing realtime handlers, and keep showing account data in the iOS
 * app-switcher snapshot.
 *
 * ── 2. IT IS NOT A DEAD END ──────────────────────────────────────────────
 * A blocked user has no nav, no tabs, no route anywhere. If the only thing on
 * screen were the word "update", every edge case — a wrong threshold, a
 * region where the listing is unavailable, an install that genuinely cannot
 * update — becomes a support call with nothing to say. So the screen carries
 * three things a person can actually use:
 *   · the App Store link (the primary, glossy action);
 *   · the support address, as a mailto with the diagnosis pre-filled, so the
 *     first reply does not have to be "what version are you on?";
 *   · the two numbers themselves, in plain text, because the user may be
 *     reading them out over the phone.
 * There is deliberately no "continue anyway" — the owner asked for a hard
 * block, and an escape hatch on the screen would defeat the point. The escape
 * hatch is on the operator's side: set the threshold back to 0.
 */
export function ForceUpdateGate({ children }: { children: React.ReactNode }) {
  const check = useVersionCheck();

  // `checking` renders the app. The gate must never be the reason a launch
  // feels slow, and it must never flash a block screen at someone who turns
  // out to be up to date.
  if (check.status !== "blocked") return <>{children}</>;

  const { installedBuild, requiredBuild } = check;

  const supportSubject = encodeURIComponent("Helpr update required");
  const supportBody = encodeURIComponent(
    `I'm being asked to update Louisiana Helpr and need help.\n\n` +
      `Installed build: ${installedBuild}\n` +
      `Required build: ${requiredBuild}\n\n` +
      `What's happening:\n`,
  );

  return (
    // bg-premium-page is a CLASS, not a design token — there is no
    // `--premium-page` variable, so an inline hsl(var(--premium-page)) would
    // render transparent and leak the (unmounted, but still) page beneath.
    // Same note as AppLockGate, same trap.
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="force-update-title"
      data-force-update="blocked"
      // Layout copied from AppLockGate rather than re-derived: `min-h-full` on
      // the inner column instead of `justify-center` on this scroller, because
      // centring a flex container's child directly makes overflow unreachable
      // above the top edge. The column grows past the viewport instead, so a
      // very short window scrolls normally rather than clipping the heading
      // away. `px-6` plus the safe-area padding is the only horizontal inset,
      // so there is nothing here that can exceed the viewport width.
      className="bg-premium-page fixed inset-0 z-[110] overflow-y-auto px-6"
      style={{
        paddingTop: "max(var(--safe-area-top, 0px), 1rem)",
        paddingBottom: "max(var(--safe-area-bottom, 0px), 1rem)",
      }}
    >
      {/* z-[110], one step above AppLockGate's z-[100]. They can both be up at
          once — an install with the app lock enabled that is also too old — and
          in that pairing this one must win. Demanding Face ID before telling
          someone their app is dead is a worse first screen, and there is
          nothing behind this cover to protect: it shows no account data. */}
      <div className="flex min-h-full w-full flex-col items-center justify-center gap-8 py-8">
        <div className="flex w-full max-w-sm shrink-0 flex-col items-center text-center">
          {/* The real Helpr mark, same asset the lock and the splash use, so a
              user who lands here still recognises the app they opened. */}
          <img
            src="/helpr-splash-icon.png"
            alt=""
            aria-hidden
            className="h-16 w-16 object-contain"
          />
          <h1 id="force-update-title" className="text-page-title mt-4">
            Update Helpr to continue
          </h1>
          <p
            className="mt-2 max-w-[32ch] font-serif text-ds-13 italic"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            This version of Louisiana Helpr is no longer supported. Install the
            latest update from the App Store and you'll pick up right where you
            left off.
          </p>
        </div>

        <div className="flex w-full max-w-sm shrink-0 flex-col items-center gap-4">
          {/* Glossy primary via variant="primary" (btn-grad-primary). `asChild`
              because this is a real external navigation, not a click handler —
              a blocked app must not depend on its own JS to get the user out.
              Default size is h-14, comfortably over the 44px target. */}
          <Button variant="primary" className="w-full" asChild>
            <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
              Update on the App Store
            </a>
          </Button>

          <p
            className="text-center font-sans text-ds-12"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Can't update?{" "}
            <a
              href={`mailto:admin@louisianahelpr.com?subject=${supportSubject}&body=${supportBody}`}
              className="underline underline-offset-2 transition-colors hover:opacity-80"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              admin@louisianahelpr.com
            </a>
          </p>

          {/* The numbers, in plain readable text. Not debug output — this is
              what a user reads out to support, and what tells them at a glance
              that the app is not simply broken. */}
          <p
            className="text-center font-mono text-ds-11 tabular-nums"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Installed build {installedBuild} · requires {requiredBuild}
          </p>
        </div>
      </div>
    </div>
  );
}
