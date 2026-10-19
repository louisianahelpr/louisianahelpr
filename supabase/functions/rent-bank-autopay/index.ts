/**
 * rent-bank-autopay — the tenant saves the bank autopay charges (Homes D7; 20261019103751). DRAFT pending
 * lh-money-escrow. TEST MODE ONLY, like rent-bank-checkout.
 *
 *   save { tenancy_id }  Opens a Stripe Checkout page in SETUP mode for us_bank_account (a mandate for
 *        future rent debits) on the tenant's one wallet customer. Nothing is charged. The webhook
 *        (handlers/rentBank.ts) records the bank with rentals_autopay_saved, checking it is the live
 *        tenancy's own tenant. Turning autopay on is the tenant's own RPC (rentals_set_autopay).
 */
import { serve } from "../_shared/buildStamp.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { requireFeature } from "../_shared/featureSwitch.ts";
import { resolveStripeCustomer } from "../_shared/stripeCustomer.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { stripeModeForParties, stripeModeRefusedResponse, StripeModeRefused, stripeSecretKeyFor } from "../_shared/stripeMode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRY_AGAIN = "We couldn't open the bank page just now. Please try again.";

// deno-lint-ignore no-explicit-any
type Db = any;

async function save(body: Record<string, unknown>, user: { id: string; email?: string }, admin: Db) {
  const tenancyId = typeof body.tenancy_id === "string" ? body.tenancy_id : "";
  if (!UUID_RE.test(tenancyId)) return json({ error: "tenancy_not_found" }, 404);
  const { data: t, error: tErr } = await admin.from("rental_tenancies").select("landlord_id, tenant_id, status").eq("id", tenancyId).maybeSingle();
  if (tErr) {
    console.error(`[rent-bank-autopay] tenancy read failed: ${tErr.message}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  const tenancy = t as { landlord_id: string; tenant_id: string | null; status: string } | null;
  if (!tenancy || tenancy.tenant_id !== user.id || tenancy.status !== "active") return json({ error: "tenancy_not_found" }, 404);
  const { data: plan, error: pErr } = await admin.from("rental_rent_plans").select("bank_pay").eq("tenancy_id", tenancyId).maybeSingle();
  if (pErr) {
    console.error(`[rent-bank-autopay] plan read failed: ${pErr.message}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  if (!(plan as { bank_pay?: boolean } | null)?.bank_pay) return json({ error: "bank_pay_off" }, 400);
  const mode = await stripeModeForParties(admin, [user.id, tenancy.landlord_id]);
  if (mode !== "test") return json({ error: "bank_rent_not_open" }, 409);
  const stripe = new Stripe(stripeSecretKeyFor(mode), { apiVersion: "2025-08-27.basil" });
  let customer: string;
  try {
    customer = await resolveStripeCustomer(admin, stripe, user, mode);
  } catch (e) {
    console.error(`[rent-bank-autopay] ${caughtMessage(e)}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  const meta = { kind: "rent_bank_autopay", tenancy_id: tenancyId, payer_id: user.id, landlord_id: tenancy.landlord_id };
  const native = isNativeRequest(body);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "setup",
      currency: "usd",
      payment_method_types: ["us_bank_account"],
      customer,
      client_reference_id: tenancyId,
      metadata: meta,
      setup_intent_data: { metadata: meta },
      payment_method_options: { us_bank_account: { verification_method: "instant" } },
      success_url: buildRedirectUrl("/rentals?autopay=saved", native),
      cancel_url: buildRedirectUrl("/rentals", native),
    },
    { idempotencyKey: `rent-bank-autopay-${tenancyId}-${Math.floor(Date.now() / 60000)}` },
  );
  return json({ url: session.url });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const rl = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 10, keyPrefix: "rent-bank-autopay" });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "not_authenticated" }, 401);
  const asMember = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await asMember.auth.getUser(authHeader.replace("Bearer ", ""));
  const user = authData?.user;
  if (authError || !user) return json({ error: "not_authenticated" }, 401);
  const unconfirmed = refuseUnconfirmedEmail(user, corsHeaders);
  if (unconfirmed) return unconfirmed;
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "");
  const off = await requireFeature(admin, "rentals", user, corsHeaders);
  if (off) return off;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === "save") return await save(body, user, admin);
    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    if (error instanceof StripeModeRefused) return stripeModeRefusedResponse(error, corsHeaders);
    console.error("[rent-bank-autopay] error:", error);
    return json({ error: TRY_AGAIN }, 500);
  }
});
