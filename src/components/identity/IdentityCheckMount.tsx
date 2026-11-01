import { lazy, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useFeature } from "@/hooks/useFeature";
import { useIdentityCheckStatus } from "@/hooks/useIdentityCheckOn";
import { setIdentityCheckOn } from "@/lib/identityCheckSwitch";
import { setPayoutAfterHireOn } from "@/lib/payoutAfterHireSwitch";
import { useIdentityCheckSheet } from "@/lib/identityCheck";
import { loadModule, untilReload } from "@/lib/loadModule";

// Through loadModule (src/test/dynamicImportThenDoesNoWork.test.ts): a prevented preload resolves null, and the lazy
// host then waits on the recovery reload instead of reading `undefined.IdentityCheckHost` (B85, 11-01).
const loadSheet = () => loadModule(() => import("@/components/identity/IdentityCheckSheet"));
const IdentityCheckHost = lazy(() => loadSheet().then((m) => (m ? { default: m.IdentityCheckHost } : untilReload())));

/** The two links that open the sheet on arrival (the notice, and Stripe's return). */
export function hasIdentityEntryParam(params: URLSearchParams): boolean {
  return params.get("verify_id") === "1" || params.get("idv") === "complete";
}

/**
 * What App.tsx mounts beside every signed-in page for the one Identity sheet
 * (B83, 11-01). The sheet's own code is ~172 KB gzip past boot (Stripe copy,
 * the shared sheet, FreeClaimFirstTime...), and it used to be fetched ~2.6 s
 * into every /home on Slow 4G to draw nothing: the ID check is off until an
 * admin turns it on (owner 2026-10-30), and even when on the sheet is closed
 * almost always.
 *
 * This part is small and always mounted. It publishes the two switch answers
 * the plain functions read (openIdentityCheck, acceptMissingFromProfile...),
 * and fetches the sheet only when it has something to show: once it is opened
 * (openIdentityCheck only opens while the check is on), or when the page was
 * reached by one of the entry links, which the sheet consumes. Once fetched it
 * stays mounted, so it can animate closed. While the check is on, the sheet is
 * also fetched when the browser is idle, so a tap on "Verify your ID" opens it
 * without a wait.
 *
 * Guard: src/test/chromeWaitsOnlyForItsOwnCode.test.tsx.
 */
export function IdentityCheckMount() {
  const { on: idOn } = useIdentityCheckStatus();
  useEffect(() => setIdentityCheckOn(idOn), [idOn]);
  // Payout setup after the hire (owner 2026-10-25): published the same way, for
  // the accept-gate mirror and the job card's "Finish payout setup" line.
  const payoutAfterHire = useFeature("payout_after_hire");
  useEffect(() => setPayoutAfterHireOn(payoutAfterHire), [payoutAfterHire]);

  const { open } = useIdentityCheckSheet();
  const [params] = useSearchParams();
  const wanted = open || hasIdentityEntryParam(params);
  const [mounted, setMounted] = useState(wanted);
  useEffect(() => {
    if (wanted) setMounted(true);
  }, [wanted]);

  useEffect(() => {
    if (!idOn || mounted) return;
    const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const warm = () => {
      void loadSheet().catch(() => {
        // A failed warm-up is retried by the real open: the warm-up calls loadSheet()
        // directly, not through the lazy component, so React.lazy has not cached this
        // rejection and its factory runs (and fetches) again on the first render.
      });
    };
    const id = ric ? ric(warm, { timeout: 8000 }) : window.setTimeout(warm, 4000);
    return () => {
      const cic = (window as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback;
      if (ric && cic) cic(id);
      else window.clearTimeout(id);
    };
  }, [idOn, mounted]);

  if (!wanted && !mounted) return null;
  return (
    <Suspense fallback={null}>
      <IdentityCheckHost />
    </Suspense>
  );
}
