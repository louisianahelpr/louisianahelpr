// seed-policy: raises no alert of its own. is_seed members, test accounts,
// fixture and reserved addresses are never claimed
// (claim_come_back_emails excludes them), isTestAddress re-checks here, and
// process-email-queue refuses test recipients again at send time. A defect
// answers 500 and sweep_cron_http_failures reports it.
//
// come-back-emails: a note from the founder to a member who signed up and
// never came back (owner said yes, 2026-10-21). Step 1 about day 3, step 2
// about day 10, never more than two per member.
//
// Each run, scheduled at 15:41 and 21:41 UTC by cron job come-back-emails
// (migration 20261021113827):
//   1. claim_come_back_emails(step, CAP) for step 1, then step 2: picks the
//      due members and writes their come_back_email_sends row in ONE
//      statement, returning only the rows it wrote, so a member is claimed
//      before the email is queued and two overlapping runs can never both
//      mail them. WHO is due (consent, exclusions, "never came back", the
//      hidden switch come_back_emails decided per member) is all in that SQL;
//      with the switch off it returns nobody.
//   2. For each claimed member: render the email, log it to email_send_log,
//      enqueue it (process-email-queue sends via Resend), then stamp the
//      claim's queued_at and message_id. Step 2 needs step 1's queued_at, so
//      a step 1 that never went out never gets a "last note". If no signed
//      one-click unsubscribe can be built, or rendering fails, or the
//      database refuses the enqueue (an error with a SQLSTATE or PGRST code:
//      rolled back, nothing queued), the claim is released (its row deleted)
//      so a later run retries. A network failure or timeout keeps the claim:
//      it may have queued, and one missed note beats a second one.
//   3. Any claim older than 2 hours (and younger than 26, so each is reported
//      about twice, not forever) that still has no queued_at is a defect: the
//      run was killed between claim and enqueue, or the enqueue's outcome is
//      unknown. Nothing else would ever show it.
//
// PGRST202 on the claim (the function not found: a schema-cache lag right
// after the migration, or a signature mismatch) stops the run before any
// claim, so nothing is lost, and is a DEFECT (500): a mismatch would
// otherwise stop every email for good behind a green run (lh-silent-failure
// review, 2026-10-21).
//
// The email is COMMERCIAL: it carries the member's signed one-click
// unsubscribe and List-Unsubscribe headers. email-unsubscribe turns
// marketing_consent and email_promotions off, and the claim reads both.
import * as React from "npm:react@18.3.1";
import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "../_shared/buildStamp.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult } from "../_shared/cron-result.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import { FROM_DEFAULT, SUPPORT_EMAIL } from "../_shared/resend.ts";
import { buildUnsubscribeUrl, unsubscribeHeaders } from "../_shared/unsubscribe.ts";
import { isTestAddress } from "../_shared/testRecipient.ts";
import { COME_BACK_COPY, type ComeBackStep, comeBackTemplateName } from "../_shared/comeBackEmail.ts";
import { ComeBackEmail } from "../_shared/email-templates/comeBack.tsx";
import { renderEmail } from "../_shared/email-templates/render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Most members one run claims per step; two runs a day. Measured 2026-10-21:
 * 7 real members signed up 3-10 days ago and never came back (before consent),
 * so the cap is headroom, and it bounds what a bad rule could do to the
 * sending domain in one run.
 */
const CAP = 25;
const STEPS: ComeBackStep[] = [1, 2];
const HOUR = 60 * 60 * 1000;

/**
 * True only for an error the DATABASE answered with: a 5-character SQLSTATE
 * or a PostgREST PGRSTxxx code. Then the call rolled back and nothing was
 * queued. A network failure or abort has an empty code (postgrest-js), and a
 * gateway body could carry any other code, so neither releases a claim.
 */
