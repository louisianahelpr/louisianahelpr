// seed-policy: raises no alert of its own. Seed profiles, test accounts,
// suppressed, fixture and reserved addresses are never claimed
// (claim_confirm_reminders excludes them), isTestAddress re-checks here, and
// process-email-queue refuses test recipients again at send time. A defect
// answers 500 and sweep_cron_http_failures reports it.
//
// confirm-reminders: ONE "confirm your email" reminder to an email account
// that never confirmed, about a day after sign-up, never more than one (owner
// 2026-10-29; migration 20261030025302). It began 2026-10-25 as two (step 1
// about an hour, step 2 about a day); step 1 is retired: this sends only step
// 2, and the SQL returns no rows for step 1 and skips any account that already
// had a reminder of either step.
//
// Each run, hourly at :17 by cron job confirm-reminders (migration
// 20261025190000):
//   1. claim_confirm_reminders(2, CAP): picks the
//      due accounts and writes their confirm_reminder_sends row in ONE
//      statement, returning only the rows it wrote. WHO is due (and the hidden
//      switch confirm_reminders, per account) is all in that SQL.
//   2. For each: mint a fresh link with auth.admin.generateLink({ type:
//      "magiclink" }). For an existing account GoTrue stores it as the
//      RECOVERY token, so the account's own sign-up link keeps working, and
//      verifying it confirms an unconfirmed address (supabase/auth verify.go,
//      recoverVerify). The link opens the scanner-safe page
//      (_shared/confirmLink.ts), so a mail scanner cannot spend it. Then render,
//      log to email_send_log, enqueue (transactional), stamp queued_at.
//      A failed mint, render or a database-refused enqueue releases the claim
//      so a later run retries; a network failure keeps it (it may have queued).
//   3. PGRST202 on the claim stops the run and is a defect (500).
import * as React from "npm:react@18.3.1";
import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "../_shared/buildStamp.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult } from "../_shared/cron-result.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import { FROM_DEFAULT } from "../_shared/resend.ts";
import { isTestAddress } from "../_shared/testRecipient.ts";
import { confirmLinkUrl } from "../_shared/confirmLink.ts";
import { CONFIRM_REMINDER_COPY, type ConfirmReminderStep, confirmReminderTemplateName } from "../_shared/confirmReminder.ts";
import { ConfirmReminderEmail } from "../_shared/email-templates/confirmReminder.tsx";
import { renderEmail } from "../_shared/email-templates/render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Most accounts one run claims per step; 24 runs a day. Measured 2026-10-25: about 5 unconfirmed sign-ups a day. */
const CAP = 25;
/** Step 2 only: one reminder per account, about a day after sign-up (owner 2026-10-29). Step 1 is retired. */
const STEPS: ConfirmReminderStep[] = [2];

/** A database answer (SQLSTATE or PGRSTxxx): the call rolled back, nothing queued. */
function databaseRefused(code: string | undefined): boolean {
  return typeof code === "string" && (/^[0-9A-Z]{5}$/.test(code) || /^PGRST\d+$/.test(code));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = verifyCronSecret(req);
  if (denied) return denied;

  const defects: string[] = [];
  const counts = { claimed: 0, queued: 0, released: 0, skippedTest: 0 };

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
      { global: { fetch: boundedFetch() } },
    );

    const release = async (userId: string, step: ConfirmReminderStep) => {
      const { data: released, error: releaseErr } = await supabase
        .from("confirm_reminder_sends")
        .delete()
        .eq("user_id", userId)
        .eq("reminder_step", step)
        .select("user_id");
      if (releaseErr || (released?.length ?? 0) === 0) {
        defects.push(`claim NOT released for account ${userId} step ${step} (${releaseErr?.message ?? "zero rows matched"}); it will not get this reminder`);
      } else {
        counts.released++;
      }
    };

    for (const step of STEPS) {
      const { data: claimed, error: claimErr } = await supabase.rpc("claim_confirm_reminders", { p_step: step, p_limit: CAP });
      if (claimErr) {
        if (claimErr.code === "PGRST202") {
          defects.push("claim_confirm_reminders not found (PGRST202: schema-cache lag right after the migration, or a signature mismatch); nothing claimed or sent this run");
          break;
        }
        defects.push(`claim_confirm_reminders(step ${step}): ${claimErr.message}`);
        continue;
      }
      const accounts = (claimed ?? []) as { user_id: string; email: string; full_name: string | null }[];
      counts.claimed += accounts.length;
      const template = confirmReminderTemplateName(step);

      for (const a of accounts) {
        if (isTestAddress(a.email)) {
          counts.skippedTest++;
          continue;
        }
        let html: string;
        let text: string;
        try {
          const { data: link, error: linkErr } = await supabase.auth.admin.generateLink({ type: "magiclink", email: a.email });
          const hashed = (link as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token;
          if (linkErr || !hashed) {
            defects.push(`no link minted for account ${a.user_id} step ${step}: ${linkErr?.message ?? "no hashed_token"}`);
            await release(a.user_id, step);
            continue;
          }
          const confirmationUrl = confirmLinkUrl(getAppUrl(), hashed, "magiclink");
          ({ html, text } = await renderEmail(React.createElement(ConfirmReminderEmail, { step, confirmationUrl })));
        } catch (e) {
          defects.push(`link or render failed for account ${a.user_id} step ${step}: ${caughtMessage(e)}`);
          await release(a.user_id, step);
          continue;
        }
        const messageId = crypto.randomUUID();
        const { error: logErr } = await supabase.from("email_send_log").insert({
          message_id: messageId,
          template_name: template,
          recipient_email: a.email,
          status: "pending",
        });
        if (logErr) defects.push(`email_send_log insert failed for account ${a.user_id}: ${logErr.message}`);

        const { error: enqueueErr } = await supabase.rpc("enqueue_email", {
          queue_name: "transactional_emails",
          payload: {
            run_id: crypto.randomUUID(),
            message_id: messageId,
            to: a.email,
            from: FROM_DEFAULT,
            subject: CONFIRM_REMINDER_COPY[step].subject,
            html,
            text,
            purpose: "transactional",
            label: template,
            queued_at: new Date().toISOString(),
          },
        });
        if (!enqueueErr) {
          counts.queued++;
          const { data: stamped, error: stampErr } = await supabase
            .from("confirm_reminder_sends")
            .update({ queued_at: new Date().toISOString(), message_id: messageId })
            .eq("user_id", a.user_id)
            .eq("reminder_step", step)
            .select("user_id");
          if (stampErr || (stamped?.length ?? 0) === 0) {
            defects.push(`queued but not stamped for account ${a.user_id} step ${step} (${stampErr?.message ?? "zero rows"})`);
          }
          continue;
        }
        if (databaseRefused(enqueueErr.code)) {
          defects.push(`enqueue refused for account ${a.user_id} step ${step}: ${enqueueErr.message}`);
          await release(a.user_id, step);
        } else {
          defects.push(`enqueue outcome unknown for account ${a.user_id} step ${step}: ${enqueueErr.message}; claim kept`);
        }
      }
    }

    return cronResult("confirm-reminders", counts, { count: defects.length, reasons: defects }, corsHeaders);
  } catch (e) {
    return cronError("confirm-reminders", caughtMessage(e), corsHeaders);
  }
});
