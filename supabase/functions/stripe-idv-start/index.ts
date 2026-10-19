import { serve } from "../_shared/buildStamp.ts";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getAppUrl, buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { IDV_FEE_CENTS, IDV_FEE_TEXT, IDV_FEE_CHECKOUT_KIND } from "../_shared/idvFee.ts";
import { stripeModeForParties, stripeModeRefusedResponse, StripeModeRefused, stripeSecretKeyFor } from "../_shared/stripeMode.ts";

// ── THE PAID ID CHECK (owner 2026-10-19: "BOTH WAYS, BUT THEY HAVE TO PAY FOR
// THEIR OWN ID") ──────────────────────────────────────────────────────────
// body.action "checkout": open a Stripe Checkout for IDV_FEE_CENTS (Stripe
//   Identity's cost + the card fee on it, _shared/idvFee.ts) and write an
//   'awaiting_payment' idv_fee_payments row. Nothing identity-related is
//   created or billed here.
// body.action "start": create THE VerificationSession for a webhook-confirmed
//   'paid' row (stripe-webhook settleIdvFee), keyed `idv-fee:<row id>` so a
//   retry or a concurrent tap gets the same session: one payment, one session.
//   A row whose session was never submitted hands the same session back (Stripe
//   bills per COMPLETED report, so resuming is free). A completed check (failed
//   or canceled) spends the payment: a retry needs a new one.
//   If creating the session fails, the payment is refunded IN FULL (our
//   mistake, never the landlord's fee to eat).
// No body.action keeps the legacy path below exactly as it was.
// Identity counts by EITHER verdict, the rule public.is_identity_verified uses.
type Json = Record<string, unknown>;
type PaidCtx = {
  user: { id: string; email?: string | null };
  profile: { idv_status?: string | null; stripe_identity_verified?: boolean | null; full_name?: string | null } | null;
  // deno-lint-ignore no-explicit-any
  admin: any;
  isNative: boolean;
  reply: (status: number, body: Json) => Response;
};
const LIVE_ROW_STATUSES = ["awaiting_payment", "paid", "starting", "session_started"];
const needsFee = (ctx: PaidCtx, message: string) =>
  ctx.reply(402, { error: message, needsIdvFee: true, feeCents: IDV_FEE_CENTS });
const verifiedEitherWay = (p: PaidCtx["profile"]) => p?.idv_status === "verified" || p?.stripe_identity_verified === true;
const stripeFor = (mode: "live" | "test") => new Stripe(stripeSecretKeyFor(mode), { apiVersion: "2025-08-27.basil" });

