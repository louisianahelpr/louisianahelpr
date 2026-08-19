import { useState } from "react";

import { Button } from "@/components/ui/button";
import { MessageSquare, CheckCircle2, XCircle, Timer } from "lucide-react";
import BrandConfirmDialog from "@/components/ui/BrandConfirmDialog";
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
 * Declining after you were SELECTED from your own application files a
 * `job_denial` violation, and the ladder is unforgiving: a warning at the third
 * and a permanent ban at the fifth (`decline_job_offer`, migration
 * 20260518140000). The first two produce no feedback whatsoever, so a helper
 * could walk three quarters of the way to losing their account without the app
 * ever mentioning it — from a single unconfirmed tap on a button labelled only
 * "Decline", while WITHDRAWING an application (which costs nothing) got a whole
 * sheet with a mandatory reason. This confirm inverts that back.
 *
 * A DIRECT offer is exempt: the helper never applied, so turning down
 * unsolicited work isn't misconduct and `respond_to_direct_offer` files no
 * violation. Those decline in one tap, as they should.
 */
const isDirectOffer = (app: AppliedApp) => app.id.startsWith("direct-");

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const busy = respondingHelperAppId === app.id;
  const skipConfirm = isDirectOffer(app);
  const deadline = job.response_deadline ?? job.direct_offer_expires_at ?? null;
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
      {/* Wrapped: AddToCalendarButton's root is inline-flex, and so was the
          deadline line below it, so `space-y-2.5` added a margin between two
          inline boxes that still shared a text line — the action and the
          countdown rendered side by side and read as one run-on label. */}
      {job.date_needed && (
        <div>
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
        </div>
      )}
      {/* The clock that actually matters in this state.
          `response_deadline` is what accept_application stamps on an
          application offer; `direct_offer_expires_at` is what jobSubmitHelpers
          stamps on a direct one. BOTH are real timestamps, so both get the real
          countdown — this used to read only the first, which meant every direct
          offer fell through to a flat sentence while application offers got a
          bordered amber card. Same fact, two designs, chosen by which column
          happened to be populated.

          The fallback sentence stays for the genuinely deadline-less case: we
          state the 24-hour rule in words rather than inventing a countdown from
          a timestamp we don't have, because a fabricated deadline is worse than
          none — the helper would plan around it. */}
      {deadline ? (
        <DeadlineCountdown
          deadline={deadline}
          expiredText="Response deadline expired"
          consequenceText="Accept or decline before the deadline"
        />
      ) : (
        <p
          className="flex items-center gap-1.5 text-ds-11 font-sans"
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
      {/* Accept takes twice the width: the safe, money-earning action leads,
          and the two are the same height rather than the destructive one being
          the larger of the pair. */}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 rounded-ds-md"
          disabled={busy}
          aria-busy={busy}
          onClick={() => (skipConfirm ? onHelperResponse(app, false) : setConfirmOpen(true))}
          style={{
            color: "hsl(var(--burnt-sienna))",
            borderColor: "hsl(var(--burnt-sienna) / 0.30)",
          }}
        >
          <XCircle className="w-4 h-4 mr-1" /> {busy ? "Declining…" : "Decline"}
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="flex-[2] rounded-ds-md"
          disabled={busy}
          aria-busy={busy}
          onClick={() => onHelperResponse(app, true)}
        >
          <CheckCircle2 className="w-4 h-4 mr-1" /> {busy ? "Accepting…" : "Accept job"}
        </Button>
      </div>
      <BrandConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Decline this job?"
        description="You applied for this one and the poster picked you, so backing out now counts against your account."
        callout={{
          text: "Three declines gets you a warning. Five is a permanent ban. This can't be undone.",
        }}
        primaryLabel="Decline the job"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => {
          setConfirmOpen(false);
          onHelperResponse(app, false);
        }}
        secondaryLabel="Keep the job"
      />
    </div>
  );
}
