import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { haversineMiles } from "@/lib/geo";
import { getParishCentroid } from "@/lib/parishCentroids";
import { report } from "@/lib/errorLogger";
import { useDrivingTime } from "@/hooks/useDrivingTime";
import type { EnrichedJob } from "../types";

interface UseJobDetailDataArgs {
  job: EnrichedJob | null;
  guest: boolean;
  userLat?: number | null;
  userLng?: number | null;
}

export function useJobDetailData({ job, guest, userLat, userLng }: UseJobDetailDataArgs) {
  const [descExpanded, setDescExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Nonce bump tells PhotoLightbox to open in grid mode when the user
  // taps the "View all" pill on the cover. Plain number so a click
  // increments + re-fires the effect even on the same photo.
  const [gridOpenNonce, setGridOpenNonce] = useState(0);
  const [applicationCount, setApplicationCount] = useState<number | null>(null);
  // The viewer's own application position (1-indexed) among existing
  // applicants for this job — null if they haven't applied yet. Drives
  // the "you're #3 of 7" banner that replaces the generic "X applied"
  // line for already-applied helpers, so the feed feels accountable.
  const [viewerAppPosition, setViewerAppPosition] = useState<number | null>(null);
  // The auth'd user's ID — used to hide the Share button for jobs the
  // current user posted (they're the owner, not a potential helper).
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  // Repeat-customer count — number of completed jobs between this
  // helper and this poster. Drives the "Worked with you N times"
  // badge that surfaces emotional re-booking trust.
  const [repeatJobs, setRepeatJobs] = useState<number>(0);
  // Cancellation rate of the poster — surfaced inline on the poster
  // card when they have ≥5 jobs of history so a single cancelled job
  // doesn't slap on a 100% rate. Null while loading or when below the
  // sample-size floor.
  const [posterCancelRate, setPosterCancelRate] = useState<number | null>(null);

  // (The viewerSubscriptionTier query lived here for the Helper Pro fee
  // upsell in FeeBreakdown — removed with that upsell, so the per-open
  // profiles fetch went with it.)

  // Viewer's credential tier — used to gate the Apply button when the job
  // requires a minimum tier. Fetched once per session (staleTime 60s) and
  // falls back to 0 gracefully when the RPC doesn't exist yet (PGRST202).
  const { data: viewerTier = 0 } = useQuery({
    queryKey: ["viewerCredentialTier"],
    enabled: !guest,
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return 0;
      try {
        const { data, error } = await supabase.rpc("get_user_credential_tier", {
          p_user_id: user.id,
        });
        // PGRST202 = function not found (migration not yet applied to prod) —
        // treat as tier 0 so open jobs remain accessible.
        if (error) {
          if ((error as { code?: string }).code === "PGRST202") return 0;
          report(error, { tags: { source: "JobDetailDialog.viewerTier" } });
          return 0;
        }
        return typeof data === "number" ? data : 0;
      } catch {
        return 0;
      }
    },
  });

  // Reset transient state when the dialog switches to a new job.
  useEffect(() => {
    setLightboxIndex(null);
    setApplicationCount(null);
    setViewerAppPosition(null);
    setViewerUserId(null);
    setPosterCancelRate(null);
    setDescExpanded(false);
  }, [job?.id]);

  // Record a view when a helper opens this job's detail dialog.
  // Fire-and-forget — we don't block the UI on this. The RPC is
  // idempotent (ON CONFLICT DO NOTHING) so repeated opens are safe.
  // Skip recording if the viewer is the poster (customer_id matches).
  useEffect(() => {
    if (guest || !job?.id) return;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        // Don't record the poster viewing their own job
        if (!user || user.id === job.customer_id) return;
        // record_job_view isn't in the generated Functions map (migration
        // unapplied to prod); call it via a narrowly-typed wrapper. PGRST202
        // is swallowed by the surrounding try/catch.
        const recordJobViewRpc = supabase.rpc.bind(supabase) as unknown as (
          fn: "record_job_view",
          args: { p_job_id: string },
        ) => Promise<{ data: unknown; error: { code?: string } | null }>;
        await recordJobViewRpc("record_job_view", { p_job_id: job.id });
      } catch {
        // Non-critical — PGRST202 (not yet deployed) or network error
      }
    })();
  }, [guest, job?.id, job?.customer_id]);

  // Fetch how many helprs have already applied AND — if the viewer is
  // already in that queue — what position (1-indexed by created_at)
  // they hold. The position is what powers the "you're #3 of 7" banner
  // for an already-applied helper; the raw count powers the original
  // "X helpers applied — you'd be #(X+1)" banner for fresh viewers.
  useEffect(() => {
    if (guest || !job?.id) return;
    let cancelled = false;
    (async () => {
      // We need both the total count AND, for the current user, the
      // index of their application in created_at order. Doing the
      // small list fetch (just ids + created_at + helper_id) and
      // counting locally is cheaper than two round-trips for a job
      // with under ~50 applicants — and the head-count above is
      // already gated to "has the helpr seen this job? yes."
      const [{ data: apps, error }, { data: userRes }] = await Promise.all([
        supabase
          .from("applications")
          .select("id, helper_id, created_at")
          .eq("job_id", job.id)
          .order("created_at", { ascending: true }),
        supabase.auth.getUser(),
      ]);
      if (cancelled) return;
      if (error) {
        report(error, { tags: { source: "JobDetailDialog.applicationCount" } });
        setApplicationCount(0);
        return;
      }
      const rows = apps ?? [];
      setApplicationCount(rows.length);
      const helperId = userRes?.user?.id;
      if (helperId) {
        setViewerUserId(helperId);
        const idx = rows.findIndex((a) => a.helper_id === helperId);
        setViewerAppPosition(idx >= 0 ? idx + 1 : null);
      } else {
        setViewerUserId(null);
        setViewerAppPosition(null);
      }
    })();
    return () => { cancelled = true; };
  }, [guest, job?.id]);

  // Fetch the poster's cancellation rate — shows next to their name on
  // the poster card. Combined poster-side + worked-side rate, capped at
  // a ≥5 sample size so a fresh poster doesn't read "100%" off one
  // cancelled job. Mirrors the math in UserProfile so the inline
  // number matches the profile page if the helpr taps through.
  useEffect(() => {
    if (guest || !job?.customer_id) return;
    let cancelled = false;
    (async () => {
      const customerId = job.customer_id;
      const [postedTotalRes, postedCancelRes, workedTotalRes, workedCancelRes] = await Promise.all([
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", customerId),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", customerId).eq("status", "cancelled"),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("helper_id", customerId),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("helper_id", customerId).eq("status", "cancelled"),
      ]);
      if (cancelled) return;
      // Don't silently swallow a failed count query — a dropped error would
      // skew the rate (a failed `cancelled` count reads as 0 → an
      // artificially clean rate). On any error, report and show no rate.
      const firstError = [postedTotalRes, postedCancelRes, workedTotalRes, workedCancelRes]
        .find((res) => res.error)?.error;
      if (firstError) {
        report(firstError, { tags: { source: "JobDetailDialog.posterCancelRate" } });
        setPosterCancelRate(null);
        return;
      }
      const total = (postedTotalRes.count ?? 0) + (workedTotalRes.count ?? 0);
      const cancelledCount = (postedCancelRes.count ?? 0) + (workedCancelRes.count ?? 0);
      if (total >= 5) setPosterCancelRate((cancelledCount / total) * 100);
      else setPosterCancelRate(null);
    })();
    return () => { cancelled = true; };
  }, [guest, job?.customer_id]);

  // Fetch how many completed jobs the current helper has done for this
  // poster. Drives the repeat-customer badge in the poster card —
  // emotional rebooking signal when the relationship has history.
  useEffect(() => {
    if (guest || !job?.customer_id) {
      setRepeatJobs(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const helperId = userRes?.user?.id;
      if (!helperId || cancelled) return;
      const { count, error } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", job.customer_id)
        .eq("helper_id", helperId)
        .eq("status", "completed");
      if (error) report(error, { tags: { source: "JobDetailDialog.repeatJobs" } });
      if (!cancelled) setRepeatJobs(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [guest, job?.customer_id]);

  // Distance + driving-time estimate for the Where tile. Computed up
  // here (not inside the IIFE below) so the useDrivingTime hook can
  // run at the top level. Falls back to null on either axis when the
  // parish centroid or helpr coords are missing.
  const parishCentroidForDriving = getParishCentroid(job?.parish);
  const distMilesForDriving =
    userLat != null && userLng != null && parishCentroidForDriving
      ? haversineMiles(userLat, userLng, parishCentroidForDriving.lat, parishCentroidForDriving.lng)
      : null;
  const drivingMinutes = useDrivingTime(
    userLat,
    userLng,
    parishCentroidForDriving?.lat ?? null,
    parishCentroidForDriving?.lng ?? null,
    distMilesForDriving,
  );
  const drivingLabel = drivingMinutes == null
    ? null
    : drivingMinutes < 60
      ? `${drivingMinutes} min drive`
      : `${Math.floor(drivingMinutes / 60)}h ${drivingMinutes % 60}m drive`;

  return {
    descExpanded, setDescExpanded,
    lightboxIndex, setLightboxIndex,
    gridOpenNonce, setGridOpenNonce,
    applicationCount,
    viewerAppPosition,
    viewerUserId,
    repeatJobs,
    posterCancelRate,
    viewerTier,
    distMilesForDriving,
    drivingLabel,
  };
}
