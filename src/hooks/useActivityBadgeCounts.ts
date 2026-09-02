import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeWithRecovery } from "@/lib/realtimeRecovery";
import { safeStorage } from "@/lib/safeStorage";

/**
 * Lightweight "actionable activity" counts for the bottom-nav badges.
 *
 * Deliberately NOT `useActivityData` — that hook fires a multi-query
 * waterfall to render the whole Activity page, and the nav is mounted on
 * every authenticated route. We only need two cheap count-only reads:
 *
 *  - Posts badge: pending applications on the jobs YOU posted (new
 *    applicants awaiting your decision). One embedded `!inner` count query
 *    filtered to your jobs.
 *  - Jobs badge: direct offers extended to YOU that are still pending
 *    (someone offered you a job and you haven't responded). One count query.
 *
 * Both use `{ count: "exact", head: true }` so no rows cross the wire —
 * just the integer. Realtime invalidation reuses the same scoped-filter +
 * channelNonce discipline as the rest of the app.
 */

const POSTS_CACHE_KEY = "helpr_nav_posts_count";
const JOBS_CACHE_KEY = "helpr_nav_jobs_count";

function readCached(key: string): number {
  try {
    const raw = safeStorage.getItem(key);
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeCached(key: string, n: number) {
  try {
    safeStorage.setItem(key, String(Math.max(0, n)));
  } catch {
    /* best-effort */
  }
}

export interface ActivityBadgeCounts {
  /** New applicants awaiting a decision on jobs you posted. */
  postsCount: number;
  /** Direct offers extended to you that are still pending a response. */
  jobsCount: number;
}

export function useActivityBadgeCounts(userId: string | undefined): ActivityBadgeCounts {
  // Seed from the durable cache so a cold start with no network still
  // paints the last-known counts on the first frame (no flicker-to-0).
  const [postsCount, setPostsCount] = useState<number>(() => readCached(POSTS_CACHE_KEY));
  const [jobsCount, setJobsCount] = useState<number>(() => readCached(JOBS_CACHE_KEY));

  useEffect(() => {
    if (!userId) {
      setPostsCount(0);
      setJobsCount(0);
      return;
    }

    const loadCounts = () => {
      // Pending applicants on jobs I posted that I haven't seen yet
      // (poster_viewed_at IS NULL). Embedded `!inner` join scopes the count
      // to my jobs server-side; head:true returns the count only.
      //
      // Fallback: if the column doesn't exist yet (error code 42703 — column
      // undefined, migration not deployed to production), fall back to
      // counting all pending applications so the badge stays informative.
      // SCOPED TO STILL-OPEN JOBS. An application keeps `status = 'pending'`
      // forever once the poster picks somebody else, and it keeps it on a job
      // that was completed or cancelled too — so the badge was counting
      // decisions that had already been made, or could no longer be made at
      // all (owner: "done should not be in this count"). A badge is a claim
      // that something is waiting on you; only an OPEN job can have that.
      supabase
        .from("applications")
        .select("id, jobs!inner(customer_id, status)", { count: "exact", head: true })
        .eq("status", "pending")
        .is("poster_viewed_at", null)
        .eq("jobs.customer_id", userId)
        .eq("jobs.status", "open")
        .then(({ count, error }) => {
          // Never zero the badge on a failed/offline read — the cache is the
          // floor, matching the Messages badge's behaviour.
          if (error) {
            // 42703 = undefined_column: the migration adding poster_viewed_at
            // hasn't been deployed yet. Fall back to the old query so the
            // badge still works on production.
            if (error.code === "42703") {
              supabase
                .from("applications")
                .select("id, jobs!inner(customer_id, status)", { count: "exact", head: true })
                .eq("status", "pending")
                .eq("jobs.customer_id", userId)
                .eq("jobs.status", "open")
                .then(({ count: fallbackCount, error: fallbackError }) => {
                  if (fallbackError) return;
                  const next = fallbackCount || 0;
                  setPostsCount(next);
                  writeCached(POSTS_CACHE_KEY, next);
                });
            }
            return;
          }
          const next = count || 0;
          setPostsCount(next);
          writeCached(POSTS_CACHE_KEY, next);
        });

      // Direct offers extended to me, still awaiting my response. Via the RPC,
      // not the table: an unaccepted offer is no longer RLS-readable, because
      // granting that row also handed over the poster's street address. The
      // RPC returns the same rows with the address masked. A helper has at
      // most a handful of open offers, so counting the returned rows costs no
      // more than the head-count round-trip it replaces.
      supabase.rpc("get_my_pending_direct_offers").then(({ data, error }) => {
        if (error) return;
        const next = data?.length || 0;
        setJobsCount(next);
        writeCached(JOBS_CACHE_KEY, next);
      });
    };

    loadCounts();

    const sub = subscribeWithRecovery(
      (name) => supabase
      .channel(name)
      // postgres_changes filters are single-column and scoped per project
      // rule (no unfiltered `event: "*"`). The Jobs badge (direct offers to
      // me) updates live via the notifications INSERT below. The Posts
      // badge (foreign applicants on my jobs) can't be filtered by poster —
      // `applications` has no customer_id column — so a stranger's INSERT
      // won't push live; instead the count re-reads whenever a job I own
      // changes (e.g. I accept/decline an applicant) and on every nav
      // mount/navigation. We deliberately do NOT open an unfiltered
      // applications channel just to catch that one case.
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "applications", filter: `helper_id=eq.${userId}` },
        () => loadCounts(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs", filter: `customer_id=eq.${userId}` },
        () => loadCounts(),
      )
      // Not a `jobs` filter any more: the helper has no RLS SELECT grant on an
      // unaccepted offer (that policy leaked the street address) and Realtime
      // only delivers rows the subscriber can read. The trigger that creates
      // the offer also inserts a notification addressed to the offered helper,
      // so this channel is the same wake-up on a row they're entitled to.
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => loadCounts(),
      ),
      { name: `nav-activity-badges-${userId}`, onRecovered: loadCounts },
    );

    return () => {
      sub.close();
    };
  }, [userId]);

  return { postsCount, jobsCount };
}
