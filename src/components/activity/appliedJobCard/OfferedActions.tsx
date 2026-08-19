import { Button } from "@/components/ui/button";
import { MessageSquare, ThumbsUp, ThumbsDown, Timer } from "lucide-react";
import { AddToCalendarButton } from "./AddToCalendarButton";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { WhatToBringChecklist } from "@/components/jobs/WhatToBringChecklist";
import type { Application, AppliedApp, Job } from "../activityConstants";

interface OfferedActionsProps {
  app: AppliedApp;
  job: Job;
  onHelperResponse: (app: Application, accept: boolean) => void;
  respondingHelperAppId: string | null;
}

/**
 * How long a helper has to respond once a poster hands them a job, when the
 * poster didn't set an explicit deadline. Mirrors the 24h
 * `direct_offer_expires_at` that jobSubmitHelpers stamps on a direct offer.
 */
const DEFAULT_RESPONSE_WINDOW_HOURS = 24;

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
            className="font-serif italic uppercase mb-1 inline-flex items-center gap-1 text-ds-10"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
          >
            <MessageSquare className="w-3 h-3" /> Message from poster
          </p>
          <p className="font-serif italic leading-relaxed text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>
            "{app.offer_message}"
          </p>
        </div>
      )}
      {/* NO "Job starts in" countdown here. This card is the one decision the
          helper still has to make, and counting down to a start date they have
          not agreed to answers the wrong question — a job three weeks out
          showed "Job starts in 20d 18h" next to Accept/Decline, which reads as
          "plenty of time" when what is actually running out is the window to
          respond. The deadline below is the clock that matters in this state;
          the start countdown appears once they have confirmed (see
          ConfirmedSection). */}
      {job.date_needed && (
        <AddToCalendarButton
          job={{
            id: job.id,
            title: job.title,
            location: job.location ?? null,
            description: job.description ?? null,
            dateNeeded: job.date_needed,
            startTime: job.start_time ?? null,
            estimatedHours: typeof job.estimated_hours === "number" ? job.estimated_hours : null,
          }}
        />
      )}
      {/* The clock that actually matters in this state. When the poster set an
          explicit deadline we count down to it; otherwise we state the 24-hour
          rule in words rather than inventing a countdown from a timestamp we
          don't have — a fabricated deadline is worse than none, because the
          helper would plan around it. */}
      {job.response_deadline ? (
        <DeadlineCountdown
          deadline={job.response_deadline}
          expiredText="Response deadline expired"
          consequenceText="Accept or decline before the deadline"
        />
      ) : (
        <p
          className="inline-flex items-center gap-1.5 text-ds-11 font-sans"
          style={{ color: "hsl(var(--burnt-sienna))" }}
        >
          <Timer className="w-3.5 h-3.5 shrink-0" aria-hidden />
          Respond within {DEFAULT_RESPONSE_WINDOW_HOURS} hours
        </p>
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
          variant="primary"
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
