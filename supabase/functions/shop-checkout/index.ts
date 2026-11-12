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
 *   close_request { request_id }  THE SHOP declines or THE BUYER withdraws a
 *           custom request (shops_decline_custom_request); the buyer's unpaid
 *           page for that price is expired (custom orders slice 2a).
 *
 * M3 (migration 20261019071055_shops_refunds_cancels_strikes): each action
 * below runs its member RPC FIRST. That RPC locks the order row, decides
 * (the buyer's cancel reads shop_order_free_cancel_until under the lock),
 * records the outcome and writes the refund row, and COMMITS; only then does
 * this send the refund to Stripe (_shared/shopRefunds.ts, key
 * shop-refund-<refund id>). A refund Stripe did not take stays pending and
 * declutter-money sends it within 10 minutes, so the answer is still 200.
 *   buyer_cancel { order_id, expect: 'free' | 'late' }  THE BUYER, after the
 *           accept (O2). free = the price back less Stripe's card fee and its
 *           tax (J3); late = nothing back, the shop is paid (no Stripe call).
 *   shop_cancel  { order_id, reason }  THE SHOP (L42): a full refund, the card
 *           fee billed to the shop, a Shops strike.
 *   no_show      { order_id }  THE SHOP (O3): a late cancel + a buyer strike
 *           (no Stripe call: the shop is paid by the payout step).
 *   admin_refund { order_id, reason, note }  AN ADMIN (M4, L43/L75).
 *   preorder_cancel { order_id }  THE BUYER of a preorder (20261108184654), before the shop marks it ready:
 *           shops_cancel_preorder decides (a full refund after the shop pushed the date; otherwise everything back but
 *           Stripe's card fee and its tax), then the refund is sent as above. 'order' with preorder: true and ONE line
 *           asks for a preorder (shops_request_preorder); its hold is accepted at once and captured by the webhook.
 * 'order' may carry the cancel terms the buyer read (terms: {cancel_policy,
 * ready_tap_cancel}); an order frozen under other terms is closed before any
 * Stripe page opens (409 terms_changed; money review of the M2 ready-tap choice).
 * An older app build sends none: its order freezes the current terms and goes on.
 *
 * Money: the buyer pays the item prices + Declutter's F1 fee (5% + 70c, the
 * card cost inside it; the shop keeps 100% of its prices) + Stripe Tax, all
 * frozen or checked in SQL. M1b part 2 (tax memo Q3): a pickup sale is taxed
 * where the buyer takes it, at the shop's private pickup address.
 * H6 (Q2102 decision b, audit 11-05): the tax is figured with ONE Stripe Tax
 * calculation at that address (shopOrderTax) and charged as its own "Sales
 * tax" line with automatic_tax OFF, exactly as Jobs' job-site tax is
 * (create-payment). Nothing is recorded at the hold: stripe-webhook commits the
 * calculation on payment_intent.succeeded, which a card hold reaches only when
 * it is CAPTURED (_jobTaxCommit.ts), so a declined, expired or withdrawn order
 * never reports tax it never collected. A refund reverses its share
 * (_visitTaxReversal.ts). This also retires the tax/locations call (Q2153).
 * The money stays on the platform until handover (M2): no transfer_data here.
 * Delivery (migration 20261106180902): 'order' may carry delivery {line1, line2?, city, postal_code}. The address
 * is geocoded HERE, before the order freezes (never a point the buyer typed), then shop_set_order_delivery
 * measures it from the shop's public pin, refuses one past the shop's radius and freezes the shop's fee into
 * total_cents. The fee is its own non-taxable "Shop delivery" line (as Declutter's "Seller delivery"), and the
 * tax is figured at the drop-off address, where the buyer takes the order (tax memo Q3).
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
import { refuseStaleTerms } from "../_shared/requireCurrentTerms.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { SHOP_KIND_TAX_CODE, shopTaxCode, splitBuyerFeeByTaxCode } from "../_shared/shopTaxCodes.ts";
import { threeDSecureOptions } from "../_shared/threeDSecure.ts";
import { NONTAXABLE_TAX_CODE } from "../_shared/salesTax.ts";
import { storedStripeCustomer, withStoredWalletCustomer } from "../_shared/stripeCustomer.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { isLockedOut } from "../_shared/banStatus.ts";
import { captureShopHold, releaseShopHold, shopOrderMode } from "../_shared/shopHolds.ts";
import { sendShopRefund, type ShopRefundRow } from "../_shared/shopRefunds.ts";
import { chargeShopBalance } from "../_shared/shopBalance.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { isLouisianaZip5 } from "../_shared/easypostRates.ts";
import { geocodeDropoff, type AppleMapsAccess } from "../_shared/geocodeDropoff.ts";
import { mapkitKeyFromEnv, signMapkitJwt } from "../_shared/mapkitJwt.ts";
import { appleEtas } from "../_shared/appleRoutes.ts";
import { requireFeature } from "../_shared/featureSwitch.ts";
import {
  sessionIdMode,
  stripeModeForParties,
  stripeModeRefusedResponse,
  StripeModeRefused,
  stripeSecretKeyFor,
  type MoneyKind,
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
  const status = error.code === "P0002" || error.code === "PT404" ? 404 : error.code === "42501" ? 403 : error.code === "22023" || error.code === "23514" ? 400 : 409;
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
/** The Stripe page's words for a preorder: charged now, in full. */
const PREORDER_PAGE_TEXT = "This is a preorder. You're charged now, in full. If it is refunded, you get your money back on this card.";

/** A preorder is ONE item: [{ item_id, quantity }]. */
function preorderLineFrom(raw: unknown): { item_id: string; quantity: number } | null {
  if (!Array.isArray(raw) || raw.length !== 1) return null;
  const l = raw[0] as { item_id?: unknown; quantity?: unknown } | null;
  if (!l || typeof l.item_id !== "string" || !UUID_RE.test(l.item_id)) return null;
  const q = Number(l.quantity);
  return Number.isInteger(q) && q >= 1 && q <= 20 ? { item_id: l.item_id, quantity: q } : null;
}

async function readOrder(admin: Db, orderId: string): Promise<OrderMoneyRow | null> {
  const { data, error } = await admin.from("shop_orders")
    .select("id, buyer_id, seller_id, status, items_cents, premium_cents, stripe_checkout_session_id, stripe_payment_intent_id, payment_livemode, captured_at, capture_attempts")
    .eq("id", orderId).maybeSingle();
  if (error) throw new Error(`shop order read failed: ${error.message}`);
  return (data as OrderMoneyRow | null) ?? null;
}

/**
 * The Stripe client for an order's existing money: recorded mode / page prefix, else the parties.
 * `kind`: a capture takes the money ("new"), so an unenrolled test-looking party refuses; a release,
 * refund or refund read gives back or reads ("refund"/"read"), and still runs (Q4).
 */
async function stripeForOrder(
  admin: Db, o: Pick<OrderMoneyRow, "buyer_id" | "seller_id" | "payment_livemode" | "stripe_checkout_session_id">, kind: MoneyKind,
): Promise<Stripe> {
  const mode = shopOrderMode({ livemode: o.payment_livemode, checkout_session_id: o.stripe_checkout_session_id })
    ?? await stripeModeForParties(admin, [o.buyer_id, o.seller_id], { kind });
  return stripeFor(mode);
}

/** The shop's private pickup address as a Stripe Tax address (the place a pickup sale is sourced to). */
type PickupTaxAddress = { line1: string; line2?: string; city: string; state: string; postal_code: string; country: "US" };

/** H8 (b): the buyer's Louisiana service address, for carpet or furniture cleaning done at their place. */
type ServiceAddress = { line1: string; city: string; postal_code: string };

/**
 * H8 (b) (lead 11-05): the service address the buyer's order sheet sent. null when none was sent; "invalid" when the
 * shape is wrong (the table's own CHECKs are the same: 3-120 / 2-60 characters, a Louisiana ZIP).
 */
function parseServiceAddress(v: unknown): ServiceAddress | null | "invalid" {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) return "invalid";
  const a = v as Record<string, unknown>;
  const line1 = typeof a.line1 === "string" ? a.line1.trim() : "";
  const city = typeof a.city === "string" ? a.city.trim() : "";
  const zip = typeof a.postal_code === "string" ? a.postal_code.trim() : "";
  if (line1.length < 3 || line1.length > 120 || city.length < 2 || city.length > 60 || !isLouisianaZip5(zip)) return "invalid";
  return { line1, city, postal_code: zip };
}

/**
 * H6: the shop's pickup address, read before the order is frozen (shops_request_order retires the buyer's
 * previous page, so a missing address answers first, review 2026-10-18 finding 3). "missing" when the shop has
 * none (the SQL refuses such an order first; this is the race where it vanished). A failed read throws.
 */
async function pickupTaxAddress(admin: Db, shopId: string): Promise<{ address: PickupTaxAddress; version: PickupVersion } | "missing"> {
  const { data, error } = await admin.from("shop_pickup_addresses")
    .select("line1, line2, city, state_code, postal_code, updated_at, tax_refused_at")
    .eq("shop_id", shopId).maybeSingle();
  if (error) throw new Error(`pickup address read failed: ${error.message}`);
  const a = data as { line1: string; line2: string | null; city: string; state_code: string; postal_code: string;
    updated_at?: string | null; tax_refused_at?: string | null } | null;
  if (!a) return "missing";
  return {
    address: { line1: a.line1, ...(a.line2 ? { line2: a.line2 } : {}), city: a.city, state: a.state_code, postal_code: a.postal_code, country: "US" },
    version: { updatedAt: a.updated_at ?? null, refused: !!a.tax_refused_at },
  };
}

/**
 * Q2146: which copy of the pickup address the tax was figured on (its updated_at, passed back unchanged so a stamp
 * never lands on an address saved since) and whether Stripe had refused it before (a success then clears that).
 */
interface PickupVersion { updatedAt: string | null; refused: boolean }

/**
 * H6: Stripe names a pickup address it cannot tax by an invalid_request on the customer's tax location
 * (code customer_tax_location_invalid, or a param under customer_details[address]). Only that is the
 * address's fault; any other refusal (Stripe Tax off, an API change) is the platform's and answers try-again,
 * never "this shop's address needs fixing" to every buyer (money review #1 of 2026-10-18).
 */
function addressRefused(e: unknown): boolean {
  const err = e as { type?: string; code?: string; param?: string } | null;
  if (err?.type !== "StripeInvalidRequestError") return false;
  return err.code === "customer_tax_location_invalid" || (typeof err.param === "string" && err.param.startsWith("customer_details[address"));
}

/**
 * H6: the order's sales tax, figured ONCE at the pickup address (address_source "shipping": the buyer takes
 * the goods there). Its lines are exactly the taxed Checkout lines: each order line at its own code and the F1
 * fee split by code (memo Q5). The one-time setup fee is not taxed and is not in it. Keyed on the order, so a
 * retry of the same order gets the same calculation back.
 */
async function shopOrderTax(
  stripe: Stripe, orderId: string, address: PickupTaxAddress,
  lines: Array<{ kind: string; tax_kind: string | null; line_cents: number }>, feeParts: Array<{ tax_code: string; cents: number }>,
  // Digital downloads (20261108185110): a download is sourced to the buyer's billing address, not a pickup point.
  addressSource: "shipping" | "billing" = "shipping",
): Promise<{ calculationId: string; cents: number }> {
  const calc = await stripe.tax.calculations.create({
    currency: "usd",
    line_items: [
      ...lines.map((l, i) => ({ amount: l.line_cents, reference: `line_${i + 1}`, tax_behavior: "exclusive" as const, tax_code: shopTaxCode(l.kind, l.tax_kind) })),
      ...feeParts.map((p, i) => ({ amount: p.cents, reference: `service_fee_${i + 1}`, tax_behavior: "exclusive" as const, tax_code: p.tax_code })),
    ],
    customer_details: { address, address_source: addressSource },
  }, { idempotencyKey: `shop-tax-${orderId}` });
  // A missing figure is never read as $0 (Number(null) is 0: an untaxed charge).
  const cents = typeof calc.tax_amount_exclusive === "number" ? calc.tax_amount_exclusive : NaN;
  if (typeof calc.id !== "string" || !calc.id.startsWith("taxcalc_") || !Number.isInteger(cents) || cents < 0) {
    throw new Error(`tax calculation for order ${orderId} returned no usable figure`);
  }
  return { calculationId: calc.id, cents };
}

/** Apple Maps for the drop-off lookup, exactly as declutter-checkout's (Q2413); null when the key is not set. */
function appleMapsAccess(): AppleMapsAccess | null {
  const key = mapkitKeyFromEnv((name) => Deno.env.get(name));
  return key ? { developerToken: () => signMapkitJwt(key, 300) } : null;
}

type DeliveryAddress = { line1: string; line2: string | null; city: string; postal_code: string };
/** The typed drop-off address, or null when the body asks for none; "invalid" when it is malformed. */
function deliveryAddressFrom(raw: unknown): DeliveryAddress | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") return "invalid";
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, min: number, max: number) =>
    typeof v === "string" && v.trim().length >= min && v.trim().length <= max ? v.trim() : null;
  const line1 = str(r.line1, 3, 120);
  const city = str(r.city, 2, 60);
  const zip = typeof r.postal_code === "string" && /^\d{5}$/.test(r.postal_code.trim()) ? r.postal_code.trim() : null;
  const line2 = r.line2 === undefined || r.line2 === null || r.line2 === "" ? null : str(r.line2, 1, 120);
  if (!line1 || !city || !zip || (r.line2 && !line2)) return "invalid";
  return { line1, line2, city, postal_code: zip };
}

