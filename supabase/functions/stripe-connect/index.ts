import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { safeReturnUrl } from "../_shared/appUrl.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { stripeIdentityVerified } from "../_shared/stripeIdentity.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 401,
    });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
  );

  try {
    const token = authHeader.replace("Bearer ", "");
    const { data, error: authError } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (authError || !user?.email) throw new Error("Not authenticated");

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const body = await req.json();
    const { action } = body;

    // Helper: get or create Connect account
    const getOrCreateAccount = async () => {
      const { data: profile, error: profileReadErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id, full_name, phone, date_of_birth, location")
        .eq("user_id", user.id)
        .single();

      if (profileReadErr) {
        // A DB error here is indistinguishable from "no profile" — profile is
        // null in both cases. Without this check, a transient DB failure causes
        // accountId to be undefined, which triggers account creation. After the
        // idempotency key expires (>24h), repeated DB failures would create
        // orphaned Express accounts and overwrite stripe_account_id.
        console.error(`[stripe-connect] getOrCreateAccount profile read failed for ${user.id}:`, profileReadErr);
        throw new Error("Could not load your profile — please try again");
      }

      let accountId = profile?.stripe_account_id;

      if (!accountId) {
        const nameParts = (profile?.full_name || "").trim().split(/\s+/);
        const firstName = nameParts[0] || undefined;
        const lastName = nameParts.slice(1).join(" ") || undefined;

        let dob: { day: number; month: number; year: number } | undefined;
        if (profile?.date_of_birth) {
          const d = new Date(profile.date_of_birth);
          dob = { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
        }

        // Idempotency keyed on the Helpr user id: if the function crashes
        // between this call and the profiles.update below, a retry returns
        // the SAME Stripe account instead of creating an orphan. Without
        // this, every crashed retry left a dangling Express account on
        // Stripe that no Helpr user pointed to.
        const account = await stripe.accounts.create({
          type: "express",
          country: "US",
          email: user.email,
          business_type: "individual",
          business_profile: {
            mcc: "7299",
            product_description: "Local job and errand services",
          },
          individual: {
            first_name: firstName,
            last_name: lastName,
            email: user.email,
            phone: profile?.phone || undefined,
            dob,
          },
          capabilities: {
            transfers: { requested: true },
          },
          // `daily`, not `manual`. `manual` left every free-tier helper with
          // no path from their Connect balance to their bank at all — the
          // only payout call anywhere in this codebase is Instant Payout,
          // which is gated to paid tiers, so a free helper's earnings just
          // sat in their Stripe balance forever. `daily` gives everyone an
          // automatic sweep, and it does not conflict with Instant Payout:
          // that call still pays out on demand from whatever balance has
          // already cleared, ahead of the next automatic cycle. Matches what
          // the Help Center already tells every helper ("transfers to your
          // bank within 2 business days... every standard payout after that
          // is free") — that copy described a schedule that never existed.
          settings: {
            payouts: { schedule: { interval: "daily" } },
          },
          metadata: { user_id: user.id },
        }, { idempotencyKey: `stripe-connect-create-${user.id}` });
        accountId = account.id;

        const { error: profileUpdateErr } = await supabaseAdmin
          .from("profiles")
          .update({ stripe_account_id: accountId })
          .eq("user_id", user.id);
        if (profileUpdateErr) {
          console.error(`[stripe-connect] Failed to save stripe_account_id for user ${user.id}:`, profileUpdateErr);
          throw new Error("Could not link your payout account — please try again");
        }
      }

      return { accountId, profile };
    };

    /**
     * Which requirement set the Account Link should collect.
     *
     * DEFAULT `currently_due` — the minimum Stripe needs to start paying out.
     *
     * `eventually_due` is requested by the acceptance gate's "finish
     * verification" CTA, and it is not a nicety. The identity verdict
     * (_shared/stripeIdentity.ts) is only TRUE when NOTHING identity-shaped is
     * outstanding in ANY bucket — `eventually_due` and `future_requirements`
     * included. A `currently_due`-only link therefore cannot clear that gate:
     * the helper completes Stripe's flow, comes back, and is still blocked,
     * forever. Collecting `eventually_due` is what makes the blocked state
     * escapable, so the two must stay in step.
     */
    const collectionOptions = (collect?: string) =>
      collect === "eventually_due"
        ? { fields: "eventually_due" as const, future_requirements: "include" as const }
        : { fields: "currently_due" as const, future_requirements: "omit" as const };

    // ─── ONBOARD: Create account + return Account Link URL ───
    if (action === "onboard") {
      const { return_url, collect } = body;
      const { accountId } = await getOrCreateAccount();

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: safeReturnUrl(return_url),
        return_url: safeReturnUrl(return_url),
        type: "account_onboarding",
        collection_options: collectionOptions(collect),
      });

      return new Response(JSON.stringify({ success: true, url: accountLink.url, account_id: accountId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── LIST PAYOUT METHODS ───
    if (action === "list_payout_methods") {
      const { data: profile, error: profileReadErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      if (profileReadErr) throw new Error("Could not load your profile — please try again");

      if (!profile?.stripe_account_id) {
        return new Response(JSON.stringify({ methods: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      const accounts = await stripe.accounts.listExternalAccounts(profile.stripe_account_id, { limit: 10 });

      const methods = accounts.data.map((m: any) => ({
        id: m.id,
        type: m.object,
        last4: m.last4,
        bank_name: m.bank_name || null,
        brand: m.brand || null,
        default_for_currency: m.default_for_currency,
      }));

      return new Response(JSON.stringify({ methods }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── DELETE PAYOUT METHOD ───
    if (action === "delete_payout_method") {
      const { method_id } = body;
      if (!method_id) throw new Error("Missing method_id");

      const { data: profile, error: profileReadErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      if (profileReadErr) throw new Error("Could not load your profile — please try again");
      if (!profile?.stripe_account_id) throw new Error("No account connected");

      await stripe.accounts.deleteExternalAccount(profile.stripe_account_id, method_id);

      // Security alert: removing a payout method is a sensitive action.
      // Log an in-app notification so the helpr can spot account takeover
      // attempts. Stripe's hosted onboarding handles 2FA + email confirm
      // for ADDING a new method, so this closes the loop on removals.
      //
      // NOT a try/catch. PostgREST does not THROW on a database error — it
      // resolves with `{ data, error }` — so wrapping this in `try/catch` and
      // discarding the result made the catch unreachable and the failure
      // completely silent, which is the exact opposite of what the comment
      // above it claimed. Read the error off the result, and treat a zero-row
      // insert the same way: this is the user's only signal that a payout
      // destination changed on their account, so a dropped one hides exactly
      // the event an account takeover would produce. It must not block the
      // removal itself, which has already happened at Stripe.
      const { data: notifRows, error: notifyErr } = await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: user.id,
          title: "Payout method removed",
          message:
            "A payout method was just removed from your account. If this wasn't you, contact support immediately.",
          type: "financial_alerts",
          link: "/profile?tab=payment",
        })
        .select("id");
      if (notifyErr || (notifRows?.length ?? 0) === 0) {
        console.error(
          `[stripe-connect] FAILED to send 'payout method removed' security notification to ${user.id} — user was NOT warned:`,
          notifyErr?.message ?? "insert returned zero rows",
        );
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── CHECK ACCOUNT STATUS ───
    if (action === "status") {
      const { data: profile, error: profileReadErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      if (profileReadErr) throw new Error("Could not load your profile — please try again");

      if (!profile?.stripe_account_id) {
        return new Response(JSON.stringify({ connected: false, details_submitted: false, payouts_enabled: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      const account = await stripe.accounts.retrieve(profile.stripe_account_id);
      const transfersCapability = account.capabilities?.transfers;

      // Re-sync the cached gate columns from this live read.
      //
      // The acceptance gate (migration 20260827191647) is enforced in Postgres
      // against `profiles.stripe_payouts_enabled` / `stripe_identity_verified`,
      // which are normally written by the `account.updated` webhook. Those
      // columns default FALSE with no backfill, so a helper who onboarded
      // BEFORE they existed — and has had no Connect event since — would be
      // blocked by a cache that is merely empty rather than by anything Stripe
      // actually says.
      //
      // This write-back makes that self-healing instead of requiring a bulk job
      // against live Stripe: the client re-runs `status` on the very attempt
      // that is about to be blocked, so a stale cache corrects itself on the
      // first try. It costs no extra Stripe call — the account is already
      // retrieved above — and it can only ever move the columns towards what
      // Stripe currently reports.
      //
      // Failure is logged, not thrown: the caller asked for a status, and the
      // stale value it replaces is the conservative one (gate stays closed).
      const { error: cacheErr } = await supabaseAdmin
        .from("profiles")
        .update({
          stripe_charges_enabled: account.charges_enabled === true,
          stripe_payouts_enabled: account.payouts_enabled === true,
          stripe_identity_verified: stripeIdentityVerified(account),
          ...(stripeIdentityVerified(account)
            ? { stripe_identity_verified_at: new Date().toISOString() }
            : {}),
        })
        .eq("user_id", user.id);
      if (cacheErr) {
        console.error(`[stripe-connect] status cache write-back failed for ${user.id}:`, cacheErr);
      }

      return new Response(JSON.stringify({
        connected: true,
        details_submitted: account.details_submitted ?? false,
        payouts_enabled: account.payouts_enabled ?? false,
        charges_enabled: account.charges_enabled,
        // Stripe's identity verdict, computed from the requirements ledger —
        // NOT payouts_enabled, which Stripe grants during a grace window and
        // enforces identity on later (_shared/stripeIdentity.ts pins two live
        // accounts that had payouts_enabled while unverified). Returned so the
        // client can explain the acceptance gate from the same read that
        // refreshed the server's cache, instead of a second, divergent query.
        identity_verified: stripeIdentityVerified(account),
        transfers_status: transfersCapability || "inactive",
        requirements: account.requirements?.currently_due || [],
        account_id: account.id,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── DASHBOARD: Manage payout account ───
    if (action === "dashboard") {
      const { return_url } = body;
      const { data: profile, error: profileReadErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      if (profileReadErr) throw new Error("Could not load your profile — please try again");
      if (!profile?.stripe_account_id) {
        throw new Error("No payout account connected. Please set up your payout account first.");
      }

      // Sync email to Stripe account before redirecting
      await stripe.accounts.update(profile.stripe_account_id, {
        email: user.email,
        individual: { email: user.email },
      });

      const account = await stripe.accounts.retrieve(profile.stripe_account_id);

      if (account.type === "express") {
        const loginLink = await stripe.accounts.createLoginLink(profile.stripe_account_id);
        return new Response(JSON.stringify({ url: loginLink.url }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      } else {
        const accountLink = await stripe.accountLinks.create({
          account: profile.stripe_account_id,
          refresh_url: safeReturnUrl(return_url),
          return_url: safeReturnUrl(return_url),
          type: "account_onboarding",
          collection_options: {
            fields: "currently_due",
            future_requirements: "omit",
          },
        });
        return new Response(JSON.stringify({ url: accountLink.url }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
    }

    // ─── RESET: Delete old account and create fresh Express one ───
    if (action === "reset") {
      const { return_url } = body;
      const { data: profile, error: profileReadErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      // A DB error here is dangerous: profile would be null, causing the code
      // to skip deletion of the real account, null out stripe_account_id, and
      // orphan the existing Express account with a brand new one.
      if (profileReadErr) throw new Error("Could not load your profile — please try again");

      if (profile?.stripe_account_id) {
        try {
          await stripe.accounts.del(profile.stripe_account_id);
        } catch (e) {
          // A failed delete used to be swallowed with `console.log` and the
          // reset carried on regardless — nulling `stripe_account_id` and
          // minting a fresh account underneath it. That is how a helper's
          // money gets stranded: Stripe REFUSES to delete a connected account
          // that still holds a balance, so the exact helper most harmed by a
          // reset (one with funds waiting to pay out) was the one whose old
          // account got orphaned while their profile was re-pointed at an
          // empty new one. Nothing in the app can reach the old account
          // afterwards, and nothing sweeps for it.
          //
          // Only "it is already gone" is a safe reason to continue — that is
          // precisely the stale-link state reset exists to clear. Anything
          // else aborts BEFORE the link is nulled, so the profile keeps
          // pointing at the account that holds the money.
          const err = e as { statusCode?: number; code?: string; message?: string };
          const alreadyGone =
            err.statusCode === 404 ||
            err.code === "resource_missing" ||
            err.code === "account_invalid" ||
            (err.message ?? "").includes("No such account");
          if (!alreadyGone) {
            console.error(
              `[stripe-connect] reset ABORTED for ${user.id}: could not delete Connect account ${profile.stripe_account_id} — link left intact so any balance stays reachable:`,
              err.message,
            );
            return new Response(
              JSON.stringify({
                error:
                  "We couldn't reset your payout account — Stripe still has activity on it (this usually means money is waiting to pay out). Nothing was changed. Contact support and we'll sort it out.",
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
            );
          }
          console.warn(
            `[stripe-connect] reset: Connect account ${profile.stripe_account_id} was already gone at Stripe; clearing the stale link.`,
          );
        }
      }

      const { error: resetUpdateErr } = await supabaseAdmin
        .from("profiles")
        .update({ stripe_account_id: null })
        .eq("user_id", user.id);

      if (resetUpdateErr) {
        // The Stripe account was already deleted above. If we can't null out
        // stripe_account_id, getOrCreateAccount() will find the stale (deleted)
        // account ID, return it without creating a new one, and the subsequent
        // accountLinks.create() will 404. Throw so the client can retry cleanly.
        console.error(`[stripe-connect] reset: failed to null stripe_account_id for ${user.id}:`, resetUpdateErr);
        throw new Error("Could not unlink your current payout account — please try again");
      }

      const { accountId } = await getOrCreateAccount();

      // Security alert: resetting the payout account deletes all saved bank
      // accounts and pending payout configuration — more destructive than
      // removing a single payout method. Mirrors the notification in
      // delete_payout_method so account takeover attempts are visible.
      //
      // Same correction as delete_payout_method above: PostgREST resolves with
      // `{ error }` rather than throwing, so the try/catch this replaces could
      // never fire and the failure was silent. Must not block the reset, which
      // has already happened.
      const { data: resetNotifRows, error: resetNotifyErr } = await supabaseAdmin
        .from("notifications")
        .insert({
          user_id: user.id,
          title: "Payout account reset",
          message:
            "Your payout account was reset and a new one created. If this wasn't you, contact support immediately.",
          type: "financial_alerts",
          link: "/profile?tab=payment",
        })
        .select("id");
      if (resetNotifyErr || (resetNotifRows?.length ?? 0) === 0) {
        console.error(
          `[stripe-connect] FAILED to send 'payout account reset' security notification to ${user.id} — user was NOT warned:`,
          resetNotifyErr?.message ?? "insert returned zero rows",
        );
      }

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: safeReturnUrl(return_url),
        return_url: safeReturnUrl(return_url),
        type: "account_onboarding",
        collection_options: {
          fields: "currently_due",
          future_requirements: "omit",
        },
      });

      return new Response(JSON.stringify({ success: true, url: accountLink.url, account_id: accountId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── UPDATE ONBOARDING: Return new Account Link for incomplete accounts ───
    if (action === "update_onboarding") {
      const { return_url, collect } = body;
      const { data: profile, error: profileReadErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      if (profileReadErr) throw new Error("Could not load your profile — please try again");
      if (!profile?.stripe_account_id) throw new Error("No account connected");

      const accountLink = await stripe.accountLinks.create({
        account: profile.stripe_account_id,
        refresh_url: safeReturnUrl(return_url),
        return_url: safeReturnUrl(return_url),
        type: "account_onboarding",
        collection_options: collectionOptions(collect),
      });

      return new Response(JSON.stringify({ url: accountLink.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    throw new Error("Invalid action");
  } catch (error) {
    // Log the full error so Supabase Edge Function logs surface a real
    // diagnosis (the log api only shows status codes, not response bodies,
    // so without console.error every 500 is opaque). Hundreds of v6 500s
    // were stacking up undiagnosed before this was added.
    const err = error as Error & { type?: string; code?: string; statusCode?: number };
    console.error("[stripe-connect] 500 — full error:", {
      message: err.message,
      stripe_type: err.type,
      stripe_code: err.code,
      stripe_status: err.statusCode,
      stack: err.stack?.split("\n").slice(0, 5).join("\n"),
    });

    // Stale stripe_account_id is a common 500 cause: profile points to a
    // Stripe account that was deleted (manual cleanup, test-mode purge,
    // etc.) so stripe.accounts.retrieve / update / del all 404. Clear the
    // stale link and surface a friendly retry message — next call will
    // create a fresh account.
    const isStaleAccountErr =
      err.statusCode === 404 ||
      err.message?.includes("No such account") ||
      err.code === "account_invalid" ||
      err.code === "resource_missing";

    if (isStaleAccountErr) {
      try {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
        const { data: u } = await supabaseClient.auth.getUser(token);
        if (u?.user?.id) {
          await supabaseAdmin.from("profiles").update({ stripe_account_id: null }).eq("user_id", u.user.id);
          console.error("[stripe-connect] Cleared stale stripe_account_id for user", u.user.id);
        }
      } catch (clearErr) {
        console.error("[stripe-connect] Failed to clear stale stripe_account_id:", clearErr);
      }
      return new Response(JSON.stringify({
        error: "Your previous payout account is no longer valid. Tap Connect again to set up a fresh one.",
        recoverable: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
    }

    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
