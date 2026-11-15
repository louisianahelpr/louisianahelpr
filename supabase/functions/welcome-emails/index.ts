// seed-policy: raises no alert of its own. is_seed members, test accounts,
// fixture and reserved addresses are never claimed (claim_welcome_emails
// excludes them), isTestAddress re-checks here, and process-email-queue
// refuses test recipients again at send time. The listings shown are real
// ones only: seed jobs are left out (get_ranked_open_jobs p_include_seed
// false), so are jobs posted by enrolled test accounts, seed items and items
// of enrolled test accounts, never the member's own, and never one from
// someone in a block with the member, either direction (fails closed). A defect
// answers 500 and sweep_cron_http_failures reports it.
//
// welcome-emails (owner 11-14, "Yes do that"): two emails to a new member,
// day 1 (a day after sign-up) and day 3, each with up to three open jobs and
// three things for sale near them, in English or Spanish (profiles.language).
// They replace the old drip's day 1 and day 3 steps in engagement-automations,
// whose day 7 tips email stays.
//
// Each run, scheduled at 15:17 and 21:17 UTC by cron job welcome-emails
// (migration 20261114234041):
//   1. Read the newest live Declutter items once (real ones only).
//   2. claim_welcome_emails(step, CAP) for step 1, then step 3: picks the due
//      members and writes their welcome_email_sends row in ONE statement,
//      returning only the rows it wrote, so a member is claimed before the
//      email is queued and two overlapping runs can never both mail them. WHO
//      is due (consent Q2299, exclusions, the day windows, one commercial
//      email a day) is all in that SQL.
//   3. For each claimed member: read the three open jobs nearest them, pick the
//      three nearest items, render the email, log it to email_send_log,
//      enqueue it, then stamp the claim's queued_at and message_id and the
//      member's profiles.last_drip_at (so the come-back emails and the day 7
//      drip email wait 20 hours). If the jobs read fails, no one-click
//      unsubscribe can be built, rendering fails, or the database refuses the
//      enqueue (a SQLSTATE or PGRST code: rolled back, nothing queued), the
//      claim is released (its row deleted) so a later run retries. A network
//      failure or timeout on the enqueue keeps the claim: it may have queued,
//      and one missed email beats a second one.
//   4. Any claim older than 2 hours (and younger than 26) that still has no
//      queued_at is a defect: the run was killed between claim and enqueue, or
//      the enqueue's outcome is unknown.
//
// PGRST202 on the claim (the function not found: schema-cache lag right after
// the migration, or a signature mismatch) stops the run before any claim, so
// nothing is lost, and is a DEFECT (500), as in come-back-emails.
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
import {
  WELCOME_COPY,
  type WelcomeLang,
  type WelcomeStep,
  welcomeLang,
  welcomePriceLabel,
  welcomeTemplateName,
} from "../_shared/welcomeEmail.ts";
import { type WelcomeListing, WelcomeEmail } from "../_shared/email-templates/welcome.tsx";
import { renderEmail } from "../_shared/email-templates/render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Most members one run claims per step; two runs a day. Measured 2026-11-14: 37 real members joined in 14 days
 * (under 3 a day), so the cap is headroom, and it bounds what a bad rule could do to the sending domain in one run.
 */
const CAP = 25;
const STEPS: WelcomeStep[] = [1, 3];
/** Shown per list. */
const SHOWN = 3;
/**
 * Jobs read per member. More than SHOWN because the member's own jobs, test accounts' jobs, jobs across a block and
 * jobs whose title came back guest-masked (Q2808) are dropped after the read (the service role has no session, so get_ranked_open_jobs cannot drop them itself).
 */
const JOBS_READ = 12;
/** The newest live items read once per run; the nearest SHOWN of them go in each email. */
const ITEMS_READ = 60;
const HOUR = 60 * 60 * 1000;
/** welcome_email_sends.message_id on a claim deliberately not mailed (a test address the claim let through). */
const SKIPPED_TEST = "not-sent:test-address";

/** get_ranked_open_jobs' distance_band, in the email's language. */
const BAND_ES: Record<string, string> = {
  "Under 5 mi": "A menos de 5 mi",
  "5-15 mi": "A 5-15 mi",
  "15-30 mi": "A 15-30 mi",
  "30+ mi": "A más de 30 mi",
};

