import { onlineManager } from "@tanstack/react-query";
import { toast } from "sonner";

import { isNativePlatform } from "@/lib/nativeInit";

/**
 * Synchronous gate for high-stakes mutation entry points (Apply, Post,
 * Send message, Save profile). Call as the FIRST line of an onClick /
 * onSubmit handler:
 *
 *   if (!requireOnline()) return;
 *
 * Returns `true` when the network is up and the caller should proceed.
 * Returns `false` and shows a sonner toast when offline — the caller
 * must bail.
 *
 * Two signals, because neither is sufficient alone:
 *
 *  - `navigator.onLine` — the only signal on the web surface, and read
 *    directly (not via `useOnlineStatus`) so this stays callable outside
 *    a React render body and always reflects the state at click time.
 *
 *  - `onlineManager.isOnline()` — the NATIVE signal. Inside WKWebView,
 *    `navigator.onLine` is the weaker of the two: WebKit keeps reporting
 *    `true` for a wifi association that has no route off it, so a gate
 *    reading only `navigator.onLine` waves the user straight through on
 *    exactly the flaky-network case it exists to catch. `onlineManager`
 *    is pinned to `@capacitor/network` — `useAppLifecycle` (see
 *    src/lib/appLifecycle.ts) seeds it from `Network.getStatus()` and
 *    then keeps it current from every `networkStatusChange` event — so
 *    on iOS/Android this is the Capacitor reachability value, readable
 *    synchronously. Reading it here rather than opening a second
 *    `Network.addListener` keeps ONE Capacitor network subscription in
 *    the app; a private listener would be a second source of truth for
 *    the same fact.
 *
 * Treated as offline when EITHER signal says offline. That ordering is
 * deliberate in both directions: `navigator.onLine === false` is
 * trustworthy on both surfaces (the browser only reports it when the
 * interface is genuinely down), and `onlineManager` is consulted only on
 * native, where TanStack's own web fallback would otherwise be a third
 * opinion about a fact `navigator.onLine` already answers.
 *
 * Fail-open by design. `onlineManager` starts `true` and is corrected a
 * few hundred ms into launch, once `useAppLifecycle`'s dynamic import of
 * `@capacitor/network` resolves; if that import ever fails, it simply
 * stays `true`. So the worst case is the pre-2026-08-31 behaviour — the
 * gate lets a write through and the mutation surfaces the failure itself
 * (see the `networkMode: "always"` default in src/lib/queryClient.ts).
 * Blocking a write on a maybe-up network would be the worse trade.
 *
 * Limitation, unchanged: neither signal detects a captive portal. That
 * stays the user's problem to discover when the mutation fails — which
 * it now visibly does.
 */
export function requireOnline(): boolean {
  const browserOnline = typeof navigator === "undefined" || navigator.onLine;
  const nativeOnline = !isNativePlatform || onlineManager.isOnline();
  if (browserOnline && nativeOnline) return true;
  toast.error("You're offline. Try again when you're back.");
  return false;
}
