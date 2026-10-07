// seed-policy: raises no alert of its own. Its only alerts are the ban-evasion
// pages inside syncConnectGate, which concern a real bank account whoever owns
// the profile; a defect answers 500 and sweep_cron_http_failures reports it.
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
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { serve } from "../_shared/buildStamp.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult } from "../_shared/cron-result.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { recheckPendingAccepts } from "../_shared/connectGateSync.ts";

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
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", { apiVersion: "2025-08-27.basil" });
    const { defects, ...counts } = await recheckPendingAccepts(stripe, supabase);
    return cronResult("recheck-pending-accepts", counts, { count: defects.length, reasons: defects }, corsHeaders);
  } catch (e) {
    return cronError("recheck-pending-accepts", caughtMessage(e), corsHeaders);
  }
});