function databaseRefused(code: string | undefined): boolean {
  return typeof code === "string" && (/^[0-9A-Z]{5}$/.test(code) || /^PGRST\d+$/.test(code));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = verifyCronSecret(req);
  if (denied) return denied;

  const defects: string[] = [];
  const counts = { claimed: 0, queued: 0, released: 0, skippedTest: 0, unqueuedClaims: 0 };

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
      { global: { fetch: boundedFetch() } },
    );

    /** Un-claim a member whose email was never queued, so a later run retries. */
    const release = async (userId: string, step: ComeBackStep) => {
      const { data: released, error: releaseErr } = await supabase
        .from("come_back_email_sends")
        .delete()
        .eq("user_id", userId)
        .eq("email_step", step)
        .select("user_id");
      if (releaseErr || (released?.length ?? 0) === 0) {
        defects.push(
          `claim NOT released for member ${userId} step ${step} (${releaseErr?.message ?? "zero rows matched"}); they will not get this email`,
        );
      } else {
        counts.released++;
      }
    };

    const appUrl = `${getAppUrl()}/home`;
    for (const step of STEPS) {
      const { data: claimed, error: claimErr } = await supabase.rpc("claim_come_back_emails", {
        p_step: step,
        p_limit: CAP,
      });
      if (claimErr) {
        if (claimErr.code === "PGRST202") {
          // Nothing was claimed, so nothing is lost: stop before the next step
          // and say so loudly. A schema-cache lag clears by the next run; a
          // signature mismatch does not, and must not hide behind a 200.
          defects.push(
            `claim_come_back_emails not found (PGRST202: schema-cache lag right after the migration, or a signature mismatch); nothing claimed or sent this run`,
          );
          break;
        }
        defects.push(`claim_come_back_emails(step ${step}): ${claimErr.message}`);
        continue;
      }
      const members = (claimed ?? []) as { user_id: string; email: string; full_name: string | null }[];
      counts.claimed += members.length;
      const template = comeBackTemplateName(step);

      for (const m of members) {
        if (isTestAddress(m.email)) {
          // The claim already excludes these; this is the belt to its braces.
          // The row stays, so they are never picked up again (and the
          // unqueued-claim check below reports it, since it should not happen).
          counts.skippedTest++;
          continue;
        }
        let html: string;
        let text: string;
        let headers: Record<string, string>;
        try {
          // Commercial mail goes out only with a working one-click opt-out.
          const unsubscribeUrl = await buildUnsubscribeUrl(m.email);
          if (!unsubscribeUrl) {
            defects.push(`no one-click unsubscribe (EMAIL_UNSUBSCRIBE_SECRET / CRON_SECRET unset); member ${m.user_id} not mailed`);
            await release(m.user_id, step);
            continue;
          }
          ({ html, text } = await renderEmail(
            React.createElement(ComeBackEmail, { step, fullName: m.full_name, appUrl, unsubscribeUrl }),
          ));
          headers = await unsubscribeHeaders(m.email);
        } catch (e) {
          defects.push(`render failed for member ${m.user_id} step ${step}: ${caughtMessage(e)}`);
          await release(m.user_id, step);
          continue;
        }
        const messageId = crypto.randomUUID();

        const { error: logErr } = await supabase.from("email_send_log").insert({
          message_id: messageId,
          template_name: template,
          recipient_email: m.email,
          status: "pending",
        });
        if (logErr) defects.push(`email_send_log insert failed for member ${m.user_id}: ${logErr.message}`);

        const { error: enqueueErr } = await supabase.rpc("enqueue_email", {
          queue_name: "transactional_emails",
          payload: {
            run_id: crypto.randomUUID(),
            message_id: messageId,
            to: m.email,
            from: FROM_DEFAULT,
            // "Just reply" in the copy: a reply reaches the support inbox.
            reply_to: SUPPORT_EMAIL,
            subject: COME_BACK_COPY[step].subject,
            html,
            text,
            purpose: "commercial",
            headers,
            label: template,
            queued_at: new Date().toISOString(),
          },
        });
        if (!enqueueErr) {
          counts.queued++;
          // The claim now records that the email went. Step 2 waits on this
          // stamp, so a failed stamp costs at most the second note, never a
          // repeat; it is still a defect.
          const { data: stamped, error: stampQueuedErr } = await supabase
            .from("come_back_email_sends")
            .update({ queued_at: new Date().toISOString(), message_id: messageId })
            .eq("user_id", m.user_id)
            .eq("email_step", step)
            .select("user_id");
          if (stampQueuedErr || (stamped?.length ?? 0) === 0) {
            defects.push(
              `queued_at NOT stamped for member ${m.user_id} step ${step} (${stampQueuedErr?.message ?? "zero rows matched"}); the email was queued`,
            );
          }
          continue;
        }

        defects.push(`enqueue_email failed for member ${m.user_id} step ${step}: ${enqueueErr.message}`);
        const refused = databaseRefused(enqueueErr.code);
        // Release ONLY when the database refused (rolled back, nothing
        // queued): a later run can retry without a second email. A network
        // failure or timeout may have queued it anyway, so the claim stays.
        if (refused) await release(m.user_id, step);
        const { data: failStamped, error: stampErr } = await supabase
          .from("email_send_log")
          .update(
            refused
              ? { status: "failed", error_message: `enqueue_email: ${enqueueErr.message}`.slice(0, 1000) }
              : { error_message: `enqueue_email outcome unknown (no database answer; may have queued): ${enqueueErr.message}`.slice(0, 1000) },
          )
          .eq("message_id", messageId)
          .select("message_id");
        if (stampErr) defects.push(`email_send_log failure stamp did not write for ${messageId}: ${stampErr.message}`);
        else if (!logErr && (failStamped?.length ?? 0) === 0) {
          defects.push(`email_send_log failure stamp matched no row for ${messageId}`);
        }
      }
    }

    // Claims that never got their queued_at stamp: killed between claim and
    // enqueue, or an enqueue whose outcome is unknown. Bounded to 2-26 hours
    // old so each is reported on about two runs, not forever.
    const now = Date.now();
    const { data: unqueued, error: unqueuedErr } = await supabase
      .from("come_back_email_sends")
      .select("user_id, email_step, claimed_at")
      .is("queued_at", null)
      .lt("claimed_at", new Date(now - 2 * HOUR).toISOString())
      .gt("claimed_at", new Date(now - 26 * HOUR).toISOString())
      .limit(50);
    if (unqueuedErr) {
      defects.push(`unqueued-claim check failed: ${unqueuedErr.message}`);
    } else {
      const rows = (unqueued ?? []) as { user_id: string; email_step: number }[];
      counts.unqueuedClaims = rows.length;
      for (const r of rows) {
        defects.push(
          `claim for member ${r.user_id} step ${r.email_step} has no queued_at after 2 hours: its email may not have gone, or it went and its queued_at stamp failed (check email_send_log); step 2 will not follow`,
        );
      }
    }

    return cronResult("come-back-emails", counts, { count: defects.length, reasons: defects }, corsHeaders);
  } catch (e) {
    return cronError("come-back-emails", caughtMessage(e), corsHeaders);
  }
});
