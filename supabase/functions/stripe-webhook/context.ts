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
