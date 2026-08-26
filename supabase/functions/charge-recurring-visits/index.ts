// Daily cron: fund the next recurring visits by charging the poster's saved card.
//
// THIS IS THE HALF RECURRING NEVER HAD. The old `spawn-recurring-jobs` copied a
// job's descriptive fields onto a new open row and stopped — no payment, no
// helper — so every visit after the first was publicly appliable with nothing
// behind it. The rule here is the inverse and is absolute:
//
//     A VISIT IS CREATED ONLY ONCE ITS MONEY IS IN ESCROW.
//
// So the job row is inserted AFTER the PaymentIntent succeeds, never before. A
// failed charge produces no job, which means there is no such thing as an
// unfunded visit for a helper to walk into. That ordering is the whole design;
// do not "optimise" it by pre-creating the row.
//
// WHY OFF-SESSION IS SAFE HERE. The poster is not present. They authorised this
// at checkout by posting a series with a saved card (`setup_future_usage:
// "off_session"`), and the authority is bounded: `recurrence_weeks` is capped at
// 52 by a CHECK, `budget` is per-visit and fixed at post time, and the poster
// can cancel the series at any point. `auto-tip-charge` is the existing
// precedent for this shape of charge and this function follows it closely.
//
// WHY THE CHARGE IS A RAW PaymentIntent AND NOT A CHECKOUT SESSION. A Checkout
// Session needs the payer in a browser. That also means Stripe's `automatic_tax`
// is unavailable, so LA sales tax is computed here from `_shared/salesTax.ts` —
// the same module the Post-a-Task screen quotes from and the same module
// create-payment classifies line items with. Only assembly labor is taxable, so
// on nearly every series this term is exactly zero; when it is not, the number
// comes from Stripe's own `tax.calculations`, which is where the actual charge
// gets it too.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import {
  DEFAULT_TIER_FEE_PERCENT,
  getHelperFeePercent,
  helperCommissionDollars,
} from "../_shared/helperFees.ts";
import { posterFeePercentForTier, posterServiceFeeCents } from "../_shared/posterFees.ts";
import { isLaborTaxable } from "../_shared/salesTax.ts";
import { recurringVisitDates } from "../_shared/recurringSchedule.ts";
import { cronResult } from "../_shared/cron-result.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * How far ahead a visit is funded.
 *
 * Long enough that a declined card leaves the poster time to fix it before the
 * helper is expecting to work, short enough that the poster is not holding
 * escrow for a week of visits at once. Also bounds the blast radius of a series
 * the poster forgot about: at most this many days of charges are ever in
 * flight.
 */
const FUND_LEAD_DAYS = 3;

