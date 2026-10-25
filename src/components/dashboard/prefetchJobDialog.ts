/**
 * prefetchJobDialog — warms the network requests JobDetailDialog fires
 * on open, so the dialog reads from a hot HTTP path instead of cold.
 *
 * The dialog fetches two head-count queries when a job opens:
 *   1. applications WHERE job_id = … (helpr competition signal)
 *   2. jobs WHERE customer_id + helper_id + status = completed
 *      (repeat-customer signal)
 *
 * Both are tiny `count: "exact", head: true` requests, so they're cheap
 * to fire ahead of the tap. Wiring them through usePrefetchOnTouch on a
 * JobCard means by the time the dialog mounts (~80ms after touchstart),
 * the requests are usually already in flight or done — the dialog's
 * own useEffect fires the same queries against PostgREST's warmed
 * query plan + an authenticated, kept-alive Supabase connection.
 *
 * Kept fire-and-forget: a failed prefetch never propagates, the dialog
 * still works fine cold, this is purely UX polish. When the dialog is
 * eventually migrated to React Query keys we can swap the body of this
 * function for `queryClient.prefetchQuery({ queryKey, queryFn })` and
 * the touch wiring at the call sites stays the same.
 */
import { supabase } from "@/integrations/supabase/client";

export async function prefetchJobDialog(
  jobId: string,
  customerId: string,
): Promise<void> {
  if (!jobId || !customerId) return;

  // SIGNED OUT: warm nothing. `applications` grants nothing to anon, so the
  // head count was a guaranteed 401 "permission denied for table
  // applications" on every guest tap of a job card on / (424 of them on
  // 2026-10-22 alone, prod edge logs; mostly Facebook's in-app browser), and
  // the dialog it warmed for does not run either query for a guest
  // (useJobDetailData returns early on `guest`). The session read is local,
  // no network round trip.
  const sessionRes = await supabase.auth.getSession();
  const viewerId = sessionRes.data.session?.user?.id;
  if (!viewerId) return;

  // Both requests are fired in parallel and awaited together — the
  // touchstart→click gap is ~80ms on mobile, plenty for two head
  // queries to a warm Supabase.
  const applicationsPromise = supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  const repeatPromise = supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("helper_id", viewerId)
    .eq("status", "completed");

  // Await both so the returned promise resolves only when warming is
  // complete — lets the hook flip its `primed` bit only after the work
  // is on the wire. We don't read the results; the dialog will re-run
  // these and benefit from a warm HTTP/RLS path.
  await Promise.allSettled([applicationsPromise, repeatPromise]);
}
