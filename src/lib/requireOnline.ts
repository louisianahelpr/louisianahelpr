import { onlineManager } from "@tanstack/react-query";
import { isConfirmedOffline } from "@/lib/connectivity";
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
 *  - Web: the CONFIRMED connectivity state (src/lib/connectivity.ts,
 *    `isConfirmedOffline()`), read synchronously so this stays callable
 *    outside a React render body. navigator.onLine=false there is only a
 *    hint until a probe confirms it (owner, 10-31: Chrome reported offline
 *    while she was online). Native reads `navigator.onLine` directly.
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
 * deliberate in both directions: on native `navigator.onLine === false` is
 * trusted (on the web it is not, see above), and `onlineManager` is consulted only on
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
  // Web: only a CONFIRMED offline blocks (src/lib/connectivity.ts). Chrome can
  // report navigator.onLine=false while online (owner, 10-31), and every write
  // was refused with this toast. Native keeps reading navigator.onLine here.
  const browserOnline = isNativePlatform
    ? typeof navigator === "undefined" || navigator.onLine
    : !isConfirmedOffline();
  const nativeOnline = !isNativePlatform || onlineManager.isOnline();
  if (browserOnline && nativeOnline) return true;
  toast.error("You're offline. Try again when you're back.");
  return false;
}
