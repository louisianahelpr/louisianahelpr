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
 *   delivery_tip { task_id, tip_cents, tip_attempt_id }  Q2453: the BUYER tips
 *                the Helpr of a delivery that is done. helpr_task_tip_start AS
 *                THE BUYER (every rule in SQL), then a Stripe page that follows
 *                the job tip (create-payment action "tip") EXACTLY: a
 *                destination charge to the Helpr's own account for
 *                tipChargeBreakdown's charge, application fee = the card fee,
 *                so the Helpr receives the whole tip (_shared/tipFees.ts); the
 *                same payout-account, payout-hold and ban-review refusals; the
 *                attempt id keys the page. The webhook marks it paid
 *                (metadata kind declutter_delivery_tip).
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
import { geocodeDropoff, plausibleAddress, type AppleMapsAccess } from "../_shared/geocodeDropoff.ts";
import { mapkitKeyFromEnv, signMapkitJwt } from "../_shared/mapkitJwt.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { storedStripeCustomer } from "../_shared/stripeCustomer.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { declutterCheckoutLineName } from "../_shared/declutterCheckoutName.ts";
import { TIP_MAX_CENTS, TIP_MIN_CENTS, TIP_PAYMENT_METHOD_TYPES, tipChargeBreakdown } from "../_shared/tipFees.ts";
import { checkIdentityHold, checkPayoutHold, PAYOUT_HELD_CODE } from "../_shared/payoutHold.ts";
import { noteDestinationChargeRefused } from "../_shared/livePayoutHold.ts";
import { loadBanReviewUsers } from "../_shared/banReview.ts";
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
  /** Shipping S3 (20261101201500): the postage frozen from the buyer's quote (0 for every other way). */
  shipping_cents?: number | null;
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

/** B110: the pickups whose day and time the buyer may choose at checkout. */
const PICKUP_TIMED = ["porch", "pickup_home", "meetup"];

