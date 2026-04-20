// Deletes accounts that never finished onboarding within 30 days.
// Targets: users whose email is unverified after 30 days, OR helpers who
// never connected Stripe and have no jobs/applications/messages after 30 days.
//
// Run on a daily cron via pg_cron + pg_net.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifyCronSecret } from "../_shared/cron-auth.ts";

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
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const deleted: string[] = [];
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
      for (const u of data.users) {
        if (u.created_at < cutoff) {
          candidates.push({
            id: u.id,
            email: u.email ?? null,
            created_at: u.created_at,
            email_confirmed_at: u.email_confirmed_at ?? null,
          });
        }
      }
      if (data.users.length < perPage) break;
      page++;
      if (page > 50) break; // hard safety cap (10k users / cycle)
    }

    for (const u of candidates) {
      try {
        // Pull profile to determine role + Stripe state
        const { data: profile } = await supabase
          .from("profiles")
          .select("role, stripe_account_id, approval_status, ban_status")
          .eq("user_id", u.id)
          .maybeSingle();

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

        // Decide: abandoned?
        // 1. Email never verified after 30d → delete
        // 2. Helper with no Stripe account after 30d → delete
        // 3. Customer still pending after 30d → delete
        const emailUnverified = !u.email_confirmed_at;
        const helperNoStripe = profile.role === "helper" && !profile.stripe_account_id;
        const customerStillPending = profile.role === "customer" && profile.approval_status === "pending";

        if (!emailUnverified && !helperNoStripe && !customerStillPending) {
          skipped.push(u.id);
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
        cutoff,
        scanned: candidates.length,
        deleted: deleted.length,
        skipped: skipped.length,
        errors: errors.length,
        sampleErrors: errors.slice(0, 5),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("cleanup-abandoned-accounts failed", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
