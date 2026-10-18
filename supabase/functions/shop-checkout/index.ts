/**
 * shop-checkout — the Stripe step of a Shops order (Shops M1, migration
 * 20261018164442_shops_orders_checkout; docs/specs/local-shops-prep.md L17-L22,
 * L37/F1, L41 + O2, O1; plan ~/.lh-wt/handoffs-1017/shops-s3-plan.md).
 *
 *   order   { shop_id, lines: [{item_id, quantity}], ready_date, note }  THE BUYER.
 *           shops_request_order runs AS THE BUYER (every rule is in SQL) and
 *           freezes ONE order; this opens a Stripe Checkout page with
 *           capture_method=manual (a card HOLD: Stripe docs "Place a hold on a
 *           payment method"), Stripe Tax on (owner O1), and records it with
 *           shop_attach_checkout_session. Nothing is charged here. A page the
 *           buyer had open for this shop is expired (superseded).
 *   accept  { order_id }  THE MAKER. shops_accept_order AS THE MAKER (row
 *           lock, stock and the daily cap re-checked), then the hold is
 *           captured (_shared/shopHolds.ts). A capture that does not answer is
 *           retried by declutter-money every 10 minutes.
 *   decline { order_id, reason }  THE MAKER. shops_decline_order, then the hold
 *           is cancelled at no cost.
 *   cancel  { order_id }  THE BUYER, before the maker answers. The page is
 *           expired or the hold cancelled; nothing is kept (O2).
 *
 * Money: the buyer pays the item prices + Declutter's F1 fee (5% + 70c, the
 * card cost inside it; the shop keeps 100% of its prices) + Stripe Tax, all
 * frozen or checked in SQL. M1b part 2 (tax memo Q3): a pickup sale is taxed
 * where the buyer takes it, so every line carries the shop's private pickup
 * address as a Stripe Tax performance location (pickupTaxLocation). The money stays on the platform until handover
 * (M2): no transfer_data here.
 *
 * L91: order and accept need the 'shops' switch (in SQL); decline and cancel
 * only let a buyer's money go, so they work with the switch off.
 * Stripe mode (owner 2026-10-12): test accounts on the TEST key, everyone else
 * live; a buyer and a shop of different kinds cannot trade (409).
 * Stripe is LIVE on prod: tests run this file only through the edge harness.
 */
import { serve } from "../_shared/buildStamp.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { SHOP_KIND_TAX_CODE, shopTaxCode, splitBuyerFeeByTaxCode } from "../_shared/shopTaxCodes.ts";
import { threeDSecureOptions } from "../_shared/threeDSecure.ts";
import { storedStripeCustomer } from "../_shared/stripeCustomer.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { captureShopHold, releaseShopHold, shopOrderMode } from "../_shared/shopHolds.ts";
import {
  sessionIdMode,
  stripeModeForParties,
  stripeModeRefusedResponse,
  StripeModeRefused,
  stripeSecretKeyFor,
  type StripeMode,
} from "../_shared/stripeMode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Stripe's minimum Checkout lifetime is 30 minutes; one more for clock skew. */
const PAGE_LIFETIME_S = 31 * 60;
const TRY_AGAIN = "We couldn't open the payment page just now. Please try again.";
const API_VERSION = "2025-08-27.basil";

// deno-lint-ignore no-explicit-any
type Db = any;

/** An RPC refusal as the app's error code (the SQL message) + a status. */
function rpcRefusal(error: { message?: string; code?: string; hint?: string }): Response {
  const status = error.code === "P0002" ? 404 : error.code === "42501" ? 403 : error.code === "22023" || error.code === "23514" ? 400 : 409;
  return json({ error: error.message ?? "refused", hint: error.hint ?? null }, status);
}

const stripeFor = (mode: StripeMode) => new Stripe(stripeSecretKeyFor(mode), { apiVersion: API_VERSION });

/** Expire a Stripe page; an already-finished one is fine. Never throws. */
async function expirePage(sessionId: string): Promise<void> {
  const mode = sessionIdMode(sessionId);
  if (!mode) return;
  try {
    await stripeFor(mode).checkout.sessions.expire(sessionId);
  } catch (e) {
    // Stripe refuses to expire a page that is already complete or expired:
    // either way it can no longer start a new hold. Logged, not fatal.
    console.log(JSON.stringify({ event: "shop_page_expire_skipped", session: sessionId, detail: String(e).slice(0, 200) }));
  }
}

