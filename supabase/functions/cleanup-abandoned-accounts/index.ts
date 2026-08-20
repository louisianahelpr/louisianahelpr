// Deletes accounts that never finished onboarding within 30 days.
// Targets: users whose email is unverified after 30 days, OR helpers who
// never connected Stripe and have no jobs/applications/messages after 30 days.
//
// Run on a daily cron via pg_cron + pg_net.
//
// TWO SAFETY RAILS, both load-bearing on the FIRST run after 2026-08:
//
// This function has been a silent no-op since 2026-05 (a dropped `profiles.role`
// column 400'd the whole SELECT and the error was discarded, so every user hit
// the `!profile` skip). Fixing that read makes `deleteUser` live again — and
// the first invocation therefore faces roughly three months of accumulated
// backlog, in one pass, irreversibly, with cascade deletes behind it. A cap and
// a rehearsal mode are not belt-and-braces here; they are the difference
// between a routine daily sweep and a single unreviewable mass deletion.
//
//   ?dryRun=1  — evaluate every candidate and REPORT what would be deleted,
//                deleting nothing. Includes the ids so an operator can inspect
//                the list before arming it for real.
//   MAX_DELETES_PER_RUN — hard per-run ceiling. The backlog then drains over
//                several daily runs, each one small enough to notice and stop.
//                Note this is a DELETE cap, distinct from the 10k SCAN cap in
//                the pagination loop below, which bounds work, not damage.

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCronSecret } from "../_shared/cron-auth.ts";

/**
 * Hard ceiling on irreversible deletions in a single invocation. Sized so a
 * normal day (a handful of abandoned signups) never touches it, and an abnormal
 * one stops well short of the whole backlog.
 */
const MAX_DELETES_PER_RUN = 50;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!
  );

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const deleted: string[] = [];
  // Candidates that qualified but were left alone because the per-run ceiling
  // was reached. Reported so a run that hit the cap is unmistakable, rather
  // than looking like a day with exactly MAX_DELETES_PER_RUN abandonments.
  const deferred: string[] = [];
  const skipped: string[] = [];
  const errors: { id: string; error: string }[] = [];

  try {
    // Pull every user (paginated). Auth admin API doesn't support filtering by date.
    let page = 1;
    const perPage = 200;
    const candidates: { id: string; email: string | null; created_at: string; email_confirmed_at: string | null }[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      // Defensive: supabase-js typings guarantee data.users but guard at runtime
      // in case a future SDK version changes the response shape.
      const users = data?.users;
      if (!users) throw new Error(`auth.admin.listUsers page ${page} returned unexpected shape: ${JSON.stringify(data)}`);
      for (const u of users) {
        if (u.created_at < cutoff) {
          candidates.push({
            id: u.id,
            email: u.email ?? null,
            created_at: u.created_at,
            email_confirmed_at: u.email_confirmed_at ?? null,
          });
        }
      }
      if (users.length < perPage) break;
      page++;
      if (page > 50) break; // hard safety cap (10k users / cycle)
    }

    for (const u of candidates) {
      try {
        // Pull profile to determine Stripe + approval/ban state.
        //
        // This used to also select `role`, a column DROPPED when accounts were
        // unified (2026-05). PostgREST 400s the whole SELECT on an unknown
        // column, and the error was being discarded (`const { data: profile }`),
        // so `profile` came back null for EVERY user and the `!profile` guard
        // below skipped all of them — this cleanup has been a silent no-op ever
        // since. Fail-safe (nothing was wrongly deleted) but entirely dead, and
        // invisible. The error is checked now so the next such break says so.
        const { data: profile, error: profileErr } = await supabase
          .from("profiles")
          .select("stripe_account_id, approval_status, ban_status")
          .eq("user_id", u.id)
          .maybeSingle();

        if (profileErr) {
          console.error(`[cleanup-abandoned-accounts] profile read failed for ${u.id} — skipping:`, profileErr);
          skipped.push(u.id);
          continue;
        }

        // Never delete approved/banned/admin accounts
        if (!profile) {
          skipped.push(u.id);
          continue;
        }
        if (profile.approval_status === "approved") {
          skipped.push(u.id);
          continue;
        }
        if (profile.ban_status && ["banned", "temp_banned", "permanently_banned"].includes(profile.ban_status)) {
          skipped.push(u.id);
          continue;
        }

        // Never delete admins
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", u.id);
        if (roles?.some((r) => r.role === "admin")) {
          skipped.push(u.id);
          continue;
        }

        // Activity check — keep anyone who has touched the platform
        const [{ count: jobCount }, { count: appCount }, { count: msgCount }] = await Promise.all([
          supabase.from("jobs").select("id", { count: "exact", head: true }).or(`customer_id.eq.${u.id},helper_id.eq.${u.id}`),
          supabase.from("applications").select("id", { count: "exact", head: true }).eq("helper_id", u.id),
          supabase.from("messages").select("id", { count: "exact", head: true }).eq("sender_id", u.id),
        ]);
        if ((jobCount ?? 0) > 0 || (appCount ?? 0) > 0 || (msgCount ?? 0) > 0) {
          skipped.push(u.id);
          continue;
        }

        // Decide: abandoned? Role-agnostic — same rules apply to every
        // account regardless of legacy customer/helper value.
        // 1. Email never verified after 30d → delete
        // 2. Approval still pending after 30d → delete (admin never reviewed
        //    OR user never finished onboarding)
        // 3. No Stripe Connect after 30d → delete (can never be paid out,
        //    so the account has no path to participating in transactions)
        const emailUnverified = !u.email_confirmed_at;
        const stillPending = profile.approval_status === "pending";
        const noStripeConnect = !profile.stripe_account_id;

        if (!emailUnverified && !stillPending && !noStripeConnect) {
          skipped.push(u.id);
          continue;
        }

        // Everything below this line is irreversible.
        if (dryRun) {
          deleted.push(u.id);
          continue;
        }
        if (deleted.length >= MAX_DELETES_PER_RUN) {
          deferred.push(u.id);
          continue;
        }

        // Delete (cascade handles profile, etc.)
        const { error: delErr } = await supabase.auth.admin.deleteUser(u.id);
        if (delErr) {
          errors.push({ id: u.id, error: delErr.message });
        } else {
          deleted.push(u.id);
        }
      } catch (e) {
        errors.push({ id: u.id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dryRun,
        cutoff,
        scanned: candidates.length,
        // In dryRun this is the WOULD-DELETE count; nothing was touched.
        deleted: deleted.length,
        // Non-zero means the run hit MAX_DELETES_PER_RUN and the rest are
        // waiting for the next one. Never silently truncate a destructive set.
        deferred: deferred.length,
        capped: deferred.length > 0,
        skipped: skipped.length,
        errors: errors.length,
        sampleErrors: errors.slice(0, 5),
        // Ids only in dryRun — this is the list an operator reads before
        // arming the real run. A live run returns counts, not a roster.
        ...(dryRun ? { wouldDelete: deleted } : {}),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    // Log the real error to Supabase edge-function logs (operator-visible) without
    // leaking stack traces / SQL details in the HTTP response body (CodeQL CWE-209).
    const msg = e instanceof Error ? e.message : String(e);
    console.error("cleanup-abandoned-accounts failed:", msg, e);
    return new Response(
      JSON.stringify({ ok: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
