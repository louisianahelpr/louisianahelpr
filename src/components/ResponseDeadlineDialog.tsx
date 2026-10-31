import { useEffect, useState, useRef } from "react";
import { ID_VERIFIED_LABEL, ID_VERIFIED_PILL_STYLE, IdVerifiedShield } from "@/components/profile/IdVerifiedPill";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { scanMessage, type DetectedViolation } from "@/lib/messageScanner";
import { ViolationDialog } from "@/components/richMessageInput/ViolationDialog";
import { MessageSquare, TriangleAlert } from "lucide-react";
import { userFacingError } from "@/lib/userFacingError";
import { offerResponseDeadline, jobOfferCutoff, JOB_STARTS_TOO_SOON_COPY, OFFER_MAX_WINDOW_HOURS } from "@/lib/offerDeadline";
import { UserAvatar } from "@/components/UserAvatar";
import { formatJobDate } from "@/lib/dateUtils";
import { jobStartTimeLabel } from "@/lib/jobDate";
import { formatPriceExact, seriesSummary } from "@/lib/format";
import { STAR_ON_CLS } from "@/lib/starColor";
import { Star } from "lucide-react";
import { readCardHoldLine } from "@/lib/cardHoldRead";

type Props = {
  open: boolean;
  helperName: string;
  onConfirm: (deadlineHours: number, message?: string) => Promise<void> | void;
  onClose: () => void;
  /** The job being hired into. The answer-by time never runs past its start
   *  (server rule, accept_application 20261005184940), so the line under the
   *  picker says so when the start comes first. */
  job?: {
    id?: string | null;
    date_needed?: string | null;
    start_time?: string | null;
    title?: string | null;
    budget?: number | null;
    is_group_job?: boolean | null;
    urgent_fee?: number | null;
    is_flexible_schedule?: boolean | null;
    recurrence_days?: number[] | null;
    recurrence_interval?: string | null;
    recurrence_weeks?: number | null;
    recurrence_end_date?: string | null;
    payment_status?: string | null;
  } | null;
  /** The day/time this applicant suggested when applying (owner 2026-10-23). Hiring them agrees to it:
   *  the dialog says so plainly before the button, and the server moves the job
   *  (accept_application_at_suggested_time, 20261023134752). null = they said the job's time works. */
  suggestedTime?: { date: string; time: string | null } | null;
  /** Board 29: who is being hired, as the applicant card already has it (no new read). */
  helper?: { userId?: string | null; avatarUrl?: string | null; idVerified?: boolean | null; avgRating?: number | null; reviewCount?: number | null } | null;
};

