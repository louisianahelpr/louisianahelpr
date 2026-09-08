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
  // WHETHER the viewer has applied to this job — null if they haven't. The
  // number itself is NOT meaningful and must never be rendered: RLS on
  // `applications` returns a helper only their OWN row, so the index below is
  // always 0 and the "position" is always 1, for every helper on every job
  // (proven live against prod: the 3rd of 4 applicants sees a count of 1).
  // Kept as a number rather than a boolean only to avoid churning the three
  // call sites that read it for null-ness.
  //
  // A per-open `applicationCount` was computed off the same fetch and returned
  // from this hook, but NO component ever consumed it — and it was equally
  // wrong for the same reason. The real figure is already on the row as
  // `applicant_count`, which `open_jobs_browse` projects; use that if a count
  // is ever wanted here.
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

  // Establish whether the viewer has already applied to this job, and pick up
  // their user id while we're here.
  useEffect(() => {
    if (guest || !job?.id) return;
    let cancelled = false;
    (async () => {
      // This reads as a list fetch but RLS makes it a membership test: the
      // `applications` SELECT policy returns a helper only their own row, so
      // `rows` is either empty or a single self row. It is NOT a census of the
      // queue and must not be counted or indexed for display — see the
      // viewerAppPosition comment above.
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
        report(error, { tags: { source: "JobDetailDialog.viewerApplied" } });
        return;
      }
      const rows = apps ?? [];
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
    // Narrowed HERE, not inside the async body: the existing guard already
    // covered the null case, but reading `job.customer_id` again inside the
    // closure re-widens it. A null customer_id means the poster deleted their
    // account and the job was anonymised (20260901033011).
    const customerId = job?.customer_id;
    if (guest || !customerId) return;
    let cancelled = false;
    (async () => {
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
      const posterId = job?.customer_id;
      // No poster means no repeat-work relationship to count.
      if (!helperId || !posterId || cancelled) return;
      const { count, error } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", posterId)
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
    viewerAppPosition,
    viewerUserId,
    repeatJobs,
    posterCancelRate,
    viewerTier,
    distMilesForDriving,
    drivingLabel,
  };
}