type OrderMoneyRow = {
  id: string; buyer_id: string | null; seller_id: string | null; status: string;
  items_cents: number; premium_cents: number; stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null; payment_livemode: boolean | null; captured_at: string | null;
  capture_attempts: number;
};
async function readOrder(admin: Db, orderId: string): Promise<OrderMoneyRow | null> {
  const { data, error } = await admin.from("shop_orders")
    .select("id, buyer_id, seller_id, status, items_cents, premium_cents, stripe_checkout_session_id, stripe_payment_intent_id, payment_livemode, captured_at, capture_attempts")
    .eq("id", orderId).maybeSingle();
  if (error) throw new Error(`shop order read failed: ${error.message}`);
  return (data as OrderMoneyRow | null) ?? null;
}

/** The Stripe client for an order's existing money: recorded mode / page prefix, else the parties. */
async function stripeForOrder(admin: Db, o: OrderMoneyRow): Promise<Stripe> {
  const mode = shopOrderMode({ livemode: o.payment_livemode, checkout_session_id: o.stripe_checkout_session_id })
    ?? await stripeModeForParties(admin, [o.buyer_id, o.seller_id]);
  return stripeFor(mode);
}

/**
 * The shop's pickup address as a Stripe Tax location (type performance), made
 * once per address and Stripe mode and cached on shop_pickup_addresses (the
 * table's trigger clears the cache when the address changes). Null when the
 * shop has no pickup address (the SQL refuses such an order first; this is the
 * race where it vanished). MEASURED in Stripe TEST mode 2026-10-18 (probe,
 * ~/.lh-wt/handoffs-1017/shops-s3-taxloc-probe-1018.json): stripe@18.5.0 has no
 * stripe.tax.locations, POST /v1/tax/locations works on 2025-08-27.basil
 * through rawRequest, and a Lafayette location taxed a Baton Rouge buyer's
 * line at Lafayette's 9% instead of Baton Rouge's 10.5%.
 */
async function pickupTaxLocation(
  stripe: Stripe, admin: Db, shopId: string, mode: StripeMode,
): Promise<{ id: string } | "missing" | "unusable"> {
  const { data, error } = await admin.from("shop_pickup_addresses")
    .select("line1, line2, city, state_code, postal_code, stripe_tax_location_id, stripe_tax_location_mode, updated_at")
    .eq("shop_id", shopId).maybeSingle();
  if (error) throw new Error(`pickup address read failed: ${error.message}`);
  const a = data as {
    line1: string; line2: string | null; city: string; state_code: string; postal_code: string;
    stripe_tax_location_id: string | null; stripe_tax_location_mode: string | null; updated_at: string;
  } | null;
  if (!a) return "missing";
  if (a.stripe_tax_location_id && a.stripe_tax_location_mode === mode) return { id: a.stripe_tax_location_id };
  const make = () => stripe.rawRequest("POST", "/v1/tax/locations", {
    type: "performance",
    description: `Shop pickup ${shopId}`,
    address: { line1: a.line1, ...(a.line2 ? { line2: a.line2 } : {}), city: a.city, state: a.state_code, postal_code: a.postal_code, country: "US" },
  }, { idempotencyKey: `shop-taxloc-${shopId}-${mode}-${a.updated_at}` }) as unknown as Promise<{ id?: string }>;
  let created: { id?: string };
  try {
    try {
      created = await make();
    } catch (e) {
      // Two first orders at once share the key: Stripe answers the second with
      // idempotency_key_in_use while the first runs. One retry gets the first's
      // answer (review 2026-10-18, finding 4).
      if ((e as { code?: string } | null)?.code !== "idempotency_key_in_use") throw e;
      await new Promise((r) => setTimeout(r, 750));
      created = await make();
    }
  } catch (e) {
    // Stripe refusing the address itself (an invalid_request on the address)
    // will refuse it on every try: say so in its own words instead of a
    // generic error forever (review 2026-10-18, finding 2). Anything else
    // (network, 5xx, auth) is a try-again.
    const err = e as { type?: string; code?: string; message?: string } | null;
    if (err?.type === "StripeInvalidRequestError" && err.code !== "idempotency_key_in_use") {
      console.error(JSON.stringify({ event: "shop_pickup_address_unusable", shop: shopId, mode, detail: err.message ?? null }));
      return "unusable";
    }
    throw e;
  }
  const id = typeof created?.id === "string" && created.id.startsWith("taxloc_") ? created.id : null;
  if (!id) throw new Error("tax location create returned no id");
  // Cache it only for the address it was made from (an edit since then cleared
  // the cache and moved updated_at, so this matches no row).
  const { error: saveErr } = await admin.from("shop_pickup_addresses")
    .update({ stripe_tax_location_id: id, stripe_tax_location_mode: mode })
    .eq("shop_id", shopId).eq("updated_at", a.updated_at);
  if (saveErr) {
    // Not fatal: this order uses the location; the next one makes (or, within
    // Stripe's idempotency window, gets back) the same one.
    console.error(JSON.stringify({ event: "shop_tax_location_cache_failed", shop: shopId, detail: saveErr.message }));
  }
  return { id };
}

