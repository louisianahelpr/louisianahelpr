// seed-policy: raises no alert of its own. is_seed subscriptions are never read on a normal run (the select filters
// is_seed = false); test mode (body {only_email}) reads exactly one address and ONLY if its row is is_seed (so a test
// run can never mail a real subscriber), and is callable only with the cron secret. isTestAddress re-checks each address here, and process-email-queue refuses test recipients again
// at send time. A defect answers 500 and sweep_cron_http_failures reports it.
//
// gift-price-alerts: saved-gift price alerts (owner approved in a pop-up, 2026-11-21: "Saved-list price alerts —
// opt-in email when a saved gift drops in price, plus a reminder before Dec 15"). Layers: _shared/giftPriceAlerts.ts.
//
// Each run, scheduled at 15:29 and 21:29 UTC by cron job gift-price-alerts (migration *_gift_price_alerts.sql):
//   1. Read today's prices from the live site's /gift-guides/price-feed.json (written by the build from the guide
//      picks the daily price train updates), so the prices compared are the ones the deployed guides show. No feed,
//      or an empty one, stops the run before any email (500).
//   2. Read the opted-in addresses (unsubscribed_at null, not is_seed), skipping hard-suppressed addresses
//      (suppressed_emails: bounces and complaints).
//   3. For each: findDrops (a saved gift down at least $5 or 10% from the guide's own price when the sender first saw
//      it, or from the price the last drop email named, at a price that has held for 20 hours; a drop over 70% is a
//      likely broken price: reported, never mailed) and reminderDue (Dec 10..14 in Louisiana, once a season). Nothing to send: at most store
//      a first-seen price. Something to send: CLAIM first (update items/stamps only if the row is unchanged since it
//      was read, .select('id'): zero rows means another run or a new sign-up changed it, so it is skipped), then
//      render, log and enqueue ONE email (the reminder, which also marks drops, wins over a drop digest). If the
//      unsubscribe link cannot be built, rendering fails, or the database refuses the enqueue, the claim is put back
//      so a later run retries; a network failure keeps the claim (it may have queued, and one missed email beats two).
//      The claim stamps send_claimed_at; a queued email clears it, and a claim left for 2 hours (a run killed between
//      claim and enqueue) is reported on each run for a day, as come-back-emails does.
//   Emails name only gifts in today's feed, by the feed's own name and link: nothing a caller typed is ever mailed.
//
// COMMERCIAL: every email carries the address's signed one-click unsubscribe for list 'gift_price_alerts'
// (email-unsubscribe stamps unsubscribed_at, and step 2 reads it) and the postal address (MarketingFooter).
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
  PRICE_ALERT_COPY as C,
  PRICE_DROP_TEMPLATE,
  REMINDER_TEMPLATE,
  findDrops,
  parseFeed,
  parseItems,
  reminderDue,
} from "../_shared/giftPriceAlerts.ts";
import { type EmailItem, GiftPriceDropEmail, GiftReminderEmail } from "../_shared/email-templates/giftPriceAlert.tsx";
import { renderEmail } from "../_shared/email-templates/render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Most addresses one run reads. Headroom for the season; it bounds what a bad rule could send in one run. */
const CAP = 2000;
/** Stop starting new emails after this long (pg_net waits 120 s); the rest are picked up by the next run. */
const TIME_BUDGET_MS = 90_000;
const HOUR = 60 * 60 * 1000;

/** True only for an error the DATABASE answered with (rolled back, nothing queued); see come-back-emails. */
function databaseRefused(code: string | undefined): boolean {
  return typeof code === "string" && (/^[0-9A-Z]{5}$/.test(code) || /^PGRST\d+$/.test(code));
}

interface Row {
  id: string;
  email: string;
  items: unknown;
  reminder_sent_at: string | null;
  last_alert_at: string | null;
  updated_at: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = verifyCronSecret(req);
  if (denied) return denied;

  const defects: string[] = [];
  const counts = { subscriptions: 0, drops: 0, reminders: 0, queued: 0, pricesNoted: 0, skipped: 0, restored: 0, suspect: 0, deferred: 0, unqueuedClaims: 0 };
  const started = Date.now();

  // Test mode (cron secret only): one address, and only if its row is is_seed (the prod check with a seed row).
  let onlyEmail: string | null = null;
  try {
    const body = (await req.json()) as { only_email?: unknown } | null;
    if (typeof body?.only_email === "string" && body.only_email.includes("@")) onlyEmail = body.only_email.trim().toLowerCase();
  } catch {
    // No body (the cron posts {}): a normal run.
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
      { global: { fetch: boundedFetch() } },
    );
    const appUrl = getAppUrl();

