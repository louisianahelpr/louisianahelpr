import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_IDV_WEBHOOK_SECRET");

  if (!stripeKey) {
    // A missing key means EVERY IDV event is silently dropped. Keep the 200 so
    // Stripe stops retrying, but page ops — a console line alone would let the
    // whole identity-verification pipeline sit broken unnoticed.
    console.error("[stripe-idv-webhook] STRIPE_SECRET_KEY not set — acknowledging to stop retries");
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Stripe IDV webhook misconfigured",
      message: "STRIPE_SECRET_KEY is not set — every identity-verification event is being dropped (200-ACKed) with no processing.",
    });
    return new Response(JSON.stringify({ received: true, error: "stripe_key_not_configured" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!webhookSecret) {
    // Return 200 so Stripe stops retrying — same pattern as stripe-webhook.
    // A 500 here causes Stripe to retry every IDV event indefinitely, filling
    // logs and burning the retry budget. But a silent drop of every IDV event is
    // an outage, so page ops instead of only logging.
    console.error("[stripe-idv-webhook] STRIPE_IDV_WEBHOOK_SECRET not set — acknowledging to stop retries");
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Stripe IDV webhook misconfigured",
      message: "STRIPE_IDV_WEBHOOK_SECRET is not set — every identity-verification event is being dropped (200-ACKed) with no processing.",
    });
    return new Response(JSON.stringify({ received: true, error: "webhook_secret_not_configured" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    // createClient() throws if the URL is falsy — outside any try-catch, that
    // produces an unhandled 500 that causes Stripe to retry indefinitely with no
    // ops signal. Return 200 + alert so Stripe stops and ops investigates.
    const missing = [!supabaseUrl && "SUPABASE_URL", !serviceRoleKey && "SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(", ");
    console.error(`[stripe-idv-webhook] Missing required env vars: ${missing} — acknowledging to stop retries`);
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Stripe IDV webhook misconfigured — Supabase env vars missing",
      message: `The following env vars are not set: ${missing}. Every identity-verification event is being dropped (200-ACKed) with no processing until this is fixed.`,
    });
    return new Response(JSON.stringify({ received: true, error: "supabase_not_configured" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: "2025-08-27.basil",
  });

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    // Return 200 (not 401) — no-sig requests are either misconfigured
    // clients or probes. A 401 causes Stripe to retry 14+ times over 3
    // days; 200 stops the storm immediately.
    console.error("[stripe-idv-webhook] Missing stripe-signature header — acknowledging to stop retries");
    return new Response(JSON.stringify({ received: true, error: "missing_signature_header" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err) {
    // Return 200 (not 400) to stop Stripe from retrying. A signature failure
    // here means either a wrong secret or a tampered payload — neither is
    // fixable by retrying. Alert ops: a misconfigured STRIPE_IDV_WEBHOOK_SECRET
    // silently drops every IDV event, breaking the entire identity-verification
    // pipeline with no visible signal — same alerting pattern as stripe-webhook.
    console.error("[stripe-idv-webhook] Signature verification failed:", err);
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Stripe IDV webhook signature failed",
      message: "Stripe IDV webhook signature verification failed — identity verification events are being acknowledged but not processed. Check `STRIPE_IDV_WEBHOOK_SECRET`.",
      fields: { Error: String(err).slice(0, 200) },
    });
    return new Response(JSON.stringify({ received: true, error: "signature_verification_failed" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---- Replay dedupe ----
  // Stripe delivers at-least-once: a verified session event can arrive again on
  // a retry or a dashboard replay. The status writes below are idempotent by
  // value, but re-running still re-sends the account-status email and re-flags
  // admins — so record the event.id in the shared ledger and skip a repeat.
  // Track whether WE inserted the dedupe row, so a later handler failure can
  // roll it back (below) and let Stripe's retry re-process — otherwise the
  // retry hits this dedupe wall and 200-skips, permanently stranding the IDV
  // status transition (approval / manual-review) un-applied.
  let idempotencyRecorded = false;
  try {
    const { error: idemErr } = await supabase
      .from("stripe_webhook_events")
      .insert({ event_id: event.id, event_type: event.type });
    if (idemErr) {
      if ((idemErr as { code?: string }).code === "23505") {
        console.log("[stripe-idv-webhook] Duplicate event — already processed, skipping:", event.id);
        return new Response(JSON.stringify({ received: true, duplicate: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Any other DB error (not a duplicate): the dedupe table is unhealthy.
      // Processing now WITHOUT a dedupe record means a later Stripe retry can't
      // be recognized as a duplicate and would re-apply the event — re-sending
      // the verification email and re-flagging admins. Fail closed: 500 so
      // Stripe retries once the DB recovers and the insert can succeed.
      console.error("[stripe-idv-webhook] Idempotency insert failed — asking Stripe to retry:", idemErr);
      await postSlackOpsAlert({
        kind: "stripe_webhook_error",
        severity: "critical",
        title: "Stripe IDV webhook idempotency insert failed",
        message: `Could not record dedupe row for \`${event.type}\` (DB error, not a duplicate) — returning 500 so Stripe retries rather than processing un-deduped.`,
        fields: { "Event ID": event.id, Error: String((idemErr as { message?: string }).message ?? idemErr).slice(0, 200) },
      });
      return new Response(JSON.stringify({ received: false, error: "idempotency_insert_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      idempotencyRecorded = true;
    }
  } catch (e) {
    // The insert threw (network/client error). Same reasoning: without a dedupe
    // record we can't safely process, so fail closed and let Stripe retry.
    console.error("[stripe-idv-webhook] Idempotency check threw — asking Stripe to retry:", e);
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Stripe IDV webhook idempotency check threw",
      message: `Dedupe insert threw for \`${event.type}\` — returning 500 so Stripe retries rather than processing un-deduped.`,
      fields: { "Event ID": event.id, Error: String(e).slice(0, 200) },
    });
    return new Response(JSON.stringify({ received: false, error: "idempotency_check_threw" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Roll back the dedupe row we inserted so Stripe's retry re-processes this
  // event instead of hitting the dedupe wall. Mirrors verification-webhook's
  // rollbackIdempotency(). No-op when we didn't insert the row ourselves.
  const rollbackIdempotency = async () => {
    if (!idempotencyRecorded) return;
    // `.select("event_id")` — NOT `.select("id")`. A DELETE matching zero rows
    // returns `{ data: [], error: null }`, so without a returning projection a
    // no-op rollback is indistinguishable from a successful one. `event_id` is
    // this table's primary key and it has no `id` column (verified against
    // prod: `?select=id` → 400), so asking for `id` would turn every rollback
    // into a hard 400 and a false critical page.
    const { data: rolledBack, error: delErr } = await supabase
      .from("stripe_webhook_events")
      .delete()
      .eq("event_id", event.id)
      .select("event_id");
    if (delErr) {
      // Rollback delete failed → the dedupe row survives → Stripe's retry will
      // dedupe-skip and silently drop this IDV status transition. Page ops; a
      // console line is invisible.
      console.error("[stripe-idv-webhook] Failed to roll back idempotency row:", delErr);
      await postSlackOpsAlert({
        kind: "stripe_webhook_error",
        severity: "critical",
        title: "Stripe IDV webhook idempotency rollback FAILED — event may be stranded",
        message: `Could not delete stripe_webhook_events row for \`${(event as Stripe.Event | undefined)?.type ?? "unknown"}\`; the retry will dedupe-skip and drop this event. Manual replay needed.`,
        fields: {
          "Event ID": (event as Stripe.Event | undefined)?.id ?? "—",
          Error: String(delErr).slice(0, 200),
        },
      });
      return;
    }

    // Zero rows deleted — not a benign race. `idempotencyRecorded` is only true
    // because THIS request inserted the row seconds ago; a concurrent delivery
    // of the same event.id would have hit 23505 and 200-skipped without ever
    // reaching this rollback; the only call site returns immediately after
    // awaiting; and `cleanup_stripe_webhook_events()` prunes at 30 days. So no
    // rows matched means the row is still there, Stripe's retry will dedupe-skip
    // it, and the identity-verification transition (approval / manual review) is
    // dropped for good. Same consequence as the delete erroring — same alert.
    if (!rolledBack || (rolledBack as unknown[]).length === 0) {
      console.error(
        "[stripe-idv-webhook] Idempotency rollback matched ZERO rows — dedupe row may survive:",
        event.id,
      );
      await postSlackOpsAlert({
        kind: "stripe_webhook_error",
        severity: "critical",
        title: "Stripe IDV webhook idempotency rollback matched 0 rows — event may be stranded",
        message: `The rollback DELETE for \`${(event as Stripe.Event | undefined)?.type ?? "unknown"}\` reported no error but removed no row, even though this request inserted it moments ago. If the row survives, Stripe's retry will dedupe-skip and this identity-verification transition is lost. Check \`stripe_webhook_events\` for this event id and delete it manually to allow redelivery.`,
        fields: {
          "Event ID": (event as Stripe.Event | undefined)?.id ?? "—",
        },
      });
    }
  };

  try {
    if (
      event.type === "identity.verification_session.verified" ||
      event.type === "identity.verification_session.requires_input" ||
      event.type === "identity.verification_session.processing" ||
      event.type === "identity.verification_session.canceled"
    ) {
      const session = event.data.object as Stripe.Identity.VerificationSession;
      const userId = session.metadata?.user_id;
      if (!userId) {
        console.warn("[stripe-idv-webhook] No user_id in metadata", session.id);
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Pull settings for threshold. A read failure falls back to the default
      // 85, but don't drop the error silently — log it so a misconfigured/locked
      // platform_settings row is diagnosable rather than an invisible default.
      const { data: settings, error: settingsErr } = await supabase
        .from("platform_settings")
        .select("idv_auto_approve_threshold")
        .single();
      if (settingsErr) {
        console.error("[stripe-idv-webhook] platform_settings read failed — using default threshold 85:", settingsErr);
      }
      const threshold = Number(settings?.idv_auto_approve_threshold ?? 85);

      let updateData: Record<string, unknown> = { idv_session_id: session.id };

      if (event.type === "identity.verification_session.verified") {
        // Stripe Identity returns "verified" as a binary outcome. We compute a
        // confidence score from selfie + document signals when available.
        // `verified_outputs` is expandable and redacted by default — without
        // asking for it, the legal name and date of birth Stripe confirmed are
        // simply absent from the object, and the identity fingerprint below
        // would be NULL for every single verification. That is the failure
        // mode this expand exists to prevent.
        const verified = await stripe.identity.verificationSessions.retrieve(
          session.id,
          { expand: ["last_verification_report", "verified_outputs"] }
        );
        const report = verified.last_verification_report as Stripe.Identity.VerificationReport | null;

        // ── Identity-level ban enforcement ────────────────────────────────
        //
        // A new email defeats `retained_bans.email_sha256`; a second SIM
        // defeats the phone key. This is the layer that holds, because
        // identity is required to work: the returning user has to present a
        // different government document belonging to a different person.
        //
        // NOTHING identifying is stored. First name, last name, DOB and (when
        // the document type carries one) the document number are passed to
        // `identity_fingerprint()`, which salts them with a Vault secret the
        // database cannot read back in plaintext and returns a SHA-256. The
        // raw values never leave this closure.
        const outputs = (verified.verified_outputs ??
          null) as Stripe.Identity.VerificationSession.VerifiedOutputs | null;
        const docFirst = report?.document?.first_name ?? null;
        const docLast = report?.document?.last_name ?? null;
        const docDob = report?.document?.dob ?? null;
        const dobOf = (d: { day?: number | null; month?: number | null; year?: number | null } | null) =>
          d?.year && d?.month && d?.day
            ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`
            : null;

        const firstName = outputs?.first_name ?? docFirst;
        const lastName = outputs?.last_name ?? docLast;
        const dob = dobOf(outputs?.dob ?? null) ?? dobOf(docDob ?? null);
        // Present only when the document type provides one AND Stripe has not
        // redacted it. Absent is fine — identity_fingerprint() folds an empty
        // document number in as an empty string, consistently on both sides.
        const docNumber = report?.document?.number ?? null;

        let identityHash: string | null = null;
        if (firstName && lastName && dob) {
          const { data: fp, error: fpErr } = await supabase.rpc("identity_fingerprint", {
            p_first_name: firstName,
            p_last_name: lastName,
            p_dob: dob,
            p_doc_number: docNumber,
          });
          if (fpErr) {
            // Do NOT approve on a failed fingerprint — approving is the
            // irreversible half. Throwing routes into the outer catch, which
            // rolls back the dedupe row and returns 500 so Stripe redelivers.
            throw new Error(`identity_fingerprint failed: ${fpErr.message}`);
          }
          identityHash = (fp as string | null) ?? null;
        } else {
          console.warn(
            `[stripe-idv-webhook] no name/DOB in verified_outputs for ${session.id} — identity ban check skipped`,
          );
        }

        if (identityHash) {
          const { data: banCheck, error: banErr } = await supabase.rpc("enforce_retained_ban", {
            p_user_id: userId,
            p_email: null,
            p_phone: null,
            p_identity_sha256: identityHash,
          });
          if (banErr) {
            // Same reasoning: never approve past an unanswered ban question.
            throw new Error(`enforce_retained_ban failed: ${banErr.message}`);
          }

          if (banCheck?.banned) {
            // The account is left UNVERIFIED — `enforce_retained_ban` has
            // already re-applied the ban status, and the jobs INSERT policy
            // reads `idv_status = 'verified'`, so writing anything else here
            // would hand a banned person the one capability the ban exists to
            // remove.
            const { error: flagErr } = await supabase.from("fraud_flags").insert({
              user_id: userId,
              flag_type: "retained_ban_identity_match",
              details:
                `Stripe Identity verified against a document fingerprint retained from a prior ban ` +
                `(matched on ${banCheck.matched_on}). IDV refused; account left unverified and the ` +
                `prior judgment re-applied. Session ${session.id}.`,
            });
            if (flagErr) {
              console.error("[stripe-idv-webhook] failed to write fraud flag:", flagErr);
            }

            const { error: refuseErr } = await supabase
              .from("profiles")
              .update({
                idv_session_id: session.id,
                idv_status: "failed",
                idv_confidence: 0,
                idv_failure_reason: "Identity matched a previously removed account.",
                approval_status: "denied",
                legacy_manual_review: false,
              })
              .eq("user_id", userId);
            if (refuseErr) throw refuseErr;

            await postSlackOpsAlert({
              kind: "stripe_webhook_error",
              severity: "warning",
              title: "Banned identity attempted to re-verify",
              message:
                "A Stripe Identity session verified against a document fingerprint retained from a prior ban. " +
                "The account was left unverified, denied, and flagged in `fraud_flags`.",
              fields: { "Session ID": session.id, "Matched on": String(banCheck.matched_on ?? "identity") },
            });

            return new Response(JSON.stringify({ received: true, refused: "retained_ban" }), {
              status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        // Heuristic confidence: 100 if document + selfie both verified with no errors,
        // 90 if minor issues, otherwise fall back to manual review.
        let confidence = 100;
        if (report?.document?.error || report?.selfie?.error) confidence = 60;
        else if (!report?.selfie) confidence = 80;

        updateData.idv_confidence = confidence;

        // Carried on the live profile so that if this account is banned later,
        // `retain_ban_for_user()` has an identity key to copy into
        // `retained_bans` — a ban with no fingerprint on file is the gap this
        // whole change closes, and the fingerprint can only be captured here,
        // while the verification is in hand.
        if (identityHash) updateData.identity_sha256 = identityHash;

        if (confidence >= threshold) {
          updateData.idv_status = "verified";
          updateData.approval_status = "approved";
          updateData.idv_failure_reason = null;
          updateData.legacy_manual_review = false;
        } else {
          updateData.idv_status = "manual_review";
          updateData.idv_failure_reason = `Auto-approve threshold not met (${confidence} < ${threshold})`;
          updateData.legacy_manual_review = true;
        }
      } else if (event.type === "identity.verification_session.requires_input") {
        // NOT 'failed'. The account gets exactly ONE billable Stripe Identity
        // attempt (claim_idv_attempt, capped at 1 because the $2 onboarding fee
        // funds one Stripe charge), so 'failed' was a permanent ban from
        // posting: the jobs INSERT policy requires idv_status='verified', and
        // the client's dead-end copy pointed at Stripe Connect payout setup,
        // which is a different column the policy never reads.
        //
        // This event fires when a SUBMITTED check could not be confirmed — the
        // platform has already been billed for it — so there is no free retry
        // to offer. A human decides instead. 'manual_review' is a legal value
        // of the idv_status CHECK constraint and is what the admin identity
        // review queue lists.
        //
        // A user who merely closes the tab without submitting fires no event at
        // all and stays 'pending' with a live session, so the reuse path in
        // stripe-idv-start still hands them their session back for free. Only a
        // real, billed failure lands here.
        updateData.idv_status = "manual_review";
        updateData.idv_failure_reason = session.last_error?.reason || "Verification could not be completed";
        updateData.legacy_manual_review = true;
      } else if (event.type === "identity.verification_session.processing") {
        updateData.idv_status = "processing";
      } else if (event.type === "identity.verification_session.canceled") {
        // Same reasoning as requires_input: the one attempt is spent, so the
        // only honest next step is a human, not a terminal 'failed'.
        updateData.idv_status = "manual_review";
        updateData.idv_failure_reason = "Verification was canceled before it finished";
        updateData.legacy_manual_review = true;
      }

      const { error: updErr } = await supabase
        .from("profiles")
        .update(updateData)
        .eq("user_id", userId);

      if (updErr) {
        // Throwing here routes into the outer catch which fires postSlackOpsAlert.
        // A silent log would permanently lose the IDV status update with no operator alert.
        throw updErr;
      }

      // Notify user + admins
      const status = updateData.idv_status as string;
      if (status === "verified") {
        // 1) In-app notification (auto-triggers browser push via useRealtimePush)
        const { error: notifErr } = await supabase.from("notifications").insert({
          user_id: userId,
          title: "Verification Successful",
          message: "Your identity has been verified! You're cleared to start using Helpr.",
          type: "success",
          link: "/dashboard",
        });
        if (notifErr) {
          console.error("[stripe-idv-webhook] Failed to insert verified notification:", notifErr);
        }

        // 2) Branded "Verification Successful" email (server-to-server with service role)
        try {
          await supabase.functions.invoke("send-account-status-email", {
            body: { userId, status: "verified" },
            headers: {
              Authorization: `Bearer ${(Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!}`,
            },
          });
        } catch (emailErr) {
          console.error("[stripe-idv-webhook] Verification email dispatch failed:", emailErr);
        }
      } else if (status === "manual_review" || status === "failed") {
        // Flag admins
        const { data: admins, error: adminsErr } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");
        if (adminsErr) {
          console.error("[stripe-idv-webhook] Failed to load admins for review flag:", adminsErr);
        }

        if (admins?.length) {
          const reason = status === "failed" ? "failed automated verification" : "needs manual review";
          const { error: adminNotifErr } = await supabase.from("notifications").insert(
            admins.map((a: { user_id: string }) => ({
              user_id: a.user_id,
              title: "Identity verification needs review",
              message: `A user ${reason}. Tap to review.`,
              type: "warning",
              link: "/admin",
            }))
          );
          if (adminNotifErr) {
            console.error("[stripe-idv-webhook] Failed to insert admin review notifications:", adminNotifErr);
          }
        }

        const { error: userNotifErr } = await supabase.from("notifications").insert({
          user_id: userId,
          title: "Verification under review",
          message: "We couldn't auto-verify your ID. Our team will review it within 24 hours.",
          type: "info",
          link: "/account-pending",
        });
        if (userNotifErr) {
          console.error("[stripe-idv-webhook] Failed to insert under-review notification:", userNotifErr);
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // Roll back the dedupe row and return a non-2xx so Stripe REDELIVERS this
    // event. A transient DB failure (e.g. the profiles UPDATE threw) must not
    // permanently lose the identity-verification status transition — the retry
    // re-runs the (idempotent-by-value) handler once the fault clears.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-idv-webhook] Processing error:", err);
    await rollbackIdempotency();
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Stripe IDV webhook processing error",
      message: `Failed to process IDV event \`${(event as Stripe.Event | undefined)?.type ?? "unknown"}\` — asking Stripe to retry: ${message}`,
      fields: {
        "Event ID": (event as Stripe.Event | undefined)?.id ?? "—",
        Error: message.slice(0, 200),
      },
    });
    return new Response(JSON.stringify({ received: false, error: "processing_error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
