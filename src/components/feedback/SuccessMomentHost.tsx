/**
 * SuccessMomentHost — single global mount for the imperative success
 * overlay. Mounted once in App.tsx; subscribes to `fireSuccessMoment()`
 * and replays the SuccessMoment animation each time it's called.
 *
 * SuccessMoment (framer-motion) is not imported with this host (Q1356): the
 * host mounts on every route, so a static import made every visitor, guests
 * included, download framer-motion (~39 KB gzip) for a beat only a signed-in
 * flow fires. It is fetched once the page has settled for a signed-in user
 * (the dock fetches framer for them then anyway), so it is in hand before any
 * hire or completion. A fire that arrives before it is skipped, never shown
 * late: a late beat would cover the payment-held dialog that opens 1550 ms
 * after a hire (Q997). A failed fetch is reported and retried by createLazyModule,
 * never thrown into render (successMoment.ts: the beat must never break a flow).
 * scripts/check-deferred-vendors.mjs holds this chunk's closure free of framer.
 */
import { useEffect, useState } from "react";
import { subscribeSuccessMoment } from "@/lib/successMoment";
import { createLazyModule } from "@/lib/lazyModule";
import { whenPageSettled } from "@/lib/routePrefetch";
import { useAuthReady } from "@/hooks/useAuthReady";

const moment = createLazyModule(() => import("./SuccessMoment"), "SuccessMomentHost.load");

export default function SuccessMomentHost() {
  // `token` increments per fire so re-firing replays the animation; null
  // until the first call so nothing renders on a quiet screen.
  const [state, setState] = useState<{ token: number; label: string } | null>(null);
  const { user } = useAuthReady();
  const loaded = moment.use();
  const signedIn = !!user;

  useEffect(() => {
    if (!signedIn) return;
    return whenPageSettled(moment.start);
  }, [signedIn]);

  useEffect(() => {
    return subscribeSuccessMoment((req) => {
      // Not here yet: fetch it for next time and skip this beat (see above).
      if (!loaded) {
        moment.start();
        return;
      }
      setState((prev) => ({
        token: (prev?.token ?? 0) + 1,
        label: req.label,
      }));
    });
  }, [loaded]);

  if (!state || !loaded) return null;
  const SuccessMoment = loaded.default;
  return <SuccessMoment token={state.token} label={state.label} />;
}
