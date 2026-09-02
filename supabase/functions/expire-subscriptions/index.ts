import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { cronError, cronResult } from "../_shared/cron-result.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { tierDisplayName } from "../_shared/tierNames.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify cron secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
  );

  try {
    // Find profiles with expired one-time passes
    const now = new Date().toISOString();
    const { data: expired, error: fetchError } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, subscription_tier, subscription_expires_at")
      .not("subscription_tier", "is", null)
      .not("subscription_expires_at", "is", null)
      .lt("subscription_expires_at", now);

    if (fetchError) {
      console.error("[EXPIRE-SUBS] Error fetching expired subs:", fetchError.message);
      throw fetchError;
    }

    // ── The rows this sweep structurally CANNOT clean ────────────────────────
    //
    // The predicate above requires `subscription_expires_at IS NOT NULL`, so a
    // profile carrying a tier with a NULL expiry is not merely unhandled — it
    // is invisible. It is a paid tier that never lapses: a permanent free
    // membership, and the sweep whose whole job is to end memberships would
    // never once look at it.
    //
    // IS A NULL EXPIRY EVER LEGITIMATE? No. It was checked rather than
    // assumed: `subscription_tier` has exactly five writers in the entire
    // codebase (the three stripe-webhook handlers, check-pro-subscription, and
    // this file), all service role, and there is no comp/manual-grant path
    // anywhere — no admin RPC, no client write (the column is not writable by
    // `authenticated` at all as of 20260901011254). Every one of those writers
    // either stamps an expiry or fires a `critical` Slack alert saying, in its
    // own words, that the tier "will never lapse on its own. Reconcile
    // manually." So a NULL expiry beside a non-NULL tier is always the residue
    // of a defect, never a comped account.
    //
    // WHY IT IS SURFACED HERE AND CLEANED ELSEWHERE. The obvious response —
    // clear the tier — is the one outcome worse than the bug. A live monthly
    // subscriber whose period end failed to read is in exactly this state, and
    // revoking them would take away access they are paying for, with no event
    // due to restore it until their next renewal. Deciding between "orphaned
    // grant" and "paying member with a missing timestamp" requires asking
    // Stripe, and this function has no Stripe client by design.
    //
    // So it is counted, reported in the body, and alerted on — the one thing
    // it must never do again is silently skip. `subscription-reconciliation`
    // (08:24 UTC, 15 minutes after this run) holds the Stripe truth and is
    // what actually resolves each row: backfill the real period end when a
    // live subscription exists, clear the tier when none does.
    const { data: unexpirable, error: unexpirableError } = await supabase
      .from("profiles")
      .select("user_id, email, subscription_tier")
      .not("subscription_tier", "is", null)
      .is("subscription_expires_at", null)
      .limit(200);

    // Never drop the error. A failed read here must not read as "none found" —
    // that would restore the exact silence this block exists to remove.
    const unexpirableCount = unexpirable?.length ?? 0;
    if (unexpirableError) {
      console.error("[EXPIRE-SUBS] unexpirable-row scan failed:", unexpirableError.message);
    } else if (unexpirableCount > 0) {
      console.error(`[EXPIRE-SUBS] ${unexpirableCount} tier(s) with NO expiry — cannot lapse`);
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Paid tiers that can never expire",
        message:
          "Profiles hold a subscription_tier with subscription_expires_at NULL. This sweep filters on a non-null expiry, so these memberships are permanent and it cannot end them. They are not cleared here on purpose — a live subscriber with a missing period end looks identical from this side, and revoking them would be worse than the bug. subscription-reconciliation resolves each one against Stripe.",
        fields: {
          count: unexpirableCount,
          sample: unexpirable!
            .slice(0, 5)
            .map((p) => `${p.email ?? p.user_id} (${p.subscription_tier})`)
            .join(", "),
        },
      }).catch(() => {});
    }

    // Reported on EVERY run, including the clean one below, so the numbers a
    // reader compares across days always have the same shape.
    const standingCounts = {
      unexpirable: unexpirableCount,
      unexpirable_scan_failed: unexpirableError ? true : undefined,
    };

    // A degraded scan IS a defect (something is broken), a non-zero
    // `unexpirable` is NOT — it is a standing data condition this function did
    // not cause and cannot fix. cronResult turns defects into a 500, and a 500
    // every single day until someone hand-repairs old rows would train everyone
    // to ignore this cron's failures, which is how the original bug survived.
    const scanDefect = unexpirableError
      ? { count: 1, reasons: [`unexpirable-row scan failed: ${unexpirableError.message}`] }
      : { count: 0 };

    if (!expired || expired.length === 0) {
      console.log("[EXPIRE-SUBS] No expired subscriptions found");
      return cronResult(
        "expire-subscriptions",
        // `found` is what cron_work_expectations keys on (20260901011254).
        // `cleared: 0` alone must never look suspicious — on almost every day
        // of this cron's life it is the correct answer.
        { found: 0, cleared: 0, ...standingCounts },
        scanDefect,
        corsHeaders,
      );
    }

    console.log(`[EXPIRE-SUBS] Found ${expired.length} expired subscription(s)`);

    // Clear all expired tiers. Re-assert the expiry predicate on the UPDATE (not
    // just user_id): if a user RENEWS in the gap between the SELECT above and
    // this write, their fresh future expiry would otherwise be wrongly nulled.
    // The .lt guard means we only clear rows that are still expired at write time.
    const userIds = expired.map(p => p.user_id);
    const { data: clearedRows, error: updateError } = await supabase
      .from("profiles")
      .update({
        subscription_tier: null,
        subscription_expires_at: null,
        // Clear the Stripe linkage that described the membership that just
        // ended, so the row does not keep asserting a subscription id or a
        // billing cycle for a tier it no longer holds — that is precisely the
        // drift subscription-reconciliation would then report. stripe_customer_id
        // is deliberately KEPT: the customer record survives cancellation and is
        // the durable handle if they come back.
        stripe_subscription_id: null,
        subscription_billing_cycle: null,
        subscription_cancel_at_period_end: false,
      })
      .in("user_id", userIds)
      .lt("subscription_expires_at", now)
      // A null `error` does not mean the write happened, and here it also does
      // not mean WHICH rows it happened to: the `.lt` re-assertion above can
      // legitimately match fewer rows than the SELECT found. Reading the rows
      // back is what makes `cleared` a real count and — see below — what stops
      // a member who renewed in the gap being emailed that their membership
      // ended.
      .select("user_id");

    if (updateError) {
      console.error("[EXPIRE-SUBS] Error clearing tiers:", updateError.message);
      throw updateError;
    }

    // The rows that ACTUALLY lost their tier on this run.
    const clearedIds = new Set((clearedRows ?? []).map((r) => r.user_id as string));
    const clearedProfiles = expired.filter((p) => clearedIds.has(p.user_id));

    // Notify each user. The tiers are already cleared above, so a failed
    // notification must not fail the run (nor cause a re-run to double-clear —
    // it won't, the WHERE filter no longer matches the now-null tiers) — but
    // log it so a missing "subscription expired" alert is traceable rather
    // than silently dropped.
    //
    // Built from `clearedProfiles`, NOT `expired`: a member who renewed between
    // the SELECT and the UPDATE is correctly skipped by the `.lt` guard on the
    // write, and mailing them "Your Pro membership ended" while they hold a
    // fresh future expiry would be a false statement sent to a paying customer.
    const notifications = clearedProfiles.map(p => ({
      user_id: p.user_id,
      title: "Membership expired",
      // tierDisplayName, not the raw column: this used to interpolate the id
      // straight in and tell a lapsing member "Your pro pass ended."
      message: `Your ${tierDisplayName(p.subscription_tier)} membership ended. Renew anytime in Profile → Membership.`,
      type: "info",
      link: "/profile?tab=subscription",
    }));

    // An empty insert is a legitimate outcome now that this is scoped to rows
    // that really were cleared (the whole batch can be lost to renewal races),
    // and PostgREST rejects a zero-length insert body — so skip it.
    const { error: notifErr } = notifications.length
      ? await supabase.from("notifications").insert(notifications)
      : { error: null };
    if (notifErr) console.error(`[EXPIRE-SUBS] expiry notifications insert failed for ${notifications.length} user(s):`, notifErr);

    console.log(`[EXPIRE-SUBS] Cleared ${clearedProfiles.length} of ${expired.length} expired subscription(s)`);

    // The tiers are already cleared, so a failed notification does not fail the
    // run — but it is still a defect: the user silently loses their pass with no
    // word about why, which is exactly the kind of quiet breakage that goes
    // unnoticed for months.
    return cronResult(
      "expire-subscriptions",
      {
        found: expired.length,
        cleared: clearedProfiles.length,
        notified: notifErr ? 0 : notifications.length,
        ...standingCounts,
      },
      {
        count: (notifErr ? 1 : 0) + scanDefect.count,
        reasons: [
          ...(notifErr
            ? [`expiry notifications insert (${notifications.length} users): ${notifErr.message}`]
            : []),
          ...(scanDefect.reasons ?? []),
        ],
      },
      corsHeaders,
    );
  } catch (error) {
    console.error("[expire-subscriptions] error:", error);
    return cronError("expire-subscriptions", "Internal server error", corsHeaders);
  }
});