/** Stripe's product_data with tax_details (tax code + performance location): newer than stripe@18.5.0's types. */
type TaxedProductData = Omit<Stripe.Checkout.SessionCreateParams.LineItem.PriceData.ProductData, "tax_code"> & {
  tax_details: { tax_code: string; performance_location: string };
};

async function order(body: Record<string, unknown>, user: { id: string; email?: string }, asBuyer: Db, admin: Db) {
  const shopId = typeof body.shop_id === "string" ? body.shop_id : "";
  const readyDate = typeof body.ready_date === "string" ? body.ready_date : "";
  if (!UUID_RE.test(shopId)) return json({ error: "shop_not_found" }, 404);
  if (!DATE_RE.test(readyDate)) return json({ error: "ready_date_too_soon" }, 400);
  if (!Array.isArray(body.lines)) return json({ error: "invalid_order_lines" }, 400);
  const note = typeof body.note === "string" ? body.note : "";
  const native = isNativeRequest(body);

  // The SQL's own gates first, as the buyer (switch, ban, the shop visible to them,
  // not blocked): nothing is sent to Stripe for a caller the order would refuse,
  // and the address answers below tell nothing to such a caller (authz review
  // 2026-10-18, note 1).
  const { error: termsErr } = await asBuyer.rpc("shops_order_terms", { p_shop_id: shopId });
  if (termsErr) return rpcRefusal(termsErr);

  // The shop's pickup address as a Stripe Tax location FIRST: shops_request_order
  // retires the buyer's previous page, so nothing that can fail on the address
  // may run after it (review 2026-10-18, finding 3). No shop row: the SQL below
  // refuses in its own words.
  const { data: shopRow, error: shopErr } = await admin.from("shops").select("owner_id").eq("id", shopId).maybeSingle();
  if (shopErr) {
    console.error(`[shop-checkout] shop read failed: ${shopErr.message}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  const ownerId = (shopRow as { owner_id?: string | null } | null)?.owner_id ?? null;
  let mode: StripeMode | null = null;
  let location: string | null = null;
  if (ownerId) {
    mode = await stripeModeForParties(admin, [user.id, ownerId]);
    const loc = await pickupTaxLocation(stripeFor(mode), admin, shopId, mode);
    if (loc === "missing") return json({ error: "pickup_address_missing" }, 409);
    if (loc === "unusable") return json({ error: "pickup_address_unusable" }, 409);
    location = loc.id;
  }

  const { data, error } = await asBuyer.rpc("shops_request_order", {
    p_shop_id: shopId, p_lines: body.lines, p_ready_date: readyDate, p_note: note,
  });
  if (error) return rpcRefusal(error);
  const frozen = data as { order_id?: string; items_cents?: number; premium_cents?: number; superseded_session_id?: string | null } | null;
  if (!frozen?.order_id) return json({ error: TRY_AGAIN }, 500);
  if (frozen.superseded_session_id) await expirePage(frozen.superseded_session_id);

  const o = await readOrder(admin, frozen.order_id);
  if (!o || o.status !== "awaiting_hold" || !o.seller_id) return json({ error: TRY_AGAIN }, 500);
  const { data: lineRows, error: linesErr } = await admin.from("shop_order_lines")
    .select("title, kind, unit_cents, quantity, line_cents").eq("order_id", o.id);
  if (linesErr) {
    console.error(`[shop-checkout] lines read failed: ${linesErr.message}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  const lines = (lineRows ?? []) as Array<{ title: string; kind: string; unit_cents: number; quantity: number; line_cents: number }>;
  const itemsCents = lines.reduce((a, l) => a + l.line_cents, 0);
  if (lines.length === 0 || itemsCents !== o.items_cents || o.items_cents !== frozen.items_cents || o.premium_cents !== frozen.premium_cents) {
    console.error(`[shop-checkout] order ${o.id} amounts do not add up`);
    return json({ error: TRY_AGAIN }, 500);
  }

  // The mode and location were made for the shop's owner; the order must be theirs.
  if (!mode || !location || o.seller_id !== ownerId) {
    console.error(`[shop-checkout] order ${o.id} seller is not the shop's owner read before it`);
    return json({ error: TRY_AGAIN }, 500);
  }
  const stripe = stripeFor(mode);
  const performanceLocation = location;
  // Stripe takes tax_code OR tax_details on a line, never both.
  const taxed = (name: string, taxCode: string): TaxedProductData => ({
    name, tax_details: { tax_code: taxCode, performance_location: performanceLocation },
  });
  // One wallet (owner 2026-10-18): the buyer's ONE stored Stripe customer in this mode pre-fills the
  // page, read only through _shared/stripeCustomer.ts (never by email, never declutter_buyer_cards).
  // A failed read stops here rather than opening a page on a guessed customer (declutter-checkout's rule).
  let customerId: string | undefined;
  try {
    customerId = (await storedStripeCustomer(admin, user.id, mode)) ?? undefined;
  } catch (e) {
    console.error(`[shop-checkout] ${caughtMessage(e)}`);
    return json({ error: TRY_AGAIN }, 503);
  }

  /** The order sheet's own name for the fee; a mixed cart's lines say which items each is for. */
  const feeLineName = (code: string, parts: number) => {
    const base = "Service fee (5% + $0.70)";
    if (parts <= 1) return base;
    if (code === SHOP_KIND_TAX_CODE.made) return `${base}, made items`;
    if (code === SHOP_KIND_TAX_CODE.home_food) return `${base}, food items`;
    return `${base}, other items`;
  };
  const meta = { kind: "shop_order", order_id: o.id, buyer_id: user.id, payer_id: user.id, seller_id: o.seller_id };
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = lines.map((l) => ({
    quantity: l.quantity,
    price_data: {
      currency: "usd", unit_amount: l.unit_cents, tax_behavior: "exclusive",
      product_data: taxed(l.title.slice(0, 120), shopTaxCode(l.kind)),
    },
  }));
  // Memo Q5: the buyer's fee is taxed like the items it is charged on, split
  // pro rata when the cart mixes food and other goods (one line per code).
  const feeParts = splitBuyerFeeByTaxCode(lines, o.premium_cents);
  for (const part of feeParts) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "usd", unit_amount: part.cents, tax_behavior: "exclusive",
        product_data: taxed(feeLineName(part.tax_code, feeParts.length), part.tax_code),
      },
    });
  }
  const expiresAt = Math.floor(Date.now() / 1000) + PAGE_LIFETIME_S;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      // O1: Stripe Tax. Each line is taxed at the pickup location; Stripe still needs the buyer's address.
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      ...(customerId ? { customer: customerId, customer_update: { address: "auto" } } : { customer_email: user.email ?? undefined }),
      client_reference_id: o.id,
      metadata: meta,
      payment_intent_data: { metadata: meta, capture_method: "manual", transfer_group: `shop_order_${o.id}` },
      // Q202: 3D Secure from $300 up (the most it could be before tax).
      payment_method_options: threeDSecureOptions(o.items_cents + o.premium_cents),
      expires_at: expiresAt,
      success_url: buildRedirectUrl("/shops/orders?sent=1", native),
      cancel_url: buildRedirectUrl(`/shops/${shopId}`, native),
    },
    { idempotencyKey: `shop-order-${o.id}` },
  );
  if (session.amount_subtotal !== o.items_cents + o.premium_cents) {
    await expirePage(session.id);
    console.error(`[shop-checkout] Stripe subtotal ${session.amount_subtotal} != order ${o.items_cents + o.premium_cents}`);
    return json({ error: TRY_AGAIN }, 500);
  }
  const { error: attachErr } = await admin.rpc("shop_attach_checkout_session", { p_order_id: o.id, p_session_id: session.id });
  if (attachErr) {
    await expirePage(session.id);
    return json({ error: TRY_AGAIN }, 409);
  }
  return json({ url: session.url, order_id: o.id });
}

