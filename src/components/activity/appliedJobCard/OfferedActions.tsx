import { Button } from "@/components/ui/button";
import { MessageSquare, ThumbsUp, ThumbsDown, CalendarPlus } from "lucide-react";
import { downloadIcs } from "@/lib/icalExport";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { JobCountdown } from "@/components/activity/JobCountdown";
import { WhatToBringChecklist } from "@/components/jobs/WhatToBringChecklist";
import type { Application, AppliedApp, Job } from "../activityConstants";

interface OfferedActionsProps {
  app: AppliedApp;
  job: Job;
  onHelperResponse: (app: Application, accept: boolean) => void;
  respondingHelperAppId: string | null;
}

/**
 * Offered: accept/decline — celebratory framing since this is a poster
 * reaching out directly. Gold-warm accent surfaces the "you were picked"
 * moment without shouting.
 */
export function OfferedActions({ app, job, onHelperResponse, respondingHelperAppId }: OfferedActionsProps) {
  return (
    <div
      className="px-4 py-3 space-y-2.5"
      onClick={(e) => e.stopPropagation()}
      style={{
        borderTop: "0.5px solid hsl(var(--amber-tint) / 0.30)",
        background:
          "radial-gradient(80% 100% at 50% 0%, hsl(var(--amber-tint) / 0.10) 0%, transparent 60%)",
      }}
    >
      {app.offer_message && (
        <div
          className="rounded-ds-md p-3"
          style={{
            background: "hsl(var(--ivory-sand) / 0.65)",
            border: "0.5px solid hsl(var(--olivewood) / 0.12)",
          }}
        >
          <p
            className="font-serif italic uppercase mb-1 inline-flex items-center gap-1"
            style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
          >
            <MessageSquare className="w-3 h-3" /> Message from poster
          </p>
          <p className="font-serif italic leading-relaxed" style={{ fontSize: "0.88rem", color: "hsl(var(--ink-deep))" }}>
            "{app.offer_message}"
          </p>
        </div>
      )}
      {/* Job countdown */}
      <JobCountdown dateNeeded={job.date_needed} startTime={job.start_time} label="Job starts in" />
      {job.date_needed && (
        <button
          type="button"
          aria-label="Add to calendar"
          className="inline-flex items-center gap-1 text-ds-11 font-medium mt-1"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          onClick={() =>
            downloadIcs({
              id: job.id,
              title: job.title,
              location: job.location ?? null,
              description: job.description ?? null,
              dateNeeded: job.date_needed!,
              startTime: job.start_time ?? null,
              estimatedHours: typeof job.estimated_hours === "number" ? job.estimated_hours : null,
            })
          }
        >
          <CalendarPlus className="w-3.5 h-3.5" />
          Add to Calendar
        </button>
      )}
      {job.response_deadline && (
        <DeadlineCountdown
          deadline={job.response_deadline}
          expiredText="Response deadline expired"
          consequenceText="Accept or decline before the deadline"
        />
      )}
      {/* Category-aware "what to bring" checklist — informational,
          ticks persist locally. Renders nothing if the category
          has no curated list (see src/data/whatToBring.ts). */}
      <WhatToBringChecklist jobId={app.job_id} category={job.category} />
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 rounded-ds-md"
          disabled={respondingHelperAppId === app.id}
          onClick={() => onHelperResponse(app, false)}
          style={{
            color: "hsl(var(--burnt-sienna))",
            borderColor: "hsl(var(--burnt-sienna) / 0.30)",
          }}
        >
          <ThumbsDown className="w-4 h-4 mr-1" /> Decline
        </Button>
        <Button
          variant="bark"
          size="sm"
          className="flex-1 rounded-ds-md"
          disabled={respondingHelperAppId === app.id}
          onClick={() => onHelperResponse(app, true)}
        >
          <ThumbsUp className="w-4 h-4 mr-1" /> {respondingHelperAppId === app.id ? "…" : "Accept job"}
        </Button>
      </div>
    </div>
  );
}