async function order(body: Record<string, unknown>, user: { id: string; email?: string }, asBuyer: Db, admin: Db) {
  const shopId = typeof body.shop_id === "string" ? body.shop_id : "";
  const readyDate = typeof body.ready_date === "string" ? body.ready_date : "";
  if (!UUID_RE.test(shopId)) return json({ error: "shop_not_found" }, 404);
  if (!DATE_RE.test(readyDate)) return json({ error: "ready_date_too_soon" }, 400);
  // Custom orders (20261106205852): a price the shop sent becomes the order's one line, so the buyer sends no lines.
  // shop_id is still sent (the terms, the Stripe mode and the tax address read it); the SQL refuses a request of
  // another shop, so those can never come from a different shop than the order's.
  const customRequestId = body.custom_request_id === undefined ? null
    : typeof body.custom_request_id === "string" && UUID_RE.test(body.custom_request_id) ? body.custom_request_id : "invalid";
  if (customRequestId === "invalid") return json({ error: "request_not_found" }, 404);
  // Q2105 step 2: ONE gift card the buyer picked pays first (the jobs and Declutter shape); the card page holds only
  // what is left. Optional; a malformed id is a bad request before anything freezes.
  const giftCardId = body.gift_card_id === undefined || body.gift_card_id === null ? null
    : typeof body.gift_card_id === "string" && UUID_RE.test(body.gift_card_id) ? body.gift_card_id : "invalid";
  if (giftCardId === "invalid") return json({ error: "gift_not_found" }, 404);
  // Lead 11-10 (money): a gift card is REFUSED on Shops, server side, until the payout path (a gift order's charge is
  // smaller than the shop's payout, so a source_transaction transfer is refused) and refunds sized on total_cents are
  // fixed and proven. No app build sending gift_card_id is no safeguard: anyone can call this function. Only the
  // SHOP_GIFT_CARDS=on secret opens it (never set on prod until both land); refused before anything freezes.
  if (giftCardId && Deno.env.get("SHOP_GIFT_CARDS") !== "on") {
    return json({ error: "gift_card_not_accepted", hint: "Gift cards can't be used at Shops yet. Pay this order by card." }, 409);
  }
  if (!customRequestId && !Array.isArray(body.lines)) return json({ error: "invalid_order_lines" }, 400);
  const note = typeof body.note === "string" ? body.note : "";
  const delivery = deliveryAddressFrom(body.delivery);
  if (delivery === "invalid") return json({ error: "invalid_address" }, 400);
  // Slice 2 (20261106223244): delivery_by "helpr" asks a Helpr to deliver at Declutter's price for the road miles;
  // the price the buyer was shown ('helpr_quote') comes with it, and a different frozen price refuses.
  const byHelpr = body.delivery_by === "helpr";
  if (body.delivery_by !== undefined && body.delivery_by !== "helpr" && body.delivery_by !== "shop") {
    return json({ error: "invalid_delivery_choice" }, 400);
  }
  const shownHelprCents = Number(body.delivery_cents);
  if (byHelpr && (!delivery || !Number.isInteger(shownHelprCents) || shownHelprCents <= 0)) {
    return json({ error: "invalid_delivery_choice" }, 400);
  }
  const native = isNativeRequest(body);
  const serviceAddress = parseServiceAddress(body.service_address);
  if (serviceAddress === "invalid") return json({ error: "invalid_service_address" }, 400);
  // The cancel terms the buyer's screen showed (shops_order_terms). OPTIONAL
  // (/code-review of shops-m3-v1 #5): an app build from before this field sends
  // none, and its order freezes the shop's current terms server-side and goes
  // ahead. Only terms the client SENT that differ from the frozen ones refuse
  // (terms_changed); terms sent in the wrong shape are a bad request.
  const terms = (body.terms ?? null) as { cancel_policy?: unknown; ready_tap_cancel?: unknown } | null;
  if (terms !== null && (typeof terms !== "object" || typeof terms.cancel_policy !== "string" || typeof terms.ready_tap_cancel !== "string")) {
    return json({ error: "invalid_terms" }, 400);
  }

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
  let taxAddress: PickupTaxAddress | null = null;
  // Q2146: set only while the tax is figured at the shop's own pickup address (not a delivery or an at-home job).
  let pickupVersion: PickupVersion | null = null;
  if (ownerId) {
    mode = await stripeModeForParties(admin, [user.id, ownerId], { caller: user.id });
    const addr = await pickupTaxAddress(admin, shopId);
    if (addr === "missing") return json({ error: "pickup_address_missing" }, 409);
    taxAddress = addr.address;
    pickupVersion = addr.version;
  }

  // H8 (b): an at-home cleaning is ordered on its own and needs the buyer's address, answered BEFORE the order
  // freezes (shops_request_order retires the buyer's previous page). The frozen line below is the truth; this is
  // the early, plain answer.
  // A custom order sends no lines (its one line is the shop's price); only ordinary lines are read here.
  const askedLines: unknown[] = Array.isArray(body.lines) ? body.lines : [];
  const itemIds = askedLines.map((l) => (l && typeof l === "object" ? (l as { item_id?: unknown }).item_id : null))
    .filter((id): id is string => typeof id === "string" && UUID_RE.test(id));
  if (itemIds.length > 0) {
    const { data: atRows, error: atErr } = await admin.from("shop_items").select("id, subtype, at_buyer").in("id", itemIds);
    if (atErr) {
      console.error(`[shop-checkout] item read failed: ${atErr.message}`);
      return json({ error: TRY_AGAIN }, 503);
    }
    const atHome = ((atRows ?? []) as Array<{ subtype: string; at_buyer: boolean }>).some((r) => r.at_buyer && r.subtype === "fabric_cleaning");
    if (atHome && askedLines.length > 1) return json({ error: "service_at_buyer_alone" }, 409);
    if (atHome && !serviceAddress) return json({ error: "service_address_needed" }, 400);
    // Restack (l106 + delivery): work done at the buyer's place has nothing to deliver.
    if (atHome && delivery) return json({ error: "at_buyer_no_delivery" }, 409);
  }
  // Delivery: the drop-off is geocoded BEFORE the order freezes (shops_request_order retires the buyer's previous
  // page, so nothing that can fail on the address may run after it), and on the server, never from the client.
  let dropoff: { lat: number; lng: number } | null = null;
  if (delivery) {
    const point = await geocodeDropoff(`${delivery.line1}, ${delivery.city}, LA ${delivery.postal_code}`, fetch, appleMapsAccess());
    if ("miss" in point) {
      if (point.miss === "not_found") return json({ error: "address_not_found" }, 422);
      console.error(JSON.stringify({ event: "shop_dropoff_geocode_unavailable", status: point.status, detail: point.detail }));
      return json({ error: "geocode_unavailable" }, 503);
    }
    dropoff = { lat: point.lat, lng: point.lng };
  }

  // Preorders (20261108184654): one item on the preorder's own ready-by date (the SQL sets it; readyDate is not used),
  // accepted at the hold and captured at once, so the buyer pays in full at order (owner 11-08).
  const preorderLine = body.preorder === true ? preorderLineFrom(body.lines) : null;
  if (body.preorder === true && (!preorderLine || customRequestId)) return json({ error: "invalid_order_lines" }, 400);
  const { data, error } = customRequestId
    ? await asBuyer.rpc("shops_order_custom_quote", {
      p_request_id: customRequestId, p_shop_id: shopId, p_ready_date: readyDate, p_note: note,
    })
    : preorderLine
    ? await asBuyer.rpc("shops_request_preorder", {
      p_shop_id: shopId, p_item_id: preorderLine.item_id, p_quantity: preorderLine.quantity, p_note: note,
    })
    : await asBuyer.rpc("shops_request_order", {
      p_shop_id: shopId, p_lines: body.lines, p_ready_date: readyDate, p_note: note,
    });
  if (error) return rpcRefusal(error);
  const frozen = data as { order_id?: string; items_cents?: number; premium_cents?: number; superseded_session_id?: string | null } | null;
  if (!frozen?.order_id) return json({ error: TRY_AGAIN }, 500);
  if (frozen.superseded_session_id) await expirePage(frozen.superseded_session_id);
  // S038 (Shops audit 11-12): every failure after the order froze closes it at once (no money has moved), so it never
  // sits unpaid until the 2-hour sweep; the buyer taps again.
  const frozenId: string = frozen.order_id;
  const closeFrozen = async (why: string) => {
    const { error: closeErr } = await asBuyer.rpc("shops_cancel_order_request", { p_order_id: frozenId });
    if (closeErr) console.error(`[shop-checkout] order ${frozenId} not closed after ${why}: ${closeErr.message}`);
    // The closed order keeps no copy of the buyer's drop-off or service address (as the delivery and tax branches).
    for (const table of ["shop_order_delivery_addresses", "shop_order_service_addresses"] as const) {
      const { error: purgeErr } = await admin.from(table).delete().eq("order_id", frozenId);
      if (purgeErr) console.error(`[shop-checkout] order ${frozenId} ${table} not purged after ${why}: ${purgeErr.message}`);
    }
  };

  // The terms the order froze (the shop row was locked while it was written)
  // must be the ones the buyer read, when the buyer's app sent them; else the
  // order closes before any page opens.
  if (terms !== null) {
    const { data: frozenTerms, error: termsReadErr } = await admin.from("shop_orders")
      .select("cancel_policy, ready_tap_cancel").eq("id", frozen.order_id).maybeSingle();
    const ft = frozenTerms as { cancel_policy?: string; ready_tap_cancel?: string } | null;
    if (termsReadErr || !ft) {
      console.error(`[shop-checkout] order ${frozen.order_id} terms read failed: ${termsReadErr?.message ?? "no row"}`);
      await asBuyer.rpc("shops_cancel_order_request", { p_order_id: frozen.order_id });
      return json({ error: TRY_AGAIN }, 503);
    }
    if (ft.cancel_policy !== terms.cancel_policy || ft.ready_tap_cancel !== terms.ready_tap_cancel) {
      const { error: closeErr } = await asBuyer.rpc("shops_cancel_order_request", { p_order_id: frozen.order_id });
      if (closeErr) console.error(`[shop-checkout] order ${frozen.order_id} not closed after terms changed: ${closeErr.message}`);
      return json({ error: "terms_changed", terms: { cancel_policy: ft.cancel_policy, ready_tap_cancel: ft.ready_tap_cancel } }, 409);
    }
  }

  // Delivery: measured, checked against the shop's radius and its fee frozen in SQL (service role, row lock).
  // A refusal (too far, the shop stopped delivering) closes the just-frozen order before any page opens.
  if (delivery && dropoff) {
    const { data: setRow, error: delErr } = await admin.rpc(byHelpr ? "shop_set_order_helpr_delivery" : "shop_set_order_delivery", {
      p_order_id: frozen.order_id, p_buyer: user.id, p_line1: delivery.line1, p_line2: delivery.line2,
      p_city: delivery.city, p_postal_code: delivery.postal_code, p_lat: dropoff.lat, p_lng: dropoff.lng,
    });
    // A Helpr price that moved since the buyer's quote (routed miles landed in between) is never charged unseen.
    const frozenHelprCents = Number((setRow as { delivery_cents?: unknown } | null)?.delivery_cents);
    if (!delErr && byHelpr && frozenHelprCents !== shownHelprCents) {
      const { error: closeErr } = await asBuyer.rpc("shops_cancel_order_request", { p_order_id: frozen.order_id });
      if (closeErr) console.error(`[shop-checkout] order ${frozen.order_id} not closed after its Helpr price moved: ${closeErr.message}`);
      const { error: purgeErr } = await admin.from("shop_order_delivery_addresses").delete().eq("order_id", frozen.order_id);
      if (purgeErr) console.error(`[shop-checkout] order ${frozen.order_id} delivery address not purged: ${purgeErr.message}`);
      return json({ error: "delivery_rate_changed", delivery_cents: Number.isInteger(frozenHelprCents) ? frozenHelprCents : null }, 409);
    }
    if (delErr) {
      const { error: closeErr } = await asBuyer.rpc("shops_cancel_order_request", { p_order_id: frozen.order_id });
      if (closeErr) console.error(`[shop-checkout] order ${frozen.order_id} not closed after its delivery was refused: ${closeErr.message}`);
      return rpcRefusal(delErr);
    }
    // The tax follows the order to where the buyer takes it: the drop-off (tax memo Q3).
    taxAddress = { line1: delivery.line1, ...(delivery.line2 ? { line2: delivery.line2 } : {}), city: delivery.city, state: "LA",
                   postal_code: delivery.postal_code, country: "US" };
    pickupVersion = null;
  }

  const o = await readOrder(admin, frozen.order_id);
  if (!o || o.status !== "awaiting_hold" || !o.seller_id) {
    if (o?.status === "awaiting_hold") await closeFrozen("an order with no seller");
    return json({ error: TRY_AGAIN }, 500);
  }
  // The delivery the order froze. Columns not deployed yet (42703): a pickup order, as before; a delivery asked for
  // then already failed above (shop_set_order_delivery does not exist either).
  const { data: delRow, error: delReadErr } = await admin.from("shop_orders")
    .select("fulfillment, delivery_cents").eq("id", o.id).maybeSingle();
  if (delReadErr && (delReadErr as { code?: string }).code !== "42703") {
    console.error(`[shop-checkout] delivery read failed: ${delReadErr.message}`);
    await asBuyer.rpc("shops_cancel_order_request", { p_order_id: o.id });
    return json({ error: TRY_AGAIN }, 503);
  }
  const fulfillment = delReadErr ? "pickup" : String((delRow as { fulfillment?: string } | null)?.fulfillment ?? "pickup");
  const deliveryCents = delReadErr ? 0 : Number((delRow as { delivery_cents?: number } | null)?.delivery_cents ?? 0);
  const askedFulfillment = !delivery ? "pickup" : byHelpr ? "helpr_delivers" : "shop_delivers";
  if (fulfillment !== askedFulfillment || !Number.isInteger(deliveryCents) || deliveryCents < 0) {
    console.error(`[shop-checkout] order ${o.id} delivery does not match what was asked`);
    await asBuyer.rpc("shops_cancel_order_request", { p_order_id: o.id });
    return json({ error: TRY_AGAIN }, 500);
  }
  const { data: lineRows, error: linesErr } = await admin.from("shop_order_lines")
    .select("title, kind, tax_kind, at_buyer, unit_cents, quantity, line_cents").eq("order_id", o.id);
  if (linesErr) {
    console.error(`[shop-checkout] lines read failed: ${linesErr.message}`);
    await closeFrozen("its lines read failed");
    return json({ error: TRY_AGAIN }, 503);
  }
  const lines = (lineRows ?? []) as Array<{ title: string; kind: string; tax_kind: string | null; at_buyer: boolean; unit_cents: number; quantity: number; line_cents: number }>;
  const itemsCents = lines.reduce((a, l) => a + l.line_cents, 0);
  if (lines.length === 0 || itemsCents !== o.items_cents || o.items_cents !== frozen.items_cents || o.premium_cents !== frozen.premium_cents) {
    console.error(`[shop-checkout] order ${o.id} amounts do not add up`);
    await closeFrozen("its amounts did not add up");
    return json({ error: TRY_AGAIN }, 500);
  }

  // The mode and address were read for the shop's owner; the order must be theirs.
  if (!mode || !taxAddress || o.seller_id !== ownerId) {
    console.error(`[shop-checkout] order ${o.id} seller is not the shop's owner read before it`);
    await closeFrozen("a seller check failed");
    return json({ error: TRY_AGAIN }, 500);
  }
  // H8 (b): an at-home cleaning (frozen on its line) is taxed where the work is done: the buyer's address, kept
  // for this order only (service role; the shop reads it after accepting). Stripe gets only what the tax needs.
  const atHome = lines.some((l) => l.at_buyer === true);
  // The frozen line is the truth (the early check above read live shop_items): at-home work takes no delivery.
  if (atHome && fulfillment !== "pickup") {
    const { error: closeErr } = await asBuyer.rpc("shops_cancel_order_request", { p_order_id: o.id });
    if (closeErr) console.error(`[shop-checkout] order ${o.id} not closed after at-home work came with a delivery: ${closeErr.message}`);
    // The closed order keeps no copy of the drop-off (as the at-home tax failure purges its address).
    const { error: purgeErr } = await admin.from("shop_order_delivery_addresses").delete().eq("order_id", o.id);
    if (purgeErr) console.error(`[shop-checkout] order ${o.id} delivery address not purged: ${purgeErr.message}`);
    return json({ error: "at_buyer_no_delivery" }, 409);
  }
  let calcAddress: PickupTaxAddress = taxAddress;
  if (atHome) {
    if (!serviceAddress) {
      const { error: closeErr } = await asBuyer.rpc("shops_cancel_order_request", { p_order_id: o.id });
      if (closeErr) console.error(`[shop-checkout] order ${o.id} not closed without its service address: ${closeErr.message}`);
      return json({ error: "service_address_needed" }, 400);
    }
    const { error: addrErr } = await admin.from("shop_order_service_addresses").upsert({
      order_id: o.id, buyer_id: user.id, line1: serviceAddress.line1, city: serviceAddress.city, state: "LA",
      postal_code: serviceAddress.postal_code,
    }, { onConflict: "order_id" });
    if (addrErr) {
      console.error(`[shop-checkout] order ${o.id} service address not saved: ${addrErr.message}`);
      const { error: closeErr } = await asBuyer.rpc("shops_cancel_order_request", { p_order_id: o.id });
      if (closeErr) console.error(`[shop-checkout] order ${o.id} not closed after its address failed: ${closeErr.message}`);
      return json({ error: TRY_AGAIN }, 503);
    }
    calcAddress = { line1: serviceAddress.line1, city: serviceAddress.city, state: "LA", postal_code: serviceAddress.postal_code, country: "US" };
  }
  const stripe = stripeFor(mode);
  // The tax is our own line (automatic_tax off): each line's code is a label only.
  const taxed = (name: string, taxCode: string) => ({ name, tax_code: taxCode });
  // One wallet (owner 2026-10-18): the buyer's ONE stored Stripe customer in this mode pre-fills the
  // page, read only through _shared/stripeCustomer.ts (never by email, never declutter_buyer_cards).
  // A failed read stops here rather than opening a page on a guessed customer (declutter-checkout's rule).
  let customerId: string | undefined;
  try {
    customerId = (await storedStripeCustomer(admin, user.id, mode)) ?? undefined;
  } catch (e) {
    console.error(`[shop-checkout] ${caughtMessage(e)}`);
    await closeFrozen("the Stripe customer read failed");
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
  // H6: tax_calculation_id + job_tax_cents (JOB_TAX_CALC_KEY / JOB_TAX_CENTS_KEY, shared with Jobs so the
  // webhook's commit, refund reversal and sessionJobTaxCents read a shop order the same way) are added below.
  const meta: Record<string, string> = { kind: "shop_order", order_id: o.id, buyer_id: user.id, payer_id: user.id, seller_id: o.seller_id };
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = lines.map((l) => ({
    quantity: l.quantity,
    price_data: {
      currency: "usd", unit_amount: l.unit_cents, tax_behavior: "exclusive",
      product_data: taxed(l.title.slice(0, 120), shopTaxCode(l.kind, l.tax_kind)),
    },
  }));
  // Memo Q5: the buyer's fee is taxed like the items it is charged on, split
  // pro rata when the cart mixes food and other goods (one line per code).
  const feeParts = splitBuyerFeeByTaxCode(lines, o.premium_cents);
  // H6: the tax, figured once at the pickup address. It fails AFTER the order froze, so the order is closed
  // first (no page opens on it; the buyer taps again). An address Stripe cannot tax says so in its own words.
  let tax: { calculationId: string; cents: number };
  try {
    tax = await shopOrderTax(stripe, o.id, calcAddress, lines, feeParts);
  } catch (e) {
    const unusable = addressRefused(e);
    console.error(JSON.stringify({ event: unusable ? (atHome ? "shop_service_address_unusable" : "shop_pickup_address_unusable") : "shop_tax_calculation_failed", shop: shopId, order: o.id, mode, detail: caughtMessage(e).slice(0, 200) }));
    const { error: closeErr } = await asBuyer.rpc("shops_cancel_order_request", { p_order_id: o.id });
    if (closeErr) console.error(`[shop-checkout] order ${o.id} not closed after its tax failed: ${closeErr.message}`);
    // The closed order keeps no copy of the buyer's address.
    if (atHome) {
      const { error: purgeErr } = await admin.from("shop_order_service_addresses").delete().eq("order_id", o.id);
      if (purgeErr) console.error(`[shop-checkout] order ${o.id} service address not purged: ${purgeErr.message}`);
    }
    // Q2146: a refused PICKUP address is the shop's to fix: stamp the copy it was figured on (My shop says so) and
    // tell the owner once. Never for a delivery or at-home address (the buyer's). A failed stamp is logged, never
    // shown to the buyer, whose 409 follows it.
    if (unusable && !atHome && pickupVersion?.updatedAt) {
      const { error: markErr } = await admin.rpc("shops_mark_pickup_address_refused", {
        p_shop_id: shopId, p_address_updated_at: pickupVersion.updatedAt, p_reason: caughtMessage(e).slice(0, 200),
      });
      if (markErr) console.error(`[shop-checkout] shop ${shopId} pickup address refusal not recorded: ${markErr.message}`);
    }
    if (unusable) return json({ error: atHome ? "service_address_unusable" : "pickup_address_unusable" }, 409);
    return json({ error: TRY_AGAIN }, 503);
  }
  // Q2146: Stripe taxed the pickup address it had refused before (a one-off refusal): the stamp and My shop's note go.
  if (!atHome && pickupVersion?.refused && pickupVersion.updatedAt) {
    const { error: clearErr } = await admin.rpc("shops_clear_pickup_address_refused", { p_shop_id: shopId, p_address_updated_at: pickupVersion.updatedAt });
    if (clearErr) console.error(`[shop-checkout] shop ${shopId} pickup address refusal not cleared: ${clearErr.message}`);
  }
  meta.tax_calculation_id = tax.calculationId;
  meta.job_tax_cents = String(tax.cents);
  for (const part of feeParts) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "usd", unit_amount: part.cents, tax_behavior: "exclusive",
        product_data: taxed(feeLineName(part.tax_code, feeParts.length), part.tax_code),
      },
    });
  }
  // H4 (owner 10-30, "once per account"): the one-time account setup fee the order froze at insert
  // (trg_shop_orders_setup_fee_frozen, migration 20261105181603), outside total_cents, its own non-taxable line.
  // shop_mark_order_held claims it when the hold lands; a hold that ends uncaptured puts it back. Column not
  // deployed yet (42703): no fee line, and the SQL accepts a page without one.
  const { data: feeRow, error: feeErr } = await admin.from("shop_orders").select("setup_fee_cents").eq("id", o.id).maybeSingle();
  if (feeErr && (feeErr as { code?: string }).code !== "42703") {
    console.error(`[shop-checkout] setup fee read failed: ${feeErr.message}`);
    await closeFrozen("the setup fee read failed");
    return json({ error: TRY_AGAIN }, 503);
  }
  const setupFeeCents = feeErr ? 0 : Number((feeRow as { setup_fee_cents?: number | null } | null)?.setup_fee_cents ?? 0);
  if (!Number.isInteger(setupFeeCents) || setupFeeCents < 0) {
    console.error(`[shop-checkout] order ${o.id} setup fee is not a whole amount`);
    await closeFrozen("a setup fee that is not a whole amount");
    return json({ error: TRY_AGAIN }, 500);
  }
  if (setupFeeCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "usd", unit_amount: setupFeeCents, tax_behavior: "exclusive",
        product_data: taxed("One-time account setup fee", NONTAXABLE_TAX_CODE),
      },
    });
  }
  // Delivery: the shop's own fee, frozen on the order; non-taxable, as Declutter's "Seller delivery" line.
  if (deliveryCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "usd", unit_amount: deliveryCents, tax_behavior: "exclusive",
        product_data: taxed(fulfillment === "helpr_delivers" ? "Helpr delivery" : "Shop delivery", NONTAXABLE_TAX_CODE),
      },
    });
  }
  if (tax.cents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "usd", unit_amount: tax.cents, tax_behavior: "exclusive",
        product_data: { name: "Sales tax", description: atHome ? "Louisiana sales tax where the work is done" : fulfillment !== "pickup" ? "Louisiana sales tax where the order is delivered" : "Louisiana sales tax where you pick up the order", tax_code: NONTAXABLE_TAX_CODE },
      },
    });
  }
  // Custom orders slice 2b: a 50% deposit order's page saves the card for the rest (charged off-session from the
  // ready date, _shared/shopBalance.ts). The webhook records it on the order (shop_order_record_saved_card); a
  // Customer is needed to save it, so a buyer with no stored wallet customer gets one made by Checkout. Column not
  // deployed yet (42703): every order is a full hold, as before.
  const { data: planRow, error: planErr } = await admin.from("shop_orders").select("payment_plan").eq("id", o.id).maybeSingle();
  if (planErr && (planErr as { code?: string }).code !== "42703") {
    console.error(`[shop-checkout] payment plan read failed: ${planErr.message}`);
    await closeFrozen("the payment plan read failed");
    return json({ error: TRY_AGAIN }, 503);
  }
  const depositPlan = !planErr && (planRow as { payment_plan?: string | null } | null)?.payment_plan === "deposit_50";
  if (depositPlan) meta.payment_plan = "deposit_50";
  if (preorderLine) meta.preorder = "1";
  const chargedCents = o.items_cents + o.premium_cents + deliveryCents + setupFeeCents + tax.cents;
  // Q2105 step 2: the gift, applied in one transaction (redeem_gift_card_for_shop_order, 20261111015126) on the tax
  // just figured, so the gift and the 50-cent check are sized on the real price and the order carries that tax. It is
  // RESERVED, not spent: the capture redeems it, and a close before capture puts it back (its trigger). The page then
  // holds only the difference; shop_mark_order_held adds gift_cents back (20261111025213). Any refusal closes the
  // just-frozen order first (the trigger puts a reserved gift back), so nothing is left waiting with no page.
  let giftCents = 0;
  const closeOrder = async (why: string) => {
    const { error: closeErr } = await asBuyer.rpc("shops_cancel_order_request", { p_order_id: o.id });
    if (closeErr) console.error(`[shop-checkout] order ${o.id} not closed after ${why}: ${closeErr.message}`);
  };
  if (giftCardId) {
    const { data: redeemed, error: redeemErr } = await admin.rpc("redeem_gift_card_for_shop_order", {
      p_credit_id: giftCardId, p_order_id: o.id, p_user_id: user.id, p_tax_cents: tax.cents, p_retired_session: null,
    });
    if (redeemErr) {
      await closeOrder("its gift was refused");
      // The refusals are sentences for the buyer (P0001), or not-yours / not-found (42501 / PT404).
      if (redeemErr.code === "P0001" || redeemErr.code === "42501" || redeemErr.code === "PT404") return rpcRefusal(redeemErr);
      console.error(`[shop-checkout] gift redeem failed: ${redeemErr.message}`);
      return json({ error: TRY_AGAIN }, 503);
    }
    const r = redeemed as { outcome?: string; difference_cents?: number; applied_cents?: number } | null;
    if (r?.outcome === "covered") {
      // A gift that pays the WHOLE order needs a no-hold accept path (captured_at set with 'accepted'), not built
      // yet: the order closes (the gift goes back) and the buyer is told in words.
      await closeOrder("a gift that covers it all");
      return json({ error: "gift_covers_whole_order", hint: "Your gift card covers this whole order. Paying a whole Shops order with a gift card is not ready yet: add an item, or pay by card." }, 409);
    }
    const rest = Number(r?.difference_cents);
    const applied = Number(r?.applied_cents);
    if (r?.outcome !== "needs_hold" || !Number.isInteger(rest) || !Number.isInteger(applied) || rest < 50
        || applied <= 0 || rest + applied !== chargedCents) {
      console.error(`[shop-checkout] order ${o.id} gift answer does not add up: ${JSON.stringify(r)}`);
      await closeOrder("a gift answer that does not add up");
      return json({ error: TRY_AGAIN }, 500);
    }
    giftCents = applied;
    meta.gift_cents = String(applied);
    // A gift card is not a Checkout discount: the page holds what is left as ONE line (the app shows the split).
    lineItems.splice(0, lineItems.length, { quantity: 1, price_data: {
      currency: "usd", unit_amount: rest, tax_behavior: "exclusive",
      product_data: { name: "Your Shops order", description: "What is left after your gift card, sales tax included", tax_code: NONTAXABLE_TAX_CODE },
    } });
  }
  const expiresAt = Math.floor(Date.now() / 1000) + PAGE_LIFETIME_S;
  // Q2140: a stored customer Stripe no longer has is replaced once and the page retried (":new-wallet" key).
  const session = await withStoredWalletCustomer(admin, stripe, user, mode, customerId, (payer, walletRetry) => stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      // H6: no automatic_tax. The tax is the "Sales tax" line above, figured at the pickup address and
      // committed to Stripe Tax only when the hold is captured (stripe-webhook, payment_intent.succeeded).
      billing_address_collection: "required",
      ...(payer ? { customer: payer, customer_update: { address: "auto" } } : { customer_email: user.email ?? undefined }),
      ...(depositPlan && !payer ? { customer_creation: "always" as const } : {}),
      client_reference_id: o.id,
      metadata: meta,
      payment_intent_data: {
        metadata: meta, capture_method: "manual", transfer_group: `shop_order_${o.id}`,
        ...(depositPlan ? { setup_future_usage: "off_session" as const } : {}),
      },
      ...(depositPlan ? {
        custom_text: { submit: { message: "Half is charged when the shop accepts. The rest is charged to this card on the ready date." } },
      } : {}),
      ...(preorderLine ? { custom_text: { submit: { message: PREORDER_PAGE_TEXT } } } : {}),
      // Q202: 3D Secure from $300 up (the whole charge, tax included).
      payment_method_options: threeDSecureOptions(chargedCents - giftCents),
      expires_at: expiresAt,
      success_url: buildRedirectUrl("/shops/orders?sent=1", native),
      cancel_url: buildRedirectUrl(`/shops/${shopId}`, native),
    },
    { idempotencyKey: `shop-order-${o.id}${walletRetry ? ":new-wallet" : ""}` },
  ));
  if (session.amount_subtotal !== chargedCents - giftCents) {
    await expirePage(session.id);
    console.error(`[shop-checkout] Stripe subtotal ${session.amount_subtotal} != order ${chargedCents} less gift ${giftCents}`);
    // Q2105 (review note 3): a gift set aside for this order goes back now, not at the 2-hour unpaid sweep.
    if (giftCents > 0) await closeOrder("its page did not match");
    return json({ error: TRY_AGAIN }, 500);
  }
  const { error: attachErr } = await admin.rpc("shop_attach_checkout_session", { p_order_id: o.id, p_session_id: session.id });
  if (attachErr) {
    await expirePage(session.id);
    if (giftCents > 0) await closeOrder("its page was not attached");
    return json({ error: TRY_AGAIN }, 409);
  }
  return json({ url: session.url, order_id: o.id });
}

