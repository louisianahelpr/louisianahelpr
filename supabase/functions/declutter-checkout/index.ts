/**
 * declutter-checkout — the Stripe step of a Declutter sale
 * (docs/specs/declutter-auctions.md rows 6, 13, 19-22, 38, 59-62; B30, B38,
 * B44, B45). Two actions:
 *
 *   pay          { seller_id, handover }  The BUYER checks out their cart lines
 *                for one seller. declutter_start_checkout runs AS THE BUYER
 *                (every rule is in SQL: cart, deadline, seller, handover) and
 *                freezes ONE order. This opens a Stripe Checkout page for
 *                exactly that order's total_cents (separate charges and
 *                transfers: no transfer_data, the money stays on the platform
 *                until slice 4's handover), records it with
 *                declutter_attach_checkout_session, and returns its URL. The
 *                buyer pays on Stripe's page; NOTHING here charges a card.
 *                  - Idempotent: the same order's open page is returned; one
 *                    Stripe idempotency key per order per minute, and the
 *                    database keeps the first page it was given.
 *                  - A superseded order's page is expired at once; a page that
 *                    timed out unpaid retires its order and a fresh one is made.
 *                  - Pages live 30 min (Stripe's minimum), so a page opened
 *                    before the checkout deadline is dead before the sweep's
 *                    1 h grace ends (B45).
 *   cancel_sale  { item_id }  The SELLER backs out of an accepted, unpaid sale
 *                (declutter_seller_cancel_sale AS THE SELLER: seller strike,
 *                row 19), then the page the buyer may have open is expired so
 *                the dead order cannot be paid (B45). A payment that still
 *                lands is refunded by the webhook (B40).
 *
 * Row 62: no switch check here. Both actions only finish a sale that was
 * already agreed; starting anything new (offer, Buy, a card) needs the switch.
 * Stripe mode (owner 2026-10-12): test accounts on the TEST key, everyone else
 * live; a buyer and seller of different kinds cannot trade (409).
 */
import { serve } from "../_shared/buildStamp.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { NONTAXABLE_TAX_CODE } from "../_shared/salesTax.ts";
import { threeDSecureOptions } from "../_shared/threeDSecure.ts";
import {
  sessionIdMode,
  stripeModeForParties,
  stripeModeRefusedResponse,
  StripeModeRefused,
  stripeSecretKeyFor,
} from "../_shared/stripeMode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Stripe's minimum Checkout lifetime is 30 minutes; one more for clock skew. */
const PAGE_LIFETIME_S = 31 * 60;
const TRY_AGAIN = "We couldn't open the payment page just now. Please try again.";

type OrderRow = {
  order_id: string;
  items_cents: number;
  premium_cents: number;
  tax_cents: number;
  total_cents: number;
  superseded_session_id: string | null;
  checkout_session_id: string | null;
};

/** An RPC refusal as the app's error code (the SQL message) + a status. */
function rpcRefusal(error: { message?: string; code?: string; hint?: string }): Response {
  const status = error.code === "P0002" ? 404 : error.code === "42501" ? 403 : error.code === "22023" ? 400 : 409;
  return json({ error: error.message ?? "refused", hint: error.hint ?? null }, status);
}

// deno-lint-ignore no-explicit-any
type Db = any;

/** Expire a Stripe page; an already-finished one is fine. Never throws. */
async function expirePage(stripe: Stripe, sessionId: string): Promise<void> {
  try {
    await stripe.checkout.sessions.expire(sessionId);
  } catch (e) {
    // Stripe refuses to expire a page that is already complete or expired:
    // either way it can no longer take a new payment. Logged, not fatal.
    console.log(JSON.stringify({ event: "declutter_page_expire_skipped", session: sessionId, detail: String(e).slice(0, 200) }));
  }
}

async function startCheckout(asBuyer: Db, sellerId: string, handover: string): Promise<{ row?: OrderRow; refusal?: Response }> {
  const { data, error } = await asBuyer.rpc("declutter_start_checkout", { p_seller_id: sellerId, p_handover: handover });
  if (error) return { refusal: rpcRefusal(error) };
  const row = (Array.isArray(data) ? data[0] : data) as OrderRow | undefined;
  if (!row?.order_id) return { refusal: json({ error: TRY_AGAIN }, 500) };
  return { row };
}

/**
 * Row 101: would declutter_start_checkout refuse porch for this buyer's cart
 * with this seller (an item whose seller turned porch off)? Asked only before
 * closing an open page to switch it TO porch, so a request the RPC refuses
 * does not cost the buyer their open page (lh-money-escrow review, porch
 * default #1). The RPC stays the protection; this is only the order of steps.
 * null = could not tell (the caller answers "try again").
 */
