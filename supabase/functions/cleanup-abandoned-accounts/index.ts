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
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { purgeAccount } from "../_shared/accountPurge.ts";

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
  // `skipped` is NOT page-worthy: it counts admins, approved accounts and
  // active users, all of which are the guards working correctly. But three of
  // its call sites are broken READS, and since those now skip instead of
  // deleting (the fail-open fix), a permanently broken read would make this
  // cron quietly stop cleaning up while still answering ok: true. That is the
  // failure mode this counter exists to surface.
  const defects = defectTracker();

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
          defects.record(`profile read ${u.id}: ${profileErr.message}`);
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

        // Never delete admins.
        //
        // This guard MUST fail closed. Dropping the error meant a transient
        // user_roles failure produced roles === null, `?.some()` short-circuited
        // to undefined, and the account fell through to irreversible deletion —
        // so the one lookup standing between an admin and `deleteUser` was also
        // the one whose failure removed the protection. Skip on error instead:
        // a missed cleanup run is free, a deleted admin is not.
        const { data: roles, error: rolesError } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", u.id);
        if (rolesError) {
          console.error(
            `[cleanup-abandoned-accounts] role lookup failed for ${u.id}, skipping to avoid deleting an admin: ${rolesError.message}`,
          );
          skipped.push(u.id);
          defects.record(`role lookup ${u.id}: ${rolesError.message}`);
          continue;
        }
        if (roles?.some((r) => r.role === "admin")) {
          skipped.push(u.id);
          continue;
        }

        // Activity check — keep anyone who has touched the platform.
        //
        // These errors MUST be checked. Destructuring only `count` left the
        // guard failing OPEN into an irreversible delete: on any read failure
        // PostgREST returns count === null, `?? 0` turned that into 0, and
        // "the read broke" became "this account has never done anything" — so
        // a live user with jobs, applications and messages was handed to
        // auth.admin.deleteUser with cascades behind it, up to
        // MAX_DELETES_PER_RUN of them, while the response still read
        // ok: true, deleted: N.
        //
        // This is the same hole commit 289d3ca45 closed one guard above for
        // user_roles, on the reasoning that a missed cleanup run is free and a
        // deleted admin is not. That applies with more force here: the roles
        // guard protects admins, this one protects everybody.
        //
        // `group_job_helpers` is in this list for the same reason
        // `findActiveWork` reads it: only the LEAD helper of a group job is
        // ever written to `jobs.helper_id`, so a second or third helper on a
        // group job has no row this check would otherwise see and reads as an
        // account that has never touched the platform.
        const [jobsRes, appsRes, msgsRes, rosterRes] = await Promise.all([
          supabase.from("jobs").select("id", { count: "exact", head: true }).or(`customer_id.eq.${u.id},helper_id.eq.${u.id}`),
          supabase.from("applications").select("id", { count: "exact", head: true }).eq("helper_id", u.id),
          supabase.from("messages").select("id", { count: "exact", head: true }).eq("sender_id", u.id),
          supabase.from("group_job_helpers").select("id", { count: "exact", head: true }).eq("helper_id", u.id),
        ]);
        const activityErr = jobsRes.error ?? appsRes.error ?? msgsRes.error ?? rosterRes.error;
        if (activityErr) {
          console.error(
            `[cleanup-abandoned-accounts] activity check failed for ${u.id}; skipping rather than deleting on an unverified account`,
            activityErr,
          );
          skipped.push(u.id);
          defects.record(`activity check ${u.id}: ${activityErr.message}`);
          continue;
        }
        if (
          (jobsRes.count ?? 0) > 0 || (appsRes.count ?? 0) > 0 ||
          (msgsRes.count ?? 0) > 0 || (rosterRes.count ?? 0) > 0
        ) {
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

        // Same purge path as the user- and admin-initiated deletes. An
        // abandoned signup has no jobs, applications or messages (the activity
        // guard above proved it), but it CAN have uploaded an avatar or an ID
        // document during onboarding before walking away — which is exactly
        // the data that must not be left behind, and exactly what a bare
        // `deleteUser` used to leave sitting in the public `avatars` bucket.
        const purge = await purgeAccount(supabase, u.id);
        if (!purge.ok) {
          // Do NOT delete the auth row on a failed purge — that would strand
          // the storage objects with no user left to attribute them to. Skip
          // and let tomorrow's run retry; the purge is idempotent.
          //
          // The deploy-lag case is a DEFERRAL, not a defect. Migrations land on
          // merge to main, so on deploy day this function is live before
          // `purge_user_data` exists. Counting that as an error would page on a
          // run that behaved exactly correctly — and once per candidate, so a
          // 50-candidate day would look like a 50-error outage.
          if (purge.reason === "rpc_not_deployed") {
            console.log(`[cleanup-abandoned-accounts] deferring ${u.id}: purge_user_data not deployed yet`);
            skipped.push(u.id);
            // Counted as a DEFECT as well as a skip, deliberately. `skipped` is
            // documented above as the guards working correctly and is not
            // page-worthy — which is exactly why a deferral must not live
            // there alone. The `defects` counter exists so a permanently
            // broken read cannot make this cron quietly stop cleaning up while
            // still answering ok: true, and a migration that never lands (or
            // gets reverted) produces precisely that state. One day of noise
            // during a normal deploy window self-clears; a silently dead cron
            // does not.
            defects.record(`purge_user_data not deployed — deferred ${u.id}`);
            continue;
          }
          console.error(`[cleanup-abandoned-accounts] purge incomplete for ${u.id}, not deleting:`, JSON.stringify(purge.steps));
          errors.push({ id: u.id, error: `purge incomplete: ${purge.steps.filter((s) => !s.ok).map((s) => s.detail).join("; ")}` });
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

    return cronResult(
      "cleanup-abandoned-accounts",
      {
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
      },
      {
        // Failed deletes plus failed reads. Both mean the run did not do the
        // work it was scheduled to do.
        count: errors.length + defects.count,
        reasons: [...errors.map((e) => `delete ${e.id}: ${e.error}`), ...defects.reasons],
      },
      corsHeaders,
    );
  } catch (e) {
    // Log the real error to Supabase edge-function logs (operator-visible) without
    // leaking stack traces / SQL details in the HTTP response body (CodeQL CWE-209).
    const msg = e instanceof Error ? e.message : String(e);
    console.error("cleanup-abandoned-accounts failed:", msg, e);
    // Body stays generic (CodeQL CWE-209); the real message is in the logs.
    return cronError("cleanup-abandoned-accounts", "Internal server error", corsHeaders);
  }
});