async function paidCheckout(ctx: PaidCtx): Promise<Response> {
  if (verifiedEitherWay(ctx.profile)) return ctx.reply(200, { alreadyVerified: true });
  const { data: live, error: liveErr } = await ctx.admin
    .from("idv_fee_payments")
    .select("id, status, stripe_checkout_session_id, stripe_livemode")
    .eq("user_id", ctx.user.id)
    .in("status", LIVE_ROW_STATUSES)
    .order("created_at", { ascending: false })
    .limit(5);
  if (liveErr || !Array.isArray(live)) {
    console.error("[stripe-idv-start] idv_fee_payments read failed:", liveErr?.message);
    return ctx.reply(503, { error: "We couldn't open checkout just now. Nothing was charged. Please try again." });
  }
  // Already paid for a check that is not used up: start it, don't sell another.
  if (live.some((r: { status: string }) => r.status !== "awaiting_payment")) {
    return ctx.reply(200, { paid: true });
  }
  // A submitted check Stripe is still deciding: nothing to sell yet.
  if (ctx.profile?.idv_status === "processing") {
    return ctx.reply(409, { error: "Stripe is still checking your ID. This usually takes a few minutes." });
  }
  const mode = await stripeModeForParties(ctx.admin, [ctx.user.id]);
  const stripe = stripeFor(mode);
  // A checkout from a moment ago: a COMPLETED one (its webhook not yet in)
  // refuses a second sale; otherwise an open one is handed back, not doubled.
  let openUrl: string | null = null;
  for (const r of live as Array<{ stripe_checkout_session_id: string; stripe_livemode: boolean }>) {
    if (r.stripe_livemode !== (mode === "live")) continue;
    try {
      const cs = await stripe.checkout.sessions.retrieve(r.stripe_checkout_session_id);
      if (cs.status === "complete") {
        return ctx.reply(409, { error: "Your payment is going through. Give it a minute, then tap again to start your ID check." });
      }
      if (cs.status === "open" && cs.url && !openUrl) openUrl = cs.url;
    } catch (e) {
      // An unreadable old checkout is not a reason to refuse a new one.
      console.warn("[stripe-idv-start] old idv checkout unreadable; opening a new one:", (e as Error)?.message);
    }
  }
  if (openUrl) return ctx.reply(200, { url: openUrl });
  const cs = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card", "link"],
    customer_email: ctx.user.email ?? undefined,
    client_reference_id: ctx.user.id,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: IDV_FEE_CENTS,
        product_data: {
          name: "ID check (photo ID + selfie)",
          description: "Stripe Identity's cost for one check, plus the card fee on this payment.",
        },
      },
    }],
    metadata: { kind: IDV_FEE_CHECKOUT_KIND, user_id: ctx.user.id },
    payment_intent_data: { metadata: { kind: IDV_FEE_CHECKOUT_KIND, user_id: ctx.user.id } },
    success_url: buildRedirectUrl("/rentals?idv=paid", ctx.isNative),
    cancel_url: buildRedirectUrl("/rentals?idv=cancelled", ctx.isNative),
  });
  const { error: insErr } = await ctx.admin
    .from("idv_fee_payments")
    .insert({
      user_id: ctx.user.id,
      stripe_checkout_session_id: cs.id,
      amount_cents: IDV_FEE_CENTS,
      stripe_livemode: mode === "live",
      status: "awaiting_payment",
    })
    .select("id");
  if (insErr) {
    // Untracked checkout: close it so nobody pays into it, then refuse.
    console.error("[stripe-idv-start] idv_fee_payments insert failed; expiring checkout:", insErr.message);
    try {
      await stripe.checkout.sessions.expire(cs.id);
    } catch (e) {
      // settleIdvFee still recovers the row from metadata if it is paid anyway.
      console.error("[stripe-idv-start] could not expire untracked idv checkout:", (e as Error)?.message);
    }
    return ctx.reply(503, { error: "We couldn't open checkout just now. Nothing was charged. Please try again." });
  }
  return ctx.reply(200, { url: cs.url });
}

