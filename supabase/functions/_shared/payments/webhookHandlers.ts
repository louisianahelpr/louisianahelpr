/**
 * What paypal-webhook does with a VERIFIED, STORED event (PayPal Plan A).
 *
 * The webhook (paypal-webhook/index.ts) verifies the signature, stores the
 * event in paypal_webhook_events, and only then calls dispatchPayPalEvent. Each
 * phase owns ONE handler file under ./webhook/ and edits only that file, so the
 * phases never touch the same lines (lead, 2026-10-23):
 *   ./webhook/checkoutEvents.ts  phase 3   CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED/PENDING/DENIED/DECLINED
 *   ./webhook/refundEvents.ts    phase 5   PAYMENT.CAPTURE.REFUNDED (and PAYMENT.REFUND.*)
 *   ./webhook/payoutEvents.ts    phase 4/8 PAYMENT.PAYOUTS-ITEM.*
 *   ./webhook/tipEvents.ts       tips      (tip orders, if they need their own lines)
 *   ./webhook/vaultEvents.ts     phase 6   VAULT.PAYMENT-TOKEN.DELETED (saved methods)
 * One event type belongs to one file: dispatch refuses a type two files claim.
 *
 * HANDLER RULES
 * - Re-read the resource from PayPal (ctx.client) and act on THAT state, never
 *   on the event body or on event order (design §5.4).
 * - Idempotent: a handler may run more than once for one event (a redelivery
 *   after a 503, two deliveries racing). Same input, same end state.
 * - Outcomes:
 *     return normally        -> processed_at set, 200.
 *     throw PayPalEventFinal -> nothing to do and nothing will change (not our
 *                               object, already settled): processed_at set,
 *                               error recorded, 200.
 *     throw PayPalEventRetry -> could not finish now (PayPal or the database
 *                               unreachable): processed_at stays NULL, error
 *                               recorded, 503 so PayPal redelivers (25 times
 *                               over 3 days).
 *     any other throw        -> treated as PayPalEventRetry (fail safe: a bug
 *                               is retried and alerted, never marked done).
 * - An event type with no handler stays stored with processed_at NULL (200):
 *   a later phase's handler picks it up on PayPal's next delivery of it.
 */
import {
  PayPalEventFinal,
  type PayPalEventContext,
  type PayPalEventHandler,
  type PayPalEventHandlers,
  type StoredPayPalEvent,
} from "./webhook/eventTypes.ts";
import { CHECKOUT_EVENT_HANDLERS } from "./webhook/checkoutEvents.ts";
import { REFUND_EVENT_HANDLERS } from "./webhook/refundEvents.ts";
import { PAYOUT_EVENT_HANDLERS } from "./webhook/payoutEvents.ts";
import { TIP_EVENT_HANDLERS } from "./webhook/tipEvents.ts";
import { VAULT_EVENT_HANDLERS } from "./webhook/vaultEvents.ts";

export type DispatchResult =
  | { kind: "unhandled" }
  | { kind: "done"; note: string }
  | { kind: "final"; note: string }
  | { kind: "retry"; note: string };

const SOURCES: ReadonlyArray<readonly [string, PayPalEventHandlers]> = [
  ["checkoutEvents", CHECKOUT_EVENT_HANDLERS],
  ["refundEvents", REFUND_EVENT_HANDLERS],
  ["payoutEvents", PAYOUT_EVENT_HANDLERS],
  ["tipEvents", TIP_EVENT_HANDLERS],
  ["vaultEvents", VAULT_EVENT_HANDLERS],
];

/** The one dispatch table. Throws at load if two files claim one event type. */
export function buildDispatchTable(sources: ReadonlyArray<readonly [string, PayPalEventHandlers]> = SOURCES): PayPalEventHandlers {
  const table: Record<string, PayPalEventHandler> = {};
  const owner: Record<string, string> = {};
  for (const [name, handlers] of sources) {
    for (const [type, h] of Object.entries(handlers)) {
      if (owner[type]) throw new Error(`paypal event ${type} claimed by both ${owner[type]} and ${name}`);
      owner[type] = name;
      table[type] = h;
    }
  }
  return table;
}

export const PAYPAL_EVENT_HANDLERS: PayPalEventHandlers = buildDispatchTable();

export async function dispatchPayPalEvent(
  event: StoredPayPalEvent,
  ctx: PayPalEventContext,
  table: PayPalEventHandlers = PAYPAL_EVENT_HANDLERS,
): Promise<DispatchResult> {
  const handler = Object.prototype.hasOwnProperty.call(table, event.event_type) ? table[event.event_type] : undefined;
  if (!handler) return { kind: "unhandled" };
  try {
    return { kind: "done", note: await handler(event, ctx) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof PayPalEventFinal) return { kind: "final", note: msg };
    return { kind: "retry", note: msg };
  }
}
