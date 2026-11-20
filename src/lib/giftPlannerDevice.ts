/**
 * The gift planner's device copy, the part sign-out needs (security review of #4791, item 1: the planner leaked
 * between accounts on a shared device). Kept tiny and import-free so src/lib/authSignOut.ts can wipe it without
 * pulling the planner's chunk onto the critical path. The planner store (src/pages/info/giftGuides/fun/plannerStore.ts)
 * registers a reset here, so a loaded planner also forgets its in-memory copy.
 */
export const PLANNER_KEY = "lh-gift-planner";

const resets = new Set<() => void>();

/** The planner store's in-memory reset (one per loaded store). */
export const onPlannerCleared = (fn: () => void) => {
  resets.add(fn);
  return () => {
    resets.delete(fn);
  };
};

/** Sign-out: remove the device copy and every in-memory copy, so the next person on this device never sees it. */
export function clearPlannerDevice() {
  try {
    window.localStorage.removeItem(PLANNER_KEY);
  } catch {
    // Storage blocked: nothing was ever written to it, so there is nothing to remove.
  }
  resets.forEach((fn) => fn());
}
