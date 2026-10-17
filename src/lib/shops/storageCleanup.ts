/**
 * Removing Shops photo objects from storage (shop photos, slice 1's api.ts;
 * item photos, slice 2's items.ts). Both buckets are public by URL, so an
 * object left behind stays fetchable until the owner's account deletion
 * removes <uid>/: a failed or short delete is reported to Sentry with its
 * count, never only logged (lh-silent-failure review nit 6 and re-review).
 */
import { supabase } from "@/integrations/supabase/client";
import { captureException } from "@/lib/sentry";

/**
 * Delete `paths` from `bucket`. Never throws: the caller's server write has
 * already happened (rows detached, or the attach was refused), so a cleanup
 * miss must not turn into an error the member is shown.
 */
export async function removeShopObjects(bucket: string, paths: string[], what: string): Promise<void> {
  if (paths.length === 0) return;
  let removed = 0;
  let failure: unknown;
  try {
    const { data, error } = await supabase.storage.from(bucket).remove(paths);
    removed = Array.isArray(data) ? data.length : 0;
    failure = error;
  } catch (err) {
    // Not swallowed: reported to Sentry just below with the count.
    failure = err;
  }
  if (failure || removed < paths.length) {
    const reason = failure instanceof Error ? failure.message : `${removed} of ${paths.length}`;
    console.warn(`[shops] ${what} not removed`, reason);
    captureException(failure ?? new Error(`shops: ${what} not removed`), { what, removed, wanted: paths.length }, "warning");
  }
}
