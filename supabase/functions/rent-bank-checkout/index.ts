/**
 * rent-bank-checkout — the tenant pays rent by bank IN THE APP (Homes, owner D2/D9; 20261019103751).
 * DRAFT pending the lh-money-escrow review. TEST MODE ONLY: a payment whose parties are not all test
 * accounts is refused before any Stripe call (live needs the owner's and LREC's yes, D1).
 *
 *   pay  { tenancy_id, amount_cents }  rentals_start_bank_rent runs AS THE TENANT (every rule is in SQL:
 *        the switch, member gates, the landlord's bank pay + payouts, one payment in flight, the cap) and
 *        returns the frozen amounts. This opens a Stripe Checkout page for us_bank_account only, for exactly
 *        charge_cents (rent + the bank cost when the tenant pays it), records it with
 *        rentals_bank_rent_attach, and returns its URL. NOTHING here marks anything paid: only the
 *        webhook's payment_intent.succeeded (the bank confirmed) does (rentals_bank_rent_succeeded), and
 *        only then is the landlord's transfer queued (separate charge, then transfer: no transfer_data).
 */
import { serve } from "../_shared/buildStamp.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { NONTAXABLE_TAX_CODE } from "../_shared/salesTax.ts";
import { requireFeature } from "../_shared/featureSwitch.ts";
import { stripeModeForParties, stripeModeRefusedResponse, StripeModeRefused, stripeSecretKeyFor } from "../_shared/stripeMode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Stripe's minimum Checkout lifetime is 30 minutes; one more for clock skew. */
const PAGE_LIFETIME_S = 31 * 60;
const TRY_AGAIN = "We couldn't open the bank payment page just now. Please try again.";

type Started = {
  id: string;
  rent_cents: number;
  fee_cents: number;
  fee_payer: "tenant" | "landlord";
  charge_cents: number;
  transfer_cents: number;
  tenant_id: string;
  landlord_id: string;
};

// deno-lint-ignore no-explicit-any
type Db = any;

function rpcRefusal(error: { message?: string; code?: string }): Response {
  const status = error.code === "P0002" ? 404 : error.code === "42501" ? 403 : error.code === "22023" ? 400 : 409;
  return json({ error: error.message ?? "refused" }, status);
}

async function expirePage(stripe: Stripe, sessionId: string): Promise<void> {
  try {
    await stripe.checkout.sessions.expire(sessionId);
  } catch (e) {
    // A page that is already complete or expired can take no new payment either way.
    console.log(JSON.stringify({ event: "rent_bank_page_expire_skipped", session: sessionId, detail: String(e).slice(0, 200) }));
  }
}

async function pay(body: Record<string, unknown>, user: { id: string; email?: string }, asTenant: Db, admin: Db) {
  const tenancyId = typeof body.tenancy_id === "string" ? body.tenancy_id : "";
  const amount = typeof body.amount_cents === "number" && Number.isInteger(body.amount_cents) ? body.amount_cents : NaN;
  if (!UUID_RE.test(tenancyId)) return json({ error: "tenancy_not_found" }, 404);
  if (!Number.isFinite(amount)) return json({ error: "bad_rent_payment" }, 400);

  // Which mode, from the server's own read of the tenancy (never the body): the landlord is the other party.
  const { data: t, error: tErr } = await admin.from("rental_tenancies").select("landlord_id, tenant_id, status").eq("id", tenancyId).maybeSingle();
  if (tErr) {
    console.error(`[rent-bank-checkout] tenancy read failed: ${tErr.message}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  const tenancy = t as { landlord_id: string; tenant_id: string | null; status: string } | null;
  if (!tenancy || tenancy.tenant_id !== user.id) return json({ error: "tenancy_not_found" }, 404);
  const mode = await stripeModeForParties(admin, [user.id, tenancy.landlord_id]);
  // TEST ONLY until the owner and LREC say yes (D1): no live bank rent, whatever the parties.
  if (mode !== "test") return json({ error: "bank_rent_not_open" }, 409);
  const stripe = new Stripe(stripeSecretKeyFor(mode), { apiVersion: "2025-08-27.basil" });

  const { data, error } = await asTenant.rpc("rentals_start_bank_rent", { p_tenancy_id: tenancyId, p_rent_cents: amount });
  if (error) return rpcRefusal(error);
  const row = data as Started | null;
  if (!row?.id || row.tenant_id !== user.id || row.landlord_id !== tenancy.landlord_id) return json({ error: TRY_AGAIN }, 500);
  if (row.charge_cents !== row.rent_cents + (row.fee_payer === "tenant" ? row.fee_cents : 0) || row.charge_cents <= 0) {
    console.error(`[rent-bank-checkout] bank payment ${row.id} amounts do not add up`);
    return json({ error: TRY_AGAIN }, 500);
  }

  const meta = { kind: "rent_bank_payment", bank_payment_id: row.id, tenancy_id: tenancyId, payer_id: user.id, landlord_id: tenancy.landlord_id };
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { quantity: 1, price_data: { currency: "usd", unit_amount: row.rent_cents, product_data: { name: "Rent", tax_code: NONTAXABLE_TAX_CODE } } },
  ];
  if (row.fee_payer === "tenant" && row.fee_cents > 0) {
    lineItems.push({ quantity: 1, price_data: { currency: "usd", unit_amount: row.fee_cents,
      product_data: { name: "Bank cost (0.8%, at most $5)", tax_code: NONTAXABLE_TAX_CODE } } });
  }
  const native = isNativeRequest(body);
  const expiresAt = Math.floor(Date.now() / 1000) + PAGE_LIFETIME_S;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["us_bank_account"],
      line_items: lineItems,
      customer_email: user.email ?? undefined,
      client_reference_id: row.id,
      metadata: meta,
      payment_intent_data: { metadata: meta, transfer_group: `rent_bank_${row.id}` },
      payment_method_options: { us_bank_account: { verification_method: "instant" } },
      expires_at: expiresAt,
      success_url: buildRedirectUrl("/rentals?bank=processing", native),
      cancel_url: buildRedirectUrl("/rentals", native),
    },
    { idempotencyKey: `rent-bank-${row.id}` },
  );
  if (session.amount_total !== row.charge_cents) {
    await expirePage(stripe, session.id);
    console.error(`[rent-bank-checkout] Stripe total ${session.amount_total} != charge ${row.charge_cents}`);
    return json({ error: TRY_AGAIN }, 500);
  }
  const { error: attachErr } = await admin.rpc("rentals_bank_rent_attach", { p_id: row.id, p_session_id: session.id, p_livemode: session.livemode });
  if (attachErr) {
    await expirePage(stripe, session.id);
    console.error(`[rent-bank-checkout] attach failed: ${attachErr.message}`);
    return json({ error: TRY_AGAIN }, 409);
  }
  return json({ url: session.url, bank_payment_id: row.id });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const rl = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 10, keyPrefix: "rent-bank-checkout" });
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
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
  );
  const off = await requireFeature(admin, "rentals", user, corsHeaders);
  if (off) return off;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === "pay") return await pay(body, user, asMember, admin);
    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    if (error instanceof StripeModeRefused) return stripeModeRefusedResponse(error, corsHeaders);
    console.error("[rent-bank-checkout] error:", error);
    return json({ error: TRY_AGAIN }, 500);
  }
});