const deadlineOptions = [
  { value: "1", label: "1 hour" },
  { value: "2", label: "2 hours" },
  { value: "4", label: "4 hours" },
  { value: "8", label: "8 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "24 hours" },
  { value: "48", label: "48 hours" },
];

/**
 * The windows a poster can pick, as the server will apply them (F16, audit 2026-10-28). The server
 * sets min(chosen, 48 h, the start) (offerResponseDeadline), so a window that runs past the start
 * was never really on offer: listing "24 hours" for a job 10 hours out showed two deadlines for one
 * offer. Only the windows that end before the start are listed, and when the start cuts any of
 * them off, one "Until it starts, <time>" choice stands for all of those. It sends 48, which the
 * server reads as "until the start".
 */
function deadlineChoices(hoursLeft: number, startLabel: string | null) {
  const fit = deadlineOptions.filter((o) => Number(o.value) < hoursLeft);
  if (fit.length === deadlineOptions.length || !startLabel) return fit.length ? fit : deadlineOptions;
  return [...fit, { value: String(OFFER_MAX_WINDOW_HOURS), label: `Until it starts, ${startLabel}` }];
}

export const ResponseDeadlineDialog = ({ open, helperName, onConfirm, onClose, job: postedJob, helper, suggestedTime }: Props) => {
  // Hiring someone who suggested another day/time agrees to it, so everything below (the
  // "when" line, the answer-by clamp to the start) reads the job as it will be once hired.
  const job = postedJob && suggestedTime
    ? { ...postedJob, date_needed: suggestedTime.date, start_time: suggestedTime.time ?? postedJob.start_time ?? null }
    : postedJob;
  // Built from the suggestion alone too, so the note never hides when the job row is missing.
  const suggestedLabel = suggestedTime
    ? [formatJobDate(suggestedTime.date), suggestedTime.time ? jobStartTimeLabel(suggestedTime.time) : null].filter(Boolean).join(" at ")
    : null;
  const postedWhen = postedJob?.date_needed
    ? [formatJobDate(postedJob.date_needed), jobStartTimeLabel(postedJob.start_time, postedJob.is_flexible_schedule)].filter(Boolean).join(" at ")
    : null;
  const first = helperName.trim().split(/\s+/)[0] || helperName;
  // The job price shown only when it is the whole charge for this Helpr: not a crew (split) and no
  // urgent bonus on top (truth rule: never a number that isn't what was paid for this hire).
  const price = job && !job.is_group_job && !(Number(job.urgent_fee) > 0) && Number(job.budget) > 0 ? Number(job.budget) : null;
  // A series charges its first visit at post and each later visit before it comes (charge-recurring-visits).
  const series = !!job?.recurrence_days?.length;
  // A2-C41: "Weekly · 4 visits until Nov 21": every visit this hire covers, not only the first date.
  const seriesLine = job ? seriesSummary(job) : null;
  // Only a funded job can be hired into (trg_job_funded_before_award); the note claims payment only then.
  const funded = !job?.payment_status || ["escrow", "payout_pending", "released"].includes(job.payment_status);
  const them = first === "Helpr" ? "your Helpr" : first;
  const when = job?.date_needed ? [formatJobDate(job.date_needed), jobStartTimeLabel(job.start_time, job.is_flexible_schedule)].filter(Boolean).join(" · ") : null;
  // The job's start (or the end of its day), and the windows that end before it.
  const cutoff = job ? jobOfferCutoff(job.date_needed, job.start_time) : null;
  const startLabel = cutoff
    ? cutoff.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })
    : null;
  const hoursLeft = cutoff ? (cutoff.getTime() - Date.now()) / 3_600_000 : Infinity;
  const options = deadlineChoices(hoursLeft, startLabel);
  // 24 hours when it fits before the start; otherwise the last choice ("Until it starts").
  const defaultHours = options.some((o) => o.value === "24") ? "24" : options[options.length - 1].value;
  const [picked, setHours] = useState<string | null>(null);
  const hours = picked && options.some((o) => o.value === picked) ? picked : defaultHours;
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // The failure reason, rendered INSIDE the dialog. onConfirm throws on any
  // failure (server award gate, job no longer open, missing state) — a toast
  // alone is transient and sits behind this open dialog, which is how a poster
  // tapped Send four times against the jobs_award_gate refusal with no visible
  // response at all. The dialog stays open and Send re-enables for a retry.
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // JOBS3-46: the amount on a held card is the hold's own (job_card_holds.amount_cents, what capture_hold charges,
  // less a setup fee already paid elsewhere). Not on a crew: its total is not this one Helpr's. Unread: no amount.
  const holdJobId = open && postedJob?.payment_status === "held" && !postedJob.is_group_job ? postedJob.id ?? null : null;
  const [heldCents, setHeldCents] = useState<number | null>(null);
  useEffect(() => {
    setHeldCents(null);
    if (!holdJobId) return;
    let alive = true;
    void readCardHoldLine(holdJobId).then((line) => { if (alive) setHeldCents(line.amountCents); });
    return () => { alive = false; };
  }, [holdJobId]);
  const [violations, setViolations] = useState<DetectedViolation[] | null>(null);
  const selectedLabel =
    options.find((o) => o.value === hours)?.label ?? `${hours} hours`;
  const planned = job ? offerResponseDeadline(parseInt(hours), job) : null;
  // Sentence start: "Hallie can…", "Your Helpr can…".
  const They = them.charAt(0).toUpperCase() + them.slice(1);

  // Synchronous in-flight guard: `disabled={state}` cannot stop two clicks in one frame (see useApplyFlow).
  const sendingRef = useRef(false);
  const handleConfirm = async () => {
    if (sendingRef.current) return;
    // SAME CONTRACT AS MESSAGES. The server scans this offer message the way
    // it scans a chat message and, when it trips a rule, withholds it: the
    // text moves to a server-only column and `offer_message_flagged_hidden` is
    // set (Q1206; `flagged_hidden` is the applicant's note) — the helpr never
    // sees it. The poster got a success
    // path and no hint that the sentence they wrote had been withheld. Messages
    // has always blocked the same content BEFORE sending and named the words
    // that caused it; this is that scanner and that dialog. The server-side
    // scan is untouched — a direct API call, a stale client and a race all
    // still hit it.
    if (message.trim()) {
      const found = scanMessage(message);
      if (found.length > 0) {
        setViolations(found);
        return;
      }
    }
    sendingRef.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await onConfirm(parseInt(hours), message.trim() || undefined);
    } catch (err) {
      // Surface the thrown reason inline. The confirm callback throws
      // human-readable messages (award-gate refusals via
      // posterAwardBlockMessage, RPC guard copy); anything without one gets
      // the generic backstop so a failure never dies silently with the
      // dialog stuck open and no explanation.
      const msg = userFacingError(err, "Couldn't send the offer — please try again.");
      // Inline only (role="alert" announces it): a toast said the same words again on top (audit 2026-10-30).
      setErrorMessage(msg);
    } finally {
      sendingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setErrorMessage(null);
    onClose();
  };

  return (
    <>
      {/* Portalled sibling, not a child of this dialog's content: a nested
          Radix modal inside an open one inherits `pointer-events: none` from
          <body> and renders inert. */}
      <ViolationDialog violations={violations} onOpenChange={(o) => { if (!o) setViolations(null); }} />
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHero title={`Hire ${them}`} />
        <div className="space-y-4">
          {/* Lede in the same serif-italic olivewood every other money/offer
              dialog opens with (TipDialog, InstantPayoutDialog). This dialog
              was the one all-grayscale member of that set. It now says so
              through DialogBody rather than restating the tokens, which is
              how it had drifted to olivewood/0.85 while the confirm sheet
              beside it used /0.8. */}
          {/* Board 29: the job and the Helpr, then what was paid. Charged at post (owner 2026-10-21,
              friction 2), so hiring charges nothing new: the note says so, the amount in rust. */}
          {(job?.title || when) && (
            <div className="rounded-ds-md border border-border bg-card p-3">
              {job?.title && <p className="font-sans text-ds-15 font-bold text-foreground">{job.title}</p>}
              {when && <p className="font-sans text-ds-13 text-muted-foreground">{when}</p>}
              {seriesLine && <p className="font-sans text-ds-13 text-muted-foreground" data-hire-series="">{seriesLine}</p>}
              <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
                <UserAvatar userId={helper?.userId} src={helper?.avatarUrl} name={helperName} pixelSize={40} aria-hidden className="h-10 w-10 shrink-0" />
                <div className="min-w-0">
                  <p className="font-sans text-ds-15 font-semibold text-foreground">{helperName}</p>
                  <p className="flex flex-wrap items-center gap-x-2 font-sans text-ds-12 text-muted-foreground">
                    {helper?.idVerified && (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={ID_VERIFIED_PILL_STYLE}><IdVerifiedShield className="h-3.5 w-3.5" />{ID_VERIFIED_LABEL}</span>
                    )}
                    {Number(helper?.reviewCount) > 0 && Number(helper?.avgRating) > 0 && (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Star className={`h-3.5 w-3.5 ${STAR_ON_CLS}`} aria-hidden />
                        {Number(helper!.avgRating).toFixed(1)} · {helper!.reviewCount} {helper!.reviewCount === 1 ? "review" : "reviews"}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
          {suggestedTime && (when || suggestedLabel) && (
            <div
              role="note"
              className="rounded-ds-md border-2 p-3 font-sans text-ds-14 text-foreground"
              style={{ borderColor: "hsl(var(--bark) / 0.5)", background: "hsl(var(--bark) / 0.06)" }}
              data-hire-agrees-to-suggestion=""
            >
              <p className="font-semibold">Since you&rsquo;re hiring {them}, you&rsquo;re also agreeing to their suggested time:</p>
              <p className="mt-1 text-ds-16 font-bold">{when ? when.replace(" · ", " at ") : suggestedLabel}</p>
              <p className="mt-1 text-ds-13 text-muted-foreground">
                {postedWhen ? `Your job moves from ${postedWhen} to this time when you send the offer. ` : "Your job moves to this time when you send the offer. "}
                It keeps the new time even if they don&rsquo;t accept.
              </p>
            </div>
          )}
          {job?.payment_status === "held" && (
            // Q2399: the card is held (or, for a job more than 6 days out, only saved) and charged when the
            // hire completes (their accept); "on hold" would be false for a saved card (round 4, silent #8).
            <p className="rounded-ds-md px-3 py-2 font-sans text-ds-13 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} data-hire-card-held="">
              {heldCents !== null && heldCents > 0
                ? <>Your card is charged <strong className="tabular-nums text-[hsl(var(--sienna-ink))]">${formatPriceExact(heldCents / 100)}</strong> when {them} accepts.</>
                : <>Your card is charged when {them} accepts.</>}
            </p>
          )}
          {funded && (
          <p className="rounded-ds-md px-3 py-2 font-sans text-ds-13 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} data-hire-no-new-charge="">
            {/* lh-money-escrow review 2026-10-21: say the JOB PRICE was paid (the card also paid the fee, a
                gift may have paid part), a series' first visit only, and a crew member's share. */}
            {series ? (
              <>
                The first visit{price !== null ? <>, <strong className="tabular-nums text-[hsl(var(--sienna-ink))]">${formatPriceExact(price)}</strong>,</> : null} was paid when you posted it, so nothing new is charged now. Each later visit is charged before it comes.
              </>
            ) : price !== null ? (
              <>
                The job price, <strong className="tabular-nums text-[hsl(var(--sienna-ink))]">${formatPriceExact(price)}</strong>, was paid when you posted it, so nothing new is charged now.
              </>
            ) : (
              <>The job was paid for when you posted it, so nothing new is charged now.</>
            )}{" "}
            {job?.is_group_job
              ? `Louisiana Helpr holds the money and pays each Helpr on the crew their share after the job is done.`
              // A no or no answer reopens the job and leaves payment_status alone (decline_job_offer, expire_unanswered_offers).
              : `Louisiana Helpr holds the money and releases it to ${them} after the job is done. If ${them} says no or doesn't answer, the job reopens and your payment stays on it.`}
          </p>
          )}
          <DialogBody>
            <p>
              How long should <span className="font-sans font-bold" style={{ color: "hsl(var(--ink-deep))" }}>{them}</span> have to accept or decline this job?
            </p>
          </DialogBody>
          <div className="space-y-2">
            <Select value={hours} onValueChange={setHours}>
              <SelectTrigger aria-label="Response deadline">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Says the window back to you the way JobBoostDialog says
                "runs for 24 hours" — the choice you just made, in display type,
                rather than a grey "in time". */}
            <p className="font-sans text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }} data-offer-deadline-line="">
              {planned && !planned.ok ? (
                JOB_STARTS_TOO_SOON_COPY
              ) : planned?.cappedByStart && startLabel ? (
                <>
                  They have until the job starts,{" "}
                  <span className="font-sans font-bold" style={{ color: "hsl(var(--ink-deep))" }}>{startLabel}</span>
                  , to respond. If they don't, the job will be reopened automatically.
                </>
              ) : (
                <>
                  If they don't respond within{" "}
                  <span className="font-sans font-bold" style={{ color: "hsl(var(--ink-deep))" }}>{selectedLabel}</span>
                  , the job will be reopened automatically.
                </>
              )}
            </p>
          </div>

          {/* Optional message with offer */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-ds-13 font-medium text-foreground">
              <MessageSquare className="w-4 h-4" />
              Include a message <span className="text-muted-foreground font-normal">(optional)</span>
            </div>
            <Textarea
              aria-label="Message to Helpr (optional)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Say something to ${them}…`}
              rows={3}
              className="resize-none"
            />
          </div>

          {/* F16 (audit 2026-10-28): this was the Helpr strike ladder under "Denial policy", rules about
              the other person's account on the poster's money screen. What the poster needs is that an
              unanswered or refused offer costs the Helpr nothing (Q1281), so it is no surprise. */}
          <p className="font-sans text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }} data-offer-no-strike="">
            {They} can turn this down or not answer, and it never counts against them.
          </p>
          {/* Inline failure block in the destructive tokens (text on --destructive-ink), so a refusal
              reads in the dialog instead of a toast lost behind it. */}
          {errorMessage && (
            <div
              role="alert"
              className="rounded-ds-sm border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.06)] p-3"
            >
              <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
                <span
                  className="inline-flex items-center gap-1.5 font-semibold align-[-2px]"
                  style={{ color: "hsl(var(--destructive-ink))" }}
                >
                  <TriangleAlert aria-hidden className="w-3.5 h-3.5 shrink-0" />
                  {/* The generic refusal already says "Couldn't send" (JOBS3-49). */}
                  {/^couldn't send/i.test(errorMessage) ? errorMessage : "Couldn't send:"}
                </span>{" "}
                {/^couldn't send/i.test(errorMessage) ? null : errorMessage}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={handleClose} disabled={submitting}>Cancel</DialogSecondaryAction>
          <DialogPrimaryAction onClick={handleConfirm} disabled={submitting}>
            {submitting ? "Sending…" : suggestedTime ? "Agree and send offer" : "Send offer"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};
