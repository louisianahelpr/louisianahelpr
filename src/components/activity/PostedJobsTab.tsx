import { useMemo, useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { formatName } from "@/lib/utils";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, Check, Pencil, Play, Plus, SearchX, Sparkles, Star, Users, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { AttachmentLink } from "@/components/AttachmentLink";
import { scoreApplicant, type ApplicantData } from "@/lib/applicantScoring";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { Skeleton } from "@/components/ui/skeleton";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { VirtualList } from "@/components/VirtualList";
import { type Job, type EnrichedApplication } from "./activityConstants";
import { PostedJobCard } from "./PostedJobCard";
import { ActivitySectionedView } from "@/pages/activity/ActivitySectionedView";
import { bucketPostedJob } from "@/pages/activity/activityFilters";
import { useBulkDismiss } from "@/pages/activity/useBulkDismiss";
import { BulkDismissBar } from "@/pages/activity/BulkDismissBar";
import { useLongPress } from "@/hooks/useLongPress";
import { hapticMedium, hapticLight } from "@/lib/haptics";
import type { TrackingData } from "@/components/JobTracking";
import type { GroupHelperLite } from "@/hooks/useActivityData";
import { useQueries, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

/**
 * BulkDismissibleWrapper — when selectionMode is off, presses are
 * forwarded to the underlying card as usual EXCEPT for the long-press
 * which enters selection mode. When selectionMode is on, taps toggle
 * selection and the card's own interactions are intercepted (a thin
 * overlay swallows pointer events) so the user can multi-select
 * without accidentally triggering the card's own actions.
 */
interface BulkDismissibleWrapperProps {
  selectionMode: boolean;
  selected: boolean;
  onLongPress: () => void;
  onTapInSelection: () => void;
  children: React.ReactNode;
}

function BulkDismissibleWrapper({
  selectionMode,
  selected,
  onLongPress,
  onTapInSelection,
  children,
}: BulkDismissibleWrapperProps) {
  const longPressProps = useLongPress({
    threshold: 500,
    onLongPress: () => {
      hapticMedium();
      onLongPress();
    },
  });

  return (
    <div
      // Don't add long-press while already in selection mode — taps
      // should toggle selection cleanly without an additional 500ms hold.
      {...(selectionMode ? {} : longPressProps)}
      className="relative"
      style={{ touchAction: selectionMode ? "manipulation" : undefined }}
    >
      {/* Selection overlay — only active in selection mode. Captures
          taps to toggle and renders a checkbox in the corner. The
          overlay sits above the card content so clicks on links/buttons
          inside the card are blocked while selecting. */}
      {selectionMode && (
        <button
          type="button"
          onClick={onTapInSelection}
          aria-pressed={selected}
          aria-label={selected ? "Deselect this post" : "Select this post"}
          className="absolute inset-0 z-10 rounded-ds-md transition"
          style={{
            background: selected
              ? "hsl(var(--bark) / 0.18)"
              : "hsl(var(--olivewood) / 0.04)",
            border: selected
              ? "1.5px solid hsl(var(--bark))"
              : "1.5px solid hsl(var(--olivewood) / 0.2)",
          }}
        >
          {/* Checkbox glyph — top-right so it doesn't fight the avatar
              or title-bar that anchors the card on the left. */}
          <span
            className="absolute top-3 right-3 w-6 h-6 rounded-full inline-flex items-center justify-center"
            style={{
              background: selected ? "hsl(var(--bark))" : "hsl(var(--parchment))",
              border: selected
                ? "1.5px solid hsl(var(--bark))"
                : "1.5px solid hsl(var(--olivewood) / 0.35)",
              boxShadow: "0 1px 3px hsl(var(--olivewood) / 0.18)",
            }}
            aria-hidden="true"
          >
            {selected && <Check className="w-3.5 h-3.5" style={{ color: "hsl(var(--parchment))" }} strokeWidth={3} />}
          </span>
        </button>
      )}
      {children}
    </div>
  );
}

interface PostedJobsTabProps {
  jobs: Job[];
  applicantCounts: Record<string, number>;
  expandedJobId: string | null;
  setExpandedJobId: (id: string | null) => void;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  startRequestedJobIds: Set<string>;
  /** Batched per-card tracking + group-helper data, pre-fetched by
      useActivityData. Hoisted here so each <JobTracking>/<GroupJobHelpers>
      doesn't re-fetch on mount (N+1 across active cards). */
  latestTracking: Record<string, TrackingData | null>;
  groupHelpersByJob: Record<string, GroupHelperLite[]>;
  userId: string;
  onBoost: (jobId: string) => void;
  onEdit: (job: Job) => void;
  onCancel: (job: Job) => void;
  onComplete: (jobId: string) => void;
  completingJobId: string | null;
  onRevision: (jobId: string) => void;
  onNoShow: (jobId: string) => void;
  onTip: (jobId: string, helperName: string) => void;
  onReview: (job: Job) => void;
  onDispute: (job: Job) => void;
  /** Open the read-only timeline + follow-up evidence uploader for a
   *  job that's already in dispute. */
  onViewDispute: (job: Job) => void;
  onConfirmStart: (jobId: string) => void;
  onConfirmArrival: (jobId: string) => void;
  onConfirmWorking: (jobId: string) => void;
  onLoadApplications: (job: Job) => void;
  selectedJob: Job | null;
  setSelectedJob: (job: Job | null) => void;
  applications: EnrichedApplication[];
  /** True while the full-screen applicants fetch is in-flight. */
  applicationsLoading?: boolean;
  /** True when the full-screen applicants fetch failed. */
  applicationsError?: boolean;
  onAcceptApplication: (app: EnrichedApplication) => void;
  onDeclineApplication: (app: EnrichedApplication, note: string, jobTitle: string) => void;
  onLoadInlineApplicants: (jobId: string) => void;
  inlineApplicants: Record<string, EnrichedApplication[]>;
  loadingApplicants: Record<string, boolean>;
  applicantErrors: Record<string, boolean>;
  /** Refetch the feed after an inline card mutation (e.g. dispute action). */
  onActionComplete: () => void;
  /** When true, render items grouped into collapsible Active /
   *  Completed / Cancelled sections instead of a flat virtualized
   *  list. Driven by the page-level "All" status filter. The page's
   *  outer header (ActivityHeader) is the sole source of truth for
   *  filter + search in both modes. */
  groupByStatus?: boolean;
}

export const PostedJobsTab = ({
  jobs, applicantCounts, expandedJobId, setExpandedJobId,
  helperNames, completedJobMeta, startRequestedJobIds,
  latestTracking, groupHelpersByJob, userId,
  onBoost, onEdit, onCancel, onComplete, completingJobId,
  onRevision, onNoShow, onTip, onReview, onDispute, onViewDispute, onConfirmStart, onConfirmArrival, onConfirmWorking,
  onLoadApplications, selectedJob, setSelectedJob, applications,
  applicationsLoading = false, applicationsError = false,
  onAcceptApplication, onDeclineApplication, onLoadInlineApplicants,
  inlineApplicants, loadingApplicants, applicantErrors,
  onActionComplete, groupByStatus = false,
}: PostedJobsTabProps) => {
  const navigate = useNavigate();

  // Sort order for the applicants comparison panel.
  // "recommended" = multi-factor score desc (default)
  // "rated"       = avgRating desc, then reviewCount desc
  // "soonest"     = created_at asc (first to apply)
  // "bid_asc"     = proposed_price asc (cheapest first; accept_bids jobs only)
  // "bid_desc"    = proposed_price desc (highest first; accept_bids jobs only)
  const [applicantSort, setApplicantSort] = useState<"recommended" | "rated" | "soonest" | "bid_asc" | "bid_desc">("recommended");
  // Video preview modal — stores the URL of the video currently playing.
  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);

  // Counter-offer state — keyed by application id.
  // `counterInputs`  — the current text in each counter price input.
  // `counterShowing` — which app id currently has the inline counter form open.
  // `counterSending` — set while the RPC is in-flight so the button disables.
  const [counterInputs, setCounterInputs] = useState<Record<string, string>>({});
  const [counterShowing, setCounterShowing] = useState<string | null>(null);
  // Optimistic negotiation state — tracks pending/sent counters in local
  // state so the UI updates immediately without waiting for a refetch.
  const [localNegotiation, setLocalNegotiation] = useState<Record<string, { status: string; price: number | null }>>({});
  const [counterSending, setCounterSending] = useState(false);

  // Decline confirmation sheet — open when poster taps "Decline" on an applicant.
  // `declineTarget` holds the app being declined; the sheet collects an optional
  // note + a reason chip before calling onDeclineApplication.
  const [declineTarget, setDeclineTarget] = useState<EnrichedApplication | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const [declineReason, setDeclineReason] = useState<string | null>(null);
  const [declineSending, setDeclineSending] = useState(false);
  const DECLINE_NOTE_MAX = 200;
  const DECLINE_REASONS = ["Found someone else", "Job is on hold", "Not the right fit"] as const;

  const handleCounter = useCallback(async (appId: string, counterPrice: number) => {
    setCounterSending(true);
    try {
      const { error } = await (supabase.rpc as any)("counter_application_bid", {
        p_application_id: appId,
        p_counter_price: counterPrice,
      });
      if (error) {
        if ((error as any).code === "PGRST202") {
          toast.error("Counter-offer feature not yet deployed — try again later.");
        } else {
          toast.error("Couldn't send counter-offer. Please try again.");
        }
        return;
      }
      toast.success("Counter sent! Waiting for the helpr's response.");
      // Optimistic update so the UI reflects the sent counter immediately.
      setLocalNegotiation((prev) => ({ ...prev, [appId]: { status: "countered", price: counterPrice } }));
      setCounterShowing(null);
      setCounterInputs((prev) => { const next = { ...prev }; delete next[appId]; return next; });
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setCounterSending(false);
    }
  }, []);

  const handleDeclineConfirm = useCallback(async () => {
    if (!declineTarget || !selectedJob) return;
    setDeclineSending(true);
    // Build the full note: prepend the selected reason chip if one was tapped.
    const fullNote = [declineReason, declineNote.trim()].filter(Boolean).join(" — ");
    await onDeclineApplication(declineTarget, fullNote, selectedJob.title);
    setDeclineTarget(null);
    setDeclineNote("");
    setDeclineReason(null);
    setDeclineSending(false);
  }, [declineTarget, declineNote, declineReason, selectedJob, onDeclineApplication]);

  // Bulk-dismiss for cancelled posts — long-press a Cancelled card to
  // enter selection mode, then bulk-hide them from view. The hide is
  // local (sessionStorage) so the audit record on the server stays
  // intact.
  const bulkDismiss = useBulkDismiss("posted");

  // Neighbor hire counts — one RPC call per applicant, keyed by helper_id.
  // Runs only when the selected job has coordinates (many jobs have
  // approximate coords from geocoding at post time). Falls back to 0
  // on PGRST202 (function not yet deployed) or any other error so the
  // panel is never blocked by the trust-graph migration.
  const neighborCountQueries = useQueries({
    queries: applications.map((app) => ({
      queryKey: ["neighbor-count", app.helper_id, selectedJob?.latitude, selectedJob?.longitude],
      queryFn: async (): Promise<number> => {
        if (!selectedJob?.latitude || !selectedJob?.longitude) return 0;
        try {
          const { data, error } = await supabase.rpc("get_neighbor_hire_count", {
            p_helper_id: app.helper_id,
            p_lat: selectedJob.latitude,
            p_lng: selectedJob.longitude,
          });
          if (error) return 0;
          return (data as number) ?? 0;
        } catch {
          return 0; // PGRST202 or network error — degrade gracefully
        }
      },
      staleTime: 300_000, // 5 min — neighborhood data is slow-moving
      enabled: !!selectedJob?.latitude && !!selectedJob?.longitude,
    })),
  });

  // Map helper_id → neighbor count for O(1) lookup in scoring + rendering.
  const neighborCountMap = useMemo(() => {
    const map = new Map<string, number>();
    applications.forEach((app, i) => {
      map.set(app.helper_id, neighborCountQueries[i]?.data ?? 0);
    });
    return map;
  }, [applications, neighborCountQueries]);

  // Deduplicated helper ids — stable reference so the completed-counts
  // query key doesn't churn on every render.
  const helperIds = useMemo(
    () => [...new Set(applications.map((a) => a.helper_id))],
    [applications],
  );

  // Batch-fetch completed job counts for all applicants in one RPC call.
  // Feeds the completedJobs dimension in scoreApplicant so the
  // "Recommended" sort can rank more experienced helpers higher.
  // Falls back to {} on PGRST202 (migration not yet deployed on prod)
  // or any other error so the panel is never blocked.
  const { data: completedCountsData } = useQuery({
    queryKey: ["helper-completed-counts", helperIds],
    queryFn: async (): Promise<Map<string, number>> => {
      if (helperIds.length === 0) return new Map();
      const { data, error } = await (supabase.rpc as any)("get_helper_completed_counts", {
        p_user_ids: helperIds,
      });
      if (error) return new Map(); // PGRST202 or any other error — degrade gracefully
      const map = new Map<string, number>();
      if (Array.isArray(data)) {
        for (const row of data as Array<{ user_id: string; completed_jobs: number }>) {
          map.set(row.user_id, Number(row.completed_jobs));
        }
      }
      return map;
    },
    staleTime: 5 * 60 * 1000, // 5 min — completed counts are slow-moving
    enabled: applications.length > 0,
  });
  const completedCountsMap: Map<string, number> = completedCountsData ?? new Map();

  // Batch-fetch repeat-hire percents for all applicants in one RPC call.
  // Returns the share of unique customers who hired a helper more than once.
  // Minimum 3 unique customers required before a result is emitted so the
  // stat isn't skewed by very sparse histories.
  // Falls back to an empty Map on PGRST202 or any other error.
  const { data: repeatHireData } = useQuery({
    queryKey: ["helper-repeat-hire-percents", helperIds],
    queryFn: async (): Promise<Map<string, number>> => {
      if (helperIds.length === 0) return new Map();
      const { data, error } = await (supabase.rpc as any)("get_helper_repeat_hire_percents", {
        p_user_ids: helperIds,
      });
      if (error) return new Map(); // PGRST202 or any other error — degrade gracefully
      const map = new Map<string, number>();
      if (Array.isArray(data)) {
        for (const row of data as Array<{ user_id: string; repeat_hire_percent: number }>) {
          map.set(row.user_id, Number(row.repeat_hire_percent));
        }
      }
      return map;
    },
    staleTime: 10 * 60 * 1000, // 10 min — repeat-hire % is slow-moving
    enabled: applications.length > 0,
  });
  const repeatHireMap: Map<string, number> = repeatHireData ?? new Map();

  // Batch-fetch on-time arrival percents for all applicants in one RPC call.
  // Measures how often a helper arrived within 10 min of the scheduled start.
  // Minimum 5 timed jobs required before a result is emitted.
  // Falls back to an empty Map on PGRST202 or any other error.
  const { data: onTimeData } = useQuery({
    queryKey: ["helper-on-time-percents", helperIds],
    queryFn: async (): Promise<Map<string, number>> => {
      if (helperIds.length === 0) return new Map();
      const { data, error } = await (supabase.rpc as any)("get_helper_on_time_percents", {
        p_user_ids: helperIds,
      });
      if (error) return new Map(); // PGRST202 or any other error — degrade gracefully
      const map = new Map<string, number>();
      if (Array.isArray(data)) {
        for (const row of data as Array<{ user_id: string; on_time_percent: number }>) {
          map.set(row.user_id, Number(row.on_time_percent));
        }
      }
      return map;
    },
    staleTime: 10 * 60 * 1000, // 10 min — on-time % is slow-moving
    enabled: applications.length > 0,
  });
  const onTimeMap: Map<string, number> = onTimeData ?? new Map();

  // Batch-fetch distances (km) from the selected job to each applicant.
  // Requires profiles.latitude/longitude (trust-graph migration) and
  // jobs.latitude/longitude (set at post time via geocoding).
  // Falls back to an empty Map on PGRST202 or any other error.
  // Only enabled when a job is selected and has coordinates.
  const { data: distanceData } = useQuery({
    queryKey: ["helper-distances-from-job", selectedJob?.id, helperIds],
    queryFn: async (): Promise<Map<string, number>> => {
      if (helperIds.length === 0 || !selectedJob?.id) return new Map();
      const { data, error } = await (supabase.rpc as any)("get_helper_distances_from_job", {
        p_job_id: selectedJob.id,
        p_user_ids: helperIds,
      });
      if (error) return new Map(); // PGRST202 or any other error — degrade gracefully
      const map = new Map<string, number>();
      if (Array.isArray(data)) {
        for (const row of data as Array<{ user_id: string; distance_km: number }>) {
          map.set(row.user_id, Number(row.distance_km));
        }
      }
      return map;
    },
    staleTime: 5 * 60 * 1000, // 5 min — distance is stable for a given job
    enabled: helperIds.length > 0 && !!selectedJob?.id && selectedJob.latitude != null,
  });
  const distanceMap: Map<string, number> = distanceData ?? new Map();

  // Batch-fetch view counts for all posted jobs so each PostedJobCard
  // can show "Seen by X helprs" without N+1 queries. Falls back to {}
  // on PGRST202 (function not yet deployed to production).
  const jobIds = useMemo(() => jobs.map((j) => j.id), [jobs]);
  const { data: viewCountsData } = useQuery({
    queryKey: ["job-view-counts", jobIds],
    queryFn: async (): Promise<Record<string, number>> => {
      if (jobIds.length === 0) return {};
      const { data, error } = await (supabase.rpc as any)("get_job_view_counts", {
        p_job_ids: jobIds,
      });
      if (error) {
        // PGRST202 = function not yet deployed to production — degrade gracefully
        if ((error as { code?: string }).code === "PGRST202") return {};
        // Other errors: swallow so the feed still renders
        return {};
      }
      const result: Record<string, number> = {};
      if (Array.isArray(data)) {
        for (const row of data as Array<{ job_id: string; view_count: number }>) {
          result[row.job_id] = Number(row.view_count);
        }
      }
      return result;
    },
    staleTime: 60_000, // 1 min — view counts are informational, not real-time
    enabled: jobIds.length > 0,
  });
  const viewCounts: Record<string, number> = viewCountsData ?? {};

  // Build per-job analytics for the PostedJobCard mini-panel.
  // Uses the already-fetched viewCounts + applicantCounts + inlineApplicants
  // (for bid prices on accept_bids jobs). No extra queries needed.
  const jobAnalyticsMap = useMemo(() => {
    const map: Record<string, {
      viewCount: number;
      applicantCount: number;
      conversionRate: number | null;
      bidMin: number | null;
      bidMax: number | null;
      bidAvg: number | null;
    }> = {};
    for (const job of jobs) {
      const views = viewCounts[job.id] ?? 0;
      const appCount = applicantCounts[job.id] ?? 0;
      const conversionRate = views > 0 ? Math.round((appCount / views) * 100) : null;

      // Bid prices — derive from inline applicants if loaded; otherwise null
      const apps = inlineApplicants[job.id] ?? [];
      const bids = apps
        .map((a) => (a as any).proposed_price)
        .filter((p): p is number => typeof p === "number" && p > 0);

      map[job.id] = {
        viewCount: views,
        applicantCount: appCount,
        conversionRate,
        bidMin: bids.length > 0 ? Math.min(...bids) : null,
        bidMax: bids.length > 0 ? Math.max(...bids) : null,
        bidAvg: bids.length > 0 ? bids.reduce((a, b) => a + b, 0) / bids.length : null,
      };
    }
    return map;
  }, [jobs, viewCounts, applicantCounts, inlineApplicants]);

  // Build scored + sorted applicant list for the comparison panel.
  // Scoring is purely client-side — no extra queries needed.
  // The score map is keyed by helper_id so the "Recommended" badge
  // can identify the top pick in O(1).
  const { sortedApplications, scoreMap } = useMemo(() => {
    type ScoredApp = { app: EnrichedApplication; score: number; signals: string[]; neighborCount: number };
    if (applications.length === 0) return { sortedApplications: [] as ScoredApp[], scoreMap: new Map<string, number>() };

    const map = new Map<string, number>();
    const scored = applications.map((app) => {
      // Map EnrichedApplication fields onto ApplicantData — pass null
      // for fields the current query doesn't return so the scoring
      // function skips those dimensions gracefully.
      const tier = app.profiles?.subscription_tier;
      // subscription_tier ("elite"=3, "pro"=2, "basic"=1, else 0) is
      // the closest proxy for credentialTier available without a migration.
      const credentialTier = tier === "elite" ? 3 : tier === "pro" ? 2 : tier === "basic" ? 1 : 0;
      const neighborCount = neighborCountMap.get(app.helper_id) ?? 0;
      const data: ApplicantData = {
        userId: app.helper_id,
        avgRating: app.avgRating ?? null,
        reviewCount: app.reviewCount ?? 0,
        completedJobs: completedCountsMap.get(app.helper_id) ?? 0,
        repeatHirePercent: repeatHireMap.get(app.helper_id) ?? null,
        onTimePercent: onTimeMap.get(app.helper_id) ?? null,
        credentialTier,
        distanceKm: distanceMap.get(app.helper_id) ?? null,
        responseTimeMinutes: null,
        neighborCount,           // live from get_neighbor_hire_count RPC
        stakeAmount: (app as any).stake_amount ?? null,
      };
      const result = scoreApplicant(data);
      map.set(app.helper_id, result.score);
      return { app, score: result.score, signals: result.signals, neighborCount };
    });

    const sorted = [...scored];
    if (applicantSort === "recommended") {
      sorted.sort((a, b) => b.score - a.score);
    } else if (applicantSort === "rated") {
      sorted.sort((a, b) => {
        const ratingDiff = (b.app.avgRating ?? 0) - (a.app.avgRating ?? 0);
        if (ratingDiff !== 0) return ratingDiff;
        return (b.app.reviewCount ?? 0) - (a.app.reviewCount ?? 0);
      });
    } else if (applicantSort === "soonest") {
      // "soonest" = first to apply (ascending created_at)
      sorted.sort((a, b) => a.app.created_at.localeCompare(b.app.created_at));
    } else if (applicantSort === "bid_asc") {
      // Cheapest bid first; apps without a bid go to the end
      sorted.sort((a, b) => {
        const pa = (a.app as any).proposed_price ?? Infinity;
        const pb = (b.app as any).proposed_price ?? Infinity;
        return pa - pb;
      });
    } else if (applicantSort === "bid_desc") {
      // Highest bid first; apps without a bid go to the end
      sorted.sort((a, b) => {
        const pa = (a.app as any).proposed_price ?? -Infinity;
        const pb = (b.app as any).proposed_price ?? -Infinity;
        return pb - pa;
      });
    }

    return { sortedApplications: sorted, scoreMap: map };
  }, [applications, applicantSort, neighborCountMap, completedCountsMap, repeatHireMap, onTimeMap, distanceMap]);

  // Private poster notes — stored in localStorage, never sent to the server.
  // Must be declared after sortedApplications (useMemo above) because the
  // useEffect dependency array evaluates sortedApplications.length at render.
  const [applicantNotes, setApplicantNotes] = useState<Record<string, string>>({});
  const [noteEditing, setNoteEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  useEffect(() => {
    const notes: Record<string, string> = {};
    for (const { app } of sortedApplications) {
      const saved = localStorage.getItem(`helpr_applicant_note_${app.id}`);
      if (saved) notes[app.id] = saved;
    }
    setApplicantNotes(notes);
  }, [sortedApplications.length]);

  const saveNote = useCallback((appId: string) => {
    const trimmed = noteDraft.trim();
    if (trimmed) {
      localStorage.setItem(`helpr_applicant_note_${appId}`, trimmed);
    } else {
      localStorage.removeItem(`helpr_applicant_note_${appId}`);
    }
    setApplicantNotes((prev) => {
      const next = { ...prev };
      if (trimmed) next[appId] = trimmed;
      else delete next[appId];
      return next;
    });
    setNoteEditing(null);
    setNoteDraft("");
  }, [noteDraft]);

  // The top recommended applicant — used to render the badge.
  const topHelperIdByScore = useMemo(() => {
    if (applications.length === 0) return null;
    let topId: string | null = null;
    let topScore = -Infinity;
    scoreMap.forEach((score, id) => {
      if (score > topScore) { topScore = score; topId = id; }
    });
    return topId;
  }, [applications, scoreMap]);

  // When switching to a bid-mode job, default the sort to bid_asc so the
  // cheapest applicant surfaces first. Non-bid jobs fall back to "recommended".
  useEffect(() => {
    const expandedJob = jobs.find((j) => j.id === expandedJobId);
    if ((expandedJob as any)?.pricing_mode === "accept_bids") {
      setApplicantSort("bid_asc");
    } else {
      setApplicantSort("recommended");
    }
  }, [expandedJobId]);

  // Aggregate stats for the at-a-glance summary strip — computed once
  // from the full (unfiltered) jobs array so the numbers reflect the
  // poster's total history, not just the current filter view.
  const posterStats = useMemo(() => {
    const postedTotal = jobs.length;
    const completedTotal = jobs.filter((j) => j.status === "completed").length;
    const cancelledTotal = jobs.filter((j) => j.status === "cancelled").length;
    const activeTotal = jobs.filter((j) =>
      ["open", "accepted", "in_progress"].includes(j.status),
    ).length;
    const finishedTotal = postedTotal - activeTotal;
    const completionRate =
      finishedTotal > 0
        ? Math.round((completedTotal / finishedTotal) * 100)
        : null;
    const totalSpent = jobs
      .filter((j) => j.status === "completed")
      .reduce((sum, j) => sum + (j.budget ?? 0), 0);
    return { postedTotal, completedTotal, cancelledTotal, activeTotal, completionRate, totalSpent };
  }, [jobs]);

  // Filter the incoming jobs through the dismissed set so a previously
  // hidden cancelled job stays hidden across re-renders. Cancelled jobs
  // are the only ones that can be dismissed; a non-cancelled job in the
  // dismissed set is a stale entry and is rendered normally.
  const visibleJobs = useMemo(
    () => jobs.filter((j) => {
      if (j.status !== "cancelled" && j.status !== "disputed") return true;
      return !bulkDismiss.dismissed.has(j.id);
    }),
    [jobs, bulkDismiss.dismissed],
  );

  // One source of truth for the per-row render so both the flat
  // VirtualList view and the grouped Sectioned view paint identical
  // cards. Cancelled cards get a long-press / checkbox wrapper that
  // drives the bulk-dismiss flow.
  const renderJobCard = (job: Job) => {
    const card = (
      <PostedJobCard
        job={job}
        applicantCounts={applicantCounts}
        expandedJobId={expandedJobId}
        setExpandedJobId={setExpandedJobId}
        helperNames={helperNames}
        completedJobMeta={completedJobMeta}
        startRequestedJobIds={startRequestedJobIds}
        viewCount={viewCounts[job.id]}
        jobAnalytics={jobAnalyticsMap[job.id]}
        // `latestTracking[job.id]` may legitimately be `null` ("we
        // looked, no row exists") — the card forwards that down so
        // <JobTracking> skips its own initial fetch. If the key is
        // absent (e.g. a not-yet-active job), the card passes
        // `undefined` and JobTracking falls back to its own query.
        initialTracking={latestTracking[job.id]}
        initialGroupHelpers={groupHelpersByJob[job.id]}
        userId={userId}
        onBoost={onBoost}
        onEdit={onEdit}
        onCancel={onCancel}
        onComplete={onComplete}
        completingJobId={completingJobId}
        onRevision={onRevision}
        onNoShow={onNoShow}
        onTip={onTip}
        onReview={onReview}
        onDispute={onDispute}
        onViewDispute={onViewDispute}
        onConfirmStart={onConfirmStart}
        onConfirmArrival={onConfirmArrival}
        onConfirmWorking={onConfirmWorking}
        onLoadApplications={onLoadApplications}
        onLoadInlineApplicants={onLoadInlineApplicants}
        inlineApplicants={inlineApplicants}
        loadingApplicants={loadingApplicants}
        applicantErrors={applicantErrors}
        onActionComplete={onActionComplete}
      />
    );
    const isCancelled = job.status === "cancelled" || job.status === "disputed";
    if (!isCancelled) return card;
    return (
      <BulkDismissibleWrapper
        selectionMode={bulkDismiss.selectionMode}
        selected={bulkDismiss.selected.has(job.id)}
        onLongPress={() => bulkDismiss.enterSelectionMode(job.id)}
        onTapInSelection={() => bulkDismiss.toggleSelected(job.id)}
      >
        {card}
      </BulkDismissibleWrapper>
    );
  };

  if (jobs.length === 0) {
    return (
      <EmptyState
        variant="inline"
        icon={Wrench}
        illustration={<EmptyStateIllustration variant="posts" />}
        title="No posts yet in this view"
        body="Post your first task and we'll match you with ID-verified Louisiana helprs nearby."
        action={
          <Button onClick={() => navigate("/post-job")} className="rounded-ds-md btn-press">
            <Wrench className="w-4 h-4 mr-1.5" /> Post a job
          </Button>
        }
      />
    );
  }

  // The page header (ActivityHeader) owns the only search + status
  // filter — both modes render the already-filtered list. "All" routes
  // through the collapsible 3-section grouped shell; a specific status
  // renders a flat list. The applicants full-screen modal renders below
  // as a sibling so it surfaces in either mode.
  const listView = groupByStatus ? (
    <ActivitySectionedView
      tab="posted"
      items={visibleJobs}
      getKey={(job) => job.id}
      bucketize={bucketPostedJob}
      renderItem={renderJobCard}
    />
  ) : visibleJobs.length === 0 ? (
    <EmptyState
      variant="inline"
      icon={SearchX}
      title="No matches in this view"
      body="Nothing here fits that filter yet — try a different status from the filter button to see more."
    />
  ) : (
    <VirtualList
      items={visibleJobs}
      getKey={(job) => job.id}
      estimateSize={260}
      overscan={4}
      className="space-y-0"
      itemClassName="pb-3"
      renderItem={renderJobCard}
    />
  );

  return (
    <div className="space-y-4">
      {/* Aggregate stats summary strip — visible whenever there are posts.
          Scrolls horizontally on narrow screens; chips snap to the start
          edge so partial reveal cues the user to scroll further. */}
      {jobs.length > 0 && (
        <div
          className="flex gap-3 overflow-x-auto pb-0.5 no-scrollbar -mx-1 px-1"
          style={{ scrollSnapType: "x mandatory" }}
        >
          {[
            { label: "Posted", value: posterStats.postedTotal.toString() },
            { label: "Completed", value: posterStats.completedTotal.toString() },
            posterStats.completionRate !== null
              ? { label: "Done rate", value: `${posterStats.completionRate}%` }
              : null,
            posterStats.totalSpent > 0
              ? { label: "Total spent", value: `$${posterStats.totalSpent.toFixed(0)}` }
              : null,
            posterStats.activeTotal > 0
              ? { label: "Active", value: posterStats.activeTotal.toString() }
              : null,
          ]
            .filter((s): s is { label: string; value: string } => s !== null)
            .map((stat) => (
              <div
                key={stat.label}
                className="shrink-0 rounded-ds-md px-3 py-2 text-center"
                style={{
                  background: "hsl(var(--parchment) / 0.5)",
                  border: "1px solid hsl(var(--olivewood) / 0.1)",
                  scrollSnapAlign: "start",
                  minWidth: "5.5rem",
                }}
              >
                <p
                  className="text-ds-17 font-bold leading-none"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {stat.value}
                </p>
                <p className="text-ds-11 mt-0.5 text-muted-foreground">{stat.label}</p>
              </div>
            ))}
        </div>
      )}

      {listView}

      {/* Sticky bottom bulk-dismiss bar — surfaces only in selection
          mode. Long-pressing a Cancelled card enters this mode. */}
      {bulkDismiss.selectionMode && (
        <BulkDismissBar
          selectedCount={bulkDismiss.stats.selectedCount}
          onDismiss={bulkDismiss.dismissSelected}
          onCancel={bulkDismiss.exitSelectionMode}
        />
      )}

      {/* Applicants full-screen comparison view */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 flex flex-col animate-in slide-in-from-right duration-200" style={{ background: "hsl(var(--parchment))" }}>
          {/* Header */}
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{
              borderBottom: "0.5px solid hsl(var(--bark) / 0.12)",
              background: "hsla(0, 0%, 100%, 0.72)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              className="btn-press -ml-1 h-9 w-9 p-0 shrink-0"
              aria-label="Back to posted jobs"
              onClick={() => setSelectedJob(null)}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <h2
                className="font-display italic font-bold leading-tight truncate"
                style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                Applicants
              </h2>
              <p className="text-ds-11 font-serif italic truncate" style={{ color: "hsl(var(--olivewood) / 0.80)" }}>
                {selectedJob.title}
              </p>
            </div>
          </div>

          {/* Modal body — capped at iPad-comfortable width */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="max-w-2xl mx-auto w-full">
              {applicationsLoading ? (
                /* Loading: 2 skeleton cards matching the real card height */
                <div className="space-y-3" aria-label="Loading applicants" aria-busy="true">
                  {[0, 1].map((i) => (
                    <div
                      key={i}
                      className="rounded-ds-md p-3.5 flex items-start gap-3"
                      style={{
                        backgroundColor: "hsla(0, 0%, 100%, 0.55)",
                        backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                        border: "0.5px solid hsl(var(--bark) / 0.18)",
                      }}
                    >
                      <Skeleton className="w-11 h-11 rounded-full shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-3.5 w-2/5" />
                        <Skeleton className="h-3 w-3/5" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                      <Skeleton className="h-9 w-16 rounded-ds-sm shrink-0" />
                    </div>
                  ))}
                </div>
              ) : applicationsError ? (
                /* Error state */
                <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-6">
                  <AlertCircle className="w-8 h-8 text-destructive" />
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground text-ds-15">Couldn't load applicants</p>
                    <p className="text-ds-13 text-muted-foreground">Check your connection and try again.</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-ds-md btn-press"
                    onClick={() => onLoadApplications(selectedJob)}
                  >
                    Retry
                  </Button>
                </div>
              ) : applications.length === 0 ? (
                /* Empty state — warmer copy when no one has applied yet */
                <div className="flex flex-col items-center text-center gap-5 pt-12 pb-6 px-6">
                  <div
                    className="w-14 h-14 rounded-full inline-flex items-center justify-center"
                    style={{ background: "hsl(var(--burnt-sienna) / 0.10)" }}
                  >
                    <Users className="w-7 h-7" style={{ color: "hsl(var(--burnt-sienna) / 0.7)" }} strokeWidth={1.5} />
                  </div>
                  <div className="space-y-1.5">
                    <p
                      className="font-display italic font-bold"
                      style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
                    >
                      No one has applied yet
                    </p>
                    <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.80)" }}>
                      Your job was just posted! Sharing it reaches more helprs nearby.
                    </p>
                  </div>
                  <ShareJobButton
                    job={{ id: selectedJob.id, title: selectedJob.title, budget: selectedJob.budget, category: selectedJob.category }}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  {/* Sort control — horizontal pill row */}
                  <div className="flex items-center gap-1.5 mb-4 flex-wrap" role="group" aria-label="Sort applicants by">
                    {(["recommended", "rated", "soonest"] as const).map((opt) => {
                      const label = opt === "recommended" ? "Recommended" : opt === "rated" ? "Highest rated" : "Soonest available";
                      const active = applicantSort === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setApplicantSort(opt)}
                          aria-pressed={active}
                          className="px-3 py-1.5 rounded-full text-ds-11 font-sans font-semibold transition-all duration-150 active:scale-95"
                          style={{
                            background: active ? "hsl(var(--bark) / 0.10)" : "hsla(0, 0%, 100%, 0.45)",
                            color: active ? "hsl(var(--bark))" : "hsl(var(--olivewood) / 0.80)",
                            border: active
                              ? "0.5px solid hsl(var(--bark) / 0.3)"
                              : "0.5px solid hsl(var(--bark) / 0.12)",
                            backdropFilter: "blur(12px)",
                            WebkitBackdropFilter: "blur(12px)",
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                    {/* Bid price sort — only shown for accept_bids jobs with at least one bid */}
                    {(selectedJob as any).pricing_mode === "accept_bids" &&
                      sortedApplications.some((sa) => (sa.app as any).proposed_price != null) && (
                        <>
                          {(["bid_asc", "bid_desc"] as const).map((opt) => {
                            const label = opt === "bid_asc" ? "Lowest bid" : "Highest bid";
                            const active = applicantSort === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => setApplicantSort(opt)}
                                aria-pressed={active}
                                className="px-3 py-1.5 rounded-full text-ds-11 font-sans font-semibold transition-all duration-150 active:scale-95"
                                style={{
                                  background: active ? "hsl(var(--heritage-gold) / 0.15)" : "hsl(var(--parchment) / 0.5)",
                                  color: active ? "hsl(var(--heritage-gold))" : "hsl(var(--olivewood) / 0.80)",
                                  border: active
                                    ? "1px solid hsl(var(--heritage-gold) / 0.4)"
                                    : "1px solid hsl(var(--olivewood) / 0.15)",
                                  backdropFilter: "blur(12px)",
                                  WebkitBackdropFilter: "blur(12px)",
                                }}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </>
                    )}
                  </div>

                  {/* Applicant cards */}
                  {sortedApplications.map(({ app, signals, neighborCount }) => {
                    const helperTier = (app.profiles?.subscription_tier ?? "free") as string;
                    const isElite = helperTier === "elite";
                    const isPro = helperTier === "pro";
                    const haloColor = isElite
                      ? "hsl(var(--gold-warm))"
                      : isPro
                        ? "hsl(var(--burnt-sienna))"
                        : null;
                    const helperName = formatName(app.profiles?.full_name, "Helpr");
                    const helperInitials = helperName
                      .split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
                    const isTopPick = applicantSort === "recommended" && app.helper_id === topHelperIdByScore && applications.length > 1;
                    // Show up to 3 trust signals as inline text (scoring signals
                    // already include the neighbor signal when neighborCount > 0)
                    const visibleSignals = signals.slice(0, 3);

                    return (
                      <div key={app.id}>
                        {/* "Helpr Recommended" badge above the top pick */}
                        {isTopPick && (
                          <div className="flex items-center gap-1.5 mb-1.5 pl-1">
                            <Sparkles className="w-3 h-3" style={{ color: "hsl(var(--burnt-sienna))" }} />
                            <span
                              className="text-ds-10 font-sans font-semibold uppercase"
                              style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.06em" }}
                            >
                              Helpr Recommended
                            </span>
                          </div>
                        )}

                        {/* Compact applicant card */}
                        <div
                          className="rounded-ds-md p-3.5 space-y-2.5"
                          style={{
                            backgroundColor: "hsla(0, 0%, 100%, 0.55)",
                            backdropFilter: "blur(16px)",
                            WebkitBackdropFilter: "blur(16px)",
                            border: isTopPick
                              ? "0.5px solid hsl(var(--burnt-sienna) / 0.30)"
                              : "0.5px solid hsl(var(--bark) / 0.18)",
                            boxShadow: isTopPick
                              ? "0 0 0 2px hsl(var(--burnt-sienna) / 0.08), inset 0 1px 1px 0 rgba(255,255,255,0.55)"
                              : "inset 0 1px 1px 0 rgba(255,255,255,0.55)",
                          }}
                        >
                          {/* Row 1: avatar + name + rating + hire button */}
                          <div className="flex items-center gap-3">
                            <a
                              href={`/user/${app.helper_id}`}
                              className="shrink-0 w-11 h-11 rounded-full overflow-hidden inline-flex items-center justify-center"
                              style={{
                                background: "hsl(var(--bark) / 0.12)",
                                boxShadow: haloColor
                                  ? `0 0 0 2.5px ${haloColor}`
                                  : "0 0 0 1px hsl(var(--olivewood) / 0.18)",
                              }}
                            >
                              {app.profiles?.avatar_url ? (
                                <OptimizedImage
                                  src={app.profiles.avatar_url}
                                  width={44}
                                  height={44}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="font-display italic font-bold text-[0.85rem]" style={{ color: "hsl(var(--bark))" }}>
                                  {helperInitials}
                                </span>
                              )}
                            </a>

                            <div className="flex-1 min-w-0">
                              {/* Name + tier badge */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <a
                                  href={`/user/${app.helper_id}`}
                                  className="font-display italic font-bold truncate hover:underline"
                                  style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
                                >
                                  {helperName}
                                </a>
                                {isElite && (
                                  <span
                                    className="text-[8.5px] font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                                    style={{
                                      background: "hsl(var(--gold-warm) / 0.14)",
                                      color: "hsl(var(--gold-warm))",
                                      letterSpacing: "0.08em",
                                    }}
                                  >
                                    Elite
                                  </span>
                                )}
                                {isPro && (
                                  <span
                                    className="text-[8.5px] font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                                    style={{
                                      background: "hsl(var(--burnt-sienna) / 0.12)",
                                      color: "hsl(var(--burnt-sienna))",
                                      letterSpacing: "0.08em",
                                    }}
                                  >
                                    Pro
                                  </span>
                                )}
                                {/* Intro video play icon — only shows when the
                                    helper has uploaded a 60s intro video. */}
                                {app.profiles?.intro_video_url && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setPlayingVideoUrl(app.profiles!.intro_video_url!);
                                    }}
                                    aria-label="Play intro video"
                                    className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 active:opacity-70 transition-opacity shrink-0"
                                    style={{
                                      background: "hsl(var(--burnt-sienna) / 0.08)",
                                    }}
                                  >
                                    <Play className="w-3 h-3" style={{ color: "hsl(var(--burnt-sienna))", fill: "hsl(var(--burnt-sienna))" }} />
                                    <span className="text-[8px] font-semibold" style={{ color: "hsl(var(--burnt-sienna))" }}>Intro</span>
                                  </button>
                                )}
                                {/* Inline rating — compact ★ 4.9 (23) */}
                                {(app.reviewCount ?? 0) > 0 && (
                                  <span className="flex items-center gap-0.5 shrink-0">
                                    <Star
                                      className="w-3 h-3"
                                      style={{ color: "hsl(var(--burnt-sienna))", fill: "hsl(var(--burnt-sienna))" }}
                                    />
                                    <span className="text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.80)" }}>
                                      {(app.avgRating ?? 0).toFixed(1)}{" "}
                                      <span style={{ color: "hsl(var(--olivewood) / 0.80)" }}>({app.reviewCount})</span>
                                    </span>
                                  </span>
                                )}
                              </div>
                              {/* Trust signals row */}
                              {visibleSignals.length > 0 && (
                                <p
                                  className="font-serif italic mt-0.5 leading-snug"
                                  style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.80)" }}
                                >
                                  {visibleSignals.join(" · ")}
                                </p>
                              )}
                              {/* Proposed bid price + counter-offer UI.
                                  Only shown on accept_bids jobs. The counter
                                  form is inline (not a modal) — minimal
                                  friction for a common negotiation action. */}
                              {(app as any).proposed_price != null && (() => {
                                const localState = localNegotiation[app.id];
                                const negotiationStatus = localState?.status ?? (app as any).negotiation_status ?? "open";
                                const counterPrice = localState?.price ?? (app as any).counter_price;
                                const isCounterShowing = counterShowing === app.id;

                                // Countered: poster already sent a price — show amber pill.
                                if (negotiationStatus === "countered") {
                                  return (
                                    <span
                                      className="inline-flex items-center gap-1 mt-0.5 text-ds-12 font-sans font-semibold px-2 py-0.5 rounded-full"
                                      style={{
                                        background: "hsl(var(--heritage-gold) / 0.15)",
                                        color: "hsl(var(--heritage-gold) / 0.85)",
                                      }}
                                    >
                                      Countered: ${counterPrice}
                                    </span>
                                  );
                                }

                                // Counter accepted by helper — show green pill.
                                if (negotiationStatus === "counter_accepted") {
                                  return (
                                    <span
                                      className="inline-flex items-center gap-1 mt-0.5 text-ds-12 font-sans font-semibold px-2 py-0.5 rounded-full"
                                      style={{
                                        background: "hsl(var(--sage) / 0.15)",
                                        color: "hsl(var(--sage))",
                                      }}
                                    >
                                      Accepted at ${counterPrice}
                                    </span>
                                  );
                                }

                                // Counter declined by helper — show muted label.
                                if (negotiationStatus === "counter_declined") {
                                  return (
                                    <span
                                      className="inline-flex items-center gap-1 mt-0.5 text-ds-11 font-sans px-2 py-0.5 rounded-full"
                                      style={{
                                        background: "hsl(var(--olivewood) / 0.08)",
                                        color: "hsl(var(--olivewood) / 0.80)",
                                      }}
                                    >
                                      Counter declined
                                    </span>
                                  );
                                }

                                // Open: show the bid pill + a "Counter" button,
                                // or the inline counter form.
                                return (
                                  <div className="flex items-center flex-wrap gap-1.5 mt-0.5">
                                    <span
                                      className="inline-flex items-center gap-1 text-ds-12 font-sans font-semibold px-2 py-0.5 rounded-full"
                                      style={{
                                        background: "hsl(var(--sage) / 0.15)",
                                        color: "hsl(var(--sage))",
                                      }}
                                    >
                                      Bid: ${(app as any).proposed_price}
                                    </span>
                                    {!isCounterShowing && app.status === "pending" && (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setCounterShowing(app.id); }}
                                        className="inline-flex items-center gap-0.5 text-ds-11 font-sans font-semibold px-2 py-0.5 rounded-full active:opacity-70 transition-opacity"
                                        style={{
                                          background: "hsl(var(--heritage-gold) / 0.12)",
                                          color: "hsl(var(--heritage-gold) / 0.85)",
                                          border: "0.5px solid hsl(var(--heritage-gold) / 0.30)",
                                        }}
                                      >
                                        Counter
                                      </button>
                                    )}
                                    {isCounterShowing && (
                                      <div
                                        className="flex items-center gap-1.5 mt-1 w-full"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <span className="text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>$</span>
                                        <input
                                          type="number"
                                          min="1"
                                          step="1"
                                          placeholder="0"
                                          value={counterInputs[app.id] ?? ""}
                                          onChange={(e) => setCounterInputs((prev) => ({ ...prev, [app.id]: e.target.value }))}
                                          className="w-20 text-ds-12 font-sans rounded px-2 py-0.5 outline-none"
                                          style={{
                                            background: "hsla(0,0%,100%,0.65)",
                                            border: "0.5px solid hsl(var(--heritage-gold) / 0.45)",
                                            color: "hsl(var(--ink-deep))",
                                          }}
                                          autoFocus
                                        />
                                        <button
                                          type="button"
                                          disabled={counterSending || !counterInputs[app.id] || Number(counterInputs[app.id]) <= 0}
                                          onClick={() => {
                                            const val = Number(counterInputs[app.id]);
                                            if (val > 0) handleCounter(app.id, val);
                                          }}
                                          className="text-ds-11 font-semibold px-2 py-0.5 rounded-full disabled:opacity-50"
                                          style={{
                                            background: "hsl(var(--heritage-gold) / 0.18)",
                                            color: "hsl(var(--heritage-gold) / 0.9)",
                                            border: "0.5px solid hsl(var(--heritage-gold) / 0.40)",
                                          }}
                                        >
                                          {counterSending ? "…" : "Send"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setCounterShowing(null)}
                                          className="text-ds-11 px-1.5 py-0.5 rounded-full active:opacity-70"
                                          style={{ color: "hsl(var(--olivewood) / 0.6)" }}
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              {/* Neighborhood trust signal — shown standalone
                                  when > 0 neighbors hired this helper near
                                  the job address (from get_neighbor_hire_count RPC).
                                  Uses bark color so it reads as a warm local signal
                                  distinct from the neutral olivewood signals above. */}
                              {neighborCount > 0 && (
                                <span
                                  className="inline-flex items-center gap-1 mt-0.5 text-ds-11 font-sans font-semibold"
                                  style={{ color: "hsl(var(--bark))" }}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ background: "hsl(var(--bark))" }}
                                    aria-hidden="true"
                                  />
                                  {neighborCount} neighbor{neighborCount > 1 ? "s" : ""} hired them
                                </span>
                              )}
                              {(app as any).stake_amount > 0 && (
                                <span
                                  className="inline-flex items-center gap-1 mt-0.5 text-ds-11 font-sans font-semibold"
                                  style={{ color: "hsl(155 50% 35%)" }}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ background: "hsl(155 50% 35%)" }}
                                    aria-hidden="true"
                                  />
                                  ${(app as any).stake_amount} staked
                                </span>
                              )}
                              {/* "Available now" pill — shown when the helper
                                  has toggled their 4-hour availability signal
                                  and the window hasn't expired yet. */}
                              {(() => {
                                const until = (app as any).profiles?.available_until;
                                const isNowAvailable = until && new Date(until) > new Date();
                                return isNowAvailable ? (
                                  <span
                                    className="inline-flex items-center gap-0.5 mt-0.5 text-ds-11 font-semibold px-1.5 py-0.5 rounded-full"
                                    style={{ background: "hsl(var(--sage) / 0.12)", color: "hsl(var(--sage))" }}
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" />
                                    Available now
                                  </span>
                                ) : null;
                              })()}
                            </div>

                            {/* Status / hire + decline buttons */}
                            {app.status === "pending" && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button
                                  variant="bark"
                                  size="sm"
                                  className="rounded-ds-md btn-press"
                                  aria-label={`Select ${helperName}`}
                                  onClick={() => onAcceptApplication(app)}
                                >
                                  Hire
                                </Button>
                                <button
                                  type="button"
                                  aria-label={`Decline ${helperName}`}
                                  onClick={() => {
                                    hapticLight();
                                    setDeclineTarget(app);
                                    setDeclineNote("");
                                    setDeclineReason(null);
                                  }}
                                  className="w-8 h-8 rounded-ds-sm flex items-center justify-center active:opacity-60 transition-opacity"
                                  style={{
                                    background: "hsl(var(--olivewood) / 0.08)",
                                    border: "0.5px solid hsl(var(--olivewood) / 0.2)",
                                  }}
                                >
                                  <X className="w-3.5 h-3.5" style={{ color: "hsl(var(--olivewood) / 0.6)" }} />
                                </button>
                              </div>
                            )}
                            {app.status === "accepted" && (
                              <span className="inline-flex items-center gap-1 text-ds-11 px-2.5 py-[3px] rounded-ds-pill font-semibold leading-none min-h-[22px] bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))]">
                                <span className="shrink-0 w-[5px] h-[5px] rounded-full bg-[hsl(var(--bark))]" aria-hidden="true" />
                                Selected
                              </span>
                            )}
                            {app.status === "rejected" && (
                              <span className="inline-flex items-center gap-1 text-ds-11 px-2.5 py-[3px] rounded-ds-pill font-semibold leading-none min-h-[22px] bg-[hsl(var(--olivewood)/0.10)] text-[hsl(var(--olivewood)/0.7)]">
                                <span className="shrink-0 w-[5px] h-[5px] rounded-full bg-[hsl(var(--olivewood)/0.7)]" aria-hidden="true" />
                                Declined
                              </span>
                            )}
                          </div>

                          {/* Row 2: applicant message — compact quote style */}
                          {app.message && (
                            <p
                              className="font-serif italic text-ds-13 leading-snug line-clamp-2 pl-14"
                              style={{ color: "hsl(var(--ink-deep) / 0.72)" }}
                            >
                              "{app.message}"
                            </p>
                          )}

                          {/* Row 3: attachments */}
                          {(app.attachment_urls || []).length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pl-14">
                              {(app.attachment_urls || [] as string[]).map((url: string, i: number) => {
                                const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
                                return (
                                  <AttachmentLink
                                    key={i}
                                    url={url}
                                    index={i}
                                    variant={isImage ? "thumb" : "chip"}
                                  />
                                );
                              })}
                            </div>
                          )}

                          {/* Row 4: private poster note — localStorage only, never sent to server */}
                          <div className="pt-1.5">
                            {noteEditing === app.id ? (
                              <div className="flex gap-2 items-start">
                                <textarea
                                  autoFocus
                                  value={noteDraft}
                                  onChange={(e) => setNoteDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveNote(app.id); }
                                    if (e.key === "Escape") setNoteEditing(null);
                                  }}
                                  placeholder="Private note — only you can see this"
                                  className="flex-1 text-ds-12 rounded-ds-sm border border-input bg-background px-2 py-1 resize-none"
                                  rows={2}
                                />
                                <button
                                  type="button"
                                  onClick={() => saveNote(app.id)}
                                  className="text-ds-12 font-medium px-2 py-1 rounded"
                                  style={{ color: "hsl(var(--sage))" }}
                                >
                                  Save
                                </button>
                              </div>
                            ) : applicantNotes[app.id] ? (
                              <button
                                type="button"
                                onClick={() => { setNoteEditing(app.id); setNoteDraft(applicantNotes[app.id]); }}
                                className="text-left w-full text-ds-12 italic flex items-start gap-1.5"
                                style={{ color: "hsl(var(--olivewood) / 0.6)" }}
                              >
                                <Pencil className="w-3 h-3 mt-0.5 shrink-0" />
                                {applicantNotes[app.id]}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => { setNoteEditing(app.id); setNoteDraft(""); }}
                                className="text-ds-11 flex items-center gap-1"
                                style={{ color: "hsl(var(--olivewood) / 0.4)" }}
                              >
                                <Plus className="w-3 h-3" /> Add private note
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Decline confirmation sheet — collects an optional reason + note
          before calling onDeclineApplication. Keeps the UX low-friction:
          no note is required; the poster can just tap "Confirm decline". */}
      <Sheet
        open={!!declineTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeclineTarget(null);
            setDeclineNote("");
            setDeclineReason(null);
          }
        }}
      >
        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-safe-nav"
          style={{ background: "hsl(var(--parchment))" }}
        >
          {declineTarget && (() => {
            const targetName = formatName(declineTarget.profiles?.full_name, "this applicant");
            return (
              <div className="px-1 pt-1 pb-2 space-y-4">
                {/* Header */}
                <div>
                  <p
                    className="font-serif italic uppercase"
                    style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
                  >
                    Decline applicant
                  </p>
                  <h2
                    className="font-display italic font-bold leading-tight mt-1"
                    style={{ fontSize: "1.1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.018em" }}
                  >
                    Decline {targetName}?
                  </h2>
                </div>

                {/* Quick-tap reason chips */}
                <div role="group" aria-label="Decline reason">
                  <p
                    className="font-serif italic mb-2"
                    style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.7)" }}
                  >
                    Choose a reason (optional)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {DECLINE_REASONS.map((reason) => {
                      const active = declineReason === reason;
                      return (
                        <button
                          key={reason}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            hapticLight();
                            setDeclineReason(active ? null : reason);
                          }}
                          className="px-3 py-1.5 rounded-full text-ds-12 font-sans font-semibold transition-all duration-150 active:scale-95"
                          style={{
                            background: active ? "hsl(var(--bark) / 0.10)" : "hsla(0, 0%, 100%, 0.55)",
                            color: active ? "hsl(var(--bark))" : "hsl(var(--olivewood) / 0.65)",
                            border: active
                              ? "0.5px solid hsl(var(--bark) / 0.35)"
                              : "0.5px solid hsl(var(--olivewood) / 0.2)",
                            backdropFilter: "blur(8px)",
                            WebkitBackdropFilter: "blur(8px)",
                          }}
                        >
                          {reason}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Optional freetext note */}
                <div className="space-y-1">
                  <label
                    htmlFor="decline-note"
                    className="font-serif italic uppercase block"
                    style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
                  >
                    Add a note (optional)
                  </label>
                  <Textarea
                    id="decline-note"
                    value={declineNote}
                    onChange={(e) => setDeclineNote(e.target.value.slice(0, DECLINE_NOTE_MAX))}
                    maxLength={DECLINE_NOTE_MAX}
                    placeholder="The helper will see this as a notification…"
                    rows={2}
                    className="rounded-ds-md bg-white/60 border-border/60 focus-visible:bg-white focus-visible:border-primary/40 font-serif italic text-[0.88rem] leading-relaxed resize-none"
                  />
                  <p
                    className="text-ds-11 text-right tabular-nums"
                    style={{
                      color: declineNote.length > DECLINE_NOTE_MAX - 20
                        ? "hsl(var(--burnt-sienna))"
                        : "hsl(var(--muted-foreground))",
                    }}
                  >
                    {declineNote.length}/{DECLINE_NOTE_MAX}
                  </p>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    className="flex-1 rounded-ds-md"
                    disabled={declineSending}
                    onClick={() => {
                      setDeclineTarget(null);
                      setDeclineNote("");
                      setDeclineReason(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 rounded-ds-md"
                    disabled={declineSending}
                    onClick={handleDeclineConfirm}
                    style={{
                      background: "hsl(var(--olivewood))",
                      border: "1px solid hsl(var(--olivewood))",
                      color: "hsl(var(--parchment))",
                    }}
                  >
                    {declineSending ? "Declining…" : "Confirm decline"}
                  </Button>
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* Video modal — shown when poster taps a helper's intro video pill */}
      {playingVideoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.88)" }}
          onClick={() => setPlayingVideoUrl(null)}
        >
          <button
            type="button"
            aria-label="Close video"
            onClick={() => setPlayingVideoUrl(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.15)" }}
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <video
            src={playingVideoUrl}
            controls
            autoPlay
            playsInline
            className="w-full max-w-sm rounded-ds-md max-h-[70dvh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
