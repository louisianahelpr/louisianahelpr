import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { CheckCircle2, XCircle, Timer } from "lucide-react";
import BrandConfirmDialog from "@/components/ui/BrandConfirmDialog";
import { useAcceptPendingJobs } from "@/hooks/useAcceptPendingJobs";
import { useAcceptGate } from "@/hooks/useAwardBlockReason";
import { pendingAcceptStatus } from "@/lib/awardGate";
import { CountdownRows, jobStartTarget, type CountdownClock } from "@/components/job-card/CountdownRows";
import type { Application, AppliedApp, Job } from "../../../components/job-card/activityConstants";
import { DEFAULT_RESPONSE_WINDOW_HOURS, isDirectOffer, offerClock } from "../../../components/job-card/offerClock";
import { seriesSummary } from "@/lib/format";
import { InstantBookingCard } from "@/components/jobs/InstantBookingCard";

interface OfferedActionsProps {
  app: AppliedApp;
  job: Job;
  onHelperResponse: (app: Application, accept: boolean) => void;
  respondingHelperAppId: string | null;
}

/**
 * Declining an offer is FREE (owner, 2026-10-05, Q1281): nothing is committed
 * until the Helpr taps Accept, so decline_job_offer files no strike
 * (20261012184444_offer_free_to_refuse). The confirm stays because the decline
 * cannot be undone: the job goes back to everyone. Strikes are only for
 * backing out AFTER accepting (helper_cancel_booking).
 *
 * A DIRECT offer is exempt: the helper never applied, so turning down
 * unsolicited work isn't misconduct and `respond_to_direct_offer` files no
 * violation. Those decline in one tap, as they should.
 */
/**
 * Offered: accept/decline — celebratory framing since this is a poster
 * reaching out directly. Gold-warm accent surfaces the "you were picked"
 * moment without shouting.
 */
export function OfferedActions(props: OfferedActionsProps) {
  // CMP-4: an instant booking is answered with its own card (Confirm / Decline,
  // the 2-hour countdown), never the generic offer's Accept and 24-hour clock.
  if (props.job.instant_decline_until) {
    return (
      <div className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <InstantBookingCard jobId={props.job.id} title={props.job.title} declineUntil={props.job.instant_decline_until} />
      </div>
    );
  }
  return <GenericOfferedActions {...props} />;
}

