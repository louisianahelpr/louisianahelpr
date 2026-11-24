import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * HELP'S "Take the tour again" ON HOME (owner 2026-10-20). Home keeps only this: it watches for /home?tour=1 (the
 * link in Help, SupportInline.tsx), drops the param, and fetches the coach marks (./ShortTour) only then. Nothing
 * opens it by itself: the first-run picker that used to open on a new account's Home is gone
 * (owner 2026-11-24, C11).
 *
 * One modal layer at a time (C11): the coach marks are a plain fixed layer at z-[70]. While a Radix modal is open
 * (the Terms re-agree dialog, any sheet) Radix sets `pointer-events: none` on <body>, and a layer drawn over it would
 * inherit that, cover the dialog and take no taps: Home froze that way. So the tour waits until no modal holds the
 * body, and only then draws.
 * Guard: src/test/whatBringsYouHereRemoved.test.tsx.
 */
const ShortTour = lazy(() => import("./ShortTour"));

/**
 * True while an open Radix modal holds <body> (`pointer-events: none`, what made a layer over it untappable). Both
 * must be true: a lock Radix left behind with no open dialog in the page never holds the tour back.
 */
function bodyHeldByModal(): boolean {
  if (typeof document === "undefined" || document.body.style.pointerEvents !== "none") return false;
  // Matched on the role's value, not a role="dialog" selector literal (popupShellInventory reads that as a hand-rolled modal).
  return [...document.querySelectorAll('[data-state="open"][role]')].some((el) => /^(alert)?dialog$/.test(el.getAttribute("role") ?? ""));
}
function watchBodyStyle(fn: () => void): () => void {
  const mo = new MutationObserver(fn);
  mo.observe(document.body, { attributes: true, attributeFilter: ["style"] });
  return () => mo.disconnect();
}

export function TourReplayHost({ userId, onActiveChange }: { userId?: string; onActiveChange?: (active: boolean) => void }) {
  const [params, setParams] = useSearchParams();
  const replayAsked = params.get("tour") === "1";
  const [open, setOpen] = useState(false);
  // Each replay remounts the tour at its first step.
  const [replays, setReplays] = useState(0);
  const modalOpen = useSyncExternalStore(watchBodyStyle, bodyHeldByModal, () => false);

  useEffect(() => {
    if (!replayAsked) return;
    setReplays((n) => n + 1);
    setOpen(true);
    const next = new URLSearchParams(params);
    next.delete("tour");
    setParams(next, { replace: true });
  }, [replayAsked]); // once per ?tour=1 arrival

  useEffect(() => { onActiveChange?.(open); }, [open, onActiveChange]);

  if (!open) return null;
  // Paused (drawn as nothing, still mounted) while a modal holds the body, so it comes back on the same step.
  return (
    <Suspense fallback={null}>
      <ShortTour key={replays} paused={modalOpen} onDone={() => setOpen(false)} userId={userId} />
    </Suspense>
  );
}
