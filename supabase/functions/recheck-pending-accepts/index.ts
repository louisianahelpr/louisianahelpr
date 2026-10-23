// seed-policy: pages for seed accounts too. Its alerts are the ban-evasion
// pages inside syncConnectGate, which concern a real bank account whoever owns
// the profile, and one "payout accounts closed" note a day, which counts real
// Stripe accounts (a seed profile's Connect account is a Stripe account like
// any other); a defect answers 500 and sweep_cron_http_failures reports it.
//
// Q1186: a pending accept completes without the Helpr coming back to the app.
//
// accept_job_offer parks an accept in job_accept_pending while the Helpr's
// payout setup or Stripe ID is unfinished; trg_profiles_complete_pending_accepts
// completes it when the cached gate columns on profiles open. Prod's webhook
// receives no Connect events (Q876: 0 account.* rows in stripe_webhook_events,
// re-measured 2026-10-06), so before this the only writer of those columns was
// the Helpr's own stripe-connect `status` call: a Helpr who finished Stripe and
// never reopened the app lost the offer at its deadline.
//
// Every run re-reads each waiting Helpr's Connect account and syncs it through
// the same writer `status` uses (_shared/connectGateSync.ts). Scheduled every
// 15 minutes by cron job recheck-pending-accepts.
//
// Then (lead, 2026-10-23) it refreshes EVERY other Helpr with a Connect
// account the same way (refreshAllConnectGates): Stripe rejected the platform
// and every connected account, and with no Connect events (Q876) the cached
// gate of a Helpr who never opens the app read payable forever. A refresh
// that closes any gate tells ops once a day.
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { serve } from "../_shared/buildStamp.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult } from "../_shared/cron-result.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { recheckPendingAccepts, refreshAllConnectGates } from "../_shared/connectGateSync.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { createStripeModeResolver } from "../_shared/stripeMode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
      { global: { fetch: boundedFetch() } },
    );
    // Stripe mode (owner 2026-10-12): each Helpr's Connect account is read with
    // the key of that Helpr's own mode (a test account: the test key).
    const stripes = createStripeModeResolver(supabase, (key) => new Stripe(key, { apiVersion: "2025-08-27.basil" }));
    const stripeFor = async (helperId: string) => (await stripes.clientForParties([helperId])).stripe;
    const seen = new Set<string>();
    const { defects, ...counts } = await recheckPendingAccepts(stripeFor, supabase, seen);
    const { defects: refreshDefects, ...refresh } = await refreshAllConnectGates(stripeFor, supabase, seen);
    // The pending pass asked some Helprs first (the refresh skips them): its
    // closes and platform refusals count toward the run's alerts too (review r2 #2).
    const closedThisRun = refresh.closed + counts.closed;
    const platformRejectedThisRun = refresh.platform_rejected + counts.platform_rejected;
    if (closedThisRun > 0) {
      // Once a day: a closed gate is a Helpr who can no longer be paid out.
      await postSlackOpsAlert({
        kind: "payout_wait",
        severity: "warning",
        oncePerDayKey: "connect-gates-closed",
        title: "Stripe closed Helprs' payout accounts",
        message: `${closedThisRun} Helpr payout account(s) read payable in the app but Stripe now says they cannot be paid out; their cached gate was closed. Payouts to them are held until Stripe says otherwise.`,
        fields: { closed: closedThisRun, accounts: refresh.accounts, cannot_verify: refresh.cannot_verify },
      });
    }
    if (platformRejectedThisRun > 0) {
      await postSlackOpsAlert({
        kind: "payout_wait",
        severity: "warning",
        oncePerDayKey: "connect-refresh-platform-rejected",
        title: "Stripe refuses the platform's account: Helpr payout accounts cannot be verified",
        message: `Stripe answered "your account has been rejected" for ${platformRejectedThisRun} Helpr payout account read(s), so their cached state could not be checked. Every payout sender re-reads Stripe before a transfer and holds when it cannot verify.`,
        fields: { platform_rejected: platformRejectedThisRun, accounts: refresh.accounts },
      });
    }
    const allDefects = [...defects, ...refreshDefects];
    return cronResult(
      "recheck-pending-accepts",
      { ...counts, refresh },
      { count: allDefects.length, reasons: allDefects },
      corsHeaders,
    );
  } catch (e) {
    return cronError("recheck-pending-accepts", caughtMessage(e), corsHeaders);
  }
});
