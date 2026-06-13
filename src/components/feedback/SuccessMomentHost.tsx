/**
 * SuccessMomentHost — single global mount for the imperative success
 * overlay. Mounted once in App.tsx; subscribes to `fireSuccessMoment()`
 * and replays the SuccessMoment animation each time it's called.
 */
import { useEffect, useState } from "react";
import SuccessMoment from "./SuccessMoment";
import { subscribeSuccessMoment } from "@/lib/successMoment";

export default function SuccessMomentHost() {
  // `token` increments per fire so re-firing replays the animation; null
  // until the first call so nothing renders on a quiet screen.
  const [state, setState] = useState<{ token: number; label: string } | null>(null);

  useEffect(() => {
    return subscribeSuccessMoment((req) => {
      setState((prev) => ({
        token: (prev?.token ?? 0) + 1,
        label: req.label,
      }));
    });
  }, []);

  if (!state) return null;
  return <SuccessMoment token={state.token} label={state.label} />;
}
