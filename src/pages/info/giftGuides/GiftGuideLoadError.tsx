import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { giftGuides as G } from "@/content/giftGuides";

/**
 * A gift guides data file that did not load (holiday audit 1121: a guide opened offline, or a failed picks / deals /
 * shops chunk, stayed on "Loading…" for good with no way out): the reason in plain words and a Try again button, and
 * the same retry by itself when the connection comes back (the window's "online" event). `onRetry` re-requests the
 * file; the caller decides what a second failure does.
 */
export function GiftGuideLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const retry = useRef(onRetry);
  retry.current = onRetry;
  useEffect(() => {
    const online = () => retry.current();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  return (
    <div className="gg-soon" role="alert" data-gift-load-error="">
      <p className="m-0">{message}</p>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry} data-gift-load-retry="">{G.loadRetry}</Button>
    </div>
  );
}

