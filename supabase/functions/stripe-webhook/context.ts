import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Shared, request-scoped dependencies threaded into every event handler.
// `stripe` and `supabase` are created per-request in index.ts; `logStep`
// is the stateless logger used across the whole webhook.
export interface WebhookContext {
  stripe: Stripe;
  supabase: SupabaseClient;
  logStep: (step: string, details?: any) => void;
}

export const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-WEBHOOK] ${step}${d}`);
};

/**
 * Q1654: thrown by a handler that must see this event again LATER, not
 * because anything failed (a refund whose own path is still telling the card
 * holder). index.ts rolls back the dedupe row and answers 503 so Stripe
 * redelivers, without the "processing error" page a real failure gets.
 */
export class WebhookDeferred extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookDeferred";
  }
}
