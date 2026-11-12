// Q1957 (migration 20261112100000_shops_hidden_photos_held): a hidden shop's, or a banned owner's, photos move out of
// the PUBLIC job-photos bucket into the PRIVATE shop-photos-held bucket at the same path, and back when the shop is
// shown again. shop_photos_to_move lists every object in the wrong bucket right now (stateless), so a failed move is
// simply listed again on the next cron run. Run by declutter-money in its own try.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface ShopPhotoMove { storage_path: string; from_bucket: string; to_bucket: string }

const BUCKETS = new Set(["job-photos", "shop-photos-held"]);

/** Moves each listed object; returns how many moved and the failures (path: message), never throws on one failure. */
export async function moveShopPhotoHolds(admin: SupabaseClient, limit = 200): Promise<{ moved: number; failures: string[] }> {
  const { data, error } = await admin.rpc("shop_photos_to_move", { p_limit: limit });
  if (error) {
    // Not deployed yet (PGRST202): nothing to move.
    if ((error as { code?: string }).code === "PGRST202") return { moved: 0, failures: [] };
    throw new Error(`shop_photos_to_move failed: ${error.message}`);
  }
  let moved = 0;
  const failures: string[] = [];
  for (const row of (data ?? []) as ShopPhotoMove[]) {
    if (!BUCKETS.has(row.from_bucket) || !BUCKETS.has(row.to_bucket) || row.from_bucket === row.to_bucket) continue;
    const move = () => admin.storage.from(row.from_bucket).move(row.storage_path, row.storage_path, { destinationBucket: row.to_bucket });
    let res = await move();
    if (res.error) {
      // The list names the copy in the WRONG bucket, so one already at the destination is a stray (e.g. re-uploaded at
      // a held path while the shop was hidden, never byte-checked): remove it and move the real one once more.
      const stray = await admin.storage.from(row.to_bucket).remove([row.storage_path]);
      if (!stray.error) res = await move();
    }
    if (res.error) failures.push(`${row.storage_path}: ${res.error.message}`.slice(0, 200));
    else moved++;
  }
  return { moved, failures };
}
