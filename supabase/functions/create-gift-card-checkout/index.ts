import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { getAppUrl, buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { posterServiceFeeCents } from "../_shared/posterFees.ts";
import { threeDSecureOptions } from "../_shared/threeDSecure.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Directed gift card bounds, in cents. The floor mirrors the minimum
// job budget so a redeemed gift can actually fund a real job; the ceiling caps
// a single prepaid gift so a fat-fingered or abusive donation can't run up an
// unbounded charge. Both are enforced server-side — the client input is never
// trusted.
const MIN_GIFT_CENTS = 1000;  // $10
const MAX_GIFT_CENTS = 50000; // $500
const MAX_MESSAGE_LEN = 140;  // matches MAX_NOTE_LENGTH in the donate UI

// A pragmatic email shape check. The authoritative validation is that a real
// person opens the emailed claim link; this only blocks obviously-malformed
// input before we spend a Stripe round-trip on it.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 5,
    keyPrefix: "create-gift-card-checkout",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
  );

  // Service-role client — used ONLY to resolve a picked-by-name recipient_id
  // to their real email server-side. search_profiles_by_name (the client-
  // facing RPC) deliberately never returns email; this is the one place that
  // elevated access is used, and only to reproduce exactly what a typed
  // email already does below.
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Expected, user-facing failures return their own status + message so the
  // client can show the real reason instead of a generic non-2xx error.
  const fail = (status: number, message: string) =>
    new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail(401, "Please sign in to send a gift.");
    const token = authHeader.replace("Bearer ", "");
    const { data, error: authErr } = await supabaseClient.auth.getUser(token);
    if (authErr) console.error("[create-gift-card-checkout] auth.getUser error:", authErr.message);
    const user = data.user;
    if (!user?.email) return fail(401, "Your session expired — sign in again to continue.");

    const body = await req.json().catch(() => ({}));
    const isNative = isNativeRequest(body);
    const amountDollars = Number(body?.amount);
    const recipientEmailRaw = typeof body?.recipient_email === "string" ? body.recipient_email : "";
    // Optional: sender picked a recipient by name via search_profiles_by_name
    // instead of typing an email. That RPC never returns email (it can't —
    // profiles SELECT RLS blocks it for anyone but the owner), so we resolve
    // the id to an email here with the service-role client, which already
    // has full-table read access. This is the exact same trust model as a
    // typed email: the sender picks who receives their own gift purchase,
    // which benefits the recipient and costs only the sender who chose it —
    // not a privilege-escalation or redirection concern.
    const recipientIdRaw = typeof body?.recipient_id === "string" ? body.recipient_id : "";
    const category = typeof body?.category === "string" ? body.category.slice(0, 40) : "Any";
    const message = typeof body?.message === "string" ? body.message.slice(0, MAX_MESSAGE_LEN) : "";
    // Presentation only — which occasion the sender picked and which card
    // design they chose. Length-capped here as well as by the column CHECK so
    // a crafted call can't stuff Stripe metadata (which has its own limits and
    // would fail the whole session create, not just this field).
    const occasion = typeof body?.occasion === "string" ? body.occasion.slice(0, 48) : "";
    const designId = typeof body?.design_id === "string" ? body.design_id.slice(0, 48) : "";

    // ── Amount validation (server-authoritative) ──
    if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
      return fail(400, "Enter a gift amount.");
    }
    const amountCents = Math.round(amountDollars * 100);
    if (amountCents < MIN_GIFT_CENTS) {
      return fail(400, `The smallest gift is $${(MIN_GIFT_CENTS / 100).toFixed(0)}.`);
    }
    if (amountCents > MAX_GIFT_CENTS) {
      return fail(400, `The largest single gift is $${(MAX_GIFT_CENTS / 100).toFixed(0)}.`);
    }

    // ── Recipient validation ──
    // Either a typed email or a recipient_id from the name-search picker.
    // recipient_id wins if both are somehow present — it came from an actual
    // profile row, not free text.
    let recipientEmail = recipientEmailRaw.trim().toLowerCase();
    if (recipientIdRaw) {
      if (recipientIdRaw === user.id) {
        return fail(400, "You can't send a gift to yourself.");
      }
      // A client-supplied recipient_id must clear the SAME gate
      // search_profiles_by_name enforces (approved, not banned) before we
      // resolve it to a real email with the service-role client — otherwise
      // this path is a stronger oracle than the search RPC it's meant to
      // front for: search_profiles_by_name is rate-limited (20/min, 200/day)
      // and filters to email-verified/non-banned rows only, but a raw recipient_id
      // sent straight to this endpoint had neither check, so any client that
      // already had (or guessed) a UUID could get back "found, here's
      // proof this id exists" / "not found" plus a real email, at this
      // endpoint's own request rate rather than the RPC's — re-opening
      // exactly the scraping vector the RPC was built to close. The generic
      // "couldn't find that person" message covers BOTH "no such user" and
      // "exists but isn't eligible" so neither response distinguishes them.
      const { data: eligibleProfile, error: profileErr } = await supabaseAdmin
        .from("profiles")
        .select("user_id")
        .eq("user_id", recipientIdRaw)
        // The same entry gate search_profiles_by_name applies (Q205b: was
        // approval_status = 'approved').
        .eq("email_verified", true)
        .or("ban_status.is.null,ban_status.not.in.(temp_banned,permanently_banned)")
        .maybeSingle();
      if (profileErr || !eligibleProfile) {
        return fail(400, "We couldn't find that person. Try searching again.");
      }
      const { data: targetAuthUser, error: lookupErr } =
        await supabaseAdmin.auth.admin.getUserById(recipientIdRaw);
      if (lookupErr || !targetAuthUser?.user?.email) {
        return fail(400, "We couldn't find that person. Try searching again.");
      }
      recipientEmail = targetAuthUser.user.email.toLowerCase();
    }
    if (!EMAIL_RE.test(recipientEmail)) {
      return fail(400, "Enter a valid email for the person you're gifting.");
    }
    if (recipientEmail === user.email.toLowerCase()) {
      return fail(400, "You can't send a gift to yourself.");
    }

    // ── Charge math ──
    // The donor covers the face value PLUS the service fee at 0% tier profit —
    // `posterServiceFeeCents(amountCents, 0)` returns just Stripe's processing-
    // cost floor. The platform forgoes its tier margin on gift-card-funded jobs,
    // but the donation still nets ~face value after Stripe, so a redeemed gift
    // that funds a $0-to-recipient job never puts the platform underwater.
    const feeCents = posterServiceFeeCents(amountCents, 0);
    const chargeCents = amountCents + feeCents;

    const donorName =
      (user.user_metadata?.full_name as string | undefined)?.trim() ||
      (user.user_metadata?.name as string | undefined)?.trim() ||
      user.email.split("@")[0];

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data[0]?.id;

    // Carry everything the webhook needs to MINT the credit. The webhook is the
    // only writer of gift_cards (client mint is removed), so amount_cents and
    // recipient_email must survive here, not be re-derived.
    const sharedMeta = {
      kind: "gift_card_purchase",
      donor_id: user.id,
      donor_name: donorName,
      recipient_email: recipientEmail,
      amount_cents: String(amountCents),
      category,
      message,
      occasion,
      design_id: designId,
    };

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            // User-visible: appears on the Stripe checkout page and emailed receipt.
            name: "Louisiana Helpr gift card",
            description:
              `A $${(amountCents / 100).toFixed(0)} Louisiana Helpr credit for ${recipientEmail} to get help when they need it.`,
            // Platform service — not subject to LA sales tax.
            tax_code: "txcd_00000000",
          },
          unit_amount: chargeCents,
        },
        quantity: 1,
      }],
      mode: "payment",
      automatic_tax: { enabled: true },
      // 3D Secure from $300 (docs/OPEN.md Q202): the hosted page runs the challenge.
      payment_method_options: threeDSecureOptions(chargeCents),
      payment_intent_data: { metadata: sharedMeta },
      // The Gift Card PROFILE TAB, directly. This is where Stripe sends the
      // buyer the instant they finish paying, so a stale path here is a 404 at
      // the end of a successful purchase — the worst possible place for one.
      // `/gift-card` was a redirect onto this tab until 2026-09-23 and is gone
      // (Q194: every link we mint is the current address, never a redirect).
      success_url: buildRedirectUrl(`/profile?tab=gift_card&gift=success`, isNative),
      cancel_url: buildRedirectUrl(`/profile?tab=gift_card&gift=cancelled`, isNative),
      metadata: sharedMeta,
    }, {
      // Same donor + recipient + amount collapses to ONE charge on a double-tap
      // or network retry. A deliberate second identical gift is rare enough that
      // sharing the key is the money-safe default; changing any field mints a new
      // session.
      idempotencyKey: `gift-card:${user.id}:${recipientEmail}:${amountCents}`,
    });

    // ── Pre-register the gift BEFORE the donor can pay ──
    // Until this existed, this function did exactly ONE database operation (the
    // profiles read above) and wrote nothing at all: a gift purchase left no row
    // of any kind until the webhook landed. So a lost webhook delivery — or a
    // signature failure, which stripe-webhook deliberately answers 200 — meant
    // the donor was charged and there was nothing queryable anywhere: no row, no
    // reconciliation target, no support path. `jobs` stamps stripe_session_id at
    // checkout-open precisely so a lost session is detectable; gifts had no
    // equivalent. This is that equivalent.
    //
    // The row is written payment_status='pending', which every spend path
    // already refuses — usePostJobGiftCard.ts and useDashboardSideQueries.ts
    // both require payment_status === "paid", and claim-gift-card rejects
    // anything else — so a pre-registered gift is inert until the webhook
    // completes it. `status` stays at the column default rather than 'sent':
    // nothing has been sent and no claim token exists yet.
    //
    // FAIL CLOSED. If this write fails we return an error instead of the
    // checkout URL, so the donor never reaches a payment page whose outcome we
    // could not record. The Stripe session exists but is unreachable without its
    // URL, and a retry collapses onto the SAME session via the idempotency key
    // below, which then re-attempts this registration.
    const { data: preRegistered, error: preErr } = await supabaseAdmin
      .from("gift_cards")
      .insert({
        donor_id: user.id,
        recipient_email: recipientEmail,
        amount: amountCents / 100,
        status: "available",
        payment_status: "pending",
        category,
        message,
        occasion,
        design_id: designId,
        stripe_session_id: session.id,
      })
      .select("id");

    // A null `error` is not a write — check the error AND the row count.
    if (preErr) {
      // 23505 is the unique violation on gift_cards_stripe_session_id_unique_idx,
      // which means this session is ALREADY registered. That is the correct and
      // expected state when the idempotency key collapses a retry onto an
      // existing session, so it is a success, not a failure.
      if ((preErr as { code?: string }).code === "23505") {
        console.log("[create-gift-card-checkout] session already pre-registered:", session.id);
      } else {
        console.error("[create-gift-card-checkout] pre-register failed:", preErr.message, session.id);
        return fail(500, "We couldn't start your gift safely. Nothing has been charged — please try again.");
      }
    } else if (!preRegistered || preRegistered.length === 0) {
      console.error("[create-gift-card-checkout] pre-register wrote zero rows:", session.id);
      return fail(500, "We couldn't start your gift safely. Nothing has been charged — please try again.");
    }

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[create-gift-card-checkout] error:", error);
    return fail(500, "Something went wrong starting your gift. Please try again.");
  }
});