function GenericOfferedActions({ app, job, onHelperResponse, respondingHelperAppId }: OfferedActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const busy = respondingHelperAppId === app.id;
  // Which button was pressed: only that one says "Accepting…" / "Declining…" (audit 2026-10-28 F6:
  // both did). Both stay disabled while the answer is in flight.
  const [pressed, setPressed] = useState<"accept" | "decline" | null>(null);
  // Q1180: they tapped Accept and it waits on their Stripe setup; tapping
  // again reopens the checklist (accept_job_offer answers with what is left).
  const acceptPending = useAcceptPendingJobs().has(job.id);
  // The profile mirror of helper_accept_missing, live over realtime.
  const gate = useAcceptGate();
  // ANYONE CAN ACCEPT; PAYOUT SETUP COMES AFTER (owner, 2026-10-06, said
  // twice: "you can offer job to anyone, they would set it up after
  // accepting. this is not an exception, it's the rule."). Before the tap the
  // primary is always "Accept job", whatever the Helpr's Stripe state:
  // accept_job_offer / respond_to_direct_offer record the accept and answer
  // pending_setup, and AwardGateDialog ("Thanks for Accepting!") takes them to
  // Stripe. The 2026-10-05 card swapped Accept for "Set Up Payouts" when the
  // profile mirror had a gate reason (Q1399, seen live 2026-10-07 at 375).
  // After the accept, while it waits on Stripe (acceptPending), the primary is
  // still Accept (owner, 2026-10-07: "never Set Up Payouts"); a status panel
  // says what it waits on. The gate feeds only that panel.
  // Guards: src/test/offerAcceptForEveryone.test.tsx,
  // src/test/offerCardHierarchy.test.tsx.
  // Once accepted and waiting only on Stripe, the button finishes that accept
  // (owner, 2026-10-08: "it should say finish accepting, they already accepted").
  const acceptLabel = busy && pressed === "accept" ? "Accepting…" : acceptPending ? "Finish accepting" : "Accept job";
  // Item 5 (owner, 2026-10-07): after a pending accept the card says plainly
  // it is NOT accepted yet, and what it waits on (the same profile mirror of
  // helper_accept_missing the pop-up's list comes from).
  const pendingStatus = pendingAcceptStatus(gate.missing);
  const startClock: CountdownClock = {
    id: "start",
    at: jobStartTarget(job.date_needed, job.start_time),
    text: "until the job starts",
    expiredText: "Job time has arrived",
  };
  const skipConfirm = isDirectOffer(app);
  // The clock and whether it has run out, from the one predicate the
  // Activity buckets use too (offerClock.ts): an expired offer leaves Needs
  // You the moment this card says so. Only the backend-stamped deadline is
  // allowed to take the buttons away while time remains; past either clock
  // the offer is gone (expire_unanswered_offers acts on it).
  const { hardDeadline, derivedDeadline, isExpired } = offerClock(app, job);
  const deadline = isExpired ? null : (hardDeadline ?? derivedDeadline);
  const seriesLine = seriesSummary(job); // JOBS-18: accepting a Repeats job takes on every visit.
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
      {seriesLine && <p data-offer-series="" className="font-sans font-semibold text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>{seriesLine}</p>}
      {(app.offer_message || app.offer_message_flagged_hidden) && (
        <div
          className="rounded-ds-md p-3"
          style={{
            background: "hsl(var(--ivory-sand) / 0.65)",
            border: "0.5px solid hsl(var(--olivewood) / 0.12)",
          }}
        >
          {/* Only the message itself, no label above it (owner, 2026-10-03). */}
          {/* The poster's own flag (Q1206): this direction is judged apart
              from the applicant's note, and a flagged message's text never
              reaches this client (the server moves it to a column no client
              can read), so the notice is all there is to show. */}
          {app.offer_message_flagged_hidden ? (
            <p className="font-sans leading-relaxed text-ds-14" style={{ color: "hsl(var(--burnt-sienna))" }}>
              This message was hidden — it looked like contact or payment details.
              Keep the conversation on Helpr so your payment stays protected.
            </p>
          ) : (
            <p className="font-sans leading-relaxed text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>
              “{app.offer_message}”
            </p>
          )}
        </div>
      )}
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
        /* WHAT SILENCE DOES IS STATED: when the answer-by passes,
           `expire_unanswered_offers` gives the job back to everyone. It files
           no strike (owner, 2026-10-05, Q1281), and the line says so, so
           nobody accepts out of fear of a penalty that does not exist.

           Only shown for a HARD deadline. The derived 24-hour clock is an
           inference from `updated_at` and the server does not act on it, so
           promising a reopen against it would be a promise we cannot keep. */
        /* BOTH CLOCKS, ONE FORMAT, SOONEST FIRST (owner, 2026-10-07, Q1399):
           "Job starts in" used to be a grey pill above and this a cream box,
           two designs for two clocks. Now both are rows of one panel,
           `<time> <what it counts to>`, ordered by which ends first, with the
           consequence under them. Guard: src/test/offerCountdownRows.test.tsx. */
        <CountdownRows
          variant="box"
          clocks={[
            { id: "answer", at: deadline, text: "left to answer", expiredText: "Response deadline expired" },
            startClock,
          ]}
          note={
            hardDeadline
              ? "If you don't answer in time, the job reopens to everyone. No strike."
              : "Accept or decline before the deadline."
          }
        />
      ) : (
        /* NO LIVE COUNTDOWN — same panel, different words.
           This used to be a bare one-line sentence in sienna, so two offers
           sitting one above the other in the same list wore two completely
           different designs for the same fact: one a bordered amber panel with
           a running clock, the other a naked line of text. Same shape now, and
           the same weight as DeadlineCountdown's — only the sentence changes.

           Two ways to land here:
           - the window has CLOSED, on either clock. The offer is gone and the
             job has reopened to everyone, so this says so plainly and the
             buttons below are not rendered at all.
           - the row carries no timestamp we can reason about, so we state the
             24-hour rule in words rather than inventing a clock. */
        <>
        {!isExpired && <CountdownRows variant="box" clocks={[startClock]} />}
        <div
          className="flex items-start gap-2 p-2 rounded-ds-sm border"
          style={{
            background: "hsl(var(--amber-tint) / 0.15)",
            borderColor: "hsl(var(--amber-tint) / 0.30)",
            color: "hsl(var(--amber-ink))",
          }}
        >
          <Timer className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0">
            {isExpired ? (
              <>
                <p className="text-ds-11 font-semibold">This offer has expired</p>
                <p className="text-ds-10 mt-0.5">
                  You didn't answer in time, so the job went back out to everyone — it
                  may already be somebody else's.
                </p>
                {/* Not a dead end (owner, ledger §VII): while the job is
                    still open the helper can walk back in through the front
                    door and apply like everyone else. Only shown for status
                    'open' — a claimed/cancelled job has nothing to offer. */}
                {job.status === "open" && (
                  <Link
                    to={`/home?job=${job.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 mt-1.5 text-ds-11 font-semibold underline"
                    style={{ color: "hsl(var(--amber-ink))" }}
                  >
                    It's still open — view the job
                  </Link>
                )}
              </>
            ) : (
              <>
                <p className="text-ds-11 font-semibold">
                  Respond within {DEFAULT_RESPONSE_WINDOW_HOURS} hours
                </p>
                <p className="text-ds-10 mt-0.5">Accept or decline before the window closes</p>
              </>
            )}
          </div>
        </div>
        </>
      )}
      {/* Equal width. Accept used to take flex-[2] so the money-earning action
          led, but the owner asked for the pair to match: "accept and decline
          should be same size". Emphasis is carried by fill (Accept is the solid
          button, Decline is outline), not by width. */}
      {/* An expired offer has no decision left to make. The server already
          refuses it (`offer_expired`), so leaving Accept / Decline on screen
          offered the helper two buttons that both fail — and the one they'd
          reach for is the one that earns money. */}
      {/* DECLINE LEFT, ACCEPT RIGHT, ONE ROW, ALWAYS (owner, 2026-10-07 on
          the live card at 375, Q1399): the primary says Accept, never "Set Up
          Payouts", and Decline is never demoted to a link under it. After a
          pending accept the panel above says it is NOT accepted yet and what
          it waits on; Accept again reopens the pop-up for what is missing
          (accept_job_offer is idempotent and answers pending_setup again).
          Guards: src/test/offerAcceptForEveryone.test.tsx,
          src/test/offerCardHierarchy.test.tsx. */}
      {!isExpired && acceptPending && (
        <div
          className="p-2 rounded-ds-sm border"
          data-offer-pending-status=""
          style={{
            background: "hsl(var(--amber-tint) / 0.15)",
            borderColor: "hsl(var(--amber-tint) / 0.30)",
            color: "hsl(var(--amber-ink))",
          }}
        >
          <p className="text-ds-11 font-semibold">{pendingStatus.headline}</p>
          <p className="text-ds-10 mt-0.5 leading-snug">{pendingStatus.body}</p>
        </div>
      )}
      {isExpired ? null : (
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            if (!skipConfirm) return setConfirmOpen(true);
            setPressed("decline");
            onHelperResponse(app, false);
          }}
          style={{
            color: "hsl(var(--burnt-sienna))",
            borderColor: "hsl(var(--burnt-sienna) / 0.30)",
          }}
        >
          <XCircle className="w-4 h-4 hidden min-[360px]:block" aria-hidden /> {busy && pressed === "decline" ? "Declining…" : "Decline"}
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          disabled={busy}
          aria-busy={busy}
          data-offer-primary="accept"
          onClick={() => {
            setPressed("accept");
            onHelperResponse(app, true);
          }}
        >
          <CheckCircle2 className="w-4 h-4 hidden min-[360px]:block" aria-hidden /> {acceptLabel}
        </Button>
      </div>
      )}
      <BrandConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Decline this job?"
        description="You applied for this one and the person who posted it picked you. Declining isn't a strike."
        callout={{
          // decline_job_offer files no strike (Q1281, 20261012184444).
          text: "The job goes back to everyone. This can’t be undone.",
        }}
        primaryLabel="Decline job"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => {
          setConfirmOpen(false);
          setPressed("decline");
          onHelperResponse(app, false);
        }}
        secondaryLabel="Cancel"
      />
    </div>
  );
}
