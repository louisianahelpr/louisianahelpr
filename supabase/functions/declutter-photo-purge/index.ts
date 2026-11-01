import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "../_shared/buildStamp.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { requireFeature } from "../_shared/featureSwitch.ts";

// Declutter photo object purge (B63, migration 20261101054258).
//
// Every deleted declutter_item_photos row queues its storage path (AFTER DELETE trigger). A photo a Helpr uploaded
// for a "Have a Helpr list it" listing sits in the HELPR's folder, and storage RLS refuses the seller's own delete
// (silently: { data: [], error: null }), so without this the object stayed public by URL.
//
// Two callers, one rule (remove ONLY queued paths, through the Storage API, then tell the database):
//   - the cron (service-role Bearer): everyone's due paths, every 15 minutes;
//   - the app, right after the seller's change (their own JWT): ONLY that caller's own queued paths. The seller id
//     comes from the verified token, never from the body.
// A Storage refusal leaves the entries queued (claim re-handed out after 15 minutes) and is a defect (non-2xx).

const FN = "declutter-photo-purge";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
/** DECLUTTER_PHOTO_BUCKET (src/lib/declutter/api.ts): Declutter photos live in the public job-photos bucket. */
const BUCKET = "job-photos";
/** Storage removes up to 1000 paths per call; stay well under. */
const BATCH = 100;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
      { auth: { persistSession: false }, global: { fetch: boundedFetch() } },
    );
    let seller: string | null = null;
    if (verifyCronSecret(req) !== null) {
      const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!jwt) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const { data: auth, error: authError } = await admin.auth.getUser(jwt);
      if (authError || !auth?.user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      const refused = await requireFeature(admin, "declutter", auth.user, corsHeaders);
      if (refused) return refused;
      seller = auth.user.id;
    }
    const defects = defectTracker();
    const { data, error } = await admin.rpc("declutter_photo_purge_due", { p_limit: 500, p_seller: seller });
    // An unreadable queue is a failed run, never "nothing due".
    if (error) return cronError(FN, `queue read failed: ${error.message}`, corsHeaders);
    const paths = ((data ?? []) as { storage_path: string }[]).map((r) => r.storage_path);

    let removed = 0;
    for (let i = 0; i < paths.length; i += BATCH) {
      const claimed = paths.slice(i, i + BATCH);
      // B67 (20261101062032): re-checked right before the remove, so a path attached again since the claim is never
      // removed. A failed re-check removes nothing (the claims are re-handed out after 15 minutes).
      const { data: still, error: recheckError } = await admin.rpc("declutter_photo_purge_recheck", { p_paths: claimed });
      if (recheckError) {
        defects.record(`purge_recheck failed: ${recheckError.message}`);
        continue;
      }
      const batch = ((still ?? []) as { storage_path: string }[]).map((r) => r.storage_path);
      if (batch.length === 0) continue;
      // A path already gone is not an error in Storage: an object the app or an account purge took first is done too.
      const { error: rmError } = await admin.storage.from(BUCKET).remove(batch);
      if (rmError) {
        defects.record(`storage remove failed: ${rmError.message}`);
        continue;
      }
      const { error: doneError } = await admin.rpc("declutter_photo_purge_done", { p_paths: batch });
      if (doneError) {
        defects.record(`purge_done failed: ${doneError.message}`);
        continue;
      }
      removed += batch.length;
    }
    return cronResult(FN, { due: paths.length, removed }, defects.defects, corsHeaders);
  } catch (e) {
    return cronError(FN, caughtMessage(e), corsHeaders);
  }
});