/** Straight-line miles (Declutter's own formula, src/lib/declutter/distance.ts milesBetween). */
function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True only for an error the DATABASE answered with (a SQLSTATE or PGRSTxxx): rolled back, nothing queued. */
function databaseRefused(code: string | undefined): boolean {
  return typeof code === "string" && (/^[0-9A-Z]{5}$/.test(code) || /^PGRST\d+$/.test(code));
}

type Item = { id: string; seller_id: string; title: string; current_price_cents: number; area_label: string | null; area_lat: number | null; area_lng: number | null };
type Job = { id: string; title: string | null; location: string | null; parish: string | null; distance_band: string | null };
type Member = { user_id: string; email: string; full_name: string | null; language: string | null; latitude: number | null; longitude: number | null };

/** The nearest SHOWN items not the member's own; with no saved position, the newest. */
function itemsNear(items: Item[], m: Member, lang: WelcomeLang, appUrl: string): WelcomeListing[] {
  const at = m.latitude != null && m.longitude != null ? { lat: Number(m.latitude), lng: Number(m.longitude) } : null;
  const mine = items.filter((i) => i.seller_id !== m.user_id);
  const ordered = at
    ? mine
        .map((i) => ({ i, d: i.area_lat != null && i.area_lng != null ? milesBetween(at, { lat: Number(i.area_lat), lng: Number(i.area_lng) }) : Infinity }))
        .sort((a, b) => a.d - b.d)
        .map((x) => x.i)
    : mine;
  return ordered.slice(0, SHOWN).map((i) => ({
    title: i.title,
    detail: [welcomePriceLabel(i.current_price_cents, lang), i.area_label].filter(Boolean).join(" · "),
    url: `${appUrl}/declutter/item/${encodeURIComponent(i.id)}`,
  }));
}

/**
 * The placeholders public.mask_guest_contact (20261114234033) writes over a phone number, an email address or a
 * street address. The service role has no session, so get_ranked_open_jobs hands this sender the GUEST copy of a
 * title. Q2808, decided by recommendation (owner rule go-with-recommendations, 2026-11-15): keep reading the masked
 * copy (no contact details are ever written into an email) and leave out a job whose title came back masked, so the
 * email never prints "[phone hidden]". The title is the only free text of a job this email prints. Kept in step with
 * the SQL by src/test/edge/welcome-emails.test.ts.
 */
const GUEST_MASK_PLACEHOLDERS = ["[email hidden]", "[phone hidden]", "[address hidden]"] as const;
const maskedForGuest = (t: string) => GUEST_MASK_PLACEHOLDERS.some((p) => t.includes(p));