async function porchRefused(admin: Db, buyerId: string, sellerId: string): Promise<boolean | null> {
  const { data: lines, error: linesErr } = await admin.from("declutter_cart_items").select("item_id")
    .eq("buyer_id", buyerId).eq("seller_id", sellerId).eq("status", "in_cart");
  if (linesErr) {
    console.error(`[declutter-checkout] cart read failed: ${linesErr.message}`);
    return null;
  }
  const ids = ((lines ?? []) as { item_id: string }[]).map((l) => l.item_id);
  if (ids.length === 0) return false;
  const { data: off, error: offErr } = await admin.from("declutter_items").select("id").in("id", ids).eq("porch_ok", false).limit(1);
  if (offErr) {
    console.error(`[declutter-checkout] porch read failed: ${offErr.message}`);
    return null;
  }
  return ((off ?? []) as unknown[]).length > 0;
}

async function pay(body: Record<string, unknown>, user: { id: string; email?: string }, asBuyer: Db, admin: Db) {
  const sellerId = typeof body.seller_id === "string" ? body.seller_id : "";
  const handover = typeof body.handover === "string" ? body.handover : "";
  if (!UUID_RE.test(sellerId)) return json({ error: "item_not_found" }, 404);
  const native = isNativeRequest(body);

  const mode = await stripeModeForParties(admin, [user.id, sellerId]);
  const stripe = new Stripe(stripeSecretKeyFor(mode), { apiVersion: "2025-08-27.basil" });
  /** A stored page runs in the mode its id was minted in (lh-money-escrow review 3b #9). */
  const stripeOf = (sessionId: string): Stripe => {
    const m = sessionIdMode(sessionId);
    return m && m !== mode ? new Stripe(stripeSecretKeyFor(m), { apiVersion: "2025-08-27.basil" }) : stripe;
  };

  // Before anything can replace the buyer's open order, look at its page
  // (lh-money-escrow review 3b #2): already paid -> say so and replace nothing
  // (the webhook records it); still open -> close it first, so the old page
  // can never be paid next to the new one. A page that cannot be closed
  // stays the buyer's page.
  const { data: openOrder, error: openErr } = await admin.from("declutter_orders")
    .select("id, handover, stripe_checkout_session_id")
    .eq("buyer_id", user.id).eq("seller_id", sellerId).eq("status", "awaiting_payment").maybeSingle();
  if (openErr) {
    console.error(`[declutter-checkout] open order read failed: ${openErr.message}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  const open = openOrder as { id: string; handover: string; stripe_checkout_session_id: string | null } | null;
  if (open?.stripe_checkout_session_id) {
    const page = await stripeOf(open.stripe_checkout_session_id).checkout.sessions.retrieve(open.stripe_checkout_session_id);
    if (page.status === "complete") return json({ paid: true, order_id: open.id });
    if (page.status === "open" && open.handover !== handover) {
      if (handover === "porch") {
        const refused = await porchRefused(admin, user.id, sellerId);
        if (refused === null) return json({ error: TRY_AGAIN }, 503);
        if (refused) return json({ error: "porch_unavailable" }, 400);
      }
      try {
        await stripeOf(open.stripe_checkout_session_id).checkout.sessions.expire(open.stripe_checkout_session_id);
      } catch (e) {
        // Paid in the meantime (Stripe refuses to expire a complete page).
        console.log(JSON.stringify({ event: "declutter_page_expire_refused", session: open.stripe_checkout_session_id, detail: String(e).slice(0, 200) }));
        return json({ paid: true, order_id: open.id });
      }
    }
  }

  let { row, refusal } = await startCheckout(asBuyer, sellerId, handover);
  if (refusal) return refusal;

  if (row!.superseded_session_id) await expirePage(stripeOf(row!.superseded_session_id), row!.superseded_session_id);
  if (row!.checkout_session_id) {
    const existing = await stripeOf(row!.checkout_session_id).checkout.sessions.retrieve(row!.checkout_session_id);
    if (existing.status === "open" && existing.url) return json({ url: existing.url, order_id: row!.order_id });
    if (existing.status === "complete") return json({ paid: true, order_id: row!.order_id });
    // Timed out unpaid: retire this order, then make a fresh one.
    const { error: retireErr } = await admin.rpc("declutter_retire_order", {
      p_order_id: row!.order_id, p_buyer: user.id, p_session_id: row!.checkout_session_id,
    });
    if (retireErr) {
      console.error(`[declutter-checkout] retire failed: ${retireErr.message}`);
      return json({ error: TRY_AGAIN }, 503);
    }
    ({ row, refusal } = await startCheckout(asBuyer, sellerId, handover));
    if (refusal) return refusal;
  }
  const order = row!;
  if (order.items_cents + order.premium_cents + order.tax_cents !== order.total_cents || order.total_cents <= 0) {
    console.error(`[declutter-checkout] order ${order.order_id} amounts do not add up`);
    return json({ error: TRY_AGAIN }, 500);
  }

  // The buyer's saved card's customer pre-fills the page, in the same mode only.
  const { data: card } = await admin.from("declutter_buyer_cards").select("stripe_customer_id, card_mode")
    .eq("user_id", user.id).maybeSingle();
  const customerId = card && (card as { card_mode?: string }).card_mode === mode
    ? (card as { stripe_customer_id?: string }).stripe_customer_id ?? undefined
    : undefined;

  const meta = {
    kind: "declutter_order",
    order_id: order.order_id,
    buyer_id: user.id,
    // The banned-card check (Q1324) reads the payer from payer_id.
    payer_id: user.id,
    seller_id: sellerId,
  };
  // Casual sellers' sales are exempt (row 54 (1)); a business-like seller is
  // refused at checkout until the tax slice (B33), so no tax line exists yet.
  if (order.tax_cents !== 0) {
    console.error(`[declutter-checkout] order ${order.order_id} carries tax before the tax slice`);
    return json({ error: TRY_AGAIN }, 500);
  }
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { quantity: 1, price_data: { currency: "usd", unit_amount: order.items_cents,
      product_data: { name: "Declutter items", tax_code: NONTAXABLE_TAX_CODE } } },
    { quantity: 1, price_data: { currency: "usd", unit_amount: order.premium_cents,
      product_data: { name: "Buyer's fee (5% + 70¢)", tax_code: NONTAXABLE_TAX_CODE } } },
  ];
  // now + 31 min, never less (lh-money-escrow review 3b #11); taps in the same
  // second share one page through the idempotency key, and a second page from
  // another second is expired when it loses the attach below.
  const expiresAt = Math.floor(Date.now() / 1000) + PAGE_LIFETIME_S;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      ...(customerId ? { customer: customerId } : { customer_email: user.email ?? undefined }),
      client_reference_id: order.order_id,
      metadata: meta,
      payment_intent_data: { metadata: meta, transfer_group: `declutter_order_${order.order_id}` },
      // Q202: 3D Secure from $300 up (card-fraud disputes move to the issuer).
      payment_method_options: threeDSecureOptions(order.total_cents),
      expires_at: expiresAt,
      success_url: buildRedirectUrl("/declutter?view=cart&paid=1", native),
      cancel_url: buildRedirectUrl("/declutter?view=cart", native),
    },
    { idempotencyKey: `declutter-order-${order.order_id}-${expiresAt}` },
  );
  if (session.amount_total !== order.total_cents) {
    await expirePage(stripe, session.id);
    console.error(`[declutter-checkout] Stripe total ${session.amount_total} != order total ${order.total_cents}`);
    return json({ error: TRY_AGAIN }, 500);
  }
  const { error: attachErr } = await admin.rpc("declutter_attach_checkout_session", {
    p_order_id: order.order_id, p_session_id: session.id,
  });
  if (attachErr) {
    // Another tap attached its page first: keep that one, retire ours.
    await expirePage(stripe, session.id);
    const { data: kept } = await admin.from("declutter_orders").select("stripe_checkout_session_id, status")
      .eq("id", order.order_id).maybeSingle();
    const keptId = (kept as { stripe_checkout_session_id?: string | null; status?: string } | null);
    if (keptId?.status === "awaiting_payment" && keptId.stripe_checkout_session_id) {
      const other = await stripeOf(keptId.stripe_checkout_session_id).checkout.sessions.retrieve(keptId.stripe_checkout_session_id);
      if (other.status === "open" && other.url) return json({ url: other.url, order_id: order.order_id });
    }
    return json({ error: TRY_AGAIN }, 409);
  }
  return json({ url: session.url, order_id: order.order_id });
}

async function cancelSale(body: Record<string, unknown>, user: { id: string }, asSeller: Db, admin: Db) {
  const itemId = typeof body.item_id === "string" ? body.item_id : "";
  if (!UUID_RE.test(itemId)) return json({ error: "item_not_found" }, 404);
  const { data: strikes, error } = await asSeller.rpc("declutter_seller_cancel_sale", { p_item_id: itemId });
  if (error) return rpcRefusal(error);
  const { data: sessionId, error: readErr } = await admin.rpc("declutter_cancelled_sale_session", {
    p_item_id: itemId, p_seller: user.id,
  });
  if (readErr) {
    // The sale IS cancelled; the page dies within 30 min on its own and a
    // payment on it is refunded in full by the webhook.
    console.error(`[declutter-checkout] cancelled-sale page read failed: ${readErr.message}`);
  } else if (typeof sessionId === "string" && sessionId) {
    const mode = sessionIdMode(sessionId);
    if (mode) await expirePage(new Stripe(stripeSecretKeyFor(mode), { apiVersion: "2025-08-27.basil" }), sessionId);
  }
  return json({ strikes });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const rl = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 10, keyPrefix: "declutter-checkout" });
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
    if (body.action === "pay") return await pay(body, user, asMember, admin);
    if (body.action === "cancel_sale") return await cancelSale(body, user, asMember, admin);
    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    if (error instanceof StripeModeRefused) return stripeModeRefusedResponse(error, corsHeaders);
    console.error("[declutter-checkout] error:", error);
    return json({ error: TRY_AGAIN }, 500);
  }
});