const US_STATES = new Set(("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC " +
  "ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split(" "));

/** The buyer's billing address for a download's tax (any US state), or "invalid". */
function parseBillingAddress(v: unknown): PickupTaxAddress | "invalid" {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "invalid";
  const a = v as Record<string, unknown>;
  const line1 = typeof a.line1 === "string" ? a.line1.trim() : "";
  const city = typeof a.city === "string" ? a.city.trim() : "";
  const state = typeof a.state === "string" ? a.state.trim().toUpperCase() : "";
  const zip = typeof a.postal_code === "string" ? a.postal_code.trim() : "";
  if (line1.length < 3 || line1.length > 120 || city.length < 2 || city.length > 60 || !US_STATES.has(state) || !/^\d{5}$/.test(zip)) {
    return "invalid";
  }
  return { line1, city, state, postal_code: zip, country: "US" };
}

/**
 * DIGITAL DOWNLOADS (owner 11-08; migrations 20261108182917 + 20261108185110): buy one download.
 *   buy_digital { item_id, billing: {line1, city, state, postal_code} }  THE BUYER.
 * shops_request_digital_order runs AS THE BUYER (every rule is SQL's, including the ID check at the first purchase
 * and the one-time setup fee, both INSERT triggers). The page is a card HOLD like every Shops page; stripe-webhook
 * marks it paid (shop_digital_mark_paid) and captures it at once, so the buyer can download as soon as the charge is
 * taken. The tax is figured at the buyer's billing address (a digital product is sourced to the purchaser: La.
 * Acts 2024 3rd Ex. Sess. No. 10; codes in salesTax.ts) and committed at capture as every Shops order is.
 * On the iPhone this page is only ever opened on the website (the app's Buy button links out; App Review
 * Guideline 3.1.1(a) / 3.1.3, US storefront), so a native request is refused here.
 */
/** The same page key as an ordinary order (one page per order; a replaced wallet retries once with ":new-wallet"). */
const digitalPageKey = (orderId: string, retry: boolean) => `shop-order-${orderId}${retry ? ":new-wallet" : ""}`;

async function buyDigital(body: Record<string, unknown>, user: { id: string; email?: string }, asBuyer: Db, admin: Db) {
  const itemId = typeof body.item_id === "string" ? body.item_id : "";
  if (!UUID_RE.test(itemId)) return json({ error: "item_unavailable" }, 404);
  if (isNativeRequest(body)) return json({ error: "digital_on_website" }, 409);
  const billing = parseBillingAddress(body.billing);
  if (billing === "invalid") return json({ error: "invalid_billing_address" }, 400);
  // The shop and its owner (for the Stripe mode) are read first; the SQL refuses a caller in its own words below.
  const { data: itemRow, error: itemErr } = await admin.from("shop_items").select("shop_id, owner_id, kind").eq("id", itemId).maybeSingle();
  if (itemErr) {
    console.error(`[shop-checkout] digital item read failed: ${itemErr.message}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  const item = itemRow as { shop_id?: string; owner_id?: string; kind?: string } | null;
  if (!item?.owner_id || !item.shop_id || item.kind !== "digital") return json({ error: "item_unavailable" }, 404);
  const mode = await stripeModeForParties(admin, [user.id, item.owner_id], { caller: user.id });

  const { data, error } = await asBuyer.rpc("shops_request_digital_order", { p_item_id: itemId });
  if (error) return rpcRefusal(error);
  const frozen = data as { order_id?: string; items_cents?: number; premium_cents?: number; superseded_session_id?: string | null } | null;
  if (!frozen?.order_id) return json({ error: TRY_AGAIN }, 500);
  const supersededPage = frozen.superseded_session_id;
  if (supersededPage) await expirePage(supersededPage);
  const close = async (why: string) => {
    const { error: closeErr } = await asBuyer.rpc("shops_cancel_order_request", { p_order_id: frozen.order_id });
    if (closeErr) console.error(`[shop-checkout] digital order ${frozen.order_id} not closed after ${why}: ${closeErr.message}`);
  };

  const { data: row, error: readErr } = await admin.from("shop_orders")
    .select("id, seller_id, items_cents, premium_cents, setup_fee_cents, is_digital, status").eq("id", frozen.order_id).maybeSingle();
  if (readErr) {
    console.error(`[shop-checkout] digital order read failed: ${readErr.message}`);
    await close("its read failed");
    return json({ error: TRY_AGAIN }, 503);
  }
  const o = row as { id: string; seller_id: string; items_cents: number; premium_cents: number; setup_fee_cents: number; is_digital: boolean; status: string } | null;
  if (!o || o.is_digital !== true || o.status !== "awaiting_hold" || o.seller_id !== item.owner_id
      || o.items_cents !== frozen.items_cents || o.premium_cents !== frozen.premium_cents) {
    console.error(`[shop-checkout] digital order ${frozen.order_id} does not match what was frozen`);
    await close("a mismatch");
    return json({ error: TRY_AGAIN }, 500);
  }
  const { data: lineRows, error: linesErr } = await admin.from("shop_order_lines")
    .select("title, kind, tax_kind, unit_cents, quantity, line_cents").eq("order_id", o.id);
  const lines = (lineRows ?? []) as Array<{ title: string; kind: string; tax_kind: string | null; unit_cents: number; quantity: number; line_cents: number }>;
  if (linesErr || lines.length !== 1 || lines[0].kind !== "digital" || lines[0].line_cents !== o.items_cents) {
    console.error(`[shop-checkout] digital order ${o.id} lines unreadable or wrong`);
    await close("its lines were wrong");
    return json({ error: TRY_AGAIN }, 500);
  }
  const stripe = stripeFor(mode);
  const feeParts = splitBuyerFeeByTaxCode(lines, o.premium_cents);
  let tax: { calculationId: string; cents: number };
  try {
    tax = await shopOrderTax(stripe, o.id, billing, lines, feeParts, "billing");
  } catch (e) {
    const unusable = addressRefused(e);
    console.error(JSON.stringify({ event: unusable ? "shop_billing_address_unusable" : "shop_tax_calculation_failed", order: o.id, mode, detail: caughtMessage(e).slice(0, 200) }));
    await close("its tax failed");
    if (unusable) return json({ error: "billing_address_unusable" }, 409);
    return json({ error: TRY_AGAIN }, 503);
  }
  let customerId: string | undefined;
  try {
    const storedWallet = await storedStripeCustomer(admin, user.id, mode);
    customerId = storedWallet ?? undefined;
  } catch (e) {
    console.error(`[shop-checkout] ${caughtMessage(e)}`);
    await close("the wallet read failed");
    return json({ error: TRY_AGAIN }, 503);
  }
  const taxed = (name: string, taxCode: string) => ({ name, tax_code: taxCode });
  const meta: Record<string, string> = {
    kind: "shop_order", digital: "1", order_id: o.id, buyer_id: user.id, payer_id: user.id, seller_id: o.seller_id,
    tax_calculation_id: tax.calculationId, job_tax_cents: String(tax.cents),
    // Review 11-08: the state and ZIP the tax was figured at. stripe-webhook compares them with the card page's
    // billing address and releases the hold when they differ, so the address that pays is the one taxed.
    billing_state: billing.state, billing_zip: billing.postal_code,
  };
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{
    quantity: 1,
    price_data: { currency: "usd", unit_amount: lines[0].unit_cents, tax_behavior: "exclusive",
      product_data: taxed(`${lines[0].title.slice(0, 100)} (download)`, shopTaxCode(lines[0].kind, lines[0].tax_kind)) },
  }];
  for (const part of feeParts) {
    lineItems.push({ quantity: 1, price_data: { currency: "usd", unit_amount: part.cents, tax_behavior: "exclusive",
      product_data: taxed("Service fee (5% + $0.70)", part.tax_code) } });
  }
  const setupFeeCents = Number(o.setup_fee_cents ?? 0);
  if (!Number.isInteger(setupFeeCents) || setupFeeCents < 0) {
    await close("a bad setup fee");
    return json({ error: TRY_AGAIN }, 500);
  }
  if (setupFeeCents > 0) {
    lineItems.push({ quantity: 1, price_data: { currency: "usd", unit_amount: setupFeeCents, tax_behavior: "exclusive",
      product_data: taxed("One-time account setup fee", NONTAXABLE_TAX_CODE) } });
  }
  if (tax.cents > 0) lineItems.push({ quantity: 1, price_data: { currency: "usd", unit_amount: tax.cents, tax_behavior: "exclusive",
    product_data: { name: "Sales tax", description: "Sales tax where you live (your billing address)", tax_code: NONTAXABLE_TAX_CODE } } });
  const chargedCents = o.items_cents + o.premium_cents + setupFeeCents + tax.cents;
  const session = await withStoredWalletCustomer(admin, stripe, user, mode, customerId, (walletPayer, isRetry) => stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      billing_address_collection: "required" as const,
      ...(walletPayer ? { customer: walletPayer, customer_update: { address: "auto" } } : { customer_email: user.email ?? undefined }),
      client_reference_id: o.id,
      metadata: meta,
      payment_intent_data: { metadata: meta, capture_method: "manual", transfer_group: `shop_order_${o.id}` },
      custom_text: { submit: { message: "Your download is ready in Shops > My orders as soon as the payment goes through." } },
      payment_method_options: threeDSecureOptions(chargedCents),
      expires_at: Math.floor(Date.now() / 1000) + PAGE_LIFETIME_S,
      success_url: buildRedirectUrl("/shops/orders?bought=1", false),
      cancel_url: buildRedirectUrl(`/shops/${item.shop_id}?item=${itemId}`, false),
    },
    { idempotencyKey: digitalPageKey(o.id, isRetry) },
  ));
  if (chargedCents !== session.amount_subtotal) {
    await expirePage(session.id);
    await close("a Stripe subtotal mismatch");
    console.error(`[shop-checkout] Stripe subtotal ${session.amount_subtotal} != digital order ${chargedCents}`);
    return json({ error: TRY_AGAIN }, 500);
  }
  const { error: attachErr } = await admin.rpc("shop_attach_checkout_session", { p_order_id: o.id, p_session_id: session.id });
  if (attachErr) {
    await expirePage(session.id);
    return json({ error: TRY_AGAIN }, 409);
  }
  return json({ url: session.url, order_id: o.id });
}

/**
 * Slice 2 (20261106194913 shop_set_pickup_point): the shop's pickup point, looked up on the SERVER from the address
 * the shop just saved, right after the save (the app calls this next). The point is private: it goes to SQL and
 * nowhere else, and this answer never carries it. The 'shops' switch first (shops_my_pickup_address has no switch
 * check of its own), then the owner's own address as the owner, so a refused caller makes no Apple call.
 */
async function pickupPoint(user: { id: string }, asOwner: Db, admin: Db) {
  const off = await requireFeature(admin, "shops", user, corsHeaders);
  if (off) return off;
  const { data: mine, error: mineErr } = await asOwner.rpc("shops_my_pickup_address");
  if (mineErr) return rpcRefusal(mineErr);
  const a = (Array.isArray(mine) ? mine[0] : null) as { line1?: string; city?: string; postal_code?: string } | null;
  if (!a?.line1 || !a.postal_code) return json({ error: "pickup_address_missing" }, 409);
  const { data: shopRow, error: shopErr } = await admin.from("shops").select("id").eq("owner_id", user.id).maybeSingle();
  if (shopErr) {
    console.error(`[shop-checkout] pickup point shop read failed: ${shopErr.message}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  const shopId = (shopRow as { id?: string } | null)?.id;
  if (!shopId) return json({ error: "shop_not_found" }, 404);
  const point = await geocodeDropoff(`${a.line1}, ${a.city ?? ""}, LA ${a.postal_code}`, fetch, appleMapsAccess());
  if ("miss" in point) {
    if (point.miss === "not_found") return json({ error: "address_not_found" }, 422);
    console.error(JSON.stringify({ event: "shop_pickup_geocode_unavailable", status: point.status, detail: point.detail }));
    return json({ error: "geocode_unavailable" }, 503);
  }
  // The SQL refuses a point for an address changed since it was read (address_changed).
  const { error: setErr } = await admin.rpc("shop_set_pickup_point", {
    p_shop_id: shopId, p_owner: user.id, p_expect_line1: a.line1, p_expect_postal_code: a.postal_code,
    p_lat: point.lat, p_lng: point.lng,
  });
  if (setErr) return rpcRefusal(setErr);
  return json({ saved: true });
}

/**
 * Slice 2 (20261106223244 shop_helpr_delivery_quote): the Helpr delivery price for a drop-off, BEFORE the order.
 * Declutter's price ($6 + $1.50/mi, declutter_delivery_price_cents) for the road miles from the shop's pickup point.
 * Road miles Declutter's way (Q1930): when the SQL names a pair with no fresh routed row, Apple /v1/etas routes it,
 * the row is stored under the SQL's exact key (declutter_route_miles), and the SQL is asked again. An Apple miss
 * pauses routing (declutter_route_outage) and the estimate answers. The order then freezes the same figure.
 */
async function helprQuote(body: Record<string, unknown>, asBuyer: Db, admin: Db) {
  const shopId = typeof body.shop_id === "string" ? body.shop_id : "";
  if (!UUID_RE.test(shopId)) return json({ error: "shop_not_found" }, 404);
  const delivery = deliveryAddressFrom(body.delivery);
  if (!delivery || delivery === "invalid") return json({ error: "invalid_address" }, 400);
  // The SQL's gates as the buyer first (switch, ban, the shop visible to them): no Apple call for a refused caller.
  const { error: gateErr } = await asBuyer.rpc("shops_order_terms", { p_shop_id: shopId });
  if (gateErr) return rpcRefusal(gateErr);
  const apple = appleMapsAccess();
  const point = await geocodeDropoff(`${delivery.line1}, ${delivery.city}, LA ${delivery.postal_code}`, fetch, apple);
  if ("miss" in point) {
    if (point.miss === "not_found") return json({ error: "address_not_found" }, 422);
    console.error(JSON.stringify({ event: "shop_dropoff_geocode_unavailable", status: point.status, detail: point.detail }));
    return json({ error: "geocode_unavailable" }, 503);
  }
  const ask = () => admin.rpc("shop_helpr_delivery_quote", { p_shop_id: shopId, p_lat: point.lat, p_lng: point.lng });
  let { data: q, error: qErr } = await ask();
  if (qErr) return rpcRefusal(qErr);
  const route = (q as { route?: { o_lat: number; o_lng: number; d_lat: number; d_lng: number } | null } | null)?.route ?? null;
  if (route && apple) {
    const legs = await appleEtas({ lat: Number(route.o_lat), lng: Number(route.o_lng) },
      [{ lat: Number(route.d_lat), lng: Number(route.d_lng) }], apple);
    const leg = Array.isArray(legs) ? legs[0] : null;
    if (!Array.isArray(legs)) {
      console.error(JSON.stringify({ event: "route_etas_miss", status: legs.status, detail: legs.detail }));
      const { error: pauseErr } = await admin.rpc("declutter_route_outage", { p_minutes: 10 });
      if (pauseErr) console.error(JSON.stringify({ event: "route_outage_record_failed", detail: String(pauseErr.message).slice(0, 200) }));
    } else if (leg && leg.miles >= 1 && leg.miles <= 2000) {
      const { error: upErr } = await admin.from("declutter_route_miles").upsert({
        o_lat: route.o_lat, o_lng: route.o_lng, d_lat: route.d_lat, d_lng: route.d_lng, miles: leg.miles,
        minutes: leg.minutes === null ? null : Math.min(leg.minutes, 6000), source: "apple", routed_at: new Date().toISOString(),
      }, { onConflict: "o_lat,o_lng,d_lat,d_lng" });
      if (upErr) console.error(JSON.stringify({ event: "route_miles_store_failed", detail: String(upErr.message).slice(0, 200) }));
      else ({ data: q, error: qErr } = await ask());
      if (qErr) return rpcRefusal(qErr);
    }
  }
  const cents = Number((q as { delivery_cents?: unknown } | null)?.delivery_cents);
  const miles = Number((q as { delivery_miles?: unknown } | null)?.delivery_miles);
  if (!Number.isInteger(cents) || cents <= 0 || !Number.isInteger(miles) || miles < 1) {
    console.error(`[shop-checkout] Helpr quote for shop ${shopId} returned no usable figure`);
    return json({ error: TRY_AGAIN }, 503);
  }
  // Only the price and miles: never the shop's point or the drop-off's.
  return json({ delivery_cents: cents, delivery_miles: miles });
}

async function accept(body: Record<string, unknown>, asMaker: Db, admin: Db) {
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!UUID_RE.test(orderId)) return json({ error: "order_not_found" }, 404);
  const { data, error } = await asMaker.rpc("shops_accept_order", { p_order_id: orderId });
  if (error) return rpcRefusal(error);
  if ((data as { captured?: boolean } | null)?.captured === true) return json({ accepted: true, charged: true });
  const o = await readOrder(admin, orderId);
  if (!o?.stripe_payment_intent_id) return json({ error: TRY_AGAIN }, 503);
  // 11-07 money review: the order IS accepted (the RPC committed). A capture step that throws (the plan read, Stripe, a
  // record) is not the shop's error: logged, and declutter-money's 10-minute run captures it (shop_captures_due).
  let outcome: Awaited<ReturnType<typeof captureShopHold>>;
  try {
    outcome = await captureShopHold(await stripeForOrder(admin, o, "new"), admin, o.id, o.stripe_payment_intent_id, o.capture_attempts ?? 0);
  } catch (e) {
    console.error(JSON.stringify({ event: "shop_capture_deferred", order: o.id, detail: caughtMessage(e, "capture failed").slice(0, 200) }));
    return json({ accepted: true, charged: false });
  }
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
    await releaseShopHold(await stripeForOrder(admin, o, "refund"), admin, {
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

/**
 * Custom orders slice 2a (20261106212437, review follow-up a on 9abcc8018a): the shop declines or the buyer withdraws
 * a custom request (shops_decline_custom_request AS THE MEMBER, every rule in SQL). The SQL closes the buyer's unpaid
 * order for that price ('superseded'); its Stripe page is expired here, so the buyer cannot even start paying. A page
 * that still completes is answered cancel_hold by shop_mark_order_held (the order is closed), so nothing is charged.
 */
type BalanceRow = {
  id: string; buyer_id: string | null; seller_id: string | null; status: string; payment_plan: string | null;
  balance_cents: number | null; balance_payment_intent_id: string | null; captured_at: string | null;
  balance_customer_id: string | null; balance_payment_method_id: string | null; balance_attempts: number | null;
  balance_failed_at: string | null; balance_checkout_session_id: string | null; ready_date: string;
  stripe_checkout_session_id: string | null; stripe_payment_intent_id: string | null; payment_livemode: boolean | null;
  items_cents: number; premium_cents: number; capture_attempts: number | null; shop_id: string | null;
};

/** A deposit order whose deposit was captured and whose rest is still owed (null: anything else, or no row). */
async function readOwedRest(admin: Db, orderId: string): Promise<BalanceRow | null> {
  const { data, error } = await admin.from("shop_orders")
    .select("id, buyer_id, seller_id, status, payment_plan, balance_cents, balance_payment_intent_id, captured_at, balance_customer_id, balance_payment_method_id, balance_attempts, balance_failed_at, balance_checkout_session_id, ready_date, stripe_checkout_session_id, stripe_payment_intent_id, payment_livemode, items_cents, premium_cents, capture_attempts, shop_id")
    .eq("id", orderId).maybeSingle();
  if (error) throw new Error(`shop order read failed: ${error.message}`);
  const o = data as BalanceRow | null;
  if (!o || o.payment_plan !== "deposit_50" || o.status !== "accepted" || !o.captured_at || o.balance_payment_intent_id
      || !Number.isInteger(o.balance_cents) || Number(o.balance_cents) <= 0) return null;
  return o;
}

/**
 * Custom orders slice 2b: the buyer's pay-the-rest page (OWNER rule: the card on file did not take it, or none was
 * saved). The BUYER of a deposit order whose rest is owed; one line, the rest (its tax share is inside it: the tax was
 * figured for the whole order at the deposit's page), charged at once. Its payment lands through the webhook's
 * payment_intent.succeeded (_shared/shopBalance.ts recordShopBalance); a second payment is refunded, never kept.
 */
async function payBalance(body: Record<string, unknown>, user: { id: string; email?: string }, admin: Db) {
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!UUID_RE.test(orderId)) return json({ error: "order_not_found" }, 404);
  const o = await readOwedRest(admin, orderId);
  if (o && o.buyer_id !== user.id) return json({ error: "order_not_found" }, 404);
  if (!o) {
    const { data: own } = await admin.from("shop_orders").select("buyer_id").eq("id", orderId).maybeSingle();
    if ((own as { buyer_id?: string | null } | null)?.buyer_id !== user.id) return json({ error: "order_not_found" }, 404);
    return json({ error: "nothing_owed", hint: "Nothing more is owed on this order." }, 409);
  }
  const stripe = await stripeForOrder(admin, o, "new");
  let restCustomer: string | undefined;
  const mode = shopOrderMode({ livemode: o.payment_livemode, checkout_session_id: o.stripe_checkout_session_id }) ?? "live";
  try {
    restCustomer = (await storedStripeCustomer(admin, user.id, mode)) ?? undefined;
  } catch (e) {
    console.error(`[shop-checkout] ${caughtMessage(e)}`);
    return json({ error: TRY_AGAIN }, 503);
  }
  const meta: Record<string, string> = { kind: "shop_balance", order_id: o.id, buyer_id: user.id, payer_id: user.id, seller_id: o.seller_id ?? "" };
  const native = isNativeRequest(body);
  const cents = Number(o.balance_cents);
  // Q2140 (m1 guard, 11-07): a stored customer Stripe no longer has is replaced once and the page retried
  // (":new-wallet" key), as on the order's own page.
  const session = await withStoredWalletCustomer(admin, stripe, user, mode, restCustomer, (payer, walletRetry) => stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd", unit_amount: cents, tax_behavior: "exclusive",
          // The rest already carries its share of the order's sales tax (figured once, on the deposit's page).
          product_data: { name: "Rest of your custom order", description: "Sales tax included", tax_code: NONTAXABLE_TAX_CODE },
        },
      }],
      ...(payer ? { customer: payer } : { customer_email: user.email ?? undefined }),
      client_reference_id: o.id,
      metadata: meta,
      payment_intent_data: { metadata: meta, transfer_group: `shop_order_${o.id}` },
      payment_method_options: threeDSecureOptions(cents),
      expires_at: Math.floor(Date.now() / 1000) + PAGE_LIFETIME_S,
      success_url: buildRedirectUrl("/shops/orders?paid=1", native),
      cancel_url: buildRedirectUrl("/shops/orders", native),
    },
    // One page per order and the page it replaces: a double tap opens one, a new tap after it closed opens a new one.
    { idempotencyKey: `shop-balance-page-${o.id}-${o.balance_checkout_session_id ?? "first"}${walletRetry ? ":new-wallet" : ""}` },
  ));
  if (session.amount_total !== cents) {
    await expirePage(session.id);
    console.error(`[shop-checkout] rest page ${session.amount_total} != owed ${cents}`);
    return json({ error: TRY_AGAIN }, 500);
  }
  const { data: att, error: attErr } = await admin.rpc("shop_attach_balance_session", { p_order_id: o.id, p_session_id: session.id });
  if (attErr) {
    await expirePage(session.id);
    return rpcRefusal(attErr);
  }
  const replaced = (att as { replaced?: string | null } | null)?.replaced;
  if (replaced && replaced !== session.id) await expirePage(replaced);
  return json({ url: session.url, order_id: o.id });
}

