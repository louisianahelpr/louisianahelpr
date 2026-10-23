/**
 * Types and outcome errors for paypal-webhook handlers. Separate from
 * ../webhookHandlers.ts so a handler file never imports the dispatcher (which
 * imports every handler file): no import cycle.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { PayPalClient } from "../paypalClient.ts";
import type { ProviderEnv } from "../types.ts";

/** The stored row, as paypal-webhook wrote it (payload is the verified event body). */
export interface StoredPayPalEvent {
  event_id: string;
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  payload: unknown;
}

export interface PayPalEventContext {
  /** Service-role client. */
  supabase: SupabaseClient;
  /** For re-reading the resource (GET only; any POST needs a deterministic idempotency key). */
  client: PayPalClient;
  env: ProviderEnv;
}

/** A short line for the log (never a secret, never a full payload). */
export type PayPalEventHandler = (event: StoredPayPalEvent, ctx: PayPalEventContext) => Promise<string>;

export type PayPalEventHandlers = Readonly<Record<string, PayPalEventHandler>>;

/** Final: nothing to do, now or later. Stored as processed (200). */
export class PayPalEventFinal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayPalEventFinal";
  }
}

/** Not now: leave unprocessed and answer 503 so PayPal redelivers. */
export class PayPalEventRetry extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayPalEventRetry";
  }
}
