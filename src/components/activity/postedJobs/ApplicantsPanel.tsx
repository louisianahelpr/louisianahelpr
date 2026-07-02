import { useState, useCallback } from "react";
import { formatName } from "@/lib/utils";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, Pencil, Play, Plus, Sparkles, Star, Users, X } from "lucide-react";
import { toast } from "sonner";
import { AttachmentLink } from "@/components/AttachmentLink";
import { Skeleton } from "@/components/ui/skeleton";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { hapticLight } from "@/lib/haptics";
import { type Job, type EnrichedApplication } from "../activityConstants";
import { callUntypedRpc, type ApplicantBidFields } from "./postedJobsHelpers";
import { useApplicantComparison } from "./useApplicantComparison";
import { DeclineApplicantSheet } from "./DeclineApplicantSheet";
import { VideoPreviewModal } from "./VideoPreviewModal";

interface ApplicantsPanelProps {
  jobs: Job[];
  expandedJobId: string | null;
  selectedJob: Job;
  setSelectedJob: (job: Job | null) => void;
  applications: EnrichedApplication[];
  applicationsLoading: boolean;
  applicationsError: boolean;
  onLoadApplications: (job: Job) => void;
  onAcceptApplication: (app: EnrichedApplication) => void;
  onDeclineApplication: (app: EnrichedApplication, note: string, jobTitle: string) => void;
  neighborCountMap: Map<string, number>;
  completedCountsMap: Map<string, number>;
  repeatHireMap: Map<string, number>;
  onTimeMap: Map<string, number>;
  distanceMap: Map<string, number>;
}

export function ApplicantsPanel({
  jobs,
  expandedJobId,
  selectedJob,
  setSelectedJob,
  applications,
  applicationsLoading,
  applicationsError,
  onLoadApplications,
  onAcceptApplication,
  onDeclineApplication,
  neighborCountMap,
  completedCountsMap,
  repeatHireMap,
  onTimeMap,
  distanceMap,
}: ApplicantsPanelProps) {
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

  const handleCounter = useCallback(async (appId: string, counterPrice: number) => {
    setCounterSending(true);
    try {
      const { error } = await callUntypedRpc("counter_application_bid", {
        p_application_id: appId,
        p_counter_price: counterPrice,
      });
      if (error) {
        if (error.code === "PGRST202") {
          toast.error("Counter-offer feature not yet deployed — try again later.");
        } else {
          toast.error("Couldn't send your counter — try again?");
        }
        return;
      }
      toast.success("Counter sent! Waiting for the Helpr's response.");
      // Optimistic update so the UI reflects the sent counter immediately.
      setLocalNegotiation((prev) => ({ ...prev, [appId]: { status: "countered", price: counterPrice } }));
      setCounterShowing(null);
      setCounterInputs((prev) => { const next = { ...prev }; delete next[appId]; return next; });
    } catch {
      toast.error("Couldn't send that — try again?");
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

  const {
    applicantSort,
    setApplicantSort,
    sortedApplications,
    topHelperIdByScore,
    applicantNotes,
    noteEditing,
    setNoteEditing,
    noteDraft,
    setNoteDraft,
    saveNote,
  } = useApplicantComparison({
    applications,
    jobs,
    expandedJobId,
    neighborCountMap,
    completedCountsMap,
    repeatHireMap,
    onTimeMap,
    distanceMap,
  });

  return (
    <>
      {/* Applicants full-screen comparison view */}
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
                    Your job was just posted! Sharing it reaches more Helprs nearby.
                  </p>
                </div>
                <ShareJobButton
                  job={{ id: selectedJob.id, title: selectedJob.title, budget: selectedJob.budget, pricingMode: selectedJob.pricing_mode, category: selectedJob.category }}
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
                  {selectedJob.pricing_mode === "accept_bids" &&
                    sortedApplications.some((sa) => (sa.app as EnrichedApplication & ApplicantBidFields).proposed_price != null) && (
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
                  // Bid/stake columns aren't in the generated types yet
                  // (migration lag); read them through this narrow view.
                  const bidApp = app as EnrichedApplication & ApplicantBidFields;
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
                            {bidApp.proposed_price != null && (() => {
                              const localState = localNegotiation[app.id];
                              const negotiationStatus = localState?.status ?? bidApp.negotiation_status ?? "open";
                              const counterPrice = localState?.price ?? bidApp.counter_price;
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
                                    Bid: ${bidApp.proposed_price}
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
                                      <span className="text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>$</span>
                                      <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        placeholder="0"
                                        value={counterInputs[app.id] ?? ""}
                                        onChange={(e) => setCounterInputs((prev) => ({ ...prev, [app.id]: e.target.value }))}
                                        aria-label="Counter offer amount in dollars"
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
                                        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
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
                            {(bidApp.stake_amount ?? 0) > 0 && (
                              <span
                                className="inline-flex items-center gap-1 mt-0.5 text-ds-11 font-sans font-semibold"
                                style={{ color: "hsl(var(--pif-tint))" }}
                              >
                                <span
                                  className="w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ background: "hsl(var(--pif-tint))" }}
                                  aria-hidden="true"
                                />
                                ${bidApp.stake_amount} staked
                              </span>
                            )}
                            {/* "Available now" pill — shown when the helper
                                has toggled their 4-hour availability signal
                                and the window hasn't expired yet. */}
                            {(() => {
                              const until = bidApp.profiles?.available_until;
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
                                <X className="w-3.5 h-3.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
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
                            <span className="inline-flex items-center gap-1 text-ds-11 px-2.5 py-[3px] rounded-ds-pill font-semibold leading-none min-h-[22px] bg-[hsl(var(--olivewood)/0.10)] text-[hsl(var(--olivewood)/0.8)]">
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
                                aria-label="Private note"
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
                              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                            >
                              <Pencil className="w-3 h-3 mt-0.5 shrink-0" />
                              {applicantNotes[app.id]}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setNoteEditing(app.id); setNoteDraft(""); }}
                              className="text-ds-11 flex items-center gap-1"
                              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
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

      <DeclineApplicantSheet
        declineTarget={declineTarget}
        declineNote={declineNote}
        setDeclineNote={setDeclineNote}
        declineReason={declineReason}
        setDeclineReason={setDeclineReason}
        declineSending={declineSending}
        onClose={() => {
          setDeclineTarget(null);
          setDeclineNote("");
          setDeclineReason(null);
        }}
        onConfirm={handleDeclineConfirm}
      />

      {/* Video modal — shown when poster taps a helper's intro video pill */}
      {playingVideoUrl && (
        <VideoPreviewModal url={playingVideoUrl} onClose={() => setPlayingVideoUrl(null)} />
      )}
    </>
  );
}