/**
 * Custom orders slice 2b: the shop's "Handed over" tap on a deposit order whose rest is due. The handover RPC refuses
 * while the rest is unpaid (balance_not_paid); the app then calls this, which tries the saved card at once (the same
 * charge, key and recording as declutter-money's), and taps again only when it is paid.
 */
async function chargeRest(body: Record<string, unknown>, user: { id: string }, admin: Db) {
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!UUID_RE.test(orderId)) return json({ error: "order_not_found" }, 404);
  const o = await readOwedRest(admin, orderId);
  if (o && o.seller_id !== user.id) return json({ error: "order_not_found" }, 404);
  if (!o) {
    const { data: own } = await admin.from("shop_orders").select("seller_id").eq("id", orderId).maybeSingle();
    if ((own as { seller_id?: string | null } | null)?.seller_id !== user.id) return json({ error: "order_not_found" }, 404);
    return json({ paid: true });
  }
  // 11-07 money review: the tap moves money, so it takes the Shops switch and the shop owner's standing like every
  // other Shops action (the SQL gates are not on this path: the charge is the service role's).
  const switchedOff = await requireFeature(admin, "shops", user, corsHeaders);
  if (switchedOff) return switchedOff;
  const { data: me, error: meErr } = await admin.from("profiles").select("ban_status, auto_suspended_until").eq("user_id", user.id).maybeSingle();
  if (meErr) return json({ error: TRY_AGAIN }, 503);
  const standing = me as { ban_status?: string | null; auto_suspended_until?: string | null } | null;
  if (isLockedOut(standing?.ban_status, standing?.auto_suspended_until)) return json({ error: "account_restricted" }, 403);
  // Waiting on the buyer (the card did not take it, or the tries ran out): the shop waits; no new charge from the tap.
  // No saved card: chargeShopBalance below makes it the buyer's to pay at once (no Stripe call).
  if (o.balance_failed_at) return json({ paid: false, waiting_on_buyer: true });
  const { data: today, error: todayErr } = await admin.rpc("shop_local_today");
  if (todayErr || typeof today !== "string") return json({ error: TRY_AGAIN }, 503);
  if (o.ready_date > today) return json({ paid: false, not_due: true });
  const done = await chargeShopBalance(await stripeForOrder(admin, o, "new"), admin, {
    order_id: o.id, buyer_id: o.buyer_id, seller_id: o.seller_id, balance_cents: Number(o.balance_cents),
    customer_id: o.balance_customer_id, payment_method_id: o.balance_payment_method_id,
    attempts: Number(o.balance_attempts ?? 0), livemode: o.payment_livemode, checkout_session_id: o.stripe_checkout_session_id,
  }, { fromTap: true });
  return json({ paid: done === "paid" || done === "already_paid", waiting_on_buyer: done === "buyer_pays" });
}

