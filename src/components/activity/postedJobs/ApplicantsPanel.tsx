import { useState, useCallback } from "react";
import { formatName } from "@/lib/utils";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil, Play, Plus, Sparkles, Star, X } from "lucide-react";
import { AttachmentLink } from "@/components/AttachmentLink";
import CredentialBadge from "@/components/CredentialBadge";
import { hapticLight } from "@/lib/haptics";
import { type Job, type EnrichedApplication } from "../activityConstants";
import { useApplicantComparison } from "./useApplicantComparison";
import { DeclineApplicantSheet } from "./DeclineApplicantSheet";
import { VideoPreviewModal } from "./VideoPreviewModal";
import { ApplicantsLoadingState, ApplicantsErrorState, ApplicantsEmptyState } from "./applicantsPanel/ApplicantsStates";
import { ApplicantSortControls } from "./applicantsPanel/ApplicantSortControls";
import { helperInitialsFrom, isImageAttachment } from "./applicantsPanel/applicantsPanelHelpers";
import { TIER_PERKS } from "@/lib/subscriptionTiers";

interface ApplicantsPanelProps {
  /** No longer read here — the bid-mode sort default was its only consumer,
      and bidding is gone. Kept on the interface so PostedJobsTab still
      type-checks until it stops passing it. */
  jobs?: Job[];
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

  // The counter-offer state (bid input, optimistic negotiation status, the
  // counter_application_bid RPC call) lived here until bidding was removed —
  // it was never used in production. Applicants are now hired or declined
  // outright; there is no price to negotiate.

  // Decline confirmation sheet — open when poster taps "Decline" on an applicant.
  // `declineTarget` holds the app being declined; the sheet collects an optional
  // note + a reason chip before calling onDeclineApplication.
  const [declineTarget, setDeclineTarget] = useState<EnrichedApplication | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const [declineReason, setDeclineReason] = useState<string | null>(null);
  const [declineSending, setDeclineSending] = useState(false);

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
      <div className="fixed inset-0 z-50 flex flex-col motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-200"
        // Same full-screen-overlay top inset as PetForm — see the note there.
        style={{ background: "hsl(var(--parchment))", paddingTop: "var(--safe-area-top, 0px)" }}>
        {/* Header */}
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{
            borderBottom: "0.5px solid hsl(var(--bark) / 0.12)",
            background: "var(--surface-premium)",
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
              className="font-display italic font-bold leading-tight truncate text-ds-17"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
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
              <ApplicantsLoadingState />
            ) : applicationsError ? (
              /* Error state */
              <ApplicantsErrorState onRetry={() => onLoadApplications(selectedJob)} />
            ) : applications.length === 0 ? (
              /* Empty state — warmer copy when no one has applied yet */
              <ApplicantsEmptyState selectedJob={selectedJob} />
            ) : (
              <div className="space-y-1.5">
                {/* Sort control — horizontal pill row */}
                <ApplicantSortControls
                  applicantSort={applicantSort}
                  setApplicantSort={setApplicantSort}
                />

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
                  const helperInitials = helperInitialsFrom(helperName);
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
                          background: "var(--surface-premium)",
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
                              <span className="font-sans font-semibold text-ds-14" style={{ color: "hsl(var(--bark))" }}>
                                {helperInitials}
                              </span>
                            )}
                          </a>

                          <div className="flex-1 min-w-0">
                            {/* Name + tier badge */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <a
                                href={`/user/${app.helper_id}`}
                                className="font-display italic font-bold truncate hover:underline text-ds-15"
                                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
                              >
                                {helperName}
                              </a>
                              {isElite && (
                                <span
                                  className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                                  style={{
                                    background: "hsl(var(--gold-warm) / 0.14)",
                                    color: "hsl(var(--gold-warm))",
                                    letterSpacing: "0.08em",
                                  }}
                                >
                                  {TIER_PERKS.elite.name}
                                </span>
                              )}
                              {isPro && (
                                <span
                                  className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                                  style={{
                                    background: "hsl(var(--burnt-sienna) / 0.12)",
                                    color: "hsl(var(--burnt-sienna))",
                                    letterSpacing: "0.08em",
                                  }}
                                >
                                  {TIER_PERKS.pro.name}
                                </span>
                              )}
                              {/* Licensed/Insured badges — the hiring surface
                                  is exactly where a verified credential should
                                  speak (owner, 2026-08-24). get_safe_profiles
                                  returns the four credential fields; the badge
                                  renders nothing unless a credential is
                                  admin-verified or pending. */}
                              <CredentialBadge credentials={app.profiles ?? {}} size="sm" />
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
                                  <span className="text-ds-9 font-semibold" style={{ color: "hsl(var(--burnt-sienna))" }}>Intro</span>
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
                                className="font-serif italic mt-0.5 leading-snug text-ds-12"
                                style={{ color: "hsl(var(--olivewood) / 0.80)" }}
                              >
                                {visibleSignals.join(" · ")}
                              </p>
                            )}
                            {/* The bid pill and inline counter-offer form used
                                to sit here, on accept_bids jobs only. Bidding
                                was removed — zero production usage — so an
                                applicant now carries no price of their own. */}
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
                            {/* "Available now" pill — shown when the helper
                                has toggled their 4-hour availability signal
                                and the window hasn't expired yet. */}
                            {(() => {
                              const until = app.profiles?.available_until;
                              const isNowAvailable = until && new Date(until) > new Date();
                              return isNowAvailable ? (
                                <span
                                  className="inline-flex items-center gap-0.5 mt-0.5 text-ds-11 font-semibold px-1.5 py-0.5 rounded-full"
                                  style={{ background: "hsl(var(--sage) / 0.12)", color: "hsl(var(--sage))" }}
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" />
                                  Available now
                                </span>
                              ) : null;
                            })()}
                          </div>

                          {/* Status / hire + decline buttons */}
                          {app.status === "pending" && (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Button
                                variant="primary"
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
                              const isImage = isImageAttachment(url);
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
                              <Plus className="w-3 h-3" /> Add Private Note
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
