// Client mirror of the canonical consumer-subscription checkout price map
// defined on the edge in supabase/functions/_shared/proTiers.ts. Re-exported
// here so any UI that needs the billing_cycle × tier → Stripe Price mapping
// derives from ONE source and can never silently diverge from what the
// create-pro-checkout edge function charges. Parity + amount drift is guarded
// by src/lib/proTiers.parity.test.ts.

export {
  PRO_PRICE_MAP,
  PRO_RECURRING_AMOUNT_CENTS,
  type ProTierKey,
  type ProBillingCycle,
} from "../../supabase/functions/_shared/proTiers";