async function closeRequest(body: Record<string, unknown>, asMember: Db, admin: Db) {
  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  if (!UUID_RE.test(requestId)) return json({ error: "request_not_found" }, 404);
  const { data, error } = await asMember.rpc("shops_decline_custom_request", { p_request_id: requestId });
  if (error) return rpcRefusal(error);
  // The request is closed in SQL whatever happens next, and a page left open cannot charge (above): a failed read is logged.
  try {
    const { data: lineRows, error: lineErr } = await admin.from("shop_order_lines").select("order_id").eq("custom_request_id", requestId);
    if (lineErr) throw new Error(`custom order lines read failed: ${lineErr.message}`);
    const orderIds = [...new Set(((lineRows ?? []) as { order_id: string }[]).map((l) => l.order_id))];
    if (orderIds.length > 0) {
      const { data: pages, error: pageErr } = await admin.from("shop_orders").select("stripe_checkout_session_id")
        .in("id", orderIds).eq("status", "superseded").is("stripe_payment_intent_id", null);
      if (pageErr) throw new Error(`custom order pages read failed: ${pageErr.message}`);
      for (const pg of (pages ?? []) as { stripe_checkout_session_id: string | null }[]) {
        if (pg.stripe_checkout_session_id) await expirePage(pg.stripe_checkout_session_id);
      }
    }
  } catch (e) {
    console.error(JSON.stringify({ event: "shop_request_page_expire_skipped", request: requestId, detail: caughtMessage(e).slice(0, 200) }));
  }
  return json({ closed: true, status: data ?? null });
}

