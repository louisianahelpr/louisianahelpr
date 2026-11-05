/**
 * stripe-webhook's per-request TEST-mode scope (see _shared/stripeTestMode.ts). AsyncLocalStorage, not a module
 * flag: one isolate can serve several requests at once. The node:async_hooks import is here, in this function only.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { registerStripeTestModeReader } from "../_shared/stripeTestMode.ts";

const scope = new AsyncLocalStorage<boolean>();
registerStripeTestModeReader(() => scope.getStore() === true);

/** Run `fn` with the TEST-mode scope on when `isTest` is true (an event with livemode === false). */
export function runForStripeMode<T>(isTest: boolean, fn: () => Promise<T>): Promise<T> {
  return scope.run(isTest, fn);
}
