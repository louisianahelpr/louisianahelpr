import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "../_shared/buildStamp.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";

// Homes listing photo purge (Q2211, lead review round 3 #1 + #2). Daily cron
// (listing-photo-purge, 20261019071203).
//
// A take-down HIDES its listings' photos and keeps them, so a lift restores
// them; each is queued in rental_photo_purge_queue for 30 days later. Listing
// photos found in the PUBLIC job-photos bucket are queued at once. This
// function deletes what is due THROUGH THE STORAGE API (never a storage.objects
// row in SQL, which orphans the bytes where no account purge can find them),
// then tells the database (rentals_photo_purge_done), which drops the photo
// rows of a still-taken-down listing and the queue entries.
//
// rentals_photo_purge_due drops (and never returns) an entry whose listing a
// lift restored. A Storage refusal leaves its entries queued for the next run
// and is a defect (non-2xx, so the cron monitor sees it), never a silent skip.

const FN = "listing-photo-purge";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
/** Storage removes up to 1000 paths per call; stay well under. */
const BATCH = 100;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
      { auth: { persistSession: false }, global: { fetch: boundedFetch() } },
    );
    const defects = defectTracker();
    const { data, error } = await admin.rpc("rentals_photo_purge_due", { p_limit: 500 });
    // An unreadable queue is a failed run, never "nothing due".
    if (error) return cronError(FN, `queue read failed: ${error.message}`, corsHeaders);
    const due = (data ?? []) as { bucket_id: string; storage_path: string }[];
    const byBucket = new Map<string, string[]>();
    for (const r of due) byBucket.set(r.bucket_id, [...(byBucket.get(r.bucket_id) ?? []), r.storage_path]);

    let removed = 0;
    for (const [bucket, paths] of byBucket) {
      for (let i = 0; i < paths.length; i += BATCH) {
        const batch = paths.slice(i, i + BATCH);
        // Removing a path that is already gone is not an error in Storage: an object the account purge took first is done too.
        const { error: rmError } = await admin.storage.from(bucket).remove(batch);
        if (rmError) {
          defects.record(`storage remove failed in ${bucket}: ${rmError.message}`);
          continue;
        }
        const { error: doneError } = await admin.rpc("rentals_photo_purge_done", { p_bucket: bucket, p_paths: batch });
        if (doneError) {
          defects.record(`purge_done failed in ${bucket}: ${doneError.message}`);
          continue;
        }
        removed += batch.length;
      }
    }
    return cronResult(FN, { due: due.length, removed }, defects.defects, corsHeaders);
  } catch (e) {
    return cronError(FN, caughtMessage(e), corsHeaders);
  }
});