async function refundInFull(
  ctx: PaidCtx,
  stripe: Stripe,
  row: { id: string; stripe_payment_intent_id: string | null },
  why: string,
): Promise<Response> {
  const sorry = `We couldn't start your ID check, so we refunded your ${IDV_FEE_TEXT} in full. Please try again in a few minutes.`;
  try {
    if (!row.stripe_payment_intent_id) throw new Error("no stripe_payment_intent_id on the paid row");
    const refund = await stripe.refunds.create(
      { payment_intent: row.stripe_payment_intent_id, metadata: { kind: "idv_fee_refund", idv_fee_payment_id: row.id } },
      { idempotencyKey: `idv-fee-refund:${row.id}` },
    );
    // Only OUR claimed row ('starting') moves: a refund never overwrites a session.
    const { data: done, error: updErr } = await ctx.admin
      .from("idv_fee_payments")
      .update({ status: "refunded", stripe_refund_id: refund.id, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "starting")
      .select("id");
    if (updErr || !Array.isArray(done) || done.length === 0) {
      // The money is back with them; only our ledger lags. Page so it is fixed by hand.
      await postSlackOpsAlert({
        kind: "custom",
        severity: "warning",
        title: "ID-check refund not recorded",
        message: "A paid ID check was refunded in Stripe but idv_fee_payments did not move to refunded. Set it by hand.",
        fields: { payment_id: row.id, stripe_refund_id: refund.id, error: String(updErr?.message ?? "0 rows").slice(0, 200) },
      });
    }
    return ctx.reply(503, { error: sorry, refunded: true });
  } catch (err) {
    await postSlackOpsAlert({
      kind: "custom",
      severity: "critical",
      title: "ID check failed to start AND its refund failed",
      message: `A landlord paid for an ID check, the session could not be created (${why}), and the automatic full refund failed. Refund them by hand.`,
      fields: { payment_id: row.id, payment_intent: row.stripe_payment_intent_id ?? "(none)", error: String((err as Error)?.message ?? err).slice(0, 200) },
    });
    return ctx.reply(503, { error: "We couldn't start your ID check. Our team has been told and will refund you in full." });
  }
}

/** A Stripe refusal that says "this key is busy / was used differently": never a reason to refund. */
const isIdempotencyRefusal = (err: unknown) => {
  const e = err as { type?: string; code?: string; rawType?: string } | null;
  return e?.type === "StripeIdempotencyError" || e?.rawType === "idempotency_error" || e?.code === "idempotency_key_in_use";
};

/** A 'starting' claim older than this is a crashed request: the next tap may finish it (same idempotency key). */
const STALE_CLAIM_MS = 2 * 60_000;

async function paidStart(ctx: PaidCtx): Promise<Response> {
  if (verifiedEitherWay(ctx.profile)) return ctx.reply(200, { alreadyVerified: true });
  const { data: rows, error: readErr } = await ctx.admin
    .from("idv_fee_payments")
    .select("id, status, stripe_verification_session_id, stripe_payment_intent_id, stripe_livemode, updated_at")
    .eq("user_id", ctx.user.id)
    .in("status", ["paid", "starting", "session_started"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (readErr || !Array.isArray(rows)) {
    console.error("[stripe-idv-start] idv_fee_payments read failed:", readErr?.message);
    return ctx.reply(503, { error: "We couldn't start your ID check just now. Please try again." });
  }
  const row = rows[0] as
    | { id: string; status: string; stripe_verification_session_id: string | null; stripe_payment_intent_id: string | null; stripe_livemode: boolean; updated_at: string }
    | undefined;
  // No webhook-confirmed payment: no session. This is the ordering rule.
  if (!row) return needsFee(ctx, `Verify your ID: photo ID + selfie, ${IDV_FEE_TEXT}. Pay first, then the check opens.`);
  const stripe = stripeFor(row.stripe_livemode ? "live" : "test");
  const now = () => new Date().toISOString();

  if (row.status === "session_started" && row.stripe_verification_session_id) {
    const vs = await stripe.identity.verificationSessions.retrieve(row.stripe_verification_session_id);
    if (vs.status === "verified") return ctx.reply(200, { alreadyVerified: true });
    if (vs.status === "processing") return ctx.reply(200, { processing: true });
    if (vs.status === "requires_input" && !vs.last_error) {
      // Never submitted: Stripe has billed nothing, so the same session resumes.
      if (vs.url) return ctx.reply(200, { url: vs.url, sessionId: vs.id });
      return ctx.reply(503, { error: "We couldn't reopen your ID check just now. Please try again in a moment." });
    }
    // A completed (failed) or canceled check used the payment up.
    const { data: used, error: useErr } = await ctx.admin
      .from("idv_fee_payments")
      .update({ status: "used", updated_at: now() })
      .eq("id", row.id)
      .eq("status", "session_started")
      .select("id");
    if (useErr || !Array.isArray(used) || used.length === 0) {
      // Selling the next check while this row still reads as live would leave
      // the landlord stuck between "already paid" and "pay again".
      await postSlackOpsAlert({
        kind: "custom",
        severity: "warning",
        title: "Used ID check not recorded",
        message: "A paid ID check finished (failed or canceled) but idv_fee_payments did not move to used, so the landlord cannot buy the next one. Set it to used by hand.",
        fields: { payment_id: row.id, session: row.stripe_verification_session_id, error: String(useErr?.message ?? "0 rows").slice(0, 200) },
      });
      return ctx.reply(503, { error: "We couldn't update your ID check just now. Please try again in a few minutes." });
    }
    return needsFee(ctx, `That ID check didn't go through. Another try is a new check: ${IDV_FEE_TEXT}.`);
  }

  // CLAIM the paid row before Stripe is called: only the request that moves it
  // 'paid' -> 'starting' creates the session, so a double tap cannot race a
  // refund against a live session. A stale 'starting' (a crashed request) is
  // re-claimed and finished with the SAME idempotency key, so Stripe hands back
  // the session it already made instead of a second one.
  const fresh = row.status === "starting" && Date.now() - Date.parse(row.updated_at) < STALE_CLAIM_MS;
  if (fresh) return ctx.reply(409, { error: "Your ID check is opening. Give it a few seconds and tap again." });
  const { data: claimed, error: claimErr } = await ctx.admin
    .from("idv_fee_payments")
    .update({ status: "starting", updated_at: now() })
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("updated_at", row.updated_at)
    .select("id");
  if (claimErr) {
    console.error("[stripe-idv-start] could not claim idv payment:", claimErr.message);
    return ctx.reply(503, { error: "We couldn't start your ID check just now. Please try again." });
  }
  if (!Array.isArray(claimed) || claimed.length === 0) {
    return ctx.reply(409, { error: "Your ID check is opening. Give it a few seconds and tap again." });
  }

  let session: Stripe.Identity.VerificationSession;
  try {
    // Everything here is fixed per payment (no name, no platform-specific URL
    // beyond the caller's), so a re-claim replays the same request.
    session = await stripe.identity.verificationSessions.create({
      type: "document",
      provided_details: { email: ctx.user.email ?? undefined },
      metadata: { user_id: ctx.user.id, idv_fee_payment_id: row.id },
      options: {
        document: {
          require_matching_selfie: true,
          require_live_capture: true,
          allowed_types: ["driving_license", "passport", "id_card"],
        },
      },
      return_url: buildRedirectUrl("/rentals?idv=complete", ctx.isNative),
    }, { idempotencyKey: `idv-fee:${row.id}` });
  } catch (err) {
    if (isIdempotencyRefusal(err)) {
      // Not our failure to start: the key is busy or was first used from the
      // other platform. The claim stays; ops finishes it by hand if it sticks.
      await postSlackOpsAlert({
        kind: "custom",
        severity: "warning",
        title: "Paid ID check stuck on its idempotency key",
        message: "Stripe refused the paid ID check's session create as an idempotency conflict. Not refunded. Check the payment's session in Stripe.",
        fields: { payment_id: row.id, error: String((err as Error)?.message ?? err).slice(0, 200) },
      });
      return ctx.reply(409, { error: "Your ID check is opening. Give it a few seconds and tap again." });
    }
    // Our side failed to start what they paid for: full refund.
    console.error("[stripe-idv-start] paid session create failed; refunding:", (err as Error)?.message);
    return await refundInFull(ctx, stripe, row, String((err as Error)?.message ?? err).slice(0, 120));
  }

  const { data: moved, error: moveErr } = await ctx.admin
    .from("idv_fee_payments")
    .update({ status: "session_started", stripe_verification_session_id: session.id, updated_at: now() })
    .eq("id", row.id)
    .eq("status", "starting")
    .select("id");
  if (moveErr || !Array.isArray(moved) || moved.length === 0) {
    // The session exists and is theirs; the ledger lags. The webhook still
    // closes it out by metadata.idv_fee_payment_id; page so it is checked.
    await postSlackOpsAlert({
      kind: "custom",
      severity: "warning",
      title: "Paid ID check session not recorded",
      message: "A VerificationSession was created for a paid ID check but idv_fee_payments did not move to session_started.",
      fields: { payment_id: row.id, session: session.id, error: String(moveErr?.message ?? "0 rows").slice(0, 200) },
    });
  }
  return ctx.reply(200, { url: session.url, sessionId: session.id });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // First of two guards, and the broader one. It is now durable and keyed to
  // the caller's JWT subject (20260902035752) rather than the in-process,
  // header-keyed Map it used to be — that Map reset on every cold start and let
  // a caller pick its own bucket, so this comment used to describe a cap that
  // was never applied to anybody.
  //
  // 10/min, raised from 3 for the same reason: the number is enforced now, and
  // 3 is inside normal use. `IDVPromptDialog` chains
  // `start → 402 needsOnboardingFee → pay the fee → start again`, which spends
  // two legitimately, and one user retry after a Stripe hiccup spends the third.
  //
  // The BILLING cap is unchanged and is the one that matters: `claim_idv_attempt`
  // below (20260827193414 / 20260829031405), which is durable, keyed to the
  // user, and allows exactly one paid attempt before manual review. This just
  // keeps a burst from reaching it.
  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 10,
    keyPrefix: "stripe-idv-start",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  // Expected, user-facing refusals carry their own status and a human message.
  // Everything here used to 500 with a raw error string, so a user who simply
  // owed the setup fee saw "Edge Function returned a non-2xx status code".
  const fail = (status: number, message: string, extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ error: message, ...extra }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });

  try {
    // Read once: native callers get a return URL the app can intercept.
    const body = await req.json().catch(() => ({}));
    const isNative = isNativeRequest(body);
    // Only PostJob's IDVPromptDialog sends "job_post". The Profile row
    // (VerificationStatusRow) mounts the same dialog but deliberately sends no
    // context, so it keeps the fee gate — see
    // 20260829090211_idv_job_post_skips_fee_gate.sql for why that context is
    // allowed to skip the pre-paid-fee requirement.
    const skipFeeGate = (body as { context?: string })?.context === "job_post";
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? ""
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail(401, "Please sign in first.");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabaseClient.auth.getUser(token);
    const user = userData.user;
    if (!user) return fail(401, "Your session expired — sign in again.");
    // Q837: an unconfirmed-email caller is refused here, as Q807 refuses at
    // the table (that gate cannot see the caller behind a service-role write).
    const unconfirmedEmail = refuseUnconfirmedEmail(user, corsHeaders);
    if (unconfirmedEmail) return unconfirmedEmail;

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      // NO `role`: `profiles.role` was DROPPED when accounts were unified
      // (2026-05, see migrations 20260504142454 / 20260505230500) — this app
      // has no poster/helper roles, and admin lives in `user_roles`. Selecting
      // it made PostgREST 400 the whole SELECT, which tripped the profileErr
      // guard below and 500'd the function on EVERY attempt. The user saw
      // "Edge Function returned a non-2xx status code" and identity
      // verification was completely dead.
      .select("idv_status, idv_session_id, full_name, stripe_identity_verified, ban_status")
      .eq("user_id", user.id)
      .maybeSingle();

    // A dropped error here silently bypasses the "already verified" guard below
    // and — critically — can overwrite idv_status:"verified" with "pending" if
    // the SELECT fails but the subsequent UPDATE succeeds (brief DB read fault).
    if (profileErr) {
      throw new Error("Could not load your account right now. Please try again.");
    }

    // The paid ID check (see the top of this file). Legacy idv_status values
    // ('pending' from the old upload flag, 'manual_review', 'failed') never
    // block it: only a verdict does.
    const action = (body as { action?: unknown })?.action;
    if (action === "checkout" || action === "start") {
      // A restricted account is not sold a check (claim_idv_attempt's rule).
      const ban = (profile as { ban_status?: string | null } | null)?.ban_status;
      if (ban === "temp_banned" || ban === "permanently_banned") {
        return fail(403, "This account can't start verification right now.");
      }
      const ctx: PaidCtx = {
        user: { id: user.id, email: user.email },
        profile: profile ?? null,
        admin: supabaseAdmin,
        isNative,
        reply: (status, payload) =>
          new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status }),
      };
      try {
        return action === "checkout" ? await paidCheckout(ctx) : await paidStart(ctx);
      } catch (err) {
        if (err instanceof StripeModeRefused) return stripeModeRefusedResponse(err, corsHeaders);
        throw err;
      }
    }

    // Already verified — short-circuit
    if (profile?.idv_status === "verified") {
      return new Response(JSON.stringify({ alreadyVerified: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Reuse existing pending session if it exists and is still usable
    if (profile?.idv_session_id && (profile.idv_status === "processing" || profile.idv_status === "pending")) {
      try {
        const existing = await stripe.identity.verificationSessions.retrieve(profile.idv_session_id);
        if (existing.status === "requires_input" && existing.url) {
          return new Response(JSON.stringify({ url: existing.url, sessionId: existing.id }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        }
      } catch (_e) {
        // fall through to create a new session
      }
    }

    // ── COST GATE ──────────────────────────────────────────────────────────
    // Everything past this line spends platform money: Stripe bills the
    // platform for each VerificationSession. Nothing above it does — the reuse
    // path returns an EXISTING session's URL and is free, which is why the
    // claim sits here and not at the top: reusing a session must not burn an
    // attempt.
    //
    // The claim is atomic (single conditional UPDATE), so concurrent calls
    // cannot both take the last attempt, and it is durable, so a cold start
    // cannot reset it. It also enforces that the account has settled the $2
    // "identity verification & account setup fee" that pays for this, is not
    // banned, and has attempts left.
    const { data: claimRaw, error: claimErr } = await supabaseAdmin.rpc("claim_idv_attempt", {
      p_user_id: user.id,
      p_skip_fee_gate: skipFeeGate,
    });
    if (claimErr) {
      // Fail CLOSED. An unreadable claim is not permission to spend.
      console.error("[stripe-idv-start] claim_idv_attempt failed:", claimErr.message);
      return fail(503, "We couldn't start verification just now. Please try again in a moment.");
    }
    const claim = (claimRaw ?? {}) as {
      claimed?: boolean;
      reason?: string | null;
      attempt?: number;
      max_attempts?: number;
    };
    if (!claim.claimed) {
      switch (claim.reason) {
        case "already_verified":
          return new Response(JSON.stringify({ alreadyVerified: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        case "onboarding_fee_unpaid": {
          // The one refusal with a way out, so it says so explicitly and the
          // client turns `needsOnboardingFee` into a pay-now button. The amount
          // is read from platform_settings like every other path that quotes
          // it (pay-onboarding-fee, the Terms page) — this string carried a
          // hard-coded "$2" that would have gone stale the day the setting
          // changed. Read failure just drops the number; the refusal stands.
          const { data: feeRow } = await supabaseAdmin
            .from("platform_settings")
            .select("onboarding_fee_cents")
            .limit(1)
            .maybeSingle();
          const feeCents = Number(feeRow?.onboarding_fee_cents);
          const feeText = Number.isFinite(feeCents) && feeCents > 0
            ? ` — it's the same $${(feeCents / 100).toFixed(feeCents % 100 === 0 ? 0 : 2)} you'd otherwise pay on your first job post or first payout, never both`
            : " — it's the same fee you'd otherwise pay on your first job post or first payout, never both";
          return fail(
            402,
            `Your one-time account setup fee covers this check. Settle it and verification opens up${feeText}.`,
            { needsOnboardingFee: true },
          );
        }
        case "attempt_limit_reached":
        case "in_manual_review":
          // Not a dead end and not a "get in touch": the account is already in
          // the admin identity review queue, and the only thing the person has
          // to do is wait. Saying anything else invites them to hunt for a
          // retry that deliberately does not exist.
          return fail(
            429,
            "Your ID check is with our team now. We review these by hand and email you as soon as it's done — usually within 24 hours.",
            { attemptLimitReached: true, inManualReview: true },
          );
        case "account_restricted":
          return fail(403, "This account can't start verification right now.");
        case "attempt_race_lost":
          return fail(409, "A verification is already starting — give it a second and refresh.");
        case "profile_not_found":
          return fail(404, "We couldn't find your account.");
        default:
          return fail(503, "We couldn't start verification just now. Please try again.");
      }
    }

    const session = await stripe.identity.verificationSessions.create({
      type: "document",
      provided_details: { email: user.email ?? undefined },
      metadata: {
        user_id: user.id,
        full_name: profile?.full_name ?? "",
      },
      options: {
        document: {
          require_matching_selfie: true,
          require_live_capture: true,
          allowed_types: ["driving_license", "passport", "id_card"],
        },
      },
      return_url: buildRedirectUrl(`/profile?idv=complete`, isNative),
    }, {
      // Keyed on the claimed attempt number, so a retry of THIS request (a
      // dropped response, a native handoff that bounced) reuses the same
      // session instead of billing for a second one. A genuinely new attempt
      // carries a new number and so gets a new session.
      idempotencyKey: `idv:${user.id}:${claim.attempt}`,
    });

    // `idv_status` and `idv_attempted_at` were already set by the claim above;
    // only the session id is left, and it matters more than it used to. Without
    // it the reuse guard is blind, so the user's NEXT tap creates a second
    // billable session — which now also burns a second attempt. Logged rather
    // than thrown because the money is already spent and the IDV webhook still
    // resolves the final status from metadata.user_id.
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ idv_session_id: session.id } as any)
      .eq("user_id", user.id);
    if (updateErr) {
      console.error("[stripe-idv-start] Failed to store IDV session on profile:", updateErr);
    }

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("stripe-idv-start error:", err);
    // Generic client-safe message; detail is logged above (EF-5, 2026-09-15).
    return new Response(JSON.stringify({ error: "We couldn't start identity verification right now. Please try again." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