async function accept(body: Record<string, unknown>, asMaker: Db, admin: Db) {
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!UUID_RE.test(orderId)) return json({ error: "order_not_found" }, 404);
  const { data, error } = await asMaker.rpc("shops_accept_order", { p_order_id: orderId });
  if (error) return rpcRefusal(error);
  if ((data as { captured?: boolean } | null)?.captured === true) return json({ accepted: true, charged: true });
  const o = await readOrder(admin, orderId);
  if (!o?.stripe_payment_intent_id) return json({ error: TRY_AGAIN }, 503);
  const outcome = await captureShopHold(await stripeForOrder(admin, o), admin, o.id, o.stripe_payment_intent_id, o.capture_attempts ?? 0);
  if (outcome === "hold_lost") return json({ error: "hold_lost" }, 409);
  // will_retry: the order IS accepted; declutter-money finishes the charge.
  return json({ accepted: true, charged: outcome === "captured" });
}

/** After a decline or a buyer cancel: drop the page or the hold now (the cron retries a miss). */
async function letGo(admin: Db, orderId: string): Promise<void> {
  const o = await readOrder(admin, orderId);
  if (!o) return;
  if (!o.stripe_payment_intent_id) {
    if (o.stripe_checkout_session_id) await expirePage(o.stripe_checkout_session_id);
    return;
  }
  try {
    await releaseShopHold(await stripeForOrder(admin, o), admin, {
      order_id: o.id, buyer_id: o.buyer_id, seller_id: o.seller_id, payment_intent_id: o.stripe_payment_intent_id,
      livemode: o.payment_livemode, checkout_session_id: o.stripe_checkout_session_id,
    });
  } catch (e) {
    // The order IS closed in SQL; declutter-money's shop step cancels the hold within 10 minutes.
    console.error(JSON.stringify({ event: "shop_hold_release_deferred", order: o.id, detail: String(e).slice(0, 200) }));
  }
}

