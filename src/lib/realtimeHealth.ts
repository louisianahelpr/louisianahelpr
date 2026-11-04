import { useSyncExternalStore } from "react";

// ── Health registry ─────────────────────────────────────────────────────────
// Module-level rather than context: channels are opened from hooks, module
// singletons (useCurrentUser's refcounted registry) and async callbacks alike,
// and none of those can reach a React provider.

/** Channels currently down, by health key (realtimeRecovery.ts adds and removes them). */
export const downChannels = new Set<string>();
const healthListeners = new Set<() => void>();
/** Snapshot for useSyncExternalStore — must be a stable value, not a new Set. */
let degradedSnapshot = false;

export function publishHealth() {
  const next = downChannels.size > 0;
  if (next === degradedSnapshot) return;
  degradedSnapshot = next;
  for (const listener of [...healthListeners]) listener();
}

function subscribeHealth(listener: () => void) {
  healthListeners.add(listener);
  return () => {
    healthListeners.delete(listener);
  };
}

const readHealth = () => degradedSnapshot;

/**
 * True while at least one realtime channel is down. Drives the "live updates
 * paused" state of the global banner.
 *
 * `getServerSnapshot` returns false: SSR/prerender has no socket, and claiming
 * degradation in a prerendered shell would flash the banner on every cold load.
 */
export function useRealtimeDegraded(): boolean {
  return useSyncExternalStore(subscribeHealth, readHealth, () => false);
}

/** Test seam — resets the registry between cases. */
export function __resetRealtimeHealth() {
  downChannels.clear();
  degradedSnapshot = false;
  healthListeners.clear();
}