/** Per-run ceiling on charges. See the note in the loop. */
const MAX_CHARGES_PER_RUN = 200;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
  );
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
    apiVersion: "2025-08-27.basil",
  });

  const today = todayUtc();
  const horizon = addDays(today, FUND_LEAD_DAYS);

  const results = {
    seriesConsidered: 0,
    funded: 0,
    skippedReleased: 0,
    skippedExisting: 0,
    declined: 0,
    errors: 0,
    capped: false,
  };

  // Active series: a day-set, a standing helper, and not cancelled. No standing
  // helper means nobody has accepted the first visit yet — there is nothing to
  // fund, because we never charge for a visit nobody is committed to.
  const { data: series, error: seriesErr } = await supabase
    .from("jobs")
    .select(
      "id, customer_id, business_id, title, description, category, budget, start_time, location, parish, zip_code, latitude, longitude, estimated_hours, special_requirements, photos, is_flexible_schedule, date_needed, recurrence_days, recurrence_weeks, recurring_helper_id, status",
    )
    .not("recurrence_days", "is", null)
    .not("recurring_helper_id", "is", null)
    .is("parent_job_id", null)
    // jobs.status is the `job_status` ENUM, and its ONLY members are: open,
    // accepted, in_progress, completed, cancelled, revision_requested,
    // disputed, pending_approval. This filter previously named 'expired',
    // which is not one of them, so Postgres rejected the whole read with
    // `invalid input value for enum job_status: "expired"`. That surfaced as
    // seriesErr -> HTTP 500 on every single daily run, so no recurring series
    // ever produced a second visit: the first visit funds at checkout and the
    // schedule then silently stops forever. Every value below is a real member
    // — if one is ever added here, check it against the enum first.
    //
    // 'cancelled' — the series is over, by the poster's own hand.
    //
    // 'disputed' — PAUSE, not stop (owner decision 2026-08-25). While a visit
    // is being contested we do not bill the poster for further visits; because
    // this is a filter and not a flag, charging resumes by itself the moment
    // the dispute resolves and the row leaves 'disputed'. No separate
    // resume path to forget to call.
    //
    // 'completed' deliberately stays IN scope — the parent row IS visit one, so
    // it flips to completed as soon as that visit is done while visits 2..N are
    // still owed. Excluding it would end every series after its first visit.
    .not("status", "in", "(cancelled,disputed)");

  if (seriesErr) {
    console.error("[charge-recurring-visits] series read failed", seriesErr);
    return new Response(JSON.stringify({ ok: false, error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  for (const parent of series ?? []) {
    results.seriesConsidered++;
    try {
      const dates = recurringVisitDates(
        parent.date_needed as string,
        (parent.recurrence_days ?? []) as number[],
        Number(parent.recurrence_weeks ?? 0),
      );
      // Due = strictly after the parent's OWN visit date, strictly after today,
      // and within the lead window.
      //
      // The `d > parentDate` term is load-bearing. dates[0] IS the parent's
      // date_needed (recurringVisitDates starts at startDate), and the previous
      // comment here reasoned that term was unnecessary because "the first date
      // is the parent job itself and can never be > today for an active
      // series". That is false for the ordinary case of booking ahead: a series
      // whose first visit is 1-3 days out has dates[0] > today and inside the
      // horizon, so it was due. The duplicate guard below cannot catch it
      // either — it only matches rows WHERE parent_job_id = parent.id, and the
      // parent itself has parent_job_id NULL. The result would have been a
      // second, separately-charged job for a visit the poster already funded at
      // checkout.
      const parentDate = parent.date_needed as string;
      const due = dates.filter((d) => d > parentDate && d > today && d <= horizon);
      if (due.length === 0) continue;

      const [{ data: existing }, { data: released }] = await Promise.all([
        supabase.from("jobs").select("date_needed").eq("parent_job_id", parent.id).in("date_needed", due),
        supabase
          .from("recurring_visit_releases")
          .select("visit_date")
          .eq("parent_job_id", parent.id)
          .in("visit_date", due),
      ]);
      const alreadyThere = new Set((existing ?? []).map((r) => r.date_needed as string));
      const releasedDates = new Set((released ?? []).map((r) => r.visit_date as string));

      for (const visitDate of due) {
        if (alreadyThere.has(visitDate)) { results.skippedExisting++; continue; }
        if (releasedDates.has(visitDate)) {
          // The standing helper gave this date up. We do NOT charge and do NOT
          // post it: nobody is committed to it, and funding a visit on the hope
          // a stranger takes it is how the poster ends up paying for work that
          // never happened. The poster was told when it was released.
          results.skippedReleased++;
          continue;
        }
        if (results.funded >= MAX_CHARGES_PER_RUN) {
          // Never silently truncate a run that moves money. A capped run is
          // reported so it cannot be mistaken for a quiet day.
          results.capped = true;
          break;
        }

        // ── What this visit costs ──────────────────────────────────────────
        const budgetCents = Math.round(Number(parent.budget) * 100);

        const { data: posterProfile, error: posterErr } = await supabase
          .from("profiles")
          .select("email, subscription_tier, subscription_expires_at")
          .eq("user_id", parent.customer_id)
          .maybeSingle();
        if (posterErr || !posterProfile?.email) {
          console.error(`[charge-recurring-visits] poster read failed for series ${parent.id}`, posterErr);
          results.errors++;
          continue;
        }

        const feePercent = posterFeePercentForTier(
          posterProfile.subscription_tier as string | null,
          posterProfile.subscription_expires_at as string | null,
        );
        // No urgent tip and no onboarding fee on a recurring visit: urgency is a
        // property of a one-off post, and onboarding is charged once per account
        // and was already paid on the first visit.
        const feeCents = posterServiceFeeCents(budgetCents, feePercent, 0);

        // Sales tax. Louisiana is an enumerated-services state, so only the
        // `assembly` and `handyman` labor lines are taxable — every other
        // category is $0 and needs no rate at all.
        //
        // This used to read `parish_tax_rates` for EVERY series, taxable or
        // not. That table was retired on 2026-08-23 (owner decision: quote
        // Stripe's number, stop maintaining a second one — the two had already
        // diverged and quoted $0 on charges Stripe taxed at 10%). It no longer
        // exists, so that read returned an error and its fail-closed branch
        // skipped the visit "rather than charging untaxed" — forever, and even
        // for the exempt categories that were never going to be taxed at all.
        // Combined with the enum bug above, recurring could not have charged a
        // visit even once.
        //
        // Tax now comes from the same place the actual charge gets it: Stripe.
        // `tax.calculations` is the exact call `calculate-tax` makes for the
        // checkout quote, with the same labor tax_code, so the recurring visit
        // and the first visit are computed from identical inputs.
        let taxCents = 0;
        if (isLaborTaxable(parent.category as string)) {
          try {
            const calc = await stripe.tax.calculations.create({
              currency: "usd",
              line_items: [{
                amount: budgetCents,
                reference: "labor",
                tax_behavior: "exclusive",
                tax_code: "txcd_20030000",
              }],
              customer_details: {
                address: {
                  postal_code: (parent.zip_code as string) ?? "",
                  state: "LA",
                  country: "US",
                },
                address_source: "billing",
              },
            });
            taxCents = calc.tax_amount_exclusive ?? 0;
          } catch (e) {
            // Still fail closed, but now only for the narrow taxable case —
            // charging untaxed would leave us owing Louisiana money we never
            // collected on a total the poster already sees as final.
            console.error(
              `[charge-recurring-visits] Stripe tax calculation failed for series ${parent.id} (${parent.category}); skipping rather than charging untaxed`,
              e,
            );
            results.errors++;
            continue;
          }
        }

        const totalCents = budgetCents + feeCents + taxCents;

        // The HELPER's commission, which is a different number in a different
        // column from the poster's service fee above. `create-payment` sets the
        // convention (index.ts:350-356) and the two are easy to transpose:
        //   platform_fee_percent -> the POSTER's tier percentage
        //   platform_fee_amount  -> the HELPER's commission, in dollars
        //   customer_fee_amount  -> the POSTER's service fee, in dollars
        //   helper_fee_percent   -> the HELPER's tier percentage
        // Writing the poster's fee into platform_fee_amount (and leaving
        // customer_fee_amount at its 0 default) does not mispay the helper —
        // release-payout overwrites platform_fee_amount at release — but it
        // makes the admin gross rollups, which read `budget +
        // customer_fee_amount + sales_tax_amount`, under-report every visit by
        // its whole service fee; and the cancellation refund reads
        // `customer_fee_amount ?? 0`, so it would hand back a fee that WAS
        // collected.
        const { data: settingsRow } = await supabase
          .from("platform_settings")
          .select("helper_fee_percent")
          .limit(1)
          .maybeSingle();
        // The last-resort fallback is the FREE-tier rate, not a literal 10.
        // helperFees.ts picks free (12) on purpose: an unrecognised or
        // unreadable tier must never under-charge the platform, and a bare 10
        // silently applied the Pro rate whenever platform_settings was
        // unreadable.
        const fallbackHelperFeePercent = typeof settingsRow?.helper_fee_percent === "number"
          ? settingsRow.helper_fee_percent
          : DEFAULT_TIER_FEE_PERCENT;
        const helperFeePercent = await getHelperFeePercent(
          supabase as never,
          parent.recurring_helper_id as string,
          fallbackHelperFeePercent,
        );
        // Use the shared commission helper, not the unrounded
        // `(budget * pct) / 100` form. helperFees.ts documents why: the
        // unrounded variant carries sub-cent precision into the row and put
        // two payout paths a cent apart on thousands of (budget, tier) pairs.
        // This value is provisional — release-payout overwrites it with the
        // real commission — but it is what admin reporting and the helper's
        // estimate read until then, so it must round like money.
        const helperFeeAmount = helperCommissionDollars(
          Number(parent.budget),
          helperFeePercent,
        );

        if (dryRun) {
          console.log("[charge-recurring-visits] would charge", {
            series: parent.id, visitDate, totalCents,
          });
          results.funded++;
          continue;
        }

        // ── Charge, then create ────────────────────────────────────────────
        const customers = await stripe.customers.list({ email: posterProfile.email as string, limit: 1 });
        const customerId = customers.data[0]?.id;
        const methods = customerId
          ? await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 })
          : null;
        const paymentMethodId = methods?.data[0]?.id;

        if (!customerId || !paymentMethodId) {
          await notifyPosterCardProblem(supabase, parent, visitDate, "no_saved_card");
          results.declined++;
          continue;
        }

        let intent: Stripe.PaymentIntent;
        try {
          intent = await stripe.paymentIntents.create(
            {
              amount: totalCents,
              currency: "usd",
              customer: customerId,
              payment_method: paymentMethodId,
              off_session: true,
              confirm: true,
              description: `Helpr recurring visit — ${parent.title} on ${visitDate}`,
              // No transfer_data: this is ESCROW. The money sits on the platform
              // until the visit is completed and `create-payment action=release`
              // transfers it, exactly like a one-off job.
              metadata: {
                type: "recurring_visit",
                parent_job_id: String(parent.id),
                visit_date: visitDate,
                customer_id: String(parent.customer_id),
                helper_id: String(parent.recurring_helper_id),
              },
            },
            {
              // Keyed on (series, date) — the natural unique key for a visit. A
              // Stripe-level retry, an overlapping cron run, or a manual
              // re-trigger can never mint a second charge for the same visit.
              idempotencyKey: `recurring-visit:${parent.id}:${visitDate}`,
            },
          );
        } catch (chargeErr) {
          // Declines and authentication_required land here. authentication_required
          // is the one an off-session charge structurally cannot satisfy — it
          // needs the poster present — so both are treated the same: no visit,
          // and tell the poster while there is still time to fix it.
          const message = chargeErr instanceof Error ? chargeErr.message : String(chargeErr);
          console.error(`[charge-recurring-visits] charge failed ${parent.id} ${visitDate}: ${message}`);
          await notifyPosterCardProblem(supabase, parent, visitDate, message.slice(0, 120));
          results.declined++;
          continue;
        }

        if (intent.status !== "succeeded") {
          await notifyPosterCardProblem(supabase, parent, visitDate, `intent_${intent.status}`);
          results.declined++;
          continue;
        }

        // Money is in. NOW the visit exists.
        const { data: child, error: childErr } = await supabase
          .from("jobs")
          .insert({
            customer_id: parent.customer_id,
            business_id: parent.business_id,
            title: parent.title,
            description: parent.description,
            category: parent.category,
            budget: parent.budget,
            date_needed: visitDate,
            start_time: parent.start_time,
            location: parent.location,
            parish: parent.parish,
            zip_code: parent.zip_code,
            latitude: parent.latitude,
            longitude: parent.longitude,
            estimated_hours: parent.estimated_hours,
            special_requirements: parent.special_requirements,
            photos: parent.photos,
            is_flexible_schedule: parent.is_flexible_schedule,
            parent_job_id: parent.id,
            // The standing helper holds it. Not 'open' — this visit is not up
            // for grabs, which is the entire point of booking a series.
            helper_id: parent.recurring_helper_id,
            status: "accepted",
            helper_confirmed_at: new Date().toISOString(),
            payment_status: "escrow",
            stripe_payment_intent_id: intent.id,
            platform_fee_percent: feePercent,
            platform_fee_amount: helperFeeAmount,
            customer_fee_amount: feeCents / 100,
            helper_fee_percent: helperFeePercent,
            // Derived from the amount Stripe actually calculated rather than a
            // rate we looked up ourselves — that second source of truth is the
            // one that was retired. Rounded to 4dp so a rate like 9.95% stores
            // as 9.95 and not a repeating float.
            sales_tax_rate: taxCents > 0 && budgetCents > 0
              ? Math.round((taxCents / budgetCents) * 1_000_000) / 10_000
              : 0,
            sales_tax_amount: taxCents / 100,
            // A recurring visit is never a one-time template itself.
            is_recurring: false,
            is_urgent: false,
            urgent_fee: 0,
          })
          .select("id")
          .single();

        if (childErr || !child) {
          // The charge went through and the row did not. Refund immediately —
          // holding a poster's money for a visit that does not exist is the
          // worst outcome available here, and it is silent unless we act.
          console.error(`[charge-recurring-visits] insert failed after charge ${intent.id}`, childErr);
          try {
            await stripe.refunds.create(
              { payment_intent: intent.id },
              { idempotencyKey: `recurring-visit-refund:${parent.id}:${visitDate}` },
            );
          } catch (refundErr) {
            await postSlackOpsAlert({
              kind: "custom",
              severity: "critical",
              title: "Recurring visit charged but not created, and the refund failed",
              message: `PaymentIntent ${intent.id} is holding a poster's money for a visit that was never created. Refund by hand.`,
              fields: { parentJobId: String(parent.id), visitDate, intent: intent.id, error: String(refundErr) },
            });
          }
          results.errors++;
          continue;
        }

        // The helper needs an application row for the same reason a direct
        // offer does: earnings, reviews and the completion flow all join
        // through it. ON CONFLICT because a helper who happened to apply
        // separately must not collide with the unique (job_id, helper_id).
        await supabase.from("applications").upsert(
          { job_id: child.id, helper_id: parent.recurring_helper_id, status: "accepted", message: null },
          { onConflict: "job_id,helper_id" },
        );

        await supabase.from("notifications").insert([
          {
            user_id: parent.recurring_helper_id,
            title: "Your next visit is booked",
            message: `"${parent.title}" on ${visitDate} is confirmed and paid. Can't make it? Release the date from My Jobs.`,
            type: "job_updates",
            link: "/my-jobs",
          },
          {
            user_id: parent.customer_id,
            title: "Next visit funded",
            message: `"${parent.title}" on ${visitDate} is booked and held in escrow.`,
            type: "job_updates",
            link: "/my-posts",
          },
        ]);

        results.funded++;
      }
    } catch (e) {
      console.error(`[charge-recurring-visits] series ${parent.id} failed`, e);
      results.errors++;
    }
  }

  if (results.errors > 0 || results.declined > 0) {
    await postSlackOpsAlert({
      kind: "custom",
      severity: results.errors > 0 ? "warning" : "info",
      title: "Recurring visit funding had failures",
      message: "Some recurring visits were not funded — declined cards produce no visit, so those posters have a gap in their schedule.",
      fields: { ...results, capped: results.capped ? "yes" : "no" },
    });
  }

  // `results.errors` already excludes declines — this function separated the
  // two from the start (`declined` is its own field, and the Slack alert above
  // drops to 'info' when errors is zero). So the counter is already
  // defects-only and can decide the status code as-is: a declined card must
  // never page, a failed insert-after-charge must.
  return cronResult(
    "charge-recurring-visits",
    { dryRun, today, horizon, ...results },
    { count: results.errors },
    corsHeaders,
  );
});

/**
 * A declined card means no visit. Say so while there is still time to fix it —
 * FUND_LEAD_DAYS is chosen so this notification lands before the helper would
 * have turned up.
 */
async function notifyPosterCardProblem(
  supabase: ReturnType<typeof createClient>,
  parent: Record<string, unknown>,
  visitDate: string,
  reason: string,
) {
  console.warn(`[charge-recurring-visits] no visit for ${parent.id} on ${visitDate}: ${reason}`);
  const { error } = await supabase.from("notifications").insert({
    user_id: parent.customer_id,
    title: "We couldn't charge for your next visit",
    message: `"${parent.title}" on ${visitDate} wasn't booked because the payment didn't go through. Update your card and we'll pick the series back up.`,
    type: "job_updates",
    link: "/profile?tab=payment",
  });
  if (error) console.error("[charge-recurring-visits] poster notification failed", error);
}