/**
 * After a member RPC committed a refund row: send it now. A failure here is not
 * the member's: the row is pending and declutter-money sends it within 10 minutes.
 */
async function sendRefundNow(admin: Db, orderId: string, refundId: unknown): Promise<"sent" | "pending" | null> {
  if (typeof refundId !== "string" || !UUID_RE.test(refundId)) return null;
  try {
    const { data, error } = await admin.rpc("shop_refund_to_send", { p_refund_id: refundId });
    if (error) throw new Error(`shop_refund_to_send failed: ${error.message}`);
    const row = ((data ?? []) as ShopRefundRow[])[0];
    if (!row) {
      // 11-07 (option B, 20261107162454): a refund of an order paid in two charges is held for a person, never sent
      // here; the member is not told it was sent.
      const { data: held, error: heldErr } = await admin.from("shop_refunds").select("status").eq("id", refundId).maybeSingle();
      if (heldErr) throw new Error(`shop refund status read failed: ${heldErr.message}`);
      return (held as { status?: string } | null)?.status === "held_for_review" ? "pending" : "sent";
    }
    const o = await readOrder(admin, orderId);
    if (!o) throw new Error("order vanished");
    const outcome = await sendShopRefund(await stripeForOrder(admin, o, "refund"), admin, row);
    return outcome === "failed" ? "pending" : "sent";
  } catch (e) {
    console.error(JSON.stringify({ event: "shop_refund_deferred", order: orderId, refund: refundId, detail: caughtMessage(e, "send failed").slice(0, 200) }));
    return "pending";
  }
}

