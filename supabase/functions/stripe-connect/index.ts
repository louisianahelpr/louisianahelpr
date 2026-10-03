import { serve } from "../_shared/buildStamp.ts";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import { safeReturnUrl } from "../_shared/appUrl.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { stripeIdentityVerified } from "../_shared/stripeIdentity.ts";
import { isUnusableConnectAccountError } from "../_shared/stripeAccountUsable.ts";
import { insertNotifications } from "../_shared/insertNotifications.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";

/** Q863: clears recorded in the last hour before stripe-connect stops clearing. */
const STALE_CLEAR_HOURLY_CAP = 5;
const STALE_CLEAR_KIND = "stale-clear";

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

  // Hoisted so the catch below can confirm and clear an unusable Connect
  // account for the SAME authenticated caller with the SAME Stripe client,
  // without re-deriving either (Q859).
  let callerId: string | null = null;
  let stripeClient: Stripe | null = null;

  /**
   * Q859 (5) — only an ACCOUNT-SCOPED answer may clear a payout account.
   *
   * A 404 / `resource_missing` names whichever resource was missing, not the
   * Connect account: `delete_payout_method` on a method that is already gone
   * (a double tap) 404s on the EXTERNAL ACCOUNT while the Connect account is
   * perfectly healthy, and the old catch nulled that valid live
   * `stripe_account_id` — stranding the helper's balance behind an id nothing
   * pointed at any more. So a candidate error from ANY call is re-asked of the
   * one call that is about the account and nothing else,
   * `stripe.accounts.retrieve(<the id on file>)`, and the link is cleared only
   * when THAT answer says the account itself is unusable. Anything else
   * (retrieve succeeds, or fails some other way) clears nothing.
   *
   * Q859 (2) — the cached gate columns go with the id. They are written only
   * from this Connect account (stripe-connect `status` and the
   * `account.updated` webhook, both via `stripeIdentityVerified(account)` /
   * `charges_enabled` / `payouts_enabled`), so an id-less profile still
   * reading payouts_enabled=true describes an account it no longer has.
   * `stripe_identity_verified` included for the same reason: it is computed
   * from this account's requirements ledger, never from Stripe Identity
   * sessions (those are `idv_status`, left untouched).
   *
   * Q859 (3) — the clear is checked: `.select("id")` + error + row count. The
   * `.eq("stripe_account_id", accountId)` scopes it to the exact id just
   * confirmed unusable, so a concurrent reset/onboard that already replaced
   * it is not undone; that case, like an error, reports "failed" so the
   * caller is not told an account was reset when nothing was cleared.
   */
  const confirmAndClearUnusableAccount = async (
    userId: string,
    stripe: Stripe,
  ): Promise<"cleared" | "account-usable" | "failed"> => {
    const { data: onFile, error: readErr } = await supabaseAdmin
      .from("profiles")
      .select("stripe_account_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr) {
      console.error(`[stripe-connect] stale-account check: profile read failed for ${userId}:`, readErr);
      return "failed";
    }
    const accountId = onFile?.stripe_account_id;
    if (!accountId) return "account-usable";

    try {
      await stripe.accounts.retrieve(accountId);
      return "account-usable";
    } catch (probeErr) {
      if (!isUnusableConnectAccountError(probeErr)) {
        console.error(
          `[stripe-connect] stale-account check: could not confirm ${accountId} for ${userId}; link left intact:`,
          probeErr instanceof Error ? probeErr.message : probeErr,
        );
        return "account-usable";
      }
    }

    // Q863 — a circuit breaker on mass clears. If STRIPE_SECRET_KEY were ever
    // another platform's key, every accounts.retrieve would answer "No such
    // account" and each helper's next Payment-settings visit would confirm
    // and clear their own link: the confirm above cannot tell "this account
    // is gone" from "this key cannot see any of our accounts". A real clear
    // is rare (a deleted or sandbox account), so more than a handful in an
    // hour means the KEY is wrong, not the accounts. Every clear is recorded
    // in error_logs (tags.kind = 'stale-clear'); once STALE_CLEAR_HOURLY_CAP
    // are recorded in the last hour, further clears are refused ("failed",
    // nothing changes) and ops is paged. A failed count also refuses: this
    // check guards a destructive write, so it fails closed.
    // Only server-written rows count: error_logs takes inserts from anon and
    // authenticated clients (client error reporting), and a client keeps its
    // own tags.source/kind, so without this filter a signed-out visitor could
    // post five forged rows an hour and hold the breaker shut for everyone.
    // stamp_error_log_origin (BEFORE INSERT trigger) sets tags.origin to
    // 'server' only for non-client roles and overwrites it to 'client' for
    // anon/authenticated, so a client cannot claim it.
    // Not atomic: the count and the clear are separate statements, so
    // concurrent requests can overshoot the cap by however many run at once,
    // and a clear whose record insert fails (below) is not counted. Both are
    // accepted: this detects a wrong key, it is not an exact quota.
    const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentClears, error: countErr } = await supabaseAdmin
      .from("error_logs")
      .select("id", { count: "exact", head: true })
      .eq("tags->>source", "stripe-connect")
      .eq("tags->>kind", STALE_CLEAR_KIND)
      .eq("tags->>origin", "server")
      .gte("created_at", sinceIso);
    if (countErr || recentClears === null || recentClears === undefined) {
      console.error(
        `[stripe-connect] stale-account clear refused for ${userId} (${accountId}): could not count recent clears:`,
        countErr?.message ?? "count was null",
      );
      return "failed";
    }
    if (recentClears >= STALE_CLEAR_HOURLY_CAP) {
      console.error(
        `[stripe-connect] stale-account clear refused for ${userId} (${accountId}): ${recentClears} clears in the last hour (cap ${STALE_CLEAR_HOURLY_CAP})`,
      );
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "stripe-connect stopped clearing payout accounts",
        message:
          `${recentClears} payout-account links were cleared as unusable in the last hour (cap ${STALE_CLEAR_HOURLY_CAP}). ` +
          "That many usually means STRIPE_SECRET_KEY cannot see our Connect accounts (wrong platform or mode), " +
          "not that the accounts are gone. Further clears are refused until the hour rolls over. Check the key.",
        fields: { user_id: userId, account_id: accountId, clears_last_hour: recentClears },
        oncePerDayKey: "stripe-connect-stale-clear-cap",
      });
      return "failed";
    }

    const { data: clearedRows, error: clearErr } = await supabaseAdmin
      .from("profiles")
      .update({
        stripe_account_id: null,
        stripe_payouts_enabled: false,
        stripe_charges_enabled: false,
        stripe_identity_verified: false,
      })
      .eq("user_id", userId)
      .eq("stripe_account_id", accountId)
      .select("id");
    if (clearErr || (clearedRows?.length ?? 0) === 0) {
      console.error(
        `[stripe-connect] stale-account clear did NOT happen for ${userId} (${accountId}):`,
        clearErr?.message ?? "update matched zero rows (the id on file changed concurrently)",
      );
      return "failed";
    }
    console.error(`[stripe-connect] Cleared unusable stripe_account_id ${accountId} for user ${userId}`);
    // The breaker above counts these rows. Severity 'info': one clear is
    // correct behaviour, but it removes a helper's payout link, so it goes on
    // the record (the error_logs Slack and ledger triggers see it at info
    // cadence). A failed insert is logged, not thrown: the clear already
    // happened and is correct for this account.
    const { error: logErr } = await supabaseAdmin.from("error_logs").insert({
      user_id: userId,
      severity: "info",
      message: `stripe-connect cleared unusable payout account ${accountId}`,
      tags: { source: "stripe-connect", kind: STALE_CLEAR_KIND },
      context: { account_id: accountId },
    });
    if (logErr) {
      console.error(`[stripe-connect] could not record the stale-clear for ${userId}:`, logErr.message);
    }
    return "cleared";
  };

  try {
    const token = authHeader.replace("Bearer ", "");
    const { data, error: authError } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    // An invalid or expired session is the CALLER's problem: 401 tells the
    // client to sign in again. Throwing here fell to the generic catch below
    // and answered 500 "couldn't set up your payout account" (Q255).
    if (authError || !user?.email) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    // Q837: an unconfirmed-email caller is refused here, as Q807 refuses at
    // the table (that gate cannot see the caller behind a service-role write).
    const unconfirmedEmail = refuseUnconfirmedEmail(user, corsHeaders);
    if (unconfirmedEmail) return unconfirmedEmail;

    callerId = user.id;
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });
    stripeClient = stripe;

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
        const createParams = {
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
        } as const;
        // Q867 — Stripe replays the ORIGINAL response for a reused idempotency
        // key for 24h, even after that account was deleted or cleared. A reset
        // or a Q859 stale-account clear inside that window would get the dead
        // account back and re-link it, forever. So confirm the account the
        // create returned is usable; if it is not, it was a replay of a dead
        // account and the next attempt's key names that dead id, which a
        // replay can never return again. Bounded: three dead replays in a row
        // is not something retrying will fix.
        let idempotencyKey = `stripe-connect-create-${user.id}`;
        let account: { id: string } | null = null;
        for (let attempt = 0; attempt < 3 && !account; attempt++) {
          const created = await stripe.accounts.create(createParams, { idempotencyKey });
          let usable = true;
          try {
            const check = await stripe.accounts.retrieve(created.id) as { deleted?: boolean };
            if (check?.deleted === true) usable = false;
          } catch (checkErr) {
            if (!isUnusableConnectAccountError(checkErr)) throw checkErr;
            usable = false;
          }
          if (usable) {
            account = created;
          } else {
            console.error(
              `[stripe-connect] create for ${user.id} returned unusable account ${created.id} (idempotent replay of a dead account); re-keying`,
            );
            idempotencyKey = `stripe-connect-create-${user.id}-after-${created.id}`;
          }
        }
        if (!account) {
          throw new Error("Could not create your payout account — please try again later");
        }
        accountId = account.id;

        // Compare-and-set (Q868): link the new id only while the profile still
        // has none. A concurrent onboard or reset may have linked an account
        // since the read above, and an unscoped write would silently overwrite
        // that fresh link. `.select("id")` reads the rows back so a zero-row
        // write is seen rather than reported as linked.
        const { data: linkedRows, error: profileUpdateErr } = await supabaseAdmin
          .from("profiles")
          .update({ stripe_account_id: accountId })
          .eq("user_id", user.id)
          .is("stripe_account_id", null)
          .select("id");
        if (profileUpdateErr) {
          console.error(`[stripe-connect] Failed to save stripe_account_id for user ${user.id}:`, profileUpdateErr);
          throw new Error("Could not link your payout account — please try again");
        }
        if ((linkedRows?.length ?? 0) === 0) {
          // Another request linked an account first. Use the id now on file
          // instead of overwriting it. If there is none (or the re-read fails)
          // we cannot say which account is linked, so fail and let the client
          // retry.
          const { data: current, error: reReadErr } = await supabaseAdmin
            .from("profiles")
            .select("user_id, stripe_account_id")
            .eq("user_id", user.id)
            .maybeSingle();
          if (reReadErr || !current?.stripe_account_id) {
            console.error(
              `[stripe-connect] link of ${accountId} for ${user.id} matched zero rows and the re-read found no linked account:`,
              reReadErr,
            );
            throw new Error("Could not link your payout account — please try again");
          }
          if (current.stripe_account_id !== accountId) {
            console.error(
              `[stripe-connect] link of ${accountId} for ${user.id} lost to a concurrent link of ${current.stripe_account_id}; keeping the one on file (${accountId} is left unlinked at Stripe).`,
            );
          }
          accountId = current.stripe_account_id;
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

      // Q864 — a double tap is idempotent. The second delete 404s /
      // `resource_missing` on the EXTERNAL account, which the first tap already
      // removed. That error alone cannot say WHICH resource was missing (it is
      // also the shape of a gone Connect account), so the same account-scoped
      // probe Q859 uses decides: if `accounts.retrieve(<id on file>)` succeeds,
      // the account is healthy and the method is simply not on it any more —
      // the caller's goal is met, answer success. No second security
      // notification: the first tap already sent one for the real removal.
      // Anything else (the probe fails for any reason, or a different error)
      // rethrows the ORIGINAL error to the outer catch, which keeps Q859's
      // confirm-then-clear path for a genuinely unusable account.
      try {
        await stripe.accounts.deleteExternalAccount(profile.stripe_account_id, method_id);
      } catch (deleteErr) {
        const de = deleteErr as { statusCode?: number; code?: string };
        const methodMissing = de?.statusCode === 404 || de?.code === "resource_missing";
        if (!methodMissing) throw deleteErr;
        try {
          await stripe.accounts.retrieve(profile.stripe_account_id);
        } catch {
          // Probe failed: the account itself may be the missing resource, or
          // the probe hit a network/rate-limit error. Either way it is not
          // confirmed healthy, so the original error goes to the outer catch.
          throw deleteErr;
        }
        console.warn(
          `[stripe-connect] delete_payout_method: ${method_id} already gone from healthy account ${profile.stripe_account_id} for ${user.id}; answering success (idempotent).`,
        );
        return new Response(JSON.stringify({ success: true, already_removed: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

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
        .select("stripe_account_id, stripe_identity_verified, stripe_charges_enabled, stripe_payouts_enabled")
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
      //
      // Q862 — scoped to the id this call RETRIEVED, not just the user. A
      // status call that read the old account before a concurrent clear
      // (Q859 stale-account clear, or `reset`) would otherwise write
      // payouts_enabled=true back onto a profile that no longer has any
      // account. With the id in the WHERE clause that write matches zero rows,
      // which is the correct outcome, so zero rows is legitimate here and not
      // treated as a failure.
      //
      // Q873 — this is a compare-and-set on the flags just read, the same
      // transition CAS the account.updated webhook runs (Q870). Prod's live
      // webhook endpoint receives no Connect events (Q876, measured
      // 2026-10-02), so `status` is usually the ONLY writer that sees a helper
      // become payable; before this it moved the cache silently and the
      // helper never got the "Payout account verified" notice. Now the one
      // write that moves the cache INTO enabled sends it. Zero rows is still
      // legitimate (a concurrent writer — the webhook or a second `status` —
      // got there first and owns the notice, or the account was replaced).
      const nowCharges = account.charges_enabled === true;
      const nowPayouts = account.payouts_enabled === true;
      const wasEnabled = profile.stripe_charges_enabled === true && profile.stripe_payouts_enabled === true;
      const { data: cacheRows, error: cacheErr } = await supabaseAdmin
        .from("profiles")
        .update({
          stripe_charges_enabled: nowCharges,
          stripe_payouts_enabled: nowPayouts,
          stripe_identity_verified: stripeIdentityVerified(account),
          ...(stripeIdentityVerified(account)
            ? { stripe_identity_verified_at: new Date().toISOString() }
            : {}),
        })
        .eq("user_id", user.id)
        .eq("stripe_account_id", profile.stripe_account_id)
        .eq("stripe_identity_verified", profile.stripe_identity_verified === true)
        .eq("stripe_charges_enabled", profile.stripe_charges_enabled === true)
        .eq("stripe_payouts_enabled", profile.stripe_payouts_enabled === true)
        .select("id");
      if (cacheErr) {
        console.error(`[stripe-connect] status cache write-back failed for ${user.id}:`, cacheErr);
      } else if ((cacheRows?.length ?? 0) === 1 && nowCharges && nowPayouts && !wasEnabled) {
        // insertNotifications logs its own failure and returns false; the
        // status answer does not depend on the notice.
        await insertNotifications(supabaseAdmin, {
          user_id: user.id,
          title: "Payout account verified",
          message: "Your payout account is fully set up! You can now receive payments for completed jobs.",
          type: "success",
          link: "/profile?tab=payment",
        });
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

      // Q861 — reset clears the link the same way the Q859 stale-account clear
      // does: the cached gate columns go with the id (they describe the old
      // account, and an id-less profile reading payouts_enabled=true passes a
      // gate for an account it no longer has); the write is scoped to the id
      // this call just deleted, so a concurrent onboard/reset that already
      // replaced it is not undone; and it reads back its rows, so a zero-row
      // clear is not reported as a reset. With no id on file there is nothing
      // to scope to: the flags are reset only while the id is still null, and
      // zero rows there is legitimate (a concurrent onboard linked a new
      // account, which getOrCreateAccount below then picks up).
      const oldAccountId: string | null = profile?.stripe_account_id ?? null;
      const resetClear = supabaseAdmin
        .from("profiles")
        .update({
          stripe_account_id: null,
          stripe_payouts_enabled: false,
          stripe_charges_enabled: false,
          stripe_identity_verified: false,
        })
        .eq("user_id", user.id);
      const { data: resetRows, error: resetUpdateErr } = await (oldAccountId
        ? resetClear.eq("stripe_account_id", oldAccountId)
        : resetClear.is("stripe_account_id", null)
      ).select("id");

      if (!resetUpdateErr && oldAccountId && (resetRows?.length ?? 0) === 0) {
        console.error(
          `[stripe-connect] reset: clear of ${oldAccountId} for ${user.id} matched zero rows (the id on file changed concurrently)`,
        );
        throw new Error("Your payout account changed while resetting — please try again");
      }

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
    // etc.) or one from the other Stripe mode (a sandbox acct_ under the live
    // key: _shared/stripeAccountUsable.ts, #1582). The error only NOMINATES
    // the account; confirmAndClearUnusableAccount (above) confirms it with an
    // account-scoped retrieve before clearing anything (Q859).
    const isStaleAccountErr = isUnusableConnectAccountError(err);

    if (isStaleAccountErr) {
      let outcome: "cleared" | "account-usable" | "failed" = "failed";
      if (callerId && stripeClient) {
        try {
          outcome = await confirmAndClearUnusableAccount(callerId, stripeClient);
        } catch (clearErr) {
          console.error("[stripe-connect] stale-account check threw:", clearErr);
        }
      }
      if (outcome === "cleared") {
        return new Response(JSON.stringify({
          error: "Your previous payout account is no longer valid. Tap Connect again to set up a fresh one.",
          recoverable: true,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
      }
      // Not confirmed, or not cleared: nothing changed, so the generic 500
      // below is the true answer.
    }

    // Client-safe generic message — the raw Stripe/PostgREST detail is already
    // in the console.error above. Returning err.message here handed schema and
    // integration internals to the caller (EF-5, hole hunt 2026-09-15).
    return new Response(JSON.stringify({ error: "We couldn't set up your payout account right now. Please try again." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
