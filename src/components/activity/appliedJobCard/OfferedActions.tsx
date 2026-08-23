import { useState } from "react";

import { Button } from "@/components/ui/button";
import { MessageSquare, CheckCircle2, XCircle, Timer } from "lucide-react";
import BrandConfirmDialog from "@/components/ui/BrandConfirmDialog";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
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
  // THE CLOCK, in priority order.
  //
  // 1. `response_deadline` — stamped by accept_application on an offer that
  //    came from the helper's own application.
  // 2. `direct_offer_expires_at` — stamped by jobSubmitHelpers on a direct
  //    offer.
  // 3. Derived: the offer stamp + the 24-hour rule. `updated_at` is the write
  //    that moved this application into the offered state (the helper cannot
  //    edit an offer, so nothing else touches the row here), so this is the
  //    documented rule applied to a real timestamp — not a number invented to
  //    fill a gap. Owner: the flat "Respond within 24 hours" sentence "should
  //    be a count down", and it now is on every offer rather than only the
  //    ones the backend happened to stamp.
  const derivedDeadline = app.updated_at
    ? new Date(
        new Date(app.updated_at).getTime() +
          DEFAULT_RESPONSE_WINDOW_HOURS * 3_600_000,
      ).toISOString()
    : null;
  // The BACKEND-STAMPED deadline, kept separate from the derived one above.
  // Only this one is allowed to take the buttons away: `respond_to_direct_offer`
  // raises `offer_expired` past `direct_offer_expires_at`, so once it passes
  // Accept and Decline are dead controls that error on tap. The derived clock
  // is an inference from `updated_at` — fine for telling the helper how long
  // they have, never grounds for removing their ability to answer.
  const hardDeadline = job.response_deadline ?? job.direct_offer_expires_at ?? null;
  const isExpired = !!hardDeadline && new Date(hardDeadline).getTime() <= Date.now();
  // A derived clock may only COUNT DOWN, never declare an expiry. Once it
  // passes we drop back to the prose rule: we inferred that window from
  // `updated_at`, the server did not stamp it, and "Response deadline expired"
  // over two live buttons is the app contradicting itself on screen.
  const derivedStillRunning =
    !!derivedDeadline && new Date(derivedDeadline).getTime() > Date.now();
  const deadline = hardDeadline ?? (derivedStillRunning ? derivedDeadline : null);
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
            “{app.offer_message}”
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
      {/* No "Add to Calendar" here (owner). Accepting a job is what should
          put it on the helper's calendar — the app owns that, so handing them
          an .ics file to download and import themselves is asking the user to
          do the app's job, on the screen where they have not even accepted
          yet. */}

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
        /* Only reachable when the row carries no timestamp at all — then we
           state the rule in words rather than inventing a clock. */
        <p
          className="flex items-center gap-1.5 text-ds-11 font-sans"
          style={{ color: "hsl(var(--burnt-sienna))" }}
        >
          <Timer className="w-3.5 h-3.5 shrink-0" aria-hidden />
          Respond within {DEFAULT_RESPONSE_WINDOW_HOURS} hours
        </p>
      )}
      {/* Equal width. Accept used to take flex-[2] so the money-earning action
          led, but the owner asked for the pair to match: "accept and decline
          should be same size". Emphasis is carried by fill (Accept is the solid
          button, Decline is outline), not by width. */}
      {/* An expired offer has no decision left to make. The server already
          refuses it (`offer_expired`), so leaving Accept / Decline on screen
          offered the helper two buttons that both fail — and the one they'd
          reach for is the one that earns money. */}
      {isExpired ? null : (
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
          className="flex-1 rounded-ds-md"
          disabled={busy}
          aria-busy={busy}
          onClick={() => onHelperResponse(app, true)}
        >
          <CheckCircle2 className="w-4 h-4 mr-1" /> {busy ? "Accepting…" : "Accept Job"}
        </Button>
      </div>
      )}
      <BrandConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Decline This Job?"
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
