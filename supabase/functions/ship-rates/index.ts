/**
 * ship-rates: live postage quotes for a buyer's Declutter cart (docs/specs/shipping-draft.md S2 rates; owner
 * decisions 3, 8, 10, 11 and 13; Q2259).
 *
 * POST { seller_id, ship_to: { street1, street2?, city, state, zip } } from a signed-in buyer:
 *   1. rate-limited, confirmed email, the declutter_shipping switch on for this account (testers until the owner
 *      flips it; the shipping_quotes trigger refuses an ordinary account as well);
 *   2. the buyer's in-cart lines from that seller: every item small with a parcel preset, packed as ONE parcel
 *      (decision 10); the seller's ZIP from their pickup line; the buyer's address in Louisiana (decision 3);
 *   3. TEST MODE ONLY for now (lead 2026-10-30): a pair of real accounts is refused with shipping_test_only, and only
 *      EASYPOST_TEST_API_KEY is ever read here. The response's own "mode" must say test;
 *   4. EasyPost POST /v2/shipments with address and parcel fields only: no member email or phone ever goes to
 *      EasyPost (the request is checked before it is sent), so EasyPost's own emails and texts can never fire;
 *   5. at most 3 options, cheapest first and pre-selected, from USPS Ground Advantage (cubic included), USPS
 *      Priority and UPS Ground; never air or overnight (filtered here, never in the client);
 *   6. each option stored in shipping_quotes (30 minutes) and returned as { quote_id, service, rate_cents,
 *      delivery_days, preselected }. Checkout (S3) takes only the quote id back.
 */
