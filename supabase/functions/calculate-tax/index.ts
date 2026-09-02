import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { corsHeadersFull as corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { isLaborTaxable } from "../_shared/salesTax.ts";

/**
 * The sales tax the poster will ACTUALLY be charged — from Stripe, not from us.
 *
 * WHY THIS EXISTS
 * ---------------
 * Checkout used to quote tax from our own `parish_tax_rates` table while
 * `create-payment` let Stripe Tax compute the real number via
 * `automatic_tax: { enabled: true }`. Two implementations of one figure, and
 * they diverged exactly as you would expect: `parish_tax_rates` spelled two
 * parishes "De Soto" and "La Salle" while the ZIP table spelled them "DeSoto"
 * and "LaSalle", so the lookup missed, the miss read as a rate of zero, and
 * seven ZIP codes were QUOTED $0 tax on a charge Stripe then taxed at 10%.
 *
 * A quote that disagrees with the charge is worse than no quote. Owner decision
 * 2026-08-23: show Stripe's number, and stop maintaining a second one.
 *
 * WHAT IT DOES NOT DO: create anything. `tax.calculations` is a pricing
 * preview — it does not hold funds, does not appear on a statement, and is not
 * the thing that charges anyone. `create-payment` still owns the actual charge
 * and still computes its own tax through `automatic_tax`, so this function
 * being wrong or unreachable cannot mis-bill a poster; it can only mis-QUOTE
 * one, which is the failure the client's fallback below is written for.
 *
 * TAX_BEHAVIOR is "exclusive" here for the same reason create-payment pins it:
 * tax is ADDED to the line, never carved out of it. Inclusive would quote a
 * total that does not match the charge, and on the labor line it would carve
 * Louisiana sales tax out of the helper's payout.
 */
const TAX_BEHAVIOR = "exclusive" as const;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const key = Deno.env.get("STRIPE_SECRET_KEY");
    if (!key) return errorResponse("Stripe is not configured", 503, corsHeaders);

    const { budget, category, zip, state } = await req.json();

    const budgetCents = Math.round(Number(budget || 0) * 100);
    if (!Number.isFinite(budgetCents) || budgetCents <= 0) {
      return errorResponse("A positive budget is required", 400, corsHeaders);
    }
    if (!zip || typeof zip !== "string") {
      // No address, no jurisdiction, no honest answer. The client shows
      // "calculated at payment" rather than inventing one.
      return jsonResponse({ taxCents: null, reason: "no_address" }, 200, corsHeaders);
    }

    // Only the LABOR line can carry tax — the service fee, urgent tip and
    // setup fee all ship as txcd_00000000 in create-payment. Sending them here
    // would quote tax on lines that are never taxed.
    if (!isLaborTaxable(category)) {
      return jsonResponse({ taxCents: 0, exempt: true }, 200, corsHeaders);
    }

    const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });

    const calculation = await stripe.tax.calculations.create({
      currency: "usd",
      line_items: [
        {
          amount: budgetCents,
          reference: "labor",
          tax_behavior: TAX_BEHAVIOR,
          // Same code create-payment assigns the labor line, so the preview and
          // the charge are computed from identical inputs.
          tax_code: "txcd_20030000",
        },
      ],
      customer_details: {
        address: { postal_code: zip, state: state || "LA", country: "US" },
        address_source: "billing",
      },
      // Required for the `jurisdiction` field below to exist at all — see the
      // note there. Sub-list expansion, not a second API call.
      expand: ["line_items"],
    });

    return jsonResponse(
      {
        taxCents: calculation.tax_amount_exclusive,
        totalCents: calculation.amount_total,
        // Surfaced so the UI can name the jurisdiction it is quoting, the way
        // the old copy named the parish. CheckoutStep renders it as
        // "Sales tax (St. Tammany Parish)" when present.
        //
        // It read `calculation.tax_breakdown[0].jurisdiction` and was therefore
        // ALWAYS null: on a Tax Calculation the top-level `tax_breakdown[]`
        // entries carry only `amount`, `inclusive`, `taxable_amount`,
        // `taxability_reason` and `tax_rate_details`. `jurisdiction` (with the
        // human-readable `display_name`) exists only on the LINE ITEM
        // breakdown, which in turn is only returned when `line_items` is
        // expanded on the request above. `?.` swallowed both misses, so the
        // parish label silently never rendered and no error was ever logged.
        jurisdiction:
          calculation.line_items?.data?.[0]?.tax_breakdown?.[0]?.jurisdiction?.display_name ??
            null,
      },
      200,
      corsHeaders,
    );
  } catch (err) {
    // A failed PREVIEW must never block posting a job. The client treats any
    // non-200 as "unknown" and falls back to "+ tax, calculated at payment".
    console.error("calculate-tax:", err);
    return errorResponse("Could not calculate tax", 500, corsHeaders);
  }
});