type DecidedRow = { result?: string; refund_id?: string | null; refund_cents?: number } | null;

async function buyerCancel(body: Record<string, unknown>, asBuyer: Db, admin: Db) {
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!UUID_RE.test(orderId)) return json({ error: "order_not_found" }, 404);
  const expect = body.expect === "free" || body.expect === "late" ? body.expect : null;
  if (!expect) return json({ error: "invalid_expect" }, 400);
  const { data, error } = await asBuyer.rpc("shops_buyer_cancel_order", { p_order_id: orderId, p_expect: expect });
  if (error) return rpcRefusal(error);
  const d = data as DecidedRow;
  const refund = await sendRefundNow(admin, orderId, d?.refund_id);
  return json({ cancelled: true, result: d?.result ?? null, refund_cents: d?.refund_cents ?? 0, refund });
}

/** Preorders: the buyer cancels a paid preorder before it is marked ready (shops_cancel_preorder decides the amount). */
async function preorderCancel(body: Record<string, unknown>, asBuyer: Db, admin: Db) {
  const orderId = typeof body.order_id === "string" && UUID_RE.test(body.order_id) ? body.order_id : "";
  if (!orderId) return json({ error: "order_not_found" }, 404);
  const { data, error } = await asBuyer.rpc("shops_cancel_preorder", { p_order_id: orderId });
  if (error) return rpcRefusal(error);
  const d = data as { refund_id?: string; refund_cents?: number } | null;
  const refund = await sendRefundNow(admin, orderId, d?.refund_id);
  return json({ result: "cancelled", order_id: orderId, refund_cents: d?.refund_cents ?? null, refund });
}

