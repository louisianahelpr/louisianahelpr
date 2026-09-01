// Saved-helper availability push
//
// Re-engagement channel for customers who've saved helpers. When a
// helper opens up new weekend availability (or generally publishes
// new slots), customers who saved them get a "X has weekend openings"
// nudge. The cron drives helpers → customers, not the other way around,
// so the push only fires on actual change.
//
// Schedule (recommended): every 6 hours. Low frequency on purpose —
// we'd rather a delayed "Maria has Saturday open" than a hot-glove
// instant notification stream.
//
// Detection model: we keep a small cursor table (helper_availability_last_seen)
// per (customer_id, helper_id) tracking the highest helper_availability.updated_at
// we've already notified about. On each run, find availability rows
// updated after that cursor, fan out a notification per (customer ↔ helper),
// then bump the cursor.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  // With no service-role key, `createClient(url, undefined)` throws
  // "supabaseKey is required" RIGHT HERE — before the try/catch below and
  // before the auth check, which already tolerates a missing key. The caller
  // got an opaque 500 with no CORS headers and no clue why. Answer instead.
  if (!serviceRoleKey) {
    console.error("[saved-helper-availability-push] SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY is not configured");
    return new Response("Service role key not configured", { status: 503, headers: corsHeaders });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const defects = defectTracker();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    // 1. Fetch all favorite_helpers pairs along with the latest
    //    availability cursor we've already notified about (NULL on
    //    first run for that pair).
    const { data: favorites, error: favsErr } = await supabase
      .from("favorite_helpers")
      .select("customer_id, helper_id");
    if (favsErr) throw favsErr;
    if (!favorites || favorites.length === 0) {
      return cronResult("saved-helper-availability-push", { pairs: 0, notified: 0 }, { count: 0 }, corsHeaders);
    }

    const helperIds = [...new Set(favorites.map((f) => f.helper_id))];

    // 2. Latest availability update per helper.
    const { data: avail } = await supabase
      .from("helper_availability")
      .select("helper_id, updated_at, day_of_week, specific_date, is_available")
      .in("helper_id", helperIds)
      .eq("is_available", true);
    const latestByHelper = new Map<string, string>();
    for (const a of avail ?? []) {
      const prev = latestByHelper.get(a.helper_id);
      if (!prev || new Date(a.updated_at) > new Date(prev)) {
        latestByHelper.set(a.helper_id, a.updated_at);
      }
    }

    // 3. Cursor table — track what we already notified per (customer, helper).
    //    We piggyback on a simple key/value structure stored as JSONB on
    //    profiles to avoid a separate migration for this lightweight signal.
    //    Schema: profiles.saved_helper_seen jsonb defaults '{}'.
    //    Map: { [helper_id]: ISO timestamp last notified }.
    const customerIds = [...new Set(favorites.map((f) => f.customer_id))];
    const { data: customerRows } = await supabase
      .from("profiles")
      .select("user_id, saved_helper_seen, full_name")
      .in("user_id", customerIds);
    const cursorByCustomer = new Map<string, Record<string, string>>();
    for (const c of customerRows ?? []) {
      cursorByCustomer.set(c.user_id, (c.saved_helper_seen as Record<string, string> | null) ?? {});
    }

    // 4. Pull helper names so the notification message can name the helper.
    const { data: helperProfiles } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", helperIds);
    const helperNameMap = new Map<string, string>();
    for (const h of helperProfiles ?? []) {
      const first = (h.full_name ?? "").trim().split(/\s+/)[0] || "Your helper";
      helperNameMap.set(h.user_id, first);
    }

    // 5. For each pair, decide if there's a fresh availability update.
    const notifications: Array<{
      user_id: string;
      title: string;
      message: string;
      type: string;
      link: string;
      read: boolean;
    }> = [];
    const cursorUpdates = new Map<string, Record<string, string>>();

    for (const fav of favorites) {
      const latest = latestByHelper.get(fav.helper_id);
      if (!latest) continue;
      const cursor = cursorByCustomer.get(fav.customer_id) ?? {};
      const lastSeen = cursor[fav.helper_id];
      if (lastSeen && new Date(lastSeen) >= new Date(latest)) continue;

      const helperName = helperNameMap.get(fav.helper_id) ?? "Your helper";
      notifications.push({
        user_id: fav.customer_id,
        title: `${helperName} updated availability`,
        message: `${helperName} has new openings. Tap to send a direct offer.`,
        type: "info",
        link: `/post-job?offerTo=${fav.helper_id}`,
        read: false,
      });
      // Stage the cursor bump.
      const next = cursorUpdates.get(fav.customer_id) ?? cursor;
      next[fav.helper_id] = latest;
      cursorUpdates.set(fav.customer_id, next);
    }

    if (notifications.length > 0) {
      const { error: notifyErr } = await supabase.from("notifications").insert(notifications);
      if (notifyErr) throw notifyErr;
    }

    // 6. Persist the cursor bumps. Best-effort — if any single update
    //    fails we still return success for the run since the notifications
    //    already went out (better one extra ping next run than silent loss).
    for (const [customerId, cursor] of cursorUpdates) {
      const { error: updateErr } = await supabase
        .from("profiles")
        .update({ saved_helper_seen: cursor })
        .eq("user_id", customerId);
      if (updateErr) {
        console.warn("cursor update failed:", customerId, updateErr.message);
        // A cursor that never advances re-pings the same customer about the
        // same helper on every run — indefinitely, at 200.
        defects.record(`cursor update ${customerId}: ${updateErr.message}`);
      }
    }

    return cronResult(
      "saved-helper-availability-push",
      { pairs: favorites.length, notified: notifications.length },
      defects.defects,
      corsHeaders,
    );
  } catch (error: any) {
    console.error("saved-helper-availability-push error:", error?.message ?? error);
    return cronError("saved-helper-availability-push", error?.message ?? "push failed", corsHeaders);
  }
});
