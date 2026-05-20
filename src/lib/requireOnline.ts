import { toast } from "sonner";

/**
 * Synchronous gate for high-stakes mutation entry points (Apply, Post,
 * Send message, Save profile). Call as the FIRST line of an onClick /
 * onSubmit handler:
 *
 *   if (!requireOnline()) return;
 *
 * Returns `true` when the network is up and the caller should proceed.
 * Returns `false` and shows a sonner toast when offline — the caller
 * must bail. We intentionally read `navigator.onLine` directly (not
 * `useOnlineStatus`) so this can be used outside of React render bodies
 * and so it always reflects the latest browser state at click time.
 *
 * Limitation: `navigator.onLine` can return `true` on captive-portal
 * networks. We treat that as the user's problem to discover when the
 * mutation fails — better than blocking attempts on a maybe-up network.
 */
export function requireOnline(): boolean {
  if (typeof navigator === "undefined" || navigator.onLine) return true;
  toast.error("You're offline. Try again when you're back.");
  return false;
}
