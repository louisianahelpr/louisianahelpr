/**
 * declutter-card — Declutter row 36 (a saved card to offer or Buy; charged
 * only when the member buys, or automatically where they turned on automatic
 * charges: one wallet card everywhere, owner 2026-10-18), docs/specs/declutter-auctions.md B31/B39.
 *
 * Opens Stripe's own card-saving page (Checkout, mode=setup) for the signed-in
 * member and returns its URL. Nothing is charged. When the member finishes,
 * stripe-webhook (handlers/declutterCheckout.ts) reads the card off the
 * SetupIntent and stores it with declutter_save_card (service role only); the
 * app never sends card details or Stripe ids anywhere.
 *
 * Stripe mode (owner 2026-10-12): a test account saves its card on the TEST
 * key, everyone else on the live key (stripeModeForParties, decided from the
 * caller's own rows). A card saved in one mode is never reused in the other.
 *
 * Gates: signed in, confirmed email, the hidden 'declutter' switch for the
 * VERIFIED caller (saving a card is starting something new; row 62), per-IP
 * rate limit.
 */
import { serve } from "../_shared/buildStamp.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import { requireFeature } from "../_shared/featureSwitch.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { stripeModeForParties, stripeModeRefusedResponse, StripeModeRefused, stripeSecretKeyFor } from "../_shared/stripeMode.ts";
import { resolveStripeCustomer, StripeCustomerUnavailable } from "../_shared/stripeCustomer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const rl = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 5, keyPrefix: "declutter-card" });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "not_authenticated" }, 401);
  const anon = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await anon.auth.getUser(authHeader.replace("Bearer ", ""));
  const user = authData?.user;
  if (authError || !user) return json({ error: "not_authenticated" }, 401);
  const unconfirmed = refuseUnconfirmedEmail(user, corsHeaders);
  if (unconfirmed) return unconfirmed;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
  );
  const refused = await requireFeature(admin, "declutter", user, corsHeaders);
  if (refused) return refused;

  try {
    const body = await req.json().catch(() => ({}));
    const native = isNativeRequest(body);
    const mode = await stripeModeForParties(admin, [user.id]);
    const stripe = new Stripe(stripeSecretKeyFor(mode), { apiVersion: "2025-08-27.basil" });

    // One wallet: the member's ONE Stripe customer in this mode (stored, else
    // made and claimed once). Never found by email.
    const customerId = await resolveStripeCustomer(admin, stripe, user, mode);

    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      currency: "usd",
      customer: customerId,
      payment_method_types: ["card"],
      client_reference_id: user.id,
      metadata: { kind: "declutter_card", user_id: user.id },
      setup_intent_data: { metadata: { kind: "declutter_card", user_id: user.id } },
      success_url: buildRedirectUrl("/declutter?card=saved", native),
      cancel_url: buildRedirectUrl("/declutter?card=cancelled", native),
    });
    if (!session.url) return json({ error: "We couldn't open the card page just now. Please try again." }, 502);
    return json({ url: session.url });
  } catch (error) {
    if (error instanceof StripeModeRefused) return stripeModeRefusedResponse(error, corsHeaders);
    if (error instanceof StripeCustomerUnavailable) {
      console.error(`[declutter-card] ${error.message}`);
      return json({ error: "We couldn't open the card page just now. Please try again." }, 503);
    }
    console.error("[declutter-card] error:", error);
    return json({ error: "We couldn't open the card page just now. Please try again." }, 500);
  }
});