async function startCheckout(asBuyer: Db, sellerId: string, handover: string, slotStart: string | null, handoff: string | null,
  quoteId: string | null = null): Promise<{ row?: OrderRow; refusal?: Response }> {
  // p_slot_start and p_handoff for a seller delivery; p_slot_start alone for a pickup whose time the buyer chose at
  // checkout (B110, 20261101191500); p_quote_id for a shipped order (Shipping S3, 20261101201500: the buyer's stored
  // ship-rates quote; the RPC prices it, never this function). Every other call is the same call as before.
  const args = handover === "ship"
    ? { p_seller_id: sellerId, p_handover: handover, p_quote_id: quoteId }
    : handover === "seller_delivery"
    ? { p_seller_id: sellerId, p_handover: handover, p_slot_start: slotStart, p_handoff: handoff }
    : slotStart && PICKUP_TIMED.includes(handover)
      ? { p_seller_id: sellerId, p_handover: handover, p_slot_start: slotStart }
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

/**
 * Owner 2026-10-28: would declutter_start_checkout refuse this way because an item in the buyer's cart with
 * this seller does not offer it (declutter_items.handovers; NULL = an older item, every way)? Asked only
 * before closing an open page to switch it, as porchRefused. null = could not tell. Before migration
 * 20261028235247 reaches prod the column is missing (42703): nothing is refused for it then.
 */
async function handoverNotOffered(admin: Db, buyerId: string, sellerId: string, handover: string): Promise<boolean | null> {
  // Shipping S3: 'ship' is not one of the ticked ways; the RPC checks every item has a parcel (ship_preset) instead.
  if (handover === "ship") return false;
  // The lines the RPC groups: in the cart and not past their checkout time (review nit 6).
  const { data: lines, error: linesErr } = await admin.from("declutter_cart_items").select("item_id, price_cents")
    .eq("buyer_id", buyerId).eq("seller_id", sellerId).eq("status", "in_cart").gt("checkout_by", new Date().toISOString());
  if (linesErr) {
    console.error(`[declutter-checkout] cart read failed: ${linesErr.message}`);
    return null;
  }
  const cart = (lines ?? []) as { item_id: string; price_cents: number }[];
  const ids = cart.map((l) => l.item_id);
  if (ids.length === 0) return false;
  const { data: items, error: itemsErr } = await admin.from("declutter_items").select("id, handovers, porch_ok, price_cents").in("id", ids);
  if (itemsErr) {
    if ((itemsErr as { code?: string }).code === "42703") return false;
    console.error(`[declutter-checkout] handovers read failed: ${itemsErr.message}`);
    return null;
  }
  const rows = (items ?? []) as { handovers: string[] | null; porch_ok: boolean | null; price_cents: number }[];
  if (!rows.some((i) => Array.isArray(i.handovers))) return false;
  // Paid only when every line and its item carry a price (as the SQL rule's all_paid).
  const allPaid = cart.every((l) => l.price_cents > 0) && rows.length > 0 && rows.every((i) => i.price_cents > 0);
  // An older line allows every way, but not porch when its porch is off (as the SQL rule).
  return handoverRefusedFor(rows.map((i) => (Array.isArray(i.handovers) ? i.handovers
    : i.porch_ok === false ? ["pickup_home", "seller_delivery", "meetup", "delivery"] : null)), handover, allPaid);
}

/**
 * declutter_handover_refused, the same rule (20261030045905): Helpr delivery is never refused for paid lines
 * (owner 2026-10-29, DC-4: buyers can always choose it); any other way must be one every line allows (NULL =
 * every way). No fallback to the seller's door (owner 2026-10-28, Q2462 #3730): when none works, the buyer and
 * seller talk it through in the app (declutter_open_handover_talk).
 */
function handoverRefusedFor(lineWays: (string[] | null)[], handover: string, allPaid: boolean): boolean {
  const ticked = lineWays.filter((w): w is string[] => Array.isArray(w));
  if (ticked.length === 0) return false;
  if (handover === "delivery" && allPaid) return false;
  const shared = ["porch", "pickup_home", "seller_delivery", "meetup", "delivery"].filter((w) => ticked.every((t) => t.includes(w)));
  return !shared.includes(handover);
}

async function pay(body: Record<string, unknown>, user: { id: string; email?: string }, asBuyer: Db, admin: Db) {
  const sellerId = typeof body.seller_id === "string" ? body.seller_id : "";
  const handover = typeof body.handover === "string" ? body.handover : "";
  if (!UUID_RE.test(sellerId)) return json({ error: "item_not_found" }, 404);
  // Seller delivery: the chosen slot, an ISO time; the RPC checks it is one of the open ones.
  // B110: a porch / door / meetup pickup may carry the time the buyer chose (optional: an older app sends none);
  // the RPC checks it is ahead, within 7 days and inside the seller's hours.
  const slotStart = handover === "seller_delivery" || PICKUP_TIMED.includes(handover) ? isoTime(body.slot_start) : null;
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
  // Shipping S3 (Q2259): the buyer's own ship-rates quote, by id only (the RPC checks it is theirs, fresh and for
  // these lines, and takes the price from it).
  const quoteId = handover === "ship" && typeof body.quote_id === "string" && UUID_RE.test(body.quote_id) ? body.quote_id : null;
  if (handover === "ship" && !quoteId) return json({ error: "shipping_quote_needed" }, 400);

  const mode = await stripeModeForParties(admin, [user.id, sellerId], { caller: user.id });
  // Labels are bought in EasyPost TEST mode only until the owner turns shipping on (lead 2026-10-30, money review
  // fix 8): a shipped order is never paid on the live Stripe key.
  if (handover === "ship" && mode !== "test") return json({ error: "shipping_test_only" }, 409);
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
    .select("id, handover, stripe_checkout_session_id, delivery_cents, bundle_discount_cents, pickup_slot_start, shipping_quote_id")
    .eq("buyer_id", user.id).eq("seller_id", sellerId).eq("status", "awaiting_payment").maybeSingle();
  if (openErr) {
    console.error(`[declutter-checkout] open order read failed: ${openErr.message}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  const open = openOrder as { id: string; handover: string; stripe_checkout_session_id: string | null; delivery_cents?: number | null;
    bundle_discount_cents?: number | null; pickup_slot_start?: string | null; shipping_quote_id?: string | null } | null;
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
  // Q2425 (lh-authz-rls review #2): a meetup whose SPOT changed replaces the open order too, so its page is
  // closed first, exactly as for a changed seller-delivery time (the order's frozen spot vs the buyer's pick now).
  let spotChanged = false;
  if (open && handover === "meetup" && open.handover === "meetup") {
    const [frozen, picked] = await Promise.all([
      admin.from("declutter_order_meetups").select("spot_id").eq("order_id", open.id).maybeSingle(),
      admin.from("declutter_meetup_choices").select("spot_id").eq("buyer_id", user.id).eq("seller_id", sellerId).maybeSingle(),
    ]);
    if (frozen.error || picked.error) {
      console.error(`[declutter-checkout] meetup spot read failed: ${(frozen.error ?? picked.error)!.message}`);
      return json({ error: TRY_AGAIN }, 503);
    }
    const frozenSpot = (frozen.data as { spot_id?: string | null } | null)?.spot_id ?? null;
    const pickedSpot = (picked.data as { spot_id?: string | null } | null)?.spot_id ?? null;
    spotChanged = frozenSpot !== pickedSpot;
  }
  // B110: a pickup whose chosen TIME changed replaces the open order too, so its page is closed first.
  const pickupChanged = !!open && PICKUP_TIMED.includes(handover) && open.handover === handover
    && (open.pickup_slot_start ? Date.parse(open.pickup_slot_start) : null) !== (slotStart ? Date.parse(slotStart) : null);
  // Shipping S3: a new quote (a new price or address) replaces the open order too, so its page is closed first.
  const quoteChanged = !!open && handover === "ship" && open.handover === "ship" && (open.shipping_quote_id ?? null) !== quoteId;
  if (open?.stripe_checkout_session_id) {
    const page = await stripeOf(open.stripe_checkout_session_id).checkout.sessions.retrieve(open.stripe_checkout_session_id);
    if (page.status === "complete") return json({ paid: true, order_id: open.id });
    // Q2427 (lead ruling 2): the SELLER changed or removed their bundle discount while the buyer's page is open,
    // so the order's frozen discount is not the one checkout gives now. Close that page FIRST, exactly as for a
    // changed time or spot: a payment on it is then the old order, paid as the buyer saw it, never a superseded
    // order the webhook refunds as the buyer's own restart (which keeps the card fee). The preview reads the
    // buyer's cart from this seller now, through the same computation checkout runs; when that cart is not the
    // order's lines any more, checkout replaces the order anyway, so closing first is never worse. Read only for
    // an open page, after the retrieve (follow-up review notes 4-5: a paid page is answered first, and the gap
    // to checkout is as short as the slot and spot checks').
    let bundleChanged = false;
    if (page.status === "open") {
      const { data: off, error: offErr } = await asBuyer.rpc("declutter_bundle_preview", { p_seller_id: sellerId });
      if (offErr) {
        console.error(`[declutter-checkout] bundle preview failed: ${offErr.message}`);
        return json({ error: TRY_AGAIN }, 503);
      }
      bundleChanged = Number(off ?? 0) !== Number(open.bundle_discount_cents ?? 0);
    }
    if (page.status === "open" && (open.handover !== handover || slotChanged || spotChanged || bundleChanged || pickupChanged || quoteChanged)) {
      // Owner 2026-10-28: a way the seller did not tick must not cost the buyer their open page either
      // (declutter_start_checkout refuses it: handover_not_offered; the RPC stays the protection).
      const notOffered = await handoverNotOffered(admin, user.id, sellerId, handover);
      if (notOffered === null) return json({ error: TRY_AGAIN }, 503);
      if (notOffered) return json({ error: "handover_not_offered" }, 400);
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
      if (handover === "meetup") {
        // Q2425: a meetup with no spot chosen (or none near any more) must not cost the buyer their open page
        // either. The RPC stays the protection (declutter_start_checkout: meetup_spot_needed).
        const { data: spots, error: spotsErr } = await asBuyer.rpc("declutter_meetup_spots_near", { p_seller_id: sellerId });
        if (spotsErr) return rpcRefusal(spotsErr);
        const chosen = Array.isArray(spots) && spots.some((s: { chosen?: boolean }) => s.chosen === true);
        if (!chosen) return json({ error: "meetup_spot_needed" }, 400);
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

  let { row, refusal } = await startCheckout(asBuyer, sellerId, handover, slotStart, handoff, quoteId);
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
    ({ row, refusal } = await startCheckout(asBuyer, sellerId, handover, slotStart, handoff, quoteId));
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
  // Shipping S3: postage only on a shipped order, and always there (the RPC took it from the quote).
  const shippingCents = Number(order.shipping_cents ?? 0);
  const shippingShapeOk = handover === "ship" ? Number.isInteger(shippingCents) && shippingCents > 0 : shippingCents === 0;
  if (!deliveryShapeOk || !shippingShapeOk
      || order.items_cents + order.premium_cents + order.tax_cents + deliveryCents + shippingCents !== order.total_cents
      || order.total_cents <= 0) {
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
    // Shipping S3: a shipped order's page is a card HOLD (money review fix 2); the webhook records the hold and the
    // label worker captures only after the label is bought (a failed label releases the hold at no cost).
    ...(handover === "ship" ? { ship: "1" } : {}),
  };
  // Casual sellers' sales are exempt (row 54 (1)); a business-like seller is
  // refused at checkout until the tax slice (B33), so no tax line exists yet.
  if (order.tax_cents !== 0) {
    console.error(`[declutter-checkout] order ${order.order_id} carries tax before the tax slice`);
    return json({ error: TRY_AGAIN }, 500);
  }
  // Owner 2026-10-25 (issue #3672): members never see a fee name or number, so
  // the page shows ONE line for the purchase, the items and the buyer's premium
  // together (the same cents the order froze; the total check below is unchanged).
  // Audit 1a #15 (2026-10-29): that line carries the item's own title (or the first
  // title + how many more), never a generic label, so every page names what is
  // being bought. A failed title read is logged and falls back to the generic name:
  // the label never blocks a payment, and the amounts are untouched either way.
  const { data: titleRows, error: titleErr } = await admin.from("declutter_cart_items")
    .select("declutter_items(title)").eq("order_id", order.order_id);
  if (titleErr) console.error(`[declutter-checkout] order ${order.order_id} item titles not read: ${titleErr.message}`);
  const purchaseName = declutterCheckoutLineName(
    ((titleRows ?? []) as { declutter_items: { title?: string | null } | null }[]).map((r) => r.declutter_items?.title),
  );
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { quantity: 1, price_data: { currency: "usd", unit_amount: order.items_cents + order.premium_cents,
      product_data: { name: purchaseName, tax_code: NONTAXABLE_TAX_CODE } } },
  ];
  if (deliveryCents > 0) {
    // Row 29: $10 + $2 per road mile + size add-ons, computed and frozen in SQL.
    // Seller delivery: the seller's flat rate, frozen in SQL (20261027153244).
    lineItems.push({ quantity: 1, price_data: { currency: "usd", unit_amount: deliveryCents,
      product_data: { name: handover === "seller_delivery" ? "Seller delivery" : "Helpr delivery", tax_code: NONTAXABLE_TAX_CODE } } });
  }
  if (shippingCents > 0) {
    // The postage the buyer picked (ship-rates quote), the exact rate the label is bought at.
    lineItems.push({ quantity: 1, price_data: { currency: "usd", unit_amount: shippingCents,
      product_data: { name: "Shipping", tax_code: NONTAXABLE_TAX_CODE } } });
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
      // Link hidden (audit 2026-10-28 #22): card-only still pre-ticked Link and asked for a phone.
      wallet_options: { link: { display: "never" } },
      line_items: lineItems,
      ...(customerId ? { customer: customerId } : { customer_email: user.email ?? undefined }),
      client_reference_id: order.order_id,
      metadata: meta,
      payment_intent_data: { metadata: meta, transfer_group: `declutter_order_${order.order_id}`,
        ...(handover === "ship" ? { capture_method: "manual" as const } : {}) },
      // Q202: 3D Secure from $300 up (card-fraud disputes move to the issuer).
      payment_method_options: threeDSecureOptions(chargeCents),
      expires_at: expiresAt,
      // B48 live check 2026-10-29: the return names the order just paid, so "What happens next" opens for it even
      // when the buyer has other paid orders in their handover (BoughtWhatNext, justPaidOrder).
      success_url: buildRedirectUrl(`/declutter?view=cart&paid=1&order=${order.order_id}`, native),
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

/**
 * Apple Maps for the drop-off lookup (Q2413): Nominatim answers 403 to this server, so the
 * MapKit key the app's maps already use signs a 5-minute developer token per lookup.
 * null when the key is not set: the lookup then asks Nominatim alone, as before.
 */
function appleMapsAccess(): AppleMapsAccess | null {
  const key = mapkitKeyFromEnv((name) => Deno.env.get(name));
  return key ? { developerToken: () => signMapkitJwt(key, 300) } : null;
}

async function deliveryQuote(body: Record<string, unknown>, user: { id: string }, asBuyer: Db, admin: Db) {
  const sellerId = typeof body.seller_id === "string" ? body.seller_id : "";
  if (!UUID_RE.test(sellerId) || sellerId === user.id) return json({ error: "item_not_found" }, 404);
  const address = plausibleAddress(body.address);
  if (!address) return json({ error: "invalid_address" }, 400);
  // New work for a Helpr: the switch, from the verified user, never the body.
  const off = await requireFeature(admin, "declutter", user, corsHeaders);
  if (off) return off;
  const point = await geocodeDropoff(address, fetch, appleMapsAccess());
  if ("miss" in point) {
    if (point.miss === "not_found") return json({ error: "address_not_found" }, 422);
    // The geocoder itself is down or refusing us: never "check your address".
    console.error(JSON.stringify({ event: "dropoff_geocode_unavailable", status: point.status, detail: point.detail }));
    await postSlackOpsAlert({
      kind: "custom", severity: "warning", oncePerDayKey: "declutter-dropoff-geocode-unavailable",
      title: "Declutter delivery: the address lookup is not answering",
      message: `Neither Apple Maps nor Nominatim could answer a drop-off lookup (${point.detail}). Buyers are told to try again in a minute; delivery quotes fail until it answers.`,
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
      wallet_options: { link: { display: "never" } },
      // One line, the raise and its card cost together (owner 2026-10-25, issue #3672: no fee
      // line a member reads); the cents are the raise row's own and the total check is unchanged.
      line_items: [
        { quantity: 1, price_data: { currency: "usd", unit_amount: raise.raise_cents + raise.card_fee_cents,
          product_data: { name: "Raise the delivery pay", tax_code: NONTAXABLE_TAX_CODE } } },
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

type TipStart = { tip_id: string; helpr_id: string | null; tip_cents: number; title: string; payment_status: string; stripe_session_id: string | null; held?: boolean };

/**
 * Q2453: the BUYER tips the Helpr of a delivery that is done. The money is the job tip's
 * (create-payment action "tip"), line for line: the Helpr receives the whole tip, the card fee
 * is added on top for the buyer inside ONE line (owner 2026-10-25: no fee line), the platform
 * keeps only that fee (application_fee_amount), card and Link only, 3D Secure from $300.
 */
async function deliveryTip(body: Record<string, unknown>, user: { id: string; email?: string }, asBuyer: Db, admin: Db) {
  const taskId = typeof body.task_id === "string" ? body.task_id : "";
  if (!UUID_RE.test(taskId)) return json({ error: "task_not_found" }, 404);
  // The prompt's own id (one per opening): it keys the page, so a retry of one prompt is one page.
  const attemptId = typeof body.tip_attempt_id === "string" && UUID_RE.test(body.tip_attempt_id) ? body.tip_attempt_id : "";
  const tipCents = typeof body.tip_cents === "number" && Number.isInteger(body.tip_cents) ? body.tip_cents : NaN;
  if (!attemptId || !(tipCents >= TIP_MIN_CENTS && tipCents <= TIP_MAX_CENTS)) return json({ error: "invalid_tip" }, 400);
  const tipSwitchOff = await requireFeature(admin, "declutter", user, corsHeaders);
  if (tipSwitchOff) return tipSwitchOff;
  const { data, error } = await asBuyer.rpc("helpr_task_tip_start", { p_task_id: taskId, p_tip_cents: tipCents, p_attempt_id: attemptId });
  if (error?.code === "PGRST202") return json({ error: "tip_unavailable" }, 503);
  if (error) return rpcRefusal(error);
  const tip = (Array.isArray(data) ? data[0] : data) as TipStart | undefined;
  if (!tip?.tip_id || !tip.helpr_id || tip.tip_cents !== tipCents) {
    console.error(`[declutter-checkout] tip for task ${taskId} came back without its row`);
    return json({ error: TRY_AGAIN }, 500);
  }
  if (tip.payment_status === "paid") return json({ error: "tip_already_paid" }, 409);
  const helprId = tip.helpr_id;
  // Q1324, as a job tip: the payer under a ban review is told to contact support; a Helpr under
  // review gets the payout-hold reply, so the buyer never learns a review exists. Fails closed.
  const review = await loadBanReviewUsers(admin, [user.id, helprId]);
  if (!review.ok) throw new Error(`ban review read failed: ${review.message}`);
  if (review.users.has(user.id)) return json({ error: "payment_review" }, 403);
  // The Helpr's own Stripe account (a destination charge pays them directly). A read error fails:
  // it must never be taken for "no account".
  const { data: helpr, error: helprErr } = await admin.from("profiles").select("stripe_account_id").eq("user_id", helprId).maybeSingle();
  if (helprErr) {
    console.error(`[declutter-checkout] tip: Helpr profile read failed for ${helprId}: ${helprErr.message}`);
    return json({ error: "tip_check_failed" }, 500);
  }
  const account = (helpr as { stripe_account_id?: string | null } | null)?.stripe_account_id ?? null;
  // Owner #3706: a Helpr with no payout account still gets the tip; the SQL marked the row held and
  // it is paid with their held delivery pay. A row NOT held needs the account (a destination charge).
  const held = tip.held === true;
  if (!held && !account) {
    return json({ error: "tip_helpr_no_payout" }, 400);
  }
  const hold = await checkPayoutHold(admin, helprId);
  if (hold.kind === "error") {
    console.error(`[declutter-checkout] tip: payout hold check failed for ${helprId}: ${hold.message}`);
    return json({ error: "tip_check_failed" }, 500);
  }
  if (hold.kind === "held" || review.users.has(helprId)) {
    return json({ error: "tip_helpr_held", code: PAYOUT_HELD_CODE }, 409);
  }
  // Owner 2026-10-30: no tip until the Helpr has verified their ID: no page opens and no money is taken. The unpaid row
  // start wrote is harmless (it holds nothing). FALSE while the identity_check switch is off. Fails closed.
  const tipIdHold = await checkIdentityHold(admin, helprId);
  if (tipIdHold.kind === "error") {
    console.error(`[declutter-checkout] tip: ID check read failed for ${helprId}: ${tipIdHold.message}`);
    return json({ error: "tip_check_failed" }, 500);
  }
  if (tipIdHold.kind === "waits") return json({ error: "tip_waits_on_identity" }, 409);
  const mode = await stripeModeForParties(admin, [user.id, helprId], { caller: user.id });
  const stripe = new Stripe(stripeSecretKeyFor(mode), { apiVersion: "2025-08-27.basil" });
  // A row that already has a page (a retry after Stripe's key window): that page, never a second one.
  if (tip.stripe_session_id) {
    const pageMode = sessionIdMode(tip.stripe_session_id);
    const pageStripe = pageMode && pageMode !== mode ? new Stripe(stripeSecretKeyFor(pageMode), { apiVersion: "2025-08-27.basil" }) : stripe;
    let prior: Stripe.Checkout.Session | null = null;
    try {
      prior = await pageStripe.checkout.sessions.retrieve(tip.stripe_session_id);
    } catch (e) {
      console.error(`[declutter-checkout] tip ${tip.tip_id}: prior page read failed: ${caughtMessage(e)}`);
      return json({ error: TRY_AGAIN }, 500);
    }
    if (prior.status === "open" && prior.url) return json({ url: prior.url, tip_id: tip.tip_id });
    if (prior.status === "complete") return json({ error: "tip_already_paid" }, 409);
    return json({ error: "tip_page_closed" }, 409);
  }
  const q = tipChargeBreakdown(tipCents);
  let payerCustomer: string | undefined;
  try {
    payerCustomer = (await storedStripeCustomer(admin, user.id, mode)) ?? undefined;
  } catch (e) {
    // The page asks for the email instead: the stored customer only pre-fills it.
    console.error(`[declutter-checkout] tip: stored customer read failed: ${caughtMessage(e)}`);
  }
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      ...(payerCustomer ? { customer: payerCustomer } : { customer_email: user.email }),
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          tax_behavior: "exclusive",
          // Owner 2026-10-25: the tipper sees only the total they pay, no card-fee line; the
          // application fee below still keeps exactly the fee, so the Helpr's transfer is the tip.
          product_data: { name: `Tip — ${tip.title}`, description: `Your Helpr receives your whole $${(q.tipCents / 100).toFixed(2)} tip.`, tax_code: NONTAXABLE_TAX_CODE },
          unit_amount: q.chargeCents,
        },
      }],
      // Card (incl. Apple/Google Pay) and Link only: the fee recovers the CARD rate (Q383).
      payment_method_types: TIP_PAYMENT_METHOD_TYPES,
      adaptive_pricing: { enabled: false },
      payment_method_options: threeDSecureOptions(q.chargeCents),
      payment_intent_data: {
        // Held (owner #3706): charged on the platform; declutter-money transfers exactly the tip from this
        // charge with the delivery pay. Otherwise the job tip's destination charge: the Helpr gets
        // charge - application fee = the tip at once.
        ...(held ? {} : { transfer_data: { destination: account as string }, application_fee_amount: q.feeCents }),
        // tipper_id: a refund or dispute notice finds who paid (refundNotice reads md.tipper_id; lh-money-escrow review #3).
        metadata: { kind: "declutter_delivery_tip", tip_id: tip.tip_id, tipper_id: user.id, held: held ? "1" : "0", tip_cents: String(q.tipCents), fee_cents: String(q.feeCents), helper_cents: String(q.helperCents) },
      },
      metadata: { kind: "declutter_delivery_tip", tip_id: tip.tip_id, task_id: taskId, tipper_id: user.id, helpr_id: helprId, tip_cents: String(q.tipCents), charge_cents: String(q.chargeCents) },
      success_url: buildRedirectUrl("/declutter?view=cart&tipped=1", isNativeRequest(body)),
      cancel_url: buildRedirectUrl("/declutter?view=cart", isNativeRequest(body)),
    }, { idempotencyKey: `delivery-tip-${tip.tip_id}-c${q.chargeCents}` });
  } catch (tipErr) {
    const refused = await noteDestinationChargeRefused(tipErr, {
      fn: "declutter-checkout", what: "A delivery tip checkout", helperId: helprId, fields: { task_id: taskId, tip_cents: tipCents, held: held ? "yes" : "no" },
    });
    // Stripe refused the Helpr's account before any money moved; the ops alert is sent (once a day).
    if (refused) return json({ error: "tip_not_sent" }, 409);
    throw tipErr;
  }
  const { data: attached, error: attachErr } = await admin.rpc("helpr_task_tip_attach", { p_tip_id: tip.tip_id, p_session_id: session.id });
  if (attachErr) {
    // Not recorded yet: the page stays open, and a retry replays this same page (the Stripe key) and
    // records it (lh-money-escrow review nit 5: expiring it here would hand the retry a dead page).
    console.error(`[declutter-checkout] tip ${tip.tip_id}: page not recorded: ${attachErr.message}`);
    return json({ error: TRY_AGAIN }, 500);
  }
  if (attached !== true) {
    // The row kept another page: this one must not stay payable.
    console.error(`[declutter-checkout] tip ${tip.tip_id}: the row holds another page`);
    await expirePage(stripe, session.id);
    return json({ error: TRY_AGAIN }, 409);
  }
  return json({ url: session.url, tip_id: tip.tip_id });
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
    if (body.action === "delivery_tip") return await deliveryTip(body, user, asMember, admin);
    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    if (error instanceof StripeModeRefused) return stripeModeRefusedResponse(error, corsHeaders);
    console.error("[declutter-checkout] error:", error);
    return json({ error: TRY_AGAIN }, 500);
  }
});