function jobRows(jobs: Job[], lang: WelcomeLang, appUrl: string): WelcomeListing[] {
  return jobs.filter((j) => j.id && j.title && !maskedForGuest(j.title)).slice(0, SHOWN).map((j) => {
    const band = j.distance_band ? (lang === "es" ? BAND_ES[j.distance_band] ?? j.distance_band : j.distance_band) : null;
    return {
      title: j.title as string,
      detail: [j.location ?? j.parish, band].filter(Boolean).join(" · "),
      url: `${appUrl}/jobs/${encodeURIComponent(j.id)}`,
    };
  });
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
    const appUrl = getAppUrl();

    /** Un-claim a member whose email was never queued, so a later run retries. */
    const release = async (userId: string, step: WelcomeStep) => {
      const { data: released, error: releaseErr } = await supabase
        .from("welcome_email_sends")
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

    // 1. The items, read once, before anyone is claimed: a failed read claims nobody.
    const { data: itemRows, error: itemsErr } = await supabase
      .from("declutter_items")
      .select("id, seller_id, title, current_price_cents, area_label, area_lat, area_lng")
      .eq("status", "live")
      .eq("is_seed", false)
      .eq("seller_hidden", false)
      .order("live_at", { ascending: false })
      .limit(ITEMS_READ);
    if (itemsErr) {
      defects.push(`items read failed (${itemsErr.message}); nobody claimed or mailed this run`);
      return cronResult("welcome-emails", counts, { count: defects.length, reasons: defects }, corsHeaders);
    }
    let items = (itemRows ?? []) as Item[];
    const sellerIds = [...new Set(items.map((i) => i.seller_id))];
    if (sellerIds.length > 0) {
      const { data: testers, error: testersErr } = await supabase.from("test_accounts").select("user_id").in("user_id", sellerIds);
      if (testersErr) {
        defects.push(`test-account read failed (${testersErr.message}); nobody claimed or mailed this run`);
        return cronResult("welcome-emails", counts, { count: defects.length, reasons: defects }, corsHeaders);
      }
      const test = new Set(((testers ?? []) as { user_id: string }[]).map((t) => t.user_id));
      items = items.filter((i) => !test.has(i.seller_id));
    }

    for (const step of STEPS) {
      const { data: claimed, error: claimErr } = await supabase.rpc("claim_welcome_emails", { p_step: step, p_limit: CAP });
      if (claimErr) {
        if (claimErr.code === "PGRST202") {
          defects.push(
            `claim_welcome_emails not found (PGRST202: schema-cache lag right after the migration, or a signature mismatch); nothing claimed or sent this run`,
          );
          break;
        }
        defects.push(`claim_welcome_emails(step ${step}): ${claimErr.message}`);
        continue;
      }
      const members = (claimed ?? []) as Member[];
      counts.claimed += members.length;
      const template = welcomeTemplateName(step);

      for (const m of members) {
        if (isTestAddress(m.email)) {
          // The claim already excludes these. The row stays, so they are never picked up again, and is marked so the
          // unqueued-claim check below does not report a skip it chose as a lost email.
          counts.skippedTest++;
          const { error: markErr } = await supabase
            .from("welcome_email_sends")
            .update({ message_id: SKIPPED_TEST })
            .eq("user_id", m.user_id)
            .eq("email_step", step);
          if (markErr) defects.push(`test-address skip not marked for member ${m.user_id} step ${step}: ${markErr.message}`);
          continue;
        }
        const lang = welcomeLang(m.language);
        // Blocks, either direction: never a job or an item from someone the member blocked or who blocked them. The
        // service role reads user_blocks for this member only. FAIL CLOSED: if the read fails, nothing is mailed and
        // the claim is released for a retry (a list that might show a blocked person is never sent).
        const { data: blockRows, error: blocksErr } = await supabase
          .from("user_blocks")
          .select("blocker_id, blocked_id")
          .or(`blocker_id.eq.${m.user_id},blocked_id.eq.${m.user_id}`);
        if (blocksErr) {
          defects.push(`blocks read failed for member ${m.user_id} step ${step}: ${blocksErr.message}`);
          await release(m.user_id, step);
          continue;
        }
        const blockedWith = new Set<string>();
        for (const b of (blockRows ?? []) as { blocker_id: string; blocked_id: string }[]) {
          if (b.blocker_id === m.user_id) blockedWith.add(b.blocked_id);
          else if (b.blocked_id === m.user_id) blockedWith.add(b.blocker_id);
        }
        const { data: jobData, error: jobsErr } = await supabase.rpc("get_ranked_open_jobs", {
          p_limit: JOBS_READ,
          p_offset: 0,
          p_include_seed: false,
          ...(m.latitude != null && m.longitude != null ? { p_lat: m.latitude, p_lng: m.longitude } : {}),
        });
        if (jobsErr) {
          defects.push(`jobs read failed for member ${m.user_id} step ${step}: ${jobsErr.message}`);
          await release(m.user_id, step);
          continue;
        }
        // get_ranked_open_jobs leaves out is_seed jobs; under the service role it cannot know the member, and it does
        // not return the poster. Drop the member's own jobs, jobs posted by an enrolled test account, and jobs across a block.
        let jobs = (jobData ?? []) as Job[];
        const jobIds = jobs.map((j) => j.id).filter(Boolean);
        if (jobIds.length > 0) {
          const { data: posters, error: postersErr } = await supabase.from("jobs").select("id, customer_id").in("id", jobIds);
          const posterRows = (posters ?? []) as { id: string; customer_id: string | null }[];
          const posterIds = [...new Set(posterRows.map((p) => p.customer_id).filter((x): x is string => !!x))];
          const { data: testPosters, error: testPostersErr } = posterIds.length > 0
            ? await supabase.from("test_accounts").select("user_id").in("user_id", posterIds)
            : { data: [], error: null };
          if (postersErr || testPostersErr) {
            defects.push(`job poster read failed for member ${m.user_id} step ${step}: ${(postersErr ?? testPostersErr)?.message}`);
            await release(m.user_id, step);
            continue;
          }
          const testSet = new Set(((testPosters ?? []) as { user_id: string }[]).map((t) => t.user_id));
          const posterOf = new Map(posterRows.map((p) => [p.id, p.customer_id]));
          jobs = jobs.filter((j) => {
            const poster = posterOf.get(j.id);
            return !!poster && poster !== m.user_id && !testSet.has(poster) && !blockedWith.has(poster);
          });
        }
        let html: string;
        let text: string;
        let headers: Record<string, string>;
        try {
          const unsubscribeUrl = await buildUnsubscribeUrl(m.email);
          if (!unsubscribeUrl) {
            defects.push(`no one-click unsubscribe (EMAIL_UNSUBSCRIBE_SECRET / CRON_SECRET unset); member ${m.user_id} not mailed`);
            await release(m.user_id, step);
            continue;
          }
          ({ html, text } = await renderEmail(
            React.createElement(WelcomeEmail, {
              step,
              lang,
              fullName: m.full_name,
              jobs: jobRows(jobs, lang, appUrl),
              items: itemsNear(items.filter((i) => !blockedWith.has(i.seller_id)), m, lang, appUrl),
              appUrl: `${appUrl}/home`,
              unsubscribeUrl,
            }),
          ));
          headers = await unsubscribeHeaders(m.email);
        } catch (e) {
          // Not silent: recorded as a defect (the run answers 500) and the claim is released for a retry.
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
            subject: WELCOME_COPY[lang][step].subject,
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
          const now = new Date().toISOString();
          const { data: stamped, error: stampQueuedErr } = await supabase
            .from("welcome_email_sends")
            .update({ queued_at: now, message_id: messageId })
            .eq("user_id", m.user_id)
            .eq("email_step", step)
            .select("user_id");
          if (stampQueuedErr || (stamped?.length ?? 0) === 0) {
            defects.push(
              `queued_at NOT stamped for member ${m.user_id} step ${step} (${stampQueuedErr?.message ?? "zero rows matched"}); the email was queued`,
            );
          }
          // One commercial email a day: the come-back claim and the day 7 drip read this stamp.
          const { data: dripped, error: dripErr } = await supabase
            .from("profiles")
            .update({ last_drip_at: now })
            .eq("user_id", m.user_id)
            .select("user_id");
          if (dripErr || (dripped?.length ?? 0) === 0) {
            defects.push(
              `last_drip_at NOT stamped for member ${m.user_id} step ${step} (${dripErr?.message ?? "zero rows matched"}); another commercial email could follow within 20 hours`,
            );
          }
          continue;
        }

        defects.push(`enqueue_email failed for member ${m.user_id} step ${step}: ${enqueueErr.message}`);
        const refused = databaseRefused(enqueueErr.code);
        // Release ONLY when the database refused (rolled back, nothing queued).
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

    // 4. Claims that never got their queued_at stamp, 2-26 hours old (each reported on about two runs).
    const nowMs = Date.now();
    const { data: unqueued, error: unqueuedErr } = await supabase
      .from("welcome_email_sends")
      .select("user_id, email_step, claimed_at")
      .is("queued_at", null)
      .is("message_id", null)
      .lt("claimed_at", new Date(nowMs - 2 * HOUR).toISOString())
      .gt("claimed_at", new Date(nowMs - 26 * HOUR).toISOString())
      .limit(50);
    if (unqueuedErr) {
      defects.push(`unqueued-claim check failed: ${unqueuedErr.message}`);
    } else {
      const rows = (unqueued ?? []) as { user_id: string; email_step: number }[];
      counts.unqueuedClaims = rows.length;
      for (const r of rows) {
        defects.push(
          `claim for member ${r.user_id} step ${r.email_step} has no queued_at after 2 hours: its email may not have gone, or it went and its queued_at stamp failed (check email_send_log)`,
        );
      }
    }

    return cronResult("welcome-emails", counts, { count: defects.length, reasons: defects }, corsHeaders);
  } catch (e) {
    // Not silent: cronError answers 500 with the message, and sweep_cron_http_failures reports it.
    return cronError("welcome-emails", caughtMessage(e), corsHeaders);
  }
});
