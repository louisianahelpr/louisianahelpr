import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { formatName } from "@/lib/utils";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { ArrowUp, Eye, Pencil, Plus, ShieldAlert, ShieldCheck, Sparkles, Star, X } from "lucide-react";
import AppPage from "@/components/AppPage";
import { AttachmentLink } from "@/components/AttachmentLink";
import CredentialBadge from "@/components/CredentialBadge";
import { hapticLight } from "@/lib/haptics";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import { type Job, type EnrichedApplication } from "../activityConstants";
import { type JobAnalytics } from "./useJobAnalytics";
import { useApplicantComparison } from "./useApplicantComparison";
import { DeclineApplicantSheet } from "./DeclineApplicantSheet";
import { ApplicantsLoadingState, ApplicantsErrorState, ApplicantsEmptyState } from "./applicantsPanel/ApplicantsStates";
import { ApplicantSortControls } from "./applicantsPanel/ApplicantSortControls";
import { helperInitialsFrom, isImageAttachment } from "./applicantsPanel/applicantsPanelHelpers";

interface ApplicantsPanelProps {
  /** No longer read here — the bid-mode sort default was its only consumer,
      and bidding is gone. Kept on the interface so PostedJobsTab still
      type-checks until it stops passing it. */
  jobs?: Job[];
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
  /** Reach for the selected job. Undefined until the view-count query
      resolves, or when the job has never been viewed — the readout is
      simply omitted in both cases rather than rendering a zero. */
  jobAnalytics?: JobAnalytics;
  /** Opens JobBoostDialog / EditJobDialog for the selected job. Both are
      already state on the Activity page (useActivityActions' `setBoostJobId`
      and `setEditJob`); they are threaded down here so the "nobody has
      applied" empty state can offer the two levers that actually change the
      outcome, instead of naming them in prose and leaving the poster to go
      find the controls on the card behind this overlay. Optional: the empty
      state omits a lever it cannot open rather than rendering a dead one. */
  onBoost?: (jobId: string) => void;
  onEdit?: (job: Job) => void;
}

