// seed-policy: raises no alert of its own. A fixture test seat (is_seed with
// no payout account, accept-ready on the server) is never claimed
// (claim_payout_setup_reminders excludes it); the notifications seed boundary
// still drops a seed job's notice to a real account, and
// send-notification-email / process-email-queue refuse test recipients. A
// defect answers 500 and sweep_cron_http_failures reports it.
//
// payout-setup-reminders (owner decision 2026-10-25, item 9; lead answer 4(a)):
// payout setup moved from sign-up to the HIRE, so a hired Helpr whose payout
// account is not ready is reminded, in the app and by email, until it is:
// right after the hire, then day 1, day 3 and day 7, plus one reminder per job
// whose payout is waiting on them. At most one a day per Helpr.
//
// Every 15 minutes (cron job payout-setup-reminders, migration
// 20261025162003):
//   1. claim_payout_setup_reminders(CAP) picks the due reminders and writes
//      their payout_setup_reminders row in ONE statement, returning only the
//      rows it wrote, so two overlapping runs can never send the same one.
//      WHO is due is all in that SQL: payout_after_hire AND payout_setup on
//      for the Helpr (while payout setup is paused a reminder would point at
//      a paused screen, so none go), not payout-ready, holding a hire whose
//      payment is held.
//   2. For each claim: the in-app notice (push fans out from the insert), then
//      the email (send-notification-email, which applies the member's email
//      settings), then sent_at. If the database REFUSES the notice the claim
//      is released (its row deleted) so a later run retries; a notice the seed
//      boundary dropped by design is not a defect and sends no email.
//
// PGRST202 on the claim (not deployed yet, or a signature mismatch) stops the
// run before any claim and is a DEFECT (500): it would otherwise stop every
// reminder behind a green run.
import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "../_shared/buildStamp.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult } from "../_shared/cron-result.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { seedBoundaryDropsRow } from "../_shared/seedBoundary.ts";
import { fetchFunction, invocationDeadline } from "../_shared/functionFetch.ts";
import {
  IDENTITY_REMINDER_LINK,
  identityReminderCopy,
  PAYOUT_SETUP_REMINDER_LINK,
  PAYOUT_SETUP_REMINDER_TYPE,
  payoutSetupReminderCopy,
  type PayoutSetupReminderStage,
} from "../_shared/payoutSetupReminder.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Most reminders one run sends. Measured 2026-10-25: 3 real profiles were ever hired, so this is headroom. */
const CAP = 100;

type Claim = { helper_id: string; reminder_key: string; stage: PayoutSetupReminderStage; job_id: string | null; job_title: string | null };

serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = verifyCronSecret(req);
  if (denied) return denied;

  const defects: string[] = [];
  const counts = { claimed: 0, notified: 0, emailed: 0, released: 0, seedDropped: 0 };
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "";

  try {
    const supabase = createClient(supabaseUrl, serviceKey, { global: { fetch: boundedFetch() } });

    const { data, error } = await supabase.rpc("claim_payout_setup_reminders", { p_limit: CAP });
    if (error) {
      return cronError("payout-setup-reminders", `claim_payout_setup_reminders failed: ${error.code ?? ""} ${error.message}`, corsHeaders);
    }
    const claims = (Array.isArray(data) ? data : []) as Claim[];
    counts.claimed = claims.length;

    /** Un-claim a reminder whose notice the database refused, so a later run retries. */
    const release = async (c: Claim) => {
      const { data: gone, error: relErr } = await supabase
        .from("payout_setup_reminders")
        .delete()
        .eq("helper_id", c.helper_id)
        .eq("reminder_key", c.reminder_key)
        .select("helper_id");
      if (relErr || (gone?.length ?? 0) === 0) {
        defects.push(`release ${c.helper_id}/${c.reminder_key}: ${relErr?.message ?? "matched 0 rows"}`);
        return;
      }
      counts.released++;
    };

    for (const c of claims) {
      // Owner 2026-10-30: payout account ready and the ID outstanding: the notice asks for the ID.
      // Payout setup first when both are missing (its words already name Stripe's check).
      const { data: prof, error: profErr } = await supabase.from("profiles")
        .select("stripe_account_id, stripe_payouts_enabled").eq("user_id", c.helper_id).maybeSingle();
      if (profErr) defects.push(`profile ${c.helper_id}: ${profErr.message}`);
      const payoutReady = !!prof?.stripe_account_id && prof?.stripe_payouts_enabled === true;
      const { title, message } = payoutReady ? identityReminderCopy(c.stage, c.job_title) : payoutSetupReminderCopy(c.stage, c.job_title);
      const link = payoutReady ? IDENTITY_REMINDER_LINK : PAYOUT_SETUP_REMINDER_LINK;
      const row = { user_id: c.helper_id, job_id: c.job_id, title, message, type: PAYOUT_SETUP_REMINDER_TYPE, link };
      const { data: noted, error: noteErr } = await supabase.from("notifications").insert(row).select("id");
      if (noteErr) {
        defects.push(`notice ${c.helper_id}/${c.reminder_key}: ${noteErr.message}`);
        await release(c);
        continue;
      }
      if ((noted?.length ?? 0) === 0) {
        // Dropped BY DESIGN by the seed boundary: not a defect, and no email.
        if ((await seedBoundaryDropsRow(supabase, { user_id: c.helper_id, job_id: c.job_id, link })) === true) {
          counts.seedDropped++;
          continue;
        }
        defects.push(`notice ${c.helper_id}/${c.reminder_key}: insert matched 0 rows`);
        await release(c);
        continue;
      }
      counts.notified++;
      try {
        const res = await fetchFunction(`${supabaseUrl}/functions/v1/send-notification-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ ...row }),
        }, { deadlineAt: invocationDeadline(startedAt) });
        if (res.ok) counts.emailed++;
        else defects.push(`email ${c.helper_id}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
      } catch (e) {
        defects.push(`email ${c.helper_id}: ${caughtMessage(e)}`);
      }
      const { error: stampErr } = await supabase
        .from("payout_setup_reminders")
        .update({ sent_at: new Date().toISOString() })
        .eq("helper_id", c.helper_id)
        .eq("reminder_key", c.reminder_key);
      if (stampErr) defects.push(`sent_at ${c.helper_id}/${c.reminder_key}: ${stampErr.message}`);
    }

    // Owner 2026-10-30: a poster is told 24 hours before the start that their hired Helpr has not
    // verified their ID (the SQL writes the one notice and is a no-op while the switch is off).
    const { error: posterErr } = await supabase.rpc("identity_notify_posters_before_start", { p_limit: CAP });
    if (posterErr && posterErr.code !== "PGRST202") defects.push(`ID notices before the start: ${posterErr.message}`);

    return cronResult("payout-setup-reminders", counts, { count: defects.length, reasons: defects }, corsHeaders);
  } catch (e) {
    return cronError("payout-setup-reminders", caughtMessage(e), corsHeaders);
  }
});