import { serve } from "../_shared/buildStamp.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { requireFeature } from "../_shared/featureSwitch.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { stripeModeForParties, stripeModeRefusedResponse, StripeModeRefused } from "../_shared/stripeMode.ts";
import {
  buildRateRequest,
  bundleParcel,
  easypostKeyName,
  louisianaZipIn,
  memberContactInRequest,
  offeredQuotes,
  responseModeMatches,
  shipToFromBody,
} from "../_shared/easypostRates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EASYPOST_SHIPMENTS = "https://api.easypost.com/v2/shipments";
const EASYPOST_TIMEOUT_MS = 15_000;
const TRY_AGAIN = "We couldn't get shipping prices just now. Please try again.";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const rl = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 10, keyPrefix: "ship-rates" });
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
  const off = await requireFeature(admin, "declutter_shipping", user, corsHeaders);
  if (off) return off;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sellerId = typeof body.seller_id === "string" && UUID_RE.test(body.seller_id) ? body.seller_id : null;
    if (!sellerId || sellerId === user.id) return json({ error: "invalid_seller" }, 400);
    const shipTo = shipToFromBody(body.ship_to);
    if (!shipTo.ok) return json({ error: shipTo.error }, 400);

    // The buyer's own in-cart lines from this seller: one parcel for all of them (decision 10).
    const { data: lines, error: linesErr } = await admin
      .from("declutter_cart_items")
      .select("id, item_id, is_seed")
      .eq("buyer_id", user.id)
      .eq("seller_id", sellerId)
      .eq("status", "in_cart");
    if (linesErr) throw new Error(`cart read failed: ${linesErr.message}`);
    if (!lines || lines.length === 0) return json({ error: "nothing_to_ship" }, 404);
    const itemIds = lines.map((l) => l.item_id as string);

    const { data: items, error: itemsErr } = await admin
      .from("declutter_items")
      .select("id, delivery_size, ship_preset")
      .in("id", itemIds);
    if (itemsErr) throw new Error(`items read failed: ${itemsErr.message}`);
    const byId = new Map((items ?? []).map((i) => [i.id as string, i]));
    const presets: (string | null)[] = [];
    for (const id of itemIds) {
      const it = byId.get(id);
      if (!it || it.delivery_size !== "small" || !it.ship_preset) return json({ error: "not_shippable" }, 409);
      presets.push(it.ship_preset as string);
    }
    const parcel = bundleParcel(presets);
    if (!parcel) return json({ error: "parcel_too_big" }, 409);

    const { data: privs, error: privErr } = await admin
      .from("declutter_item_private")
      .select("item_id, pickup_address")
      .in("item_id", itemIds);
    if (privErr) throw new Error(`pickup read failed: ${privErr.message}`);
    const sellerZip = (privs ?? []).map((p) => louisianaZipIn(p.pickup_address as string | null)).find((z) => z) ?? null;
    if (!sellerZip) return json({ error: "seller_zip_missing" }, 409);

    // Test mode only until the owner turns shipping on (lead 2026-10-30): never the live EasyPost key here.
    const mode = await stripeModeForParties(admin, [user.id, sellerId], { caller: user.id });
    if (mode !== "test") return json({ error: "shipping_test_only" }, 409);
    const key = Deno.env.get(easypostKeyName("test"));
    if (!key) {
      console.error("[ship-rates] the EasyPost test key is not set");
      return json({ error: TRY_AGAIN }, 503);
    }

    const request = buildRateRequest(shipTo.address, { zip: sellerZip, state: "LA" }, parcel);
    const contact = memberContactInRequest(request);
    if (contact.length > 0) {
      // Unreachable by construction (buildRateRequest copies address fields only); refuse rather than send.
      console.error(`[ship-rates] refused to send member contact fields to EasyPost: ${contact.join(", ")}`);
      return json({ error: TRY_AGAIN }, 500);
    }
    const res = await fetch(EASYPOST_SHIPMENTS, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${key}:`)}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(EASYPOST_TIMEOUT_MS),
    });
    const shipment = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !shipment) {
      // Status and EasyPost's error code only: the body can echo the buyer's address.
      const code = (shipment?.error as { code?: unknown } | undefined)?.code;
      console.error(`[ship-rates] EasyPost shipments answered ${res.status}${typeof code === "string" ? ` (${code})` : ""}`);
      return json({ error: TRY_AGAIN }, 502);
    }
    if (!responseModeMatches(shipment, "test")) {
      console.error(`[ship-rates] EasyPost answered in mode ${String(shipment.mode)} for a test quote: refused`);
      return json({ error: TRY_AGAIN }, 502);
    }
    const offers = offeredQuotes(shipment.rates as never);
    if (offers.length === 0) return json({ error: "no_rates" }, 409);

    const isSeed = lines.some((l) => l.is_seed === true);
    const rows = offers.map((q) => ({
      buyer_id: user.id,
      seller_id: sellerId,
      cart_item_ids: lines.map((l) => l.id as string),
      label_mode: "test",
      service: q.service,
      rate_cents: q.rateCents,
      provider_rate_id: q.providerRateId,
      provider_shipment_id: q.providerShipmentId,
      delivery_days: q.deliveryDays,
      preselected: q.preselected,
      ship_to: shipTo.address,
      parcel: { weight_oz: parcel.weightOz, length_in: parcel.lengthIn, width_in: parcel.widthIn, height_in: parcel.heightIn },
      is_seed: isSeed,
    }));
    const { data: saved, error: saveErr } = await admin
      .from("shipping_quotes")
      .insert(rows)
      .select("id, service, rate_cents, delivery_days, preselected, expires_at");
    if (saveErr) throw new Error(`quote save failed: ${saveErr.message}`);
    if (!saved || saved.length !== rows.length) throw new Error(`quote save wrote ${saved?.length ?? 0} of ${rows.length} rows`);
    const quotes = [...saved].sort((a, b) => (a.rate_cents as number) - (b.rate_cents as number));
    return json({
      quotes: quotes.map((q) => ({
        quote_id: q.id, service: q.service, rate_cents: q.rate_cents, delivery_days: q.delivery_days, preselected: q.preselected,
      })),
      expires_at: quotes[0]?.expires_at ?? null,
    });
  } catch (error) {
    if (error instanceof StripeModeRefused) return stripeModeRefusedResponse(error, corsHeaders);
    console.error(`[ship-rates] error: ${caughtMessage(error)}`);
    return json({ error: TRY_AGAIN }, 500);
  }
});