export function ApplicantsPanel({
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
  jobAnalytics,
  onBoost,
  onEdit,
}: ApplicantsPanelProps) {
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
    selectedJobId: selectedJob.id,
    neighborCountMap,
    completedCountsMap,
    repeatHireMap,
    onTimeMap,
    distanceMap,
  });

  /**
   * Escape closes the panel, the same as the back chevron.
   *
   * A full-screen overlay dismissible only by hitting one specific control is
   * a keyboard dead end, and every other dismissible surface in the app (every
   * Dialog, every Sheet) takes Escape — so this one reads as broken without it.
   *
   * A window listener rather than `onKeyDown` on the container: this panel is
   * a push, not a modal, so it never takes focus on open and a container
   * handler would simply never fire. The guard is the price of that — an open
   * Radix overlay (the Boost and Edit dialogs the empty state opens, the
   * decline sheet) owns Escape while it is up, and closing the panel out from
   * under it would dismiss two things with one key.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"]')) return;
      setSelectedJob(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelectedJob]);

  // PORTALLED TO <body> ON PURPOSE — do not "simplify" this back to a plain
  // return. The panel is a full-screen overlay, but a `position: fixed`
  // element (both this wrapper AND AppShell's own `.app-shell-frame`) is
  // positioned against the nearest ancestor carrying a
  // transform/filter/backdrop-filter, NOT the viewport. Activity renders
  // inside PageScaffold and PageTransition, both framer-motion `motion.div`s,
  // so an animating ancestor became the containing block and `inset-0`
  // resolved to the JOB CARD's box: the owner saw the Applicants header
  // pinned partway down the screen with "My Posts" still above it and a grey
  // band where the overlay had been clipped. Rendering into <body> puts the
  // overlay outside every transformed ancestor, so inset-0 (and AppShell's
  // own fixed frame) means the viewport again, whatever the page animates.
  return createPortal(
    <>
      {/* Applicants full-screen comparison view — the shared <AppPage> shell
          (AppShell + ProfileTabHeader), same as every other in-app sub-screen.
          `onBack` (not `backTo`) because "back" here is closing the overlay
          via local state, not a route change — same pattern as PostJob. This
          wrapper only supplies the slide-in transition + stacking; AppShell
          itself already fills the viewport (`fixed inset-x-0 bottom-0`,
          100dvh) so it doesn't need `inset-0`/background of its own. */}
      <div
        className="fixed inset-0 z-50 motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-200"
        /* The screen's accessible NAME, and the one place the job it belongs to
           is programmatically tied to the heading. The visible subtitle under
           the h1 is a plain sibling <p> — sighted readers get the association
           from proximity, and a screen reader gets nothing until it happens to
           read the next line. Naming the region "Applicants for <job>" states
           it once, up front, without changing what is drawn.

           `region`, deliberately not `dialog`: this is a full-screen push, not
           a modal — it has no backdrop, nothing behind it is inert, and
           claiming `dialog` would promise a focus trap that does not exist. */
        role="region"
        aria-label={`Applicants for ${selectedJob.title}`}
      >
        <AppPage
          title="Applicants"
          onBack={() => setSelectedJob(null)}
          titleActions={
            /* Reach, on demand. This readout used to sit on the job card
               itself (once in the meta row, again in an "Activity" panel
               under the tracker — the same number twice). Owner: show it
               when applicants is clicked. This is where a poster is actually
               weighing whether the post is working, so it is the one place
               it earns its space. */
            jobAnalytics && jobAnalytics.viewCount > 0 ? (
              <div className="shrink-0 text-right" aria-label="Post reach">
                <span className="flex items-center justify-end gap-1 text-ds-12" style={{ color: "hsl(var(--ink-deep) / 0.7)" }}>
                  <Eye className="w-3 h-3 shrink-0" aria-hidden />
                  {jobAnalytics.viewCount} {jobAnalytics.viewCount === 1 ? "view" : "views"}
                </span>
                {jobAnalytics.conversionRate !== null && (
                  <span className="block text-ds-11" style={{ color: "hsl(var(--ink-deep) / 0.55)" }}>
                    {jobAnalytics.conversionRate}% applied
                  </span>
                )}
              </div>
            ) : undefined
          }
        >
          {/* Job name — kept as this component's own content directly beneath
              the title, same as it always did. NOT folded into PageHeader's
              `meta`: the owner's 2026-08-13 note retiring `meta` is a standing
              design rule ("a title sitting next to a back button must not
              carry a small line beneath it"), not just a note that it was
              redundant that one time — so it stays off app-wide. AppPage has
              no subtitle slot of its own, so this renders as a plain first
              child, negative-margined up against the header's own bottom
              padding the same way the hand-rolled version sat `-mt-2` under
              PageHeader. */}
          <p
            className="text-ds-11 font-serif italic truncate -mt-4 mb-2"
            style={{ color: "hsl(var(--olivewood) / 0.80)" }}
          >
            {selectedJob.title}
          </p>

          {/* Capped at iPad-comfortable width — `.page-measure` (AppPage's
              own column) carries no max-width of its own (see index.css),
              so a reading/comfort measure like this one caps itself locally
              rather than stacking a second column width. */}
          <div className="max-w-2xl mx-auto w-full">
            {applicationsLoading ? (
              /* Loading: 2 skeleton cards matching the real card height */
              <ApplicantsLoadingState />
            ) : applicationsError ? (
              /* Error state */
              <ApplicantsErrorState onRetry={() => onLoadApplications(selectedJob)} />
            ) : applications.length === 0 ? (
              /* Empty state — warmer copy when no one has applied yet */
              <ApplicantsEmptyState
                selectedJob={selectedJob}
                jobAnalytics={jobAnalytics}
                onBoost={onBoost}
                onEdit={onEdit}
              />
            ) : (
              <div className="space-y-1.5">
                {/* Sort control — horizontal pill row */}
                <ApplicantSortControls
                  applicantSort={applicantSort}
                  setApplicantSort={setApplicantSort}
                />

                {/* Paid-ordering disclosure.
                    The poster is choosing a person, so if money moved the
                    order they are entitled to know before they read the list
                    top-down — an undisclosed pay-for-position ranking on a
                    hiring surface is the trust defect, not the perk itself.
                    Shown only when Priority Placement ACTUALLY promoted
                    someone in this list (see `promotedByTier`), so it is a
                    fact about what they are looking at rather than boilerplate
                    that trains people to ignore it. */}
                {applicantSort === "recommended" && sortedApplications.some((s) => s.promotedByTier) && (
                  <p
                    className="text-ds-11 font-sans mb-3 -mt-1"
                    style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                  >
                    Ranked on ratings, work history and verified credentials.
                    {" "}Pro and Elite members get a small placement bump — enough to
                    settle a close call, never enough to outrank a stronger helper.
                  </p>
                )}

                {/* Applicant cards */}
                {sortedApplications.map(({ app, signals, neighborCount, promotedByTier }) => {
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

                      {/* Per-card half of the disclosure: this specific card
                          sits above where its earned score alone would have
                          put it. Mutually exclusive with the badge above —
                          the quality top pick cannot be promoted past itself.
                          Muted, not celebratory: it is an explanation the
                          poster is owed, not a second endorsement. */}
                      {promotedByTier && (
                        <div className="flex items-center gap-1.5 mb-1.5 pl-1">
                          <ArrowUp className="w-3 h-3" style={{ color: "hsl(var(--olivewood) / 0.7)" }} aria-hidden />
                          <span
                            className="text-ds-10 font-sans font-semibold uppercase"
                            style={{ color: "hsl(var(--olivewood) / 0.7)", letterSpacing: "0.06em" }}
                          >
                            Priority placement
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
                          {/* Migrated onto the shared `<UserAvatar>`
                              (2026-08-31). This is a hiring decision: the
                              poster is choosing between people, and the
                              previous markup gave a candidate whose upload is
                              a flat coloured block NO identity at all — an
                              `<OptimizedImage>` with no guard beyond a bare
                              404, layered over an initials span that only
                              rendered when `avatar_url` was null. Every blank
                              avatar on prod returns 200, so the initials never
                              got a turn and the applicant read as an anonymous
                              tinted circle. See `src/lib/avatarImage.ts`.

                              The <a> keeps the link, the halo ring (top-pick /
                              verified) and the 44px tap target; the avatar
                              inside is now the app-wide one. `ring-0` cancels
                              `UserAvatar`'s own hairline so the halo is the
                              only edge. */}
                          <a
                            href={`/user/${app.helper_id}`}
                            // The avatar inside is `aria-hidden` (the name link
                            // beside it already names this person), so without
                            // an explicit label this link would have no
                            // accessible name at all. It had none before either
                            // whenever a photo was present — `alt=""` on the
                            // image and nothing else in the anchor — so this is
                            // a fix, not a consequence of the migration.
                            aria-label={`View ${helperName}'s profile`}
                            className="shrink-0 w-11 h-11 rounded-full overflow-hidden inline-flex items-center justify-center"
                            style={{
                              boxShadow: haloColor
                                ? `0 0 0 2.5px ${haloColor}`
                                : "0 0 0 1px hsl(var(--olivewood) / 0.18)",
                            }}
                          >
                            <UserAvatar
                              userId={app.helper_id}
                              src={app.profiles?.avatar_url}
                              name={helperName}
                              initials={helperInitials}
                              pixelSize={44}
                              aria-hidden
                              className="w-full h-full"
                              fallbackClassName="text-ds-14 ring-0"
                            />
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
                              {/* Verification status — the same two facts the
                                  server gate enforces before this helper can be
                                  awarded the job (migration 20260827191647).
                                  Shown BEFORE the poster taps Hire for two
                                  reasons: it is a safety signal on a decision
                                  about letting a stranger into your home, and
                                  it stops the card offering a Hire the database
                                  will refuse. */}
                              <ApplicantVerificationChip
                                idVerified={app.profiles?.is_id_verified === true}
                                payoutReady={app.profiles?.is_payout_ready === true}
                              />
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
                                // Not disabled when unverified. The chip beside
                                // the name already says why they can't be hired
                                // yet, and a poster who taps anyway gets a toast
                                // naming the reason (useOfferHandlers reads the
                                // server's refusal) — which beats a dead
                                // control that explains nothing.
                                aria-label={
                                  app.profiles?.is_id_verified === true
                                    ? `Select ${helperName}`
                                    : `Select ${helperName} — not verified yet, so this may be declined`
                                }
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

                {/* "Message all N Helprs" bulk-broadcast button REMOVED
                    (owner, 2026-08-30: redundant — each applicant already
                    has their own Message action right above). */}
              </div>
            )}
          </div>
        </AppPage>
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

    </>,
    document.body,
  );
}

/**
 * The applicant's standing against the acceptance gate, in one chip.
 *
 * Verified is stated positively because it is the signal a poster is actually
 * shopping for. The blocked states are stated as facts about Stripe rather than
 * as a judgement of the person — a helper who simply hasn't finished onboarding
 * is not untrustworthy, and the poster is reading this about a real neighbour.
 *
 * "ID verified" here means Stripe Connect has no outstanding identity
 * requirement — never the old `idv_status` upload flag, which nobody reviews.
 */
function ApplicantVerificationChip({
  idVerified,
  payoutReady,
}: {
  idVerified: boolean;
  payoutReady: boolean;
}) {
  if (idVerified) {
    return (
      <span
        className="inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-ds-10 font-sans font-semibold"
        style={{ background: "hsl(var(--sage) / 0.14)", color: "hsl(var(--sage))" }}
      >
        <ShieldCheck className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
        ID verified by Stripe
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-ds-10 font-sans font-semibold"
      style={{ background: "hsl(var(--amber-tint) / 0.16)", color: "hsl(var(--amber-ink))" }}
      // Kept short deliberately: at 375px the chip shares its row with the
      // Hire button, and "Payout setup unfinished" clipped under it.
      title={payoutReady ? "Stripe has not finished verifying this helper's identity" : "This helper has not set up a payout account yet"}
    >
      <ShieldAlert className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
      {payoutReady ? "Stripe verifying" : "No payout account"}
    </span>
  );
}
