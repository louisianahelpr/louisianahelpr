import { lazy, Suspense, useEffect, useState } from "react";

// Sonner + TooltipProvider pull in @radix-ui/react-tooltip + @floating-ui (~14 KB
// gzipped, unused on the landing page). Lazy-loading keeps them out of the
// critical entry bundle; they hydrate after first paint when the wrappers mount.
const Sonner = lazy(() =>
  import("@/components/ui/sonner").then((m) => ({ default: m.Toaster }))
);
// Global host for the imperative SuccessMoment overlay (job posted /
// applicant hired / job completed). Lazy + deferred for the same
// critical-path reason as the toasters above — framer-motion isn't on
// the landing-page hot path.
const SuccessMomentHost = lazy(() => import("@/components/feedback/SuccessMomentHost"));

/**
 * Mounts `<Toaster />` and `<Sonner />` only AFTER first paint.
 *
 * Even though both are `lazy()`-wrapped above, React still asks for their
 * chunks on the same tick as the first render (it kicks the dynamic
 * import the moment a `<lazy>` element is in the tree). On native iOS
 * cold start that adds ~100-300ms of chunk-fetch contention with the
 * route chunk and page chunks that actually matter for first paint.
 *
 * Gating both on a post-mount `useState` flag means React doesn't even
 * see the lazy elements until after the first browser frame has
 * committed, so their chunks queue *after* the chunks that paint the UI
 * the user is waiting for. Toasts triggered during the very first
 * render-to-paint window are vanishingly rare (no API has resolved yet),
 * and the existing Toaster surfaces queued toasts as soon as it mounts.
 */
const DeferredToasters = () => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Schedule on a microtask after commit — React has already painted the
    // first frame by the time this runs, so the toaster chunk-fetch can
    // no longer contend with the critical-path bundles.
    setMounted(true);
  }, []);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      {/* Failures surface, confirmations don't (owner decision 2026-08-13).

          The split is enforced in src/lib/toastPolicy.ts, which neuters
          `toast.success` / `.info` / `.message` at boot. So "Job saved" /
          "Notifications on" — the clutter that was covering page headers —
          never appear, while a declined card, a blocked message or a failed
          payout still tells the user something went wrong.

          The HOSTS below must stay mounted for that to hold. They were briefly
          off entirely, and then the comment kept claiming they were mounted
          while the JSX rendered only <SuccessMomentHost /> — which silenced all
          427 `toast.error` call sites app-wide, money paths included. A
          suppressed confirmation is a design choice; a suppressed error is the
          blank-screen failure CLAUDE.md's "never drop the error" rule exists to
          prevent. Removing either host again re-breaks every error path in the
          app, so the policy layer — not the mount — is where suppression
          belongs.

          One host, not two: the three remaining Radix `@/hooks/use-toast`
          callers (AdminHealth, EarningsTab, useHelperMilestones) were migrated
          to `sonner`, so <Toaster /> and the whole @/hooks/use-toast +
          ui/toast + ui/toaster stack are gone. Two toast systems meant two
          places to configure duration, stacking and dismissal, and a toast
          could render in either one depending on which import a file
          happened to pick. */}
      <Sonner />
      <SuccessMomentHost />
    </Suspense>
  );
};

export default DeferredToasters;
