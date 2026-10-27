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
 *   delivery_quote { seller_id, address }  Slice 5 (Helpr delivery, rows 29-30,
 *                38): the BUYER's drop-off address is geocoded HERE (never typed
 *                coordinates: the price is measured from this point), stored with
 *                declutter_set_delivery_dropoff (service only), and the price for
 *                the cart with that seller is returned from
 *                declutter_delivery_quote AS THE BUYER. Nothing is charged.
 *   pay with handover 'delivery' adds the frozen delivery fee as its own line.
 *   raise_pay  { order_id, raise_cents }  Q1929 (row 40): the BUYER raises the
 *                pay of a delivery no Helpr has taken. declutter_delivery_raise_start
 *                AS THE BUYER (every rule in SQL), then a second Stripe page for
 *                the raise + its card fee only, tied to the order (metadata
 *                kind declutter_raise, the order's transfer group). The webhook
 *                applies it only once it is paid.
 *
 *   seller_delivery_quote { seller_id, address? }  The seller delivers
 *                (20261027153244, switch 'declutter_seller_delivery'): with an
 *                address, it is geocoded HERE and stored exactly as for Helpr
 *                delivery; then declutter_seller_delivery_offer AS THE BUYER
 *                answers: available or why not, the seller's rate, the open
 *                times. Nothing is charged and no distance is returned.
 *   pay with handover 'seller_delivery', slot_start (an ISO time from the
 *                offer's slots) and handoff ('leave' | 'hand', the buyer's door
 *                choice): declutter_start_checkout holds the slot and freezes
 *                the rate; the rate is its own "Seller delivery" line.
 *
 * Row 62: no switch check for pay/cancel_sale. Both only finish a sale that was
 * already agreed; starting anything new (offer, Buy, a card, a delivery) needs
 * the switch: delivery_quote checks it here, and declutter_start_checkout
 * refuses 'delivery' without it.
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
import { requireFeature } from "../_shared/featureSwitch.ts";
import { geocodeDropoff, plausibleAddress } from "../_shared/geocodeDropoff.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { storedStripeCustomer } from "../_shared/stripeCustomer.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
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
  /** Slice 5: the Helpr delivery fee frozen on the order (absent before slice 5 = 0). */
  delivery_cents?: number | null;
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

async function startCheckout(asBuyer: Db, sellerId: string, handover: string, slotStart: string | null, handoff: string | null): Promise<{ row?: OrderRow; refusal?: Response }> {
  // p_slot_start and p_handoff only for a seller delivery: every other call is the same call as before.
  const args = handover === "seller_delivery"
    ? { p_seller_id: sellerId, p_handover: handover, p_slot_start: slotStart, p_handoff: handoff }
    : { p_seller_id: sellerId, p_handover: handover };
  const { data, error } = await asBuyer.rpc("declutter_start_checkout", args);
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
  // Seller delivery: the chosen slot, an ISO time; the RPC checks it is one of the open ones.
  const slotStart = handover === "seller_delivery" ? isoTime(body.slot_start) : null;
  if (handover === "seller_delivery" && !slotStart) return json({ error: "slot_unavailable" }, 400);
  // The buyer's door choice (owner 2026-10-22): "leave" it at the door, or "hand" it to me.
  const handoff = handover === "seller_delivery" && (body.handoff === "leave" || body.handoff === "hand") ? body.handoff : null;
  if (handover === "seller_delivery" && !handoff) return json({ error: "invalid_handoff" }, 400);
  // The delivery price the buyer's screen showed (owner 2026-10-27: it may be "Free"). When the
  // order's frozen rate differs (the seller changed it meanwhile), no page is made: the app asks
  // again (lh-money-escrow review of the free-delivery change #2). Optional: an older app sends none.
  const expectedRate = handover === "seller_delivery" && typeof body.expected_delivery_cents === "number"
    && Number.isInteger(body.expected_delivery_cents) && body.expected_delivery_cents >= 0 ? body.expected_delivery_cents : null;
  const native = isNativeRequest(body);

  const mode = await stripeModeForParties(admin, [user.id, sellerId], { caller: user.id });
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
    .select("id, handover, stripe_checkout_session_id, delivery_cents")
    .eq("buyer_id", user.id).eq("seller_id", sellerId).eq("status", "awaiting_payment").maybeSingle();
  if (openErr) {
    console.error(`[declutter-checkout] open order read failed: ${openErr.message}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  const open = openOrder as { id: string; handover: string; stripe_checkout_session_id: string | null; delivery_cents?: number | null } | null;
  // lh-money-escrow review #4: a seller delivery whose TIME changed replaces the open order
  // too, so its page is closed first exactly as for a changed handover.
  let slotChanged = false;
  if (open && handover === "seller_delivery" && open.handover === "seller_delivery") {
    const { data: held, error: heldErr } = await admin.from("declutter_seller_deliveries")
      .select("slot_start").eq("order_id", open.id).maybeSingle();
    if (heldErr) {
      console.error(`[declutter-checkout] held slot read failed: ${heldErr.message}`);
      return json({ error: TRY_AGAIN }, 503);
    }
    const heldAt = (held as { slot_start?: string | null } | null)?.slot_start;
    slotChanged = !heldAt || Date.parse(heldAt) !== Date.parse(slotStart!)
      // Review note 3: a different delivery price (the seller changed it, or the cart crossed the
      // free-delivery amount) replaces the order too, so its open page is closed first.
      || (expectedRate !== null && Number(open.delivery_cents ?? 0) !== expectedRate);
  }
  if (open?.stripe_checkout_session_id) {
    const page = await stripeOf(open.stripe_checkout_session_id).checkout.sessions.retrieve(open.stripe_checkout_session_id);
    if (page.status === "complete") return json({ paid: true, order_id: open.id });
    if (page.status === "open" && (open.handover !== handover || slotChanged)) {
      if (handover === "porch") {
        const refused = await porchRefused(admin, user.id, sellerId);
        if (refused === null) return json({ error: TRY_AGAIN }, 503);
        if (refused) return json({ error: "porch_unavailable" }, 400);
      }
      if (handover === "delivery") {
        // Slice 5: a delivery the RPC would refuse (no address yet, items at two
        // addresses) must not cost the buyer their open page. The RPC stays the protection.
        const { error: quoteErr } = await asBuyer.rpc("declutter_delivery_quote", { p_seller_id: sellerId });
        if (quoteErr) return rpcRefusal(quoteErr);
      }
      if (handover === "seller_delivery") {
        // The same for a seller delivery: a refused offer or a time no longer open
        // must not cost the buyer their open page. The RPC stays the protection.
        const refused = await sellerDeliveryRefused(asBuyer, sellerId, slotStart!);
        if (refused) return refused;
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

  let { row, refusal } = await startCheckout(asBuyer, sellerId, handover, slotStart, handoff);
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
    ({ row, refusal } = await startCheckout(asBuyer, sellerId, handover, slotStart, handoff));
    if (refusal) return refusal;
  }
  const order = row!;
  if (expectedRate !== null && Number(order.delivery_cents ?? 0) !== expectedRate) {
    // The order is left open with no page (its hold lapses; the next checkout replaces it).
    return json({ error: "delivery_rate_changed", delivery_cents: Number(order.delivery_cents ?? 0) }, 409);
  }
  // Slice 5: the delivery fee frozen on the order (0 unless handover is 'delivery'
  // or 'seller_delivery', the seller's rate). A seller delivery may be FREE
  // (owner 2026-10-27: a $0 rate, or the order reached the seller's free-delivery
  // amount), so for it 0 is a real answer; a Helpr delivery always costs, and no
  // other handover carries a delivery charge.
  const deliveryCents = Number(order.delivery_cents ?? 0);
  const deliveryShapeOk = handover === "delivery" ? deliveryCents > 0
    : handover === "seller_delivery" ? Number.isInteger(deliveryCents) && deliveryCents >= 0
    : deliveryCents === 0;
  if (!deliveryShapeOk
      || order.items_cents + order.premium_cents + order.tax_cents + deliveryCents !== order.total_cents || order.total_cents <= 0) {
    console.error(`[declutter-checkout] order ${order.order_id} amounts do not add up`);
    return json({ error: TRY_AGAIN }, 500);
  }
  // Q2352 (owner 2026-10-22, terms #9): the one-time account setup fee the
  // order froze (declutter_start_checkout, 0 when the account paid it). It is
  // charged on this page but sits OUTSIDE total_cents, so no refund of the
  // sale returns it; declutter_mark_order_paid checks the payment against
  // total + this. 42703 (no such column) only while the migration is still
  // deploying: then start_checkout froze none either, and 0 is the truth.
  const { data: feeRow, error: feeErr } = await admin.from("declutter_orders").select("setup_fee_cents")
    .eq("id", order.order_id).maybeSingle();
  if (feeErr && feeErr.code !== "42703") {
    console.error(`[declutter-checkout] setup fee read failed: ${feeErr.message}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  // lh-silent-failure review of the Q2352 rebase #1: no order row is never read as "no fee".
  if (!feeErr && !feeRow) {
    console.error(`[declutter-checkout] order ${order.order_id} not found for its setup fee`);
    return json({ error: TRY_AGAIN }, 503);
  }
  if (feeErr) console.warn(`[declutter-checkout] setup_fee_cents not deployed yet (42703); charging no setup fee for order ${order.order_id}`);
  const setupFeeCents = feeErr ? 0 : Number((feeRow as { setup_fee_cents?: number | null } | null)?.setup_fee_cents ?? 0);
  if (!Number.isInteger(setupFeeCents) || setupFeeCents < 0) {
    console.error(`[declutter-checkout] order ${order.order_id} setup fee is not a whole amount`);
    return json({ error: TRY_AGAIN }, 500);
  }
  const chargeCents = order.total_cents + setupFeeCents;

  // One wallet: the buyer's ONE stored customer (in this mode) pre-fills the
  // page. Today it holds the cards saved through Declutter's card page; Jobs'
  // saved cards join it when Jobs moves onto the wallet (Q2139). A failed read
  // stops here rather than opening a page on a guessed customer.
  let customerId: string | undefined;
  try {
    customerId = (await storedStripeCustomer(admin, user.id, mode)) ?? undefined;
  } catch (e) {
    console.error(`[declutter-checkout] ${caughtMessage(e)}`);
    return json({ error: TRY_AGAIN }, 503);
  }

  const meta = {
    kind: "declutter_order",
    order_id: order.order_id,
    buyer_id: user.id,
    // The banned-card check (Q1324) reads the payer from payer_id.
    payer_id: user.id,
    seller_id: sellerId,
    // Q2352: what the page charges beyond the sale (the webhook's receipt names it).
    setup_fee_cents: String(setupFeeCents),
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
  if (deliveryCents > 0) {
    // Row 29: $10 + $2 per road mile + size add-ons, computed and frozen in SQL.
    // Seller delivery: the seller's flat rate, frozen in SQL (20261027153244).
    lineItems.push({ quantity: 1, price_data: { currency: "usd", unit_amount: deliveryCents,
      product_data: { name: handover === "seller_delivery" ? "Seller delivery" : "Helpr delivery", tax_code: NONTAXABLE_TAX_CODE } } });
  }
  if (setupFeeCents > 0) {
    lineItems.push({ quantity: 1, price_data: { currency: "usd", unit_amount: setupFeeCents,
      product_data: { name: "One-time account setup fee", tax_code: NONTAXABLE_TAX_CODE } } });
  }
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
      payment_method_options: threeDSecureOptions(chargeCents),
      expires_at: expiresAt,
      success_url: buildRedirectUrl("/declutter?view=cart&paid=1", native),
      cancel_url: buildRedirectUrl("/declutter?view=cart", native),
    },
    { idempotencyKey: `declutter-order-${order.order_id}-${expiresAt}` },
  );
  if (session.amount_total !== chargeCents) {
    await expirePage(stripe, session.id);
    console.error(`[declutter-checkout] Stripe total ${session.amount_total} != order total ${chargeCents}`);
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

async function deliveryQuote(body: Record<string, unknown>, user: { id: string }, asBuyer: Db, admin: Db) {
  const sellerId = typeof body.seller_id === "string" ? body.seller_id : "";
  if (!UUID_RE.test(sellerId) || sellerId === user.id) return json({ error: "item_not_found" }, 404);
  const address = plausibleAddress(body.address);
  if (!address) return json({ error: "invalid_address" }, 400);
  // New work for a Helpr: the switch, from the verified user, never the body.
  const off = await requireFeature(admin, "declutter", user, corsHeaders);
  if (off) return off;
  const point = await geocodeDropoff(address);
  if ("miss" in point) {
    if (point.miss === "not_found") return json({ error: "address_not_found" }, 422);
    // The geocoder itself is down or refusing us: never "check your address".
    console.error(JSON.stringify({ event: "dropoff_geocode_unavailable", status: point.status, detail: point.detail }));
    await postSlackOpsAlert({
      kind: "custom", severity: "warning", oncePerDayKey: "declutter-dropoff-geocode-unavailable",
      title: "Declutter delivery: the address lookup is not answering",
      message: `Nominatim could not answer a drop-off lookup (${point.detail}). Buyers are told to try again in a minute; delivery quotes fail until it answers.`,
      fields: { Status: point.status ?? "no answer" },
    }).catch((e) => console.error(JSON.stringify({ event: "dropoff_geocode_alert_failed", detail: String(e).slice(0, 200) })));
    return json({ error: "geocode_unavailable" }, 503);
  }
  const { error: setErr } = await admin.rpc("declutter_set_delivery_dropoff", {
    p_buyer: user.id, p_seller: sellerId, p_address: address, p_area_label: point.areaLabel, p_lat: point.lat, p_lng: point.lng,
  });
  if (setErr) return rpcRefusal(setErr);
  const { data: quote, error: quoteErr } = await asBuyer.rpc("declutter_delivery_quote", { p_seller_id: sellerId });
  if (quoteErr) return rpcRefusal(quoteErr);
  return json({ quote });
}

type RaiseRow = { raise_id: string; raise_cents: number; card_fee_cents: number; total_cents: number; superseded_session_id: string | null };

/**
 * Q1929 (spec row 40): the BUYER raises the pay of a delivery no Helpr has
 * taken yet. A second Stripe page tied to the order, for the raise and its
 * card fee only (the buyer pays the card cost of this charge). Nothing changes
 * until Stripe says PAID: the webhook (declutterCheckout.ts, kind
 * declutter_raise) applies it, or refunds it if the delivery stopped waiting.
 * The buyer's open raise page, if any, is closed first; a page that already
 * went through is reported as paid and replaces nothing.
 */
async function raisePay(body: Record<string, unknown>, user: { id: string; email?: string }, asBuyer: Db, admin: Db) {
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const raiseCents = typeof body.raise_cents === "number" && Number.isInteger(body.raise_cents) ? body.raise_cents : NaN;
  if (!UUID_RE.test(orderId)) return json({ error: "item_not_found" }, 404);
  if (!Number.isFinite(raiseCents)) return json({ error: "invalid_raise" }, 400);
  // New money toward a Helpr: the switch, from the verified user, never the body.
  const switchOff = await requireFeature(admin, "declutter", user, corsHeaders);
  if (switchOff) return switchOff;
  const { data: orderRow, error: orderErr } = await admin.from("declutter_orders")
    .select("buyer_id, seller_id").eq("id", orderId).maybeSingle();
  if (orderErr) {
    console.error(`[declutter-checkout] raise order read failed: ${orderErr.message}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  const parties = orderRow as { buyer_id: string | null; seller_id: string | null } | null;
  // Anyone but the buyer: the same answer as an unknown order (the RPC says so too).
  if (!parties || parties.buyer_id !== user.id) return json({ error: "item_not_found" }, 404);
  const mode = await stripeModeForParties(admin, [user.id, parties.seller_id], { caller: user.id });
  const stripe = new Stripe(stripeSecretKeyFor(mode), { apiVersion: "2025-08-27.basil" });

  // The open raise page first: already paid -> say so and replace nothing (the webhook applies it).
  // It is CLOSED only after the SQL accepted the new raise (lh-authz-rls review #4): a refused
  // request never costs the buyer the page they have open.
  const { data: openRaise, error: openErr } = await admin.from("declutter_delivery_raises")
    .select("id, stripe_checkout_session_id").eq("order_id", orderId).eq("status", "awaiting_payment").maybeSingle();
  if (openErr) {
    console.error(`[declutter-checkout] open raise read failed: ${openErr.message}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  const openPage = (openRaise as { stripe_checkout_session_id: string | null } | null)?.stripe_checkout_session_id ?? null;
  if (openPage) {
    const m = sessionIdMode(openPage);
    const pageStripe = m && m !== mode ? new Stripe(stripeSecretKeyFor(m), { apiVersion: "2025-08-27.basil" }) : stripe;
    const page = await pageStripe.checkout.sessions.retrieve(openPage);
    if (page.status === "complete") return json({ paid: true, order_id: orderId });
  }

  const { data, error } = await asBuyer.rpc("declutter_delivery_raise_start", { p_order_id: orderId, p_raise_cents: raiseCents });
  // This function can deploy before its migration (20261021185418): say it is not available yet, never "try again".
  if (error?.code === "PGRST202") return json({ error: "raise_unavailable" }, 503);
  if (error) return rpcRefusal(error);
  const raise = (Array.isArray(data) ? data[0] : data) as RaiseRow | undefined;
  if (!raise?.raise_id || raise.raise_cents !== raiseCents || raise.raise_cents + raise.card_fee_cents !== raise.total_cents) {
    console.error(`[declutter-checkout] raise for order ${orderId} came back without its amounts`);
    return json({ error: TRY_AGAIN }, 500);
  }
  if (raise.superseded_session_id) {
    // The page this raise replaced is closed now; one paid in the meantime is refunded in full by the webhook
    // (its row is 'superseded': page_replaced).
    const m = sessionIdMode(raise.superseded_session_id);
    if (m) await expirePage(new Stripe(stripeSecretKeyFor(m), { apiVersion: "2025-08-27.basil" }), raise.superseded_session_id);
  }

  let payerCustomer: string | undefined;
  try {
    payerCustomer = (await storedStripeCustomer(admin, user.id, mode)) ?? undefined;
  } catch (e) {
    console.error(`[declutter-checkout] ${caughtMessage(e)}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  const meta = {
    kind: "declutter_raise",
    raise_id: raise.raise_id,
    order_id: orderId,
    buyer_id: user.id,
    // The banned-card check (Q1324) reads the payer from payer_id.
    payer_id: parties.buyer_id,
    seller_id: parties.seller_id ?? "",
  };
  const expiresAt = Math.floor(Date.now() / 1000) + PAGE_LIFETIME_S;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        { quantity: 1, price_data: { currency: "usd", unit_amount: raise.raise_cents,
          product_data: { name: "Higher Helpr delivery pay", tax_code: NONTAXABLE_TAX_CODE } } },
        { quantity: 1, price_data: { currency: "usd", unit_amount: raise.card_fee_cents,
          product_data: { name: "Card fee", tax_code: NONTAXABLE_TAX_CODE } } },
      ],
      ...(payerCustomer ? { customer: payerCustomer } : { customer_email: user.email ?? undefined }),
      client_reference_id: orderId,
      metadata: meta,
      // The order's own transfer group: the Helpr's payout draws the raise from this charge.
      payment_intent_data: { metadata: meta, transfer_group: `declutter_order_${orderId}` },
      payment_method_options: threeDSecureOptions(raise.total_cents),
      expires_at: expiresAt,
      success_url: buildRedirectUrl("/declutter?view=cart&raised=1", isNativeRequest(body)),
      cancel_url: buildRedirectUrl("/declutter?view=cart", isNativeRequest(body)),
    },
    { idempotencyKey: `declutter-raise-${raise.raise_id}` },
  );
  if (session.amount_total !== raise.total_cents) {
    await expirePage(stripe, session.id);
    console.error(`[declutter-checkout] Stripe total ${session.amount_total} != raise total ${raise.total_cents}`);
    return json({ error: TRY_AGAIN }, 500);
  }
  const { error: attachErr } = await admin.rpc("declutter_delivery_raise_attach", { p_raise_id: raise.raise_id, p_session_id: session.id });
  if (attachErr) {
    // Another tap replaced this raise first: its page is the buyer's, ours is closed.
    await expirePage(stripe, session.id);
    return json({ error: TRY_AGAIN }, 409);
  }
  return json({ url: session.url, order_id: orderId, raise_id: raise.raise_id });
}

/** An ISO time string the database can read, or null. */
function isoTime(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 40 || Number.isNaN(Date.parse(v))) return null;
  return new Date(v).toISOString();
}

/**
 * Would declutter_start_checkout refuse this seller delivery (offer not
 * available, or the time no longer open)? Asked only before closing an open
 * page to switch it to seller delivery. null = it would go ahead.
 */
async function sellerDeliveryRefused(asBuyer: Db, sellerId: string, slotStart: string): Promise<Response | null> {
  const { data, error } = await asBuyer.rpc("declutter_seller_delivery_offer", { p_seller_id: sellerId });
  if (error) return rpcRefusal(error);
  const offer = data as { available?: boolean; reason?: string | null; slots?: string[] } | null;
  if (!offer?.available) return json({ error: "seller_delivery_unavailable", reason: offer?.reason ?? null }, 400);
  const want = Date.parse(slotStart);
  if (!(offer.slots ?? []).some((s) => Date.parse(s) === want)) return json({ error: "slot_unavailable" }, 400);
  return null;
}

async function sellerDeliveryQuote(body: Record<string, unknown>, user: { id: string }, asBuyer: Db, admin: Db) {
  const sellerId = typeof body.seller_id === "string" ? body.seller_id : "";
  if (!UUID_RE.test(sellerId) || sellerId === user.id) return json({ error: "item_not_found" }, 404);
  // New work for the seller: the switch, from the verified user, never the body.
  const off = await requireFeature(admin, "declutter_seller_delivery", user, corsHeaders);
  if (off) return off;
  const declutterOff = await requireFeature(admin, "declutter", user, corsHeaders);
  if (declutterOff) return declutterOff;
  // lh-authz-rls review #3: the buyer's own cart with this seller first (the offer RPC's
  // cart and seller checks), so no address is geocoded or stored against an arbitrary id.
  const { error: cartErr } = await asBuyer.rpc("declutter_seller_delivery_offer", { p_seller_id: sellerId });
  if (cartErr) return rpcRefusal(cartErr);
  if (body.address !== undefined && body.address !== null && body.address !== "") {
    const address = plausibleAddress(body.address);
    if (!address) return json({ error: "invalid_address" }, 400);
    const point = await geocodeDropoff(address);
    if ("miss" in point) {
      if (point.miss === "not_found") return json({ error: "address_not_found" }, 422);
      console.error(JSON.stringify({ event: "dropoff_geocode_unavailable", status: point.status, detail: point.detail }));
      await postSlackOpsAlert({
        kind: "custom", severity: "warning", oncePerDayKey: "declutter-dropoff-geocode-unavailable",
        title: "Declutter delivery: the address lookup is not answering",
        message: `Nominatim could not answer a drop-off lookup (${point.detail}). Buyers are told to try again in a minute; delivery quotes fail until it answers.`,
        fields: { Status: point.status ?? "no answer" },
      }).catch((e) => console.error(JSON.stringify({ event: "dropoff_geocode_alert_failed", detail: String(e).slice(0, 200) })));
      return json({ error: "geocode_unavailable" }, 503);
    }
    const { error: setErr } = await admin.rpc("declutter_set_delivery_dropoff", {
      p_buyer: user.id, p_seller: sellerId, p_address: address, p_area_label: point.areaLabel, p_lat: point.lat, p_lng: point.lng,
    });
    // A seller id that is no member (foreign key) answers like any unknown seller.
    if (setErr) return setErr.code === "23503" ? json({ error: "item_not_found" }, 404) : rpcRefusal(setErr);
  }
  const { data: offer, error: offerErr } = await asBuyer.rpc("declutter_seller_delivery_offer", { p_seller_id: sellerId });
  if (offerErr) return rpcRefusal(offerErr);
  return json({ offer });
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
    if (body.action === "delivery_quote") return await deliveryQuote(body, user, asMember, admin);
    if (body.action === "raise_pay") return await raisePay(body, user, asMember, admin);
    if (body.action === "seller_delivery_quote") return await sellerDeliveryQuote(body, user, asMember, admin);
    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    if (error instanceof StripeModeRefused) return stripeModeRefusedResponse(error, corsHeaders);
    console.error("[declutter-checkout] error:", error);
    return json({ error: TRY_AGAIN }, 500);
  }
});