async function decline(body: Record<string, unknown>, asMaker: Db, admin: Db) {
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!UUID_RE.test(orderId)) return json({ error: "order_not_found" }, 404);
  const reason = typeof body.reason === "string" ? body.reason : null;
  const { error } = await asMaker.rpc("shops_decline_order", { p_order_id: orderId, p_reason: reason });
  if (error) return rpcRefusal(error);
  await letGo(admin, orderId);
  return json({ declined: true });
}

async function cancel(body: Record<string, unknown>, asBuyer: Db, admin: Db) {
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!UUID_RE.test(orderId)) return json({ error: "order_not_found" }, 404);
  const { error } = await asBuyer.rpc("shops_cancel_order_request", { p_order_id: orderId });
  if (error) return rpcRefusal(error);
  await letGo(admin, orderId);
  return json({ cancelled: true });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const rl = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 10, keyPrefix: "shop-checkout" });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "not_authenticated" }, 401);
  // The member's own client: the RPCs run as them, under every SQL rule.
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

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === "order") return await order(body, user, asMember, admin);
    if (body.action === "accept") return await accept(body, asMember, admin);
    if (body.action === "decline") return await decline(body, asMember, admin);
    if (body.action === "cancel") return await cancel(body, asMember, admin);
    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    if (error instanceof StripeModeRefused) return stripeModeRefusedResponse(error, corsHeaders);
    console.error("[shop-checkout] error:", error);
    return json({ error: TRY_AGAIN }, 500);
  }
});
