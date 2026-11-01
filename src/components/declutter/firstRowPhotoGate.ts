/**
 * THE FIRST ROW'S PHOTOS LOAD FIRST (B77, 2026-11-01, "Nothing slow for users"). Measured (cwv-lab, customer, 375 Slow
 * 4G + 4x CPU, B72's branch): /declutter's largest paint is the first card's photo at 11.9 s; it started at 8.9 s
 * together with 15 more card photos (every lazy photo within the browser's and useLoadPhotoAhead's margins), so the
 * 26 KB first photo shared the line with ~400 KB and took 3.1 s. Now a later card's photo waits until every first-row
 * photo has loaded or failed (each first-row card holds the gate while its photo is in flight), or MAX_WAIT_MS has
 * passed, then loads as before (lazy, and ahead of the scroll). With no first-row photo in flight the gate opens at
 * once. Once open it stays open for the visit.
 */
import { useEffect, useSyncExternalStore } from "react";

/** The longest a later photo waits on the first row (a stalled photo never holds the rest for long). */
export const MAX_WAIT_MS = 2500;

let pending = 0;
let open = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function openGate() {
  if (open) return;
  open = true;
  if (timer) clearTimeout(timer);
  timer = null;
  for (const l of listeners) l();
}

/** A first-row card's photo is in flight: returns the call that says it loaded or failed (safe to call twice). */
export function holdForFirstRowPhoto(): () => void {
  if (open) return () => undefined;
  pending++;
  if (!timer) timer = setTimeout(openGate, MAX_WAIT_MS);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending--;
    if (pending <= 0) openGate();
  };
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Whether a later card may ask for its photo yet. Opens on its own when no first-row photo holds it. */
export function useLaterPhotosOpen(enabled: boolean): boolean {
  const isOpen = useSyncExternalStore(subscribe, () => open, () => true);
  useEffect(() => {
    if (!enabled || open) return;
    // First-row cards register in their own effects of the same commit; if none did, nothing is worth waiting for.
    const t = setTimeout(() => {
      if (pending <= 0) openGate();
    }, 0);
    return () => clearTimeout(t);
  }, [enabled]);
  return !enabled || isOpen;
}

/** Tests only: back to a fresh visit. */
export function resetFirstRowPhotoGate() {
  pending = 0;
  open = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