async function shopCancel(body: Record<string, unknown>, asShop: Db, admin: Db) {
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!UUID_RE.test(orderId)) return json({ error: "order_not_found" }, 404);
  const reason = typeof body.reason === "string" ? body.reason : null;
  const { data, error } = await asShop.rpc("shops_shop_cancel_order", { p_order_id: orderId, p_reason: reason });
  if (error) return rpcRefusal(error);
  const d = data as DecidedRow;
  const refund = await sendRefundNow(admin, orderId, d?.refund_id);
  return json({ cancelled: true, result: d?.result ?? null, refund_cents: d?.refund_cents ?? 0, refund });
}

async function noShow(body: Record<string, unknown>, asShop: Db) {
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!UUID_RE.test(orderId)) return json({ error: "order_not_found" }, 404);
  const { error } = await asShop.rpc("shops_report_no_show", { p_order_id: orderId });
  if (error) return rpcRefusal(error);
  // No refund: the shop is paid by declutter-money's payout step.
  return json({ no_show: true });
}

async function adminRefund(body: Record<string, unknown>, asAdmin: Db, admin: Db) {
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!UUID_RE.test(orderId)) return json({ error: "order_not_found" }, 404);
  const reason = typeof body.reason === "string" ? body.reason : "";
  const note = typeof body.note === "string" ? body.note : "";
  // has_role(admin) is checked inside the RPC, as the caller.
  const { data, error } = await asAdmin.rpc("shops_admin_refund_order", { p_order_id: orderId, p_reason: reason, p_note: note });
  if (error) return rpcRefusal(error);
  const d = data as DecidedRow;
  const refund = await sendRefundNow(admin, orderId, d?.refund_id);
  return json({ refunded: true, refund_cents: d?.refund_cents ?? 0, refund });
}

/**
 * Read one refund from Stripe. A bad id, one from the other mode or another account is
 * Stripe's resource_missing: null (the caller answers refund_not_found, 404, in plain
 * words), never "try again" (run-3 review L5). Any other Stripe error throws.
 */
async function retrieveRefund(stripe: Stripe, refundId: string): Promise<Stripe.Refund | null> {
  try {
    return await stripe.refunds.retrieve(refundId);
  } catch (e) {
    const err = e as { code?: string; statusCode?: number };
    if (err?.code === "resource_missing" || err?.statusCode === 404) return null;
    throw e;
  }
}

/**
 * "Record a refund made in Stripe" (admin Shops orders; rule B of the v2 review).
 * AN ADMIN only (user_roles read with the service key; nobody else reaches
 * Stripe here). The refund is RETRIEVED from Stripe (read only, no Stripe write)
 * and must be a live refund on THIS order's PaymentIntent for exactly the amount
 * typed; only then is it recorded (service-only shops_admin_record_hand_refund,
 * with the admin's id: has_role checked again there, audited).
 */
async function adminRecordHandRefund(body: Record<string, unknown>, userId: string, admin: Db) {
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!UUID_RE.test(orderId)) return json({ error: "order_not_found" }, 404);
  const refundId = typeof body.refund_id === "string" ? body.refund_id.trim() : "";
  if (!/^(re|pyr)_[A-Za-z0-9]+$/.test(refundId)) return json({ error: "invalid_stripe_ref" }, 400);
  const cents = typeof body.amount_cents === "number" && Number.isInteger(body.amount_cents) && body.amount_cents > 0 ? body.amount_cents : 0;
  if (!cents) return json({ error: "invalid_amount" }, 400);
  const note = typeof body.note === "string" ? body.note : "";
  const { data: role, error: roleErr } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (roleErr) throw new Error(`admin role read failed: ${roleErr.message}`);
  if (!role) return json({ error: "admin_only" }, 403);
  const o = await readOrder(admin, orderId);
  if (!o?.stripe_payment_intent_id) return json({ error: "order_not_found" }, 404);
  const refund = await retrieveRefund(await stripeForOrder(admin, o, "read"), refundId);
  if (!refund) return json({ error: "refund_not_found" }, 404);
  const refundPi = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id ?? null;
  if (refundPi !== o.stripe_payment_intent_id) return json({ error: "refund_not_on_this_order" }, 409);
  if (refund.amount !== cents) return json({ error: "refund_amount_differs", amount_cents: refund.amount }, 409);
  if (refund.status === "failed" || refund.status === "canceled") return json({ error: "refund_not_live" }, 409);
  const { data, error } = await admin.rpc("shops_admin_record_hand_refund", {
    p_admin: userId, p_order_id: orderId, p_stripe_refund_id: refundId, p_amount_cents: cents, p_note: note,
  });
  if (error) return rpcRefusal(error);
  return json({ recorded: true, result: (data as { result?: string } | null)?.result ?? null });
}

/**
 * Settle a HELD Shops refund with a refund made in Stripe (Payouts held for review;
 * /code-review of shops-m3 run 3 #2/#3). AN ADMIN only (user_roles read with the
 * service key). The refund is RETRIEVED from Stripe (read only, no Stripe write) and
 * must be live, on THIS refund row's PaymentIntent, and for at least the whole refund
 * the row owes; then the service-only shops_admin_settle_held_refund records it (with
 * the admin's id and Stripe's amount: has_role checked again there, audited). The
 * client RPC admin_payout_settle_by_hand takes only "other: ..." for a Shops refund.
 */
async function adminSettleHeldRefund(body: Record<string, unknown>, userId: string, admin: Db) {
  const rowId = typeof body.refund_row_id === "string" ? body.refund_row_id : "";
  if (!UUID_RE.test(rowId)) return json({ error: "refund_not_found" }, 404);
  const refundId = typeof body.refund_id === "string" ? body.refund_id.trim() : "";
  if (!/^(re|pyr)_[A-Za-z0-9]+$/.test(refundId)) return json({ error: "invalid_stripe_ref" }, 400);
  const note = typeof body.note === "string" ? body.note : "";
  const { data: role, error: roleErr } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (roleErr) throw new Error(`admin role read failed: ${roleErr.message}`);
  if (role == null) return json({ error: "admin_only" }, 403);
  const { data: row, error: rowErr } = await admin.from("shop_refunds")
    .select("id, order_id, stripe_payment_intent_id, refund_cents, status").eq("id", rowId).maybeSingle();
  if (rowErr) throw new Error(`shop refund read failed: ${rowErr.message}`);
  if (!row) return json({ error: "refund_not_found" }, 404);
  const o = await readOrder(admin, row.order_id as string);
  if (!o?.stripe_payment_intent_id) return json({ error: "refund_not_found" }, 404);
  const refund = await retrieveRefund(await stripeForOrder(admin, o, "read"), refundId);
  if (!refund) return json({ error: "refund_not_found" }, 404);
  const refundPi = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id ?? null;
  // 11-07 (option B): a two-charge order's refund made on the rest's payment is settled with "other: <the refund ids>"
  // (admin_payout_settle_by_hand), never here: this settles one refund on the row's own payment.
  if (refundPi !== row.stripe_payment_intent_id) return json({ error: "refund_not_on_this_order" }, 409);
  if (refund.status === "failed" || refund.status === "canceled") return json({ error: "refund_not_live" }, 409);
  // Only a refund Stripe has FINISHED settles a row (run-3 review L3): a pending one can still fail.
  if (refund.status !== "succeeded") return json({ error: "refund_pending" }, 409);
  if (Number(refund.amount ?? 0) < Number(row.refund_cents)) return json({ error: "hand_refund_short", amount_cents: refund.amount }, 409);
  const { data, error } = await admin.rpc("shops_admin_settle_held_refund", {
    p_admin: userId, p_refund_id: rowId, p_stripe_refund_id: refundId, p_amount_cents: Number(refund.amount), p_note: note,
  });
  if (error) return rpcRefusal(error);
  const settled = (data ?? {}) as { result?: string; owed_cents?: number; over_refunded_cents?: number };
  // A Stripe refund LARGER than the row owes settled it (the money already moved): the card fee and tax the
  // app keeps went back too, so ops are told, never quiet (run-3 review L2; audited in the SQL).
  if (Number(settled.over_refunded_cents ?? 0) > 0) {
    await postSlackOpsAlert({
      kind: "money_at_risk", severity: "critical", oncePerDayKey: `shop-refund-over-${rowId}`,
      title: "Shops: a held refund was settled with a LARGER Stripe refund",
      message: `Refund ${refundId} gave the buyer $${(Number(refund.amount) / 100).toFixed(2)}; this order's refund owed $${(Number(settled.owed_cents ?? 0) / 100).toFixed(2)}. `
        + `The $${(Number(settled.over_refunded_cents) / 100).toFixed(2)} difference (the card fee and its tax the app keeps) went back too: recover it or record why.`,
      fields: { ShopRefund: rowId, Order: String(row.order_id), Refund: refundId, Admin: userId },
    });
  }
  return json({ settled: true, result: settled.result ?? null, over_refunded_cents: Number(settled.over_refunded_cents ?? 0) });
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
    // Ordering and a shop accepting an order are commitments: the caller must
    // have accepted the current Terms (_shared/requireCurrentTerms.ts).
    // pay_balance and charge_rest collect on an order already agreed (like
    // create-payment's settlement actions) and are not refused, so a deposit
    // order is never stranded.
    if (body.action === "order" || body.action === "accept") {
      const staleTerms = await refuseStaleTerms(admin, user, corsHeaders);
      if (staleTerms) return staleTerms;
    }
    if (body.action === "order") return await order(body, user, asMember, admin);
    if (body.action === "buy_digital") return await buyDigital(body, user, asMember, admin);
    if (body.action === "helpr_quote") return await helprQuote(body, asMember, admin);
    if (body.action === "pickup_point") return await pickupPoint(user, asMember, admin);
    if (body.action === "accept") return await accept(body, asMember, admin);
    if (body.action === "decline") return await decline(body, asMember, admin);
    if (body.action === "cancel") return await cancel(body, asMember, admin);
    if (body.action === "close_request") return await closeRequest(body, asMember, admin);
    if (body.action === "pay_balance") return await payBalance(body, user, admin);
    if (body.action === "charge_rest") return await chargeRest(body, user, admin);
    if (body.action === "buyer_cancel") return await buyerCancel(body, asMember, admin);
    if (body.action === "shop_cancel") return await shopCancel(body, asMember, admin);
    if (body.action === "preorder_cancel") return await preorderCancel(body, asMember, admin);
    if (body.action === "no_show") return await noShow(body, asMember);
    if (body.action === "admin_refund") return await adminRefund(body, asMember, admin);
    if (body.action === "admin_record_hand_refund") return await adminRecordHandRefund(body, user.id, admin);
    if (body.action === "admin_settle_held_refund") return await adminSettleHeldRefund(body, user.id, admin);
    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    if (error instanceof StripeModeRefused) return stripeModeRefusedResponse(error, corsHeaders);
    console.error("[shop-checkout] error:", error);
    return json({ error: TRY_AGAIN }, 500);
  }
});