    // 1. Today's prices.
    let feedRaw: unknown;
    try {
      const res = await fetch(`${appUrl}/gift-guides/price-feed.json`, { signal: AbortSignal.timeout(15000), headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      feedRaw = await res.json();
    } catch (e) {
      // Not silent: a defect, so the run answers 500 and sweep_cron_http_failures reports it.
      defects.push(`price feed unreadable (${caughtMessage(e)}); nothing compared or sent this run`);
      return cronResult("gift-price-alerts", counts, { count: defects.length, reasons: defects }, corsHeaders);
    }
    const feed = parseFeed(feedRaw);
    if (!feed || Object.keys(feed.items).length === 0) {
      defects.push("price feed has no priced items; nothing compared or sent this run");
      return cronResult("gift-price-alerts", counts, { count: defects.length, reasons: defects }, corsHeaders);
    }

    // 2. The opted-in addresses.
    let q = supabase
      .from("gift_price_alerts")
      .select("id, email, items, reminder_sent_at, last_alert_at, updated_at")
      .is("unsubscribed_at", null)
      .order("created_at")
      .limit(CAP);
    q = onlyEmail ? q.eq("email", onlyEmail).eq("is_seed", true) : q.eq("is_seed", false);
    const { data: rowsRaw, error: rowsErr } = await q;
    if (rowsErr) {
      // PGRST205 (table not found) included: the function deployed before its migration is a defect, not a quiet run.
      defects.push(`gift_price_alerts read failed (${rowsErr.code ?? ""} ${rowsErr.message}); nothing sent this run`);
      return cronResult("gift-price-alerts", counts, { count: defects.length, reasons: defects }, corsHeaders);
    }
    const rows = (rowsRaw ?? []) as Row[];
    counts.subscriptions = rows.length;
    if (rows.length >= CAP) defects.push(`read the cap of ${CAP} subscriptions; the rest wait for a later run (raise CAP)`);

    // Hard-suppressed addresses (bounces, complaints), asked 100 at a time (each answer is at most 100 rows, so no
    // page limit can cut it short). Fail closed: an unreadable list sends nothing.
    const suppressed = new Set<string>();
    for (let i = 0; i < rows.length; i += 100) {
      const { data: sup, error: supErr } = await supabase
        .from("suppressed_emails")
        .select("email")
        .in("email", rows.slice(i, i + 100).map((r) => r.email));
      if (supErr) {
        defects.push(`suppressed_emails read failed (${supErr.message}); nothing sent this run`);
        return cronResult("gift-price-alerts", counts, { count: defects.length, reasons: defects }, corsHeaders);
      }
      for (const s of (sup ?? []) as { email: string }[]) suppressed.add(s.email.toLowerCase());
    }

    const now = new Date();
    const suspectLinks = new Set<string>();
    for (const row of rows) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        counts.deferred++;
        continue;
      }
      // Test mode reads only seed rows, and process-email-queue suppresses those addresses itself.
      if ((!onlyEmail && isTestAddress(row.email)) || suppressed.has(row.email)) {
        counts.skipped++;
        continue;
      }
      const items = parseItems(row.items);
      const { drops, suspect, items: nextItems, changed } = findDrops(items, feed, now);
      for (const d of suspect) suspectLinks.add(`${d.href} (${d.was} -> ${d.now})`);
      const reminder = reminderDue(now, row.reminder_sent_at);
      const sending = drops.length > 0 || reminder;
      if (!changed && !reminder) continue;

      const stamp = now.toISOString();
      const claim: Record<string, unknown> = { items: nextItems, updated_at: stamp };
      if (drops.length > 0) claim.last_alert_at = stamp;
      if (reminder) claim.reminder_sent_at = stamp;
      if (sending) claim.send_claimed_at = stamp;
      const { data: claimed, error: claimErr } = await supabase
        .from("gift_price_alerts")
        .update(claim)
        .eq("id", row.id)
        .eq("updated_at", row.updated_at)
        .select("id");
      if (claimErr) {
        defects.push(`claim failed for subscription ${row.id}: ${claimErr.message}`);
        continue;
      }
      if ((claimed?.length ?? 0) === 0) continue; // changed since it was read (a new sign-up, or another run): next run
      if (!sending) {
        counts.pricesNoted++;
        continue;
      }

      const restore = async () => {
        const { data: back, error: backErr } = await supabase
          .from("gift_price_alerts")
          .update({ items: row.items, last_alert_at: row.last_alert_at, reminder_sent_at: row.reminder_sent_at, send_claimed_at: null, updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("updated_at", stamp)
          .select("id");
        if (backErr || (back?.length ?? 0) === 0) {
          defects.push(`claim NOT put back for subscription ${row.id} (${backErr?.message ?? "changed since"}); this email will not be retried`);
        } else {
          counts.restored++;
        }
      };

      const dropped = new Map(drops.map((d) => [d.href, d]));
      const template = reminder ? REMINDER_TEMPLATE : PRICE_DROP_TEMPLATE;
      // Only gifts in today's feed, by the feed's own name: nothing a caller typed is ever mailed (lh-authz-rls review).
      const emailItems: EmailItem[] = reminder
        ? nextItems.flatMap((i) => {
          const cur = feed.items[i.href];
          if (!cur?.name) return [];
          const d = dropped.get(i.href);
          return [{ href: i.href, name: cur.name, now: cur.price, was: d?.was ?? null, image: cur.image, guide: cur.guide ?? i.guide ?? null }];
        })
        : drops.map((d) => ({ href: d.href, name: d.name, now: d.now, was: d.was, image: d.image, guide: d.guide }));
      if (emailItems.length === 0) {
        // A reminder with none of its gifts on a guide any more: nothing to show, so nothing is sent (the stamp stays:
        // there is no list to remind about this season).
        const { data: cleared0, error: clearErr } = await supabase.from("gift_price_alerts").update({ send_claimed_at: null }).eq("id", row.id).select("id");
        if (clearErr || (cleared0?.length ?? 0) === 0) defects.push(`send_claimed_at not cleared for subscription ${row.id} (${clearErr?.message ?? "zero rows matched"})`);
        continue;
      }
      const subject = reminder ? C.reminderSubject : C.dropSubject(drops.length, drops[0]?.name ?? "");

      let html: string;
      let text: string;
      let headers: Record<string, string>;
      try {
        const unsubscribeUrl = await buildUnsubscribeUrl(row.email, "gift_price_alerts");
        if (!unsubscribeUrl) {
          defects.push(`no one-click unsubscribe (EMAIL_UNSUBSCRIBE_SECRET / CRON_SECRET unset); subscription ${row.id} not mailed`);
          await restore();
          continue;
        }
        const el = reminder
          ? React.createElement(GiftReminderEmail, { items: emailItems, appUrl, unsubscribeUrl })
          : React.createElement(GiftPriceDropEmail, { items: emailItems, appUrl, unsubscribeUrl });
        ({ html, text } = await renderEmail(el));
        headers = await unsubscribeHeaders(row.email, "gift_price_alerts");
      } catch (e) {
        // Not silent: a defect (the run answers 500), and the claim is put back so a later run retries.
        defects.push(`render failed for subscription ${row.id}: ${caughtMessage(e)}`);
        await restore();
        continue;
      }

      const messageId = crypto.randomUUID();
      const { error: logErr } = await supabase.from("email_send_log").insert({
        message_id: messageId,
        template_name: template,
        recipient_email: row.email,
        status: "pending",
      });
      if (logErr) defects.push(`email_send_log insert failed for subscription ${row.id}: ${logErr.message}`);

      const { error: enqueueErr } = await supabase.rpc("enqueue_email", {
        queue_name: "transactional_emails",
        payload: {
          run_id: crypto.randomUUID(),
          message_id: messageId,
          to: row.email,
          from: FROM_DEFAULT,
          reply_to: SUPPORT_EMAIL,
          subject,
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
        if (reminder) counts.reminders++;
        else counts.drops++;
        const { data: cleared, error: clearErr } = await supabase
          .from("gift_price_alerts")
          .update({ send_claimed_at: null })
          .eq("id", row.id)
          .select("id");
        if (clearErr || (cleared?.length ?? 0) === 0) {
          defects.push(`send_claimed_at NOT cleared for subscription ${row.id} (${clearErr?.message ?? "zero rows matched"}); the email was queued`);
        }
        continue;
      }
      defects.push(`enqueue_email failed for subscription ${row.id}: ${enqueueErr.message}`);
      const refused = databaseRefused(enqueueErr.code);
      if (refused) await restore();
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
      else if (!logErr && (failStamped?.length ?? 0) === 0) defects.push(`email_send_log failure stamp matched no row for ${messageId}`);
    }

    if (counts.deferred > 0) {
      // The same tail would be skipped run after run (rows are read oldest first): said, not hidden.
      defects.push(`${counts.deferred} subscriptions not checked: the run hit its ${TIME_BUDGET_MS / 1000} s budget (send faster or run more often)`);
    }
    if (suspectLinks.size > 0) {
      counts.suspect = suspectLinks.size;
      defects.push(`price drops over 70% not mailed (likely a broken price in the guide picks; fix the price, or it stays unmailed): ${[...suspectLinks].slice(0, 5).join("; ")}`);
    }

    // Claims whose email was never confirmed queued: killed between claim and enqueue, or an enqueue whose outcome is
    // unknown. Bounded to 2-26 hours old so each is reported on a few runs, not forever.
    const { data: unqueued, error: unqueuedErr } = await supabase
      .from("gift_price_alerts")
      .select("id, send_claimed_at")
      .not("send_claimed_at", "is", null)
      .lt("send_claimed_at", new Date(started - 2 * HOUR).toISOString())
      .gt("send_claimed_at", new Date(started - 26 * HOUR).toISOString())
      .limit(50);
    if (unqueuedErr) defects.push(`unqueued-claim check failed: ${unqueuedErr.message}`);
    else {
      counts.unqueuedClaims = (unqueued ?? []).length;
      for (const u of (unqueued ?? []) as { id: string }[]) {
        defects.push(`subscription ${u.id} was claimed over 2 hours ago and its email was never confirmed queued (check email_send_log); its drops and reminder are marked sent`);
      }
    }

    return cronResult("gift-price-alerts", counts, { count: defects.length, reasons: defects }, corsHeaders);
  } catch (e) {
    // Not silent: cronError answers 500 with the message, which sweep_cron_http_failures reports.
    return cronError("gift-price-alerts", caughtMessage(e), corsHeaders);
  }
});
