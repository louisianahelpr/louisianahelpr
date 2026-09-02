// Marketing email blast tool — admin-only.
// Sends a one-off campaign to a segmented user list via the Resend API.
// Segments: all | helpers | posters | by_parish.
import * as React from "npm:react@18.3.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
// Sending, the From header, the List-Unsubscribe headers and the
// postal-address secret all come from the one Resend module now — this
// function used to carry its own copy of each, including the only use of
// hello@ in the product.
import { FROM_DEFAULT, POSTAL_ADDRESS, sendWithResend } from "../_shared/resend.ts";
import { buildUnsubscribeUrl, unsubscribeHeaders } from "../_shared/unsubscribe.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
// The campaign is wrapped in the shared react-email shell, which is where the
// branded card, the preheader, dark mode and <MarketingFooter> (unsubscribe +
// POSTAL_ADDRESS) now come from. Both the HTML and the plaintext part are
// rendered from that one component — see the note above `renderCampaign`.
import { MarketingBlastEmail } from "../_shared/email-templates/marketing-blast.tsx";
import { renderEmail } from "../_shared/email-templates/render.ts";
// EVERY list this function reads to decide who gets mail is capped by
// PostgREST's `db-max-rows` (1000) unless it is paged. Five reads here were
// not, and each one fails in the same direction: a short list means MORE mail
// goes out, not less. `engagement-automations` is the reference implementation
// for the fail-closed pattern used below.
import { scanAll, scanAllIn } from "../_shared/paginate.ts";
import type { CountOption } from "../_shared/paginate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Per-blast recipient ceiling. Was an undocumented `.limit(5000)` that silently
 * dropped everyone past it; it is now an explicit refusal — see the check.
 */
const MAX_BLAST_RECIPIENTS = 5000;

interface BlastBody {
  subject: string;
  html: string;
  segment: "all" | "helpers" | "posters" | "by_parish";
  parish?: string;
  test_email?: string; // if present, only send to this address (preview)
}

/** `email_send_log` rows buffered during a campaign, flushed in chunks. */
interface SendLogRow {
  message_id: string;
  template_name: string;
  recipient_email: string;
  status: "sent" | "failed";
  error_message?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;

    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");

