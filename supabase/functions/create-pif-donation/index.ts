import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import { posterServiceFeeCents } from "../_shared/posterFees.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Directed Pay-It-Forward gift bounds, in cents. The floor mirrors the minimum
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
    keyPrefix: "create-pif-donation",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
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
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) return fail(401, "Your session expired — sign in again to continue.");

    const body = await req.json().catch(() => ({}));
    const amountDollars = Number(body?.amount);
    const recipientEmailRaw = typeof body?.recipient_email === "string" ? body.recipient_email : "";
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
    const recipientEmail = recipientEmailRaw.trim().toLowerCase();
    if (!EMAIL_RE.test(recipientEmail)) {
      return fail(400, "Enter a valid email for the person you're gifting.");
    }
    if (recipientEmail === user.email.toLowerCase()) {
      return fail(400, "You can't send a gift to yourself.");
    }

    // ── Charge math ──
    // The donor covers the face value PLUS the service fee at 0% tier profit —
    // `posterServiceFeeCents(amountCents, 0)` returns just Stripe's processing-
    // cost floor. The platform forgoes its tier margin on Pay-It-Forward jobs,
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
    // only writer of pif_credits (client mint is removed), so amount_cents and
    // recipient_email must survive here, not be re-derived.
    const sharedMeta = {
      kind: "pif_donation",
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
            // User-visible: this is the Stripe line-item name, so it shows on the
// checkout page and on the emailed receipt. The feature was renamed to
// "gift card" at the surface; this string was missed.
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
      payment_intent_data: { metadata: sharedMeta },
      success_url: `${getAppUrl()}/pay-it-forward?gift=success`,
      cancel_url: `${getAppUrl()}/pay-it-forward?gift=cancelled`,
      metadata: sharedMeta,
    }, {
      // Same donor + recipient + amount collapses to ONE charge on a double-tap
      // or network retry. A deliberate second identical gift is rare enough that
      // sharing the key is the money-safe default; changing any field mints a new
      // session.
      idempotencyKey: `pif:${user.id}:${recipientEmail}:${amountCents}`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[create-pif-donation] error:", error);
    return fail(500, "Something went wrong starting your gift. Please try again.");
  }
});
