// seed-policy: raises no alert of its own. Fixture, reserved and seed
// addresses are never claimed (claim_signup_lead_reminders excludes
// is_fixture_email, reserved domains and any address with a profile or auth
// user), isTestAddress re-checks here, and process-email-queue refuses test
// recipients again at send time. A defect answers 500 and
// sweep_cron_http_failures reports it.
//
// signup-lead-reminders: the ONE "Finish signing up" email (owner pop-up
// 2026-10-09, "Save it, follow up once").
//
// Each run, scheduled hourly 14:23-23:23 UTC by cron job signup-lead-reminders
// (migration 20261009223714):
//   1. sweep_signup_leads(): marks completed every lead whose address now has
//      an auth user, and deletes leads older than 30 days.
//   2. claim_signup_lead_reminders(CAP): stamps reminder_sent_at and returns
//      the due leads in ONE UPDATE, so a lead is claimed before its email is
//      queued and two overlapping runs can never both mail it.
//   3. For each claimed lead: render the email, log it to email_send_log, and
//      enqueue it (process-email-queue sends via Resend). If no signed
//      one-click unsubscribe can be built (the recipient has no account, so
//      the preferences page is no opt-out for them), or rendering fails,
//      or the database refuses the enqueue (an error with a code: rolled
//      back, nothing queued), the claim is released so the next run retries.
//      A network failure or timeout keeps the claim: it may have queued, and
//      one missed reminder beats a second one.
//
// The email is COMMERCIAL (it asks a non-member to join): it carries the
// recipient's signed one-click unsubscribe link and List-Unsubscribe headers;
// email-unsubscribe stamps signup_leads.unsubscribed_at.
import * as React from "npm:react@18.3.1";
import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "../_shared/buildStamp.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult } from "../_shared/cron-result.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import { FROM_DEFAULT } from "../_shared/resend.ts";
import { buildUnsubscribeUrl, unsubscribeHeaders } from "../_shared/unsubscribe.ts";
import { isTestAddress } from "../_shared/testRecipient.ts";
import { SignupLeadReminderEmail } from "../_shared/email-templates/drip.tsx";
import { renderEmail } from "../_shared/email-templates/render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Most reminders one run queues; ten runs a day, so at most 200 a day. Real
 * volume was 12 unfinished sign-ups in the launch day (2026-10-09), and the cap
 * bounds what a flood of captured addresses could do to the sending domain.
 */
const CAP = 20;
const SUBJECT = "Finish signing up for Louisiana Helpr";
const TEMPLATE = "signup_lead_reminder";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = verifyCronSecret(req);
  if (denied) return denied;

  const defects: string[] = [];
  const counts = { completed: 0, purged: 0, claimed: 0, queued: 0, released: 0, skippedTest: 0 };

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
      { global: { fetch: boundedFetch() } },
    );

    const { data: sweep, error: sweepErr } = await supabase.rpc("sweep_signup_leads");
    if (sweepErr) {
      // The claim re-checks auth.users itself, so a failed sweep cannot mail a
      // member; it is still dropped work (retention did not run).
      defects.push(`sweep_signup_leads: ${sweepErr.message}`);
    } else {
      counts.completed = Number((sweep as { completed?: number } | null)?.completed ?? 0);
      counts.purged = Number((sweep as { purged?: number } | null)?.purged ?? 0);
    }

    const { data: claimed, error: claimErr } = await supabase.rpc("claim_signup_lead_reminders", {
      p_limit: CAP,
    });
    if (claimErr) {
      defects.push(`claim_signup_lead_reminders: ${claimErr.message}`);
      return cronResult("signup-lead-reminders", counts, { count: defects.length, reasons: defects }, corsHeaders);
    }
    const leads = (claimed ?? []) as { id: string; email: string }[];
    counts.claimed = leads.length;

    /** Un-claim a lead whose email was never queued, so the next run retries it. */
    const release = async (id: string) => {
      const { data: released, error: releaseErr } = await supabase
        .from("signup_leads")
        .update({ reminder_sent_at: null })
        .eq("id", id)
        .not("reminder_sent_at", "is", null)
        .select("id");
      if (releaseErr || (released?.length ?? 0) === 0) {
        defects.push(
          `claim NOT released for lead ${id} (${releaseErr?.message ?? "zero rows matched"}); it will not be reminded`,
        );
      } else {
        counts.released++;
      }
    };

    const signupUrl = `${getAppUrl()}/signup`;
    for (const lead of leads) {
      if (isTestAddress(lead.email)) {
        // The claim already excludes these; this is the belt to its braces.
        // The stamp stays, so it is never picked up again.
        counts.skippedTest++;
        continue;
      }
      let html: string;
      let text: string;
      let headers: Record<string, string>;
      try {
        // A non-member cannot open the preferences page, so with no signing
        // secret there is no opt-out to offer: release and say so, never send.
        const unsubscribeUrl = await buildUnsubscribeUrl(lead.email);
        if (!unsubscribeUrl) {
          defects.push(`no one-click unsubscribe (EMAIL_UNSUBSCRIBE_SECRET / CRON_SECRET unset); lead ${lead.id} not mailed`);
          await release(lead.id);
          continue;
        }
        ({ html, text } = await renderEmail(
          React.createElement(SignupLeadReminderEmail, { signupUrl, unsubscribeUrl }),
        ));
        headers = await unsubscribeHeaders(lead.email);
      } catch (e) {
        defects.push(`render failed for lead ${lead.id}: ${caughtMessage(e)}`);
        await release(lead.id);
        continue;
      }
      const messageId = crypto.randomUUID();

      const { error: logErr } = await supabase.from("email_send_log").insert({
        message_id: messageId,
        template_name: TEMPLATE,
        recipient_email: lead.email,
        status: "pending",
      });
      if (logErr) defects.push(`email_send_log insert failed for lead ${lead.id}: ${logErr.message}`);

      const { error: enqueueErr } = await supabase.rpc("enqueue_email", {
        queue_name: "transactional_emails",
        payload: {
          run_id: crypto.randomUUID(),
          message_id: messageId,
          to: lead.email,
          from: FROM_DEFAULT,
          subject: SUBJECT,
          html,
          text,
          purpose: "commercial",
          headers,
          label: TEMPLATE,
          queued_at: new Date().toISOString(),
        },
      });
      if (!enqueueErr) {
        counts.queued++;
        continue;
      }

      defects.push(`enqueue_email failed for lead ${lead.id}: ${enqueueErr.message}`);
      // Release ONLY when the database answered with an error (it has a code):
      // then the call rolled back, nothing was queued, and the next run can
      // retry without a second email. A network failure or timeout has no
      // code and may have queued the email anyway, so the claim stays: one
      // missed reminder beats a second one.
      if (enqueueErr.code) await release(lead.id);
      const { error: stampErr } = await supabase
        .from("email_send_log")
        .update({ status: "failed", error_message: `enqueue_email: ${enqueueErr.message}`.slice(0, 1000) })
        .eq("message_id", messageId)
        .select("message_id");
      if (stampErr) defects.push(`email_send_log failure stamp did not write for ${messageId}: ${stampErr.message}`);
    }

    return cronResult("signup-lead-reminders", counts, { count: defects.length, reasons: defects }, corsHeaders);
  } catch (e) {
    return cronError("signup-lead-reminders", caughtMessage(e), corsHeaders);
  }
});