    // Auth: must be admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Use the shared has_role RPC rather than hand-rolling a user_roles select
    // (the drift admin-resend-verification was already consolidated away from).
    // Both are equivalent today, but a hand-rolled copy silently stops matching
    // if the role model moves — and this endpoint can mail every user.
    // The error is checked so a transient RPC failure returns a truthful 503
    // instead of a misleading "Forbidden" to a real admin.
    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    if (roleError) {
      console.error("[send-marketing-blast] has_role check failed:", roleError.message);
      return new Response(JSON.stringify({ error: "Couldn't verify permissions. Please retry." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // POSTAL ADDRESS — A LOUD WARNING, NO LONGER A HARD STOP.
    //
    // This function used to REFUSE with a 400 whenever POSTAL_ADDRESS was
    // unset, which is what disabled commercial email entirely. The owner
    // decided on 2026-08-31 to restore the capability with the address
    // requirement still unmet, having been told exactly what CAN-SPAM
    // §7704(a)(5) asks for (see the constant's note in _shared/resend.ts).
    // That is an accepted business risk, so the block is a log line now.
    //
    // What has NOT been relaxed: the opt-out half of the statute. Every
    // recipient below gets a working, signed, one-click unsubscribe in the
    // footer and in the List-Unsubscribe headers, honoured on the next send by
    // the marketing_consent / email_promotions filters here.
    //
    // To close the remaining gap it is one edit — POSTAL_ADDRESS_LITERAL in
    // _shared/resend.ts, or `supabase secrets set HELPR_POSTAL_ADDRESS="…"`.
    // The address then renders in this campaign's footer automatically via the
    // shared <MarketingFooter> inside MarketingBlastEmail; nothing here changes.
    // ─────────────────────────────────────────────────────────────────────
    if (!POSTAL_ADDRESS) {
      console.warn(
        "[send-marketing-blast] HELPR_POSTAL_ADDRESS is unset — this campaign will ship WITHOUT the physical postal address CAN-SPAM §7704(a)(5) requires. Sending anyway per owner decision 2026-08-31.",
      );
    }

    const body = (await req.json()) as BlastBody;
    if (!body.subject?.trim() || !body.html?.trim() || !body.segment) {
      return new Response(JSON.stringify({ error: "subject, html, and segment are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only {{name}} is substituted. Any other token the admin types would ship
    // verbatim to up to 5000 inboxes, so refuse the send and name the offender
    // rather than mailing "Hey {{first_name}}" to the whole list.
    const leftoverTokens = [
      ...new Set(
        // `?? []` on its own infers `never[]`, so `.concat()` then refuses the
        // RegExpMatchArray from the subject scan and the subject's leftover
        // tokens would have to be dropped to compile. Seed the element type.
        (body.html.replaceAll("{{name}}", "").match(/\{\{\s*[\w.]+\s*\}\}/g) ?? ([] as string[]))
          .concat(body.subject.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []),
      ),
    ];
    if (leftoverTokens.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Unsupported placeholder(s): ${leftoverTokens.join(", ")}. Only {{name}} is substituted.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Hard suppression list ────────────────────────────────────────────
    // Bounces and spam complaints, written by `resend-webhook`. This function
    // was the ONLY sender with a marketing footer that never consulted it:
    // send-notification-email and engagement-automations both do, both fail
    // closed. So a campaign kept mailing every hard-bounced and every
    // complained-about address on the platform — up to 5000 of them at a time,
    // which is the single fastest way to lose a sending domain.
    //
    // Fail CLOSED, and BEFORE the segment branches so the `test_email` preview
    // is covered too. A dropped error would produce an empty set, which looks
    // exactly like "nobody is suppressed".
    //
    // PAGED, and a short read aborts exactly as a failed one does. The
    // unpaged version returned the first 1000 suppressed addresses with a
    // clean 200; every hard-bounced or complained address past that row was
    // simply absent from `suppressedSet`, which at the filter below is
    // indistinguishable from never having bounced. This list only ever grows,
    // and it is the one whose truncation costs the sending domain.
    const suppressedScan = await scanAll<{ email: string | null }>(
      "suppressed_emails",
      (countOpt) =>
        supabase.from("suppressed_emails").select("email", countOpt).order("id", { ascending: true }),
    );
    if (suppressedScan.error) {
      console.error("[send-marketing-blast] suppression list unavailable:", suppressedScan.error.message);
      return new Response(
        JSON.stringify({
          error:
            `Could not load the bounce/complaint suppression list (${suppressedScan.error.message}). Blast aborted — no email was sent.`,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!suppressedScan.complete) {
      console.error("[send-marketing-blast] suppression list incomplete:", suppressedScan.shortfall);
      return new Response(
        JSON.stringify({
          error:
            `The bounce/complaint suppression list came back incomplete (${suppressedScan.shortfall}). Blast aborted — no email was sent.`,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const suppressedSet = new Set(
      suppressedScan.rows.map((r) => (r.email ?? "").toLowerCase()).filter((e) => e.length > 0),
    );

    // Resolve recipient list
    let recipients: { email: string; full_name: string | null }[] = [];

    if (body.test_email) {
      recipients = [{ email: body.test_email, full_name: "Test" }];
    } else {
      // profiles.role was dropped in the unified-accounts migration —
      // selecting it would throw. Segments now derive from BEHAVIOR:
      //   helpers  = anyone with ≥1 application
      //   posters  = anyone with ≥1 posted job
      //   by_parish = profile's parish field
      // Same user can be in both helpers and posters segments — that's
      // intentional under the unified user model.
      // Honor explicit marketing-email consent captured at signup. Anyone
      // who didn't tick the marketing opt-in box (or was created before the
      // column existed and has the DB default of `false`) is never sent
      // promotional mail. Transactional mail (auth, receipts, disputes)
      // uses different send paths and is not gated by this column.
      // Rebuilt once per page — `scanAll` calls this for every 500-row window
      // and a PostgREST builder is single-use. `.order("user_id")` is required:
      // offset paging over an unordered result is sampling, not paging.
      const baseRecipients = (countOpt: CountOption) => {
        let b = supabase
          .from("profiles")
          .select("user_id, email, full_name, parish", countOpt)
          .not("email", "is", null)
          .eq("email_verified", true)
          .eq("approval_status", "approved")
          .eq("marketing_consent", true);
        if (body.segment === "by_parish" && body.parish) b = b.eq("parish", body.parish);
        return b.order("user_id", { ascending: true });
      };

      // The two behavioural segments read a table that is far LARGER than the
      // user base — one row per application, one per posted job — so they cross
      // `db-max-rows` long before `profiles` does. Both reads also dropped
      // their error outright (`const { data: applicants } =`), and the failure
      // was silent in the worst possible way: on error the list came back
      // empty, `helperIds.length === 0` matched, and the function answered
      // `200 {sent: 0, message: "No users have applied to a job yet"}` — a
      // truthful-sounding sentence about a read that never happened. Both are
      // now paged and both fail closed.
      let segmentIds: string[] | null = null;
      if (body.segment === "helpers") {
        const applicantScan = await scanAll<{ helper_id: string | null }>(
          "applications (helper segment)",
          (countOpt) =>
            supabase.from("applications").select("helper_id", countOpt).order("id", { ascending: true }),
        );
        if (applicantScan.error || !applicantScan.complete) {
          const why = applicantScan.error?.message ?? applicantScan.shortfall;
          console.error("[send-marketing-blast] helper segment read failed:", why);
          return new Response(
            JSON.stringify({
              error: `Could not resolve the helper segment (${why}). Blast aborted — no email was sent.`,
            }),
            { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        segmentIds = [...new Set(applicantScan.rows.map((a) => a.helper_id).filter((id): id is string => !!id))];
        if (segmentIds.length === 0) {
          return new Response(JSON.stringify({ sent: 0, message: "No users have applied to a job yet" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      if (body.segment === "posters") {
        const posterScan = await scanAll<{ customer_id: string | null }>(
          "jobs (poster segment)",
          (countOpt) =>
            supabase
              .from("jobs")
              .select("customer_id", countOpt)
              .not("customer_id", "is", null)
              .order("id", { ascending: true }),
        );
        if (posterScan.error || !posterScan.complete) {
          const why = posterScan.error?.message ?? posterScan.shortfall;
          console.error("[send-marketing-blast] poster segment read failed:", why);
          return new Response(
            JSON.stringify({
              error: `Could not resolve the poster segment (${why}). Blast aborted — no email was sent.`,
            }),
            { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        segmentIds = [...new Set(posterScan.rows.map((j) => j.customer_id).filter((id): id is string => !!id))];
        if (segmentIds.length === 0) {
          return new Response(JSON.stringify({ sent: 0, message: "No users have posted a job yet" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // `.in()` is capped like any other read AND blows the URL length on a
      // long id list, so a segmented scan goes through `scanAllIn`, which
      // chunks the filter and pages each chunk.
      type RecipientRow = {
        user_id: string | null;
        email: string | null;
        full_name: string | null;
        parish: string | null;
      };
      const recipientScan = segmentIds === null
        ? await scanAll<RecipientRow>("profiles (blast recipients)", baseRecipients)
        : await scanAllIn<RecipientRow>(
          "profiles (blast recipients)",
          segmentIds,
          (chunk, countOpt) => baseRecipients(countOpt).in("user_id", chunk),
        );
      if (recipientScan.error || !recipientScan.complete) {
        const why = recipientScan.error?.message ?? recipientScan.shortfall;
        console.error("[send-marketing-blast] recipient read failed:", why);
        return new Response(
          JSON.stringify({
            error: `Could not resolve the recipient list (${why}). Blast aborted — no email was sent.`,
          }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const data = recipientScan.rows;

      // The old `.limit(5000)` was a SILENT truncation: a campaign aimed at
      // 6000 people mailed 5000 and reported success, and nothing anywhere
      // named the 1000 who were dropped. The cap is kept — a blast is
      // irreversible and a runaway one is worse than a refused one — but it now
      // refuses and says how many it saw, so narrowing the segment is a choice
      // the admin makes rather than one the function makes for them.
      if (data.length > MAX_BLAST_RECIPIENTS) {
        return new Response(
          JSON.stringify({
            error:
              `This segment resolves to ${data.length} recipients, above the ${MAX_BLAST_RECIPIENTS} per-blast cap. ` +
              `Blast aborted — no email was sent. Narrow the segment (by parish) and send in batches.`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Honor email opt-out: drop anyone with email_promotions=false.
      //
      // This read MUST fail closed, exactly like the recipient query above.
      // Dropping the error made the opt-out list fail OPEN: `prefs` comes back
      // null, `|| []` turns it into an empty set, nobody matches `optedOut`,
      // and the blast goes to every user who explicitly unsubscribed from
      // promotions. A single transient read failure is the difference between
      // honoring an opt-out and a CAN-SPAM violation across up to 5000
      // recipients, with no error surfaced. Abort the blast instead — an
      // unsent campaign is retryable, an unwanted one is not.
      //
      // Paged for the same reason and with the same abort. This table holds one
      // row per user, so it crosses `db-max-rows` before anything else here
      // does; the first person past that boundary who switched Promotions off
      // was simply absent from `optedOut` and got the campaign. That is the
      // CAN-SPAM half of this function failing open on a read that returned a
      // clean 200.
      const prefsScan = await scanAll<{ user_id: string; email_promotions: boolean | null }>(
        "notification_preferences",
        (countOpt) =>
          supabase
            .from("notification_preferences")
            .select("user_id, email_promotions", countOpt)
            .order("id", { ascending: true }),
      );
      if (prefsScan.error || !prefsScan.complete) {
        const why = prefsScan.error?.message ?? prefsScan.shortfall;
        throw new Error(
          `Could not load email opt-out preferences (${why}). Blast aborted — no email was sent.`,
        );
      }
      const optedOut = new Set(
        prefsScan.rows.filter((p) => p.email_promotions === false).map((p) => p.user_id),
      );

      // The query above already includes the segment filter (in() on
      // helper-applicants or poster-customers, or .eq parish). No need
      // to refetch + cross-check; just drop opted-out users.
      recipients = data
        .filter((p) => p.user_id && !optedOut.has(p.user_id) && !!p.email)
        .map((p) => ({ email: p.email!, full_name: p.full_name }));
    }

    // Applies to both branches, including the `test_email` preview.
    const beforeSuppression = recipients.length;
    recipients = recipients.filter((r) => !suppressedSet.has(r.email.toLowerCase()));
    if (recipients.length !== beforeSuppression) {
      console.log(
        `[send-marketing-blast] dropped ${beforeSuppression - recipients.length} suppressed recipient(s)`,
      );
    }

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ sent: 0, failed: 0, message: "No recipients" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send via the Resend API. Throttle lightly: batches of 10, 200ms between.
    //
    // The admin types raw HTML, so there is no component to build the campaign
    // body from — but everything AROUND it is now the shared react-email shell
    // (MarketingBlastEmail → BaseLayout). That shell owns:
    //   • the centred <Container> card, the preheader, the color-scheme metas
    //     and the dark-mode stylesheet, none of which the bare campaign HTML
    //     had;
    //   • <MarketingFooter>, which emits the unsubscribe link, the mailto
    //     unsubscribe, and the POSTAL_ADDRESS block — rendered only when that
    //     one shared constant is populated, so nothing false is printed while
    //     it is empty. Links route through getAppUrl() rather than a
    //     hardcoded apex domain.
    //
    // The old code appended marketingFooter() to the HTML by hand and skipped
    // that append when the campaign already contained "/profile?tab=notifications"
    // (an admin who pasted their own unsubscribe link kept theirs). Both the
    // append and that check are gone: the footer is part of the shell, so it is
    // always present exactly once, and an admin's own unsubscribe link in the
    // body is now merely a harmless duplicate rather than a reason to suppress
    // the compliant footer.
    //
    // Every other sender supplies a plaintext part; this one used to synthesise
    // it with htmlToPlainText(), a regex that strips tags — which threw away the
    // unsubscribe href and left the word "Unsubscribe" pointing nowhere in every
    // text-only client. Both parts now come from the SAME component via
    // renderEmail(), so they cannot drift and the links survive. HTML-only mail
    // is a direct spam-score penalty anyway, and sendWithResend refuses a send
    // without a text part.
    //
    // The preheader is the campaign subject: the inbox preview used to be
    // whatever words happened to start the admin's HTML.
    //
    // The unsubscribe link is now PER RECIPIENT — a signed one-click URL for
    // that address — and the same URL goes into both the footer and the
    // List-Unsubscribe headers, so Gmail's native control and the visible link
    // hit the same handler. Previously both pointed at the logged-in
    // preferences page while the headers still claimed RFC 8058 one-click, so
    // a recipient tapping Gmail's button was told they were unsubscribed and
    // nothing was written.
    const preheader = body.subject.trim();
    const renderCampaign = async (rawHtml: string, fullName: string | null, email: string) => {
      const unsubscribeUrl =
        (await buildUnsubscribeUrl(email)) ?? `${getAppUrl()}/profile?tab=notifications`;
      return await renderEmail(
        React.createElement(MarketingBlastEmail, {
          preheader,
          bodyHtml: rawHtml.replaceAll("{{name}}", fullName || "neighbor"),
          unsubscribeUrl,
        }),
      );
    };

    let sent = 0, failed = 0;
    const errors: string[] = [];

    // ── Audit trail ──────────────────────────────────────────────────────
    // This function used to write NO email_send_log rows at all: up to 5000
    // sends left behind a single aggregate admin_audit_log row and only the
    // first 5 failure strings, so "did this person get the campaign?" was
    // unanswerable. Every recipient now gets a row.
    //
    // Buffered and inserted in chunks — one round-trip per recipient inside
    // the send loop would multiply a 5000-recipient campaign's runtime.
    // Failure to write the audit rows is logged loudly but never aborts a
    // campaign that is already partly delivered.
    const LOG_CHUNK = 100;
    const pendingLogs: SendLogRow[] = [];
    const flushLogs = async (force = false) => {
      while (pendingLogs.length >= LOG_CHUNK || (force && pendingLogs.length > 0)) {
        const chunk = pendingLogs.splice(0, LOG_CHUNK);
        const { error: logError } = await supabase.from("email_send_log").insert(chunk);
        if (logError) {
          console.error(
            `[send-marketing-blast] email_send_log insert failed for ${chunk.length} row(s):`,
            logError.message,
          );
        }
      }
    };

    for (let i = 0; i < recipients.length; i += 10) {
      const batch = recipients.slice(i, i + 10);
      await Promise.all(batch.map(async (r) => {
        // Correlation key. Resend's own id is preferred when the send lands
        // (it's what a bounce/complaint webhook reports back); a locally
        // generated uuid covers failures and any response without an id.
        // Annotated `string`: `crypto.randomUUID()` returns the template literal
        // type `${string}-${string}-${string}-${string}-${string}`, which the
        // Resend message id assigned below does not satisfy.
        let messageId: string = crypto.randomUUID();
        try {
          // Rendering is per-recipient ({{name}} is substituted before the
          // shell is rendered) and ASYNCHRONOUS, so it is awaited before the
          // send — an unawaited render would hand sendWithResend a pair of
          // Promises and every recipient would get "[object Promise]".
          //
          // It sits inside the try so a render failure is recorded against
          // that recipient like any other failed send, instead of rejecting
          // the whole Promise.all and killing a campaign mid-flight.
          const { html: personalisedHtml, text: personalisedText } = await renderCampaign(
            body.html,
            r.full_name,
            r.email,
          );
          // sendWithResend THROWS on any non-2xx — there is no non-ok
          // Response to inspect any more, so both the HTTP-failure and the
          // network-failure paths land in the same catch below.
          const resendId = await sendWithResend(RESEND_API_KEY, {
            to: r.email,
            from: FROM_DEFAULT,
            subject: body.subject,
            html: personalisedHtml,
            text: personalisedText,
            // Recipient-specific, so the native Gmail / Apple Mail control
            // resolves to the same signed one-click endpoint as the footer
            // link. This send carried no opt-out of any kind before the
            // template migration, and then a non-functional one.
            headers: await unsubscribeHeaders(r.email),
          });
          if (resendId) messageId = resendId;
          sent++;
          pendingLogs.push({
            message_id: messageId,
            template_name: "marketing_blast",
            recipient_email: r.email,
            status: "sent",
          });
        } catch (e: any) {
          failed++;
          const message = e instanceof Error ? e.message : String(e);
          if (errors.length < 5) errors.push(`${r.email}: ${message.slice(0, 160)}`);
          pendingLogs.push({
            message_id: messageId,
            template_name: "marketing_blast",
            recipient_email: r.email,
            status: "failed",
            error_message: message.slice(0, 1000),
          });
        }
      }));
      await flushLogs();
      if (i + 10 < recipients.length) await new Promise(r => setTimeout(r, 200));
    }
    await flushLogs(true);

    // Audit
    await supabase.from("admin_audit_log").insert({
      admin_id: user.id,
      action: "marketing_blast_sent",
      target_type: "campaign",
      details: {
        subject: body.subject,
        segment: body.segment,
        parish: body.parish,
        recipients: recipients.length,
        sent, failed,
      },
    });

    return new Response(JSON.stringify({ sent, failed, total: recipients.length, errors }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("send-marketing-blast error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
