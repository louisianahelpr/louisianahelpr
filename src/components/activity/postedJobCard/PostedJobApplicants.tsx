import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { TrustRow } from "@/components/TrustRow";
import { SaveHelperButton } from "@/components/SaveHelperButton";
import { Button } from "@/components/ui/button";
import {
  Users, AlertTriangle, RotateCw, MessageSquare, Send, X, ChevronRight,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import { type Job, type EnrichedApplication } from "../activityConstants";
import { useBroadcastMessage } from "./useBroadcastMessage";

interface PostedJobApplicantsProps {
  job: Job;
  userId: string;
  isExpanded: boolean;
  applicantCounts: Record<string, number>;
  inlineApplicants: Record<string, EnrichedApplication[]>;
  loadingApplicants: Record<string, boolean>;
  applicantErrors: Record<string, boolean>;
  onLoadApplications: (job: Job) => void;
  onLoadInlineApplicants: (jobId: string) => void;
}

/**
 * PostedJobApplicants — the open-job "Applicants" button plus the inline
 * expanded applicant list (skeleton / error+retry / empty-state / populated
 * list with TrustRow and the "Message all" broadcast composer). Extracted
 * verbatim from PostedJobCard.
 */
export function PostedJobApplicants({
  job,
  userId,
  isExpanded,
  applicantCounts,
  inlineApplicants,
  loadingApplicants,
  applicantErrors,
  onLoadApplications,
  onLoadInlineApplicants,
}: PostedJobApplicantsProps) {
  const navigate = useNavigate();
  const {
    broadcastOpen,
    setBroadcastOpen,
    broadcastText,
    setBroadcastText,
    broadcastSending,
    broadcastRef,
    handleBroadcastMessage,
  } = useBroadcastMessage(job, userId, inlineApplicants);

  return (
    <div className="px-4 py-2 space-y-2" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" className="w-full rounded-ds-md glass-press" onClick={() => onLoadApplications(job)}>
        <Users className="w-4 h-4 mr-1" /> Applicants{(applicantCounts[job.id] || 0) > 0 ? ` (${applicantCounts[job.id]})` : ""}
      </Button>

      {/* Inline applicants — load when the card is expanded.
          Shows a skeleton while loading, an error+retry when
          the fetch failed, and an empty-state with a share/boost
          hint when there are zero applicants. */}
      {isExpanded && (() => {
        const isLoadingInline = loadingApplicants[job.id];
        const hasError = applicantErrors[job.id];
        const apps = inlineApplicants[job.id];

        // Kick off the fetch the first time the card expands.
        if (!isLoadingInline && !hasError && apps === undefined) {
          onLoadInlineApplicants(job.id);
        }

        if (isLoadingInline) {
          return (
            <div className="space-y-2 py-1">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-10 rounded-ds-sm" />
              ))}
            </div>
          );
        }

        if (hasError) {
          return (
            <div
              className="rounded-ds-md px-3 py-2.5 flex items-center gap-2"
              style={{
                background: "hsl(var(--destructive) / 0.06)",
                border: "0.5px solid hsl(var(--destructive) / 0.22)",
              }}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-destructive" />
              <p className="font-serif italic flex-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
                Couldn't load applicants.
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-ds-11 font-semibold text-primary hover:underline"
                onClick={() => onLoadInlineApplicants(job.id)}
              >
                <RotateCw className="w-3 h-3" /> Retry
              </button>
            </div>
          );
        }

        if (apps !== undefined && apps.length === 0) {
          return (
            <div
              className="rounded-ds-md px-3 py-2.5 space-y-1.5"
              style={{
                background: "hsl(var(--olivewood) / 0.05)",
                border: "0.5px solid hsl(var(--olivewood) / 0.16)",
              }}
            >
              <p
                className="font-display italic font-bold text-ds-14"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
              >
                No applicants yet
              </p>
              <p
                className="font-serif italic leading-snug text-ds-12"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Share your job or Boost it (below) to reach more Helprs nearby.
              </p>
            </div>
          );
        }

        // Render the inline applicant list with TrustRow
        // showing each applicant's completed jobs and rating.
        if (apps !== undefined && apps.length > 0) {
          const pendingCount = apps.filter((a) => a.status === "pending").length;
          return (
            <div className="space-y-2 py-1">
              {apps.map((app) => {
                const name = app.profiles?.full_name || "Helpr";
                return (
                  <div
                    key={app.id}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-ds-sm"
                    style={{
                      background: "hsl(var(--olivewood) / 0.05)",
                      border: "0.5px solid hsl(var(--olivewood) / 0.14)",
                    }}
                  >
                    {/* Left: avatar + name + trust — tappable to
                        open the helper's full profile page. The
                        whole left column is the tap target; action
                        buttons (Save, etc.) stay on the right so
                        there's no accidental nav when tapping them. */}
                    <button
                      type="button"
                      className="min-w-0 flex-1 flex items-center gap-2 text-left active:opacity-70 transition-opacity"
                      onClick={() => navigate(`/user/${app.helper_id}`)}
                      aria-label={`View ${name}'s profile`}
                    >
                      {/* Avatar circle */}
                      <div
                        className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-ds-11 font-bold overflow-hidden"
                        style={{ background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))" }}
                      >
                        {app.profiles?.avatar_url ? (
                          <img
                            src={app.profiles.avatar_url}
                            alt={name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          name[0].toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          <p
                            className="font-display italic font-bold truncate text-ds-13"
                            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
                          >
                            {name}
                          </p>
                          {/* Subtle arrow signals the row is tappable */}
                          <ChevronRight
                            className="w-3 h-3 shrink-0"
                            style={{ color: "hsl(var(--olivewood) / 0.80)" }}
                            aria-hidden="true"
                          />
                        </div>
                        <TrustRow
                          completedJobs={
                            typeof (app as { completedJobs?: number }).completedJobs === "number"
                              ? (app as { completedJobs?: number }).completedJobs
                              : undefined
                          }
                          avgRating={app.avgRating ?? undefined}
                          reviewCount={app.reviewCount ?? undefined}
                          className="mt-0.5"
                        />
                      </div>
                    </button>
                    {app.status === "pending" && userId && (
                      <SaveHelperButton
                        helperId={app.helper_id}
                        customerId={userId}
                        className="shrink-0 h-8 w-8"
                      />
                    )}
                  </div>
                );
              })}

              {/* "Message all" — only when 2+ pending applicants */}
              {pendingCount >= 2 && (
                <div className="pt-1">
                  {!broadcastOpen ? (
                    <button
                      type="button"
                      className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-ds-md text-ds-12 font-semibold transition-colors"
                      style={{
                        background: "hsl(var(--info-tint) / 0.10)",
                        color: "hsl(var(--info-ink))",
                        border: "0.5px solid hsl(var(--info-tint) / 0.28)",
                      }}
                      onClick={() => {
                        setBroadcastOpen(true);
                        // Focus the textarea on next tick after render.
                        setTimeout(() => broadcastRef.current?.focus(), 50);
                      }}
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Message all {pendingCount} applicants
                    </button>
                  ) : (
                    /* Inline compose area */
                    <div
                      className="rounded-ds-md p-3 space-y-2"
                      style={{
                        background: "hsl(var(--info-tint) / 0.06)",
                        border: "0.5px solid hsl(var(--info-tint) / 0.24)",
                      }}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <p
                          className="text-ds-11 font-semibold"
                          style={{ color: "hsl(var(--info-ink))" }}
                        >
                          Message all {pendingCount} applicants
                        </p>
                        <button
                          type="button"
                          aria-label="Close"
                          className="p-1 rounded-full hover:bg-muted/60 transition-colors"
                          onClick={() => {
                            setBroadcastOpen(false);
                            setBroadcastText("");
                          }}
                        >
                          <X className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      </div>
                      <textarea
                        ref={broadcastRef}
                        aria-label="Message to all applicants"
                        className="w-full resize-none rounded-ds-sm px-3 py-2 text-ds-12 text-foreground placeholder:text-muted-foreground/60 bg-background border border-border/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
                        rows={3}
                        placeholder={`e.g. "I'm running 15 min late — please bring your own gloves"`}
                        value={broadcastText}
                        onChange={(e) => setBroadcastText(e.target.value)}
                        maxLength={500}
                        disabled={broadcastSending}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-ds-10 text-muted-foreground">
                          {broadcastText.length}/500
                        </span>
                        <Button
                          size="sm"
                          disabled={!broadcastText.trim() || broadcastSending}
                          onClick={handleBroadcastMessage}
                          className="h-8 px-3 rounded-ds-md text-ds-12"
                        >
                          <Send className="w-3.5 h-3.5 mr-1" />
                          {broadcastSending ? "Sending…" : `Send to all`}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        }

        return null;
      })()}
    </div>
  );
}
