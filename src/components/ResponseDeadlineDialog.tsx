import { useState, useRef } from "react";
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
import { toast } from "sonner";
import { RELIABILITY_LADDER_RUNGS } from "@/lib/reliabilityLadder";
import { userFacingError } from "@/lib/userFacingError";
import { offerResponseDeadline, JOB_STARTS_TOO_SOON_COPY } from "@/lib/offerDeadline";
import { UserAvatar } from "@/components/UserAvatar";
import { formatJobDate } from "@/lib/dateUtils";
import { jobStartTimeLabel } from "@/lib/jobDate";
import { formatPriceExact } from "@/lib/format";
import { STAR_ON_CLS } from "@/lib/starColor";
import { BadgeCheck, Star } from "lucide-react";

type Props = {
  open: boolean;
  helperName: string;
  onConfirm: (deadlineHours: number, message?: string) => Promise<void> | void;
  onClose: () => void;
  /** The job being hired into. The answer-by time never runs past its start
   *  (server rule, accept_application 20261005184940), so the line under the
   *  picker says so when the start comes first. */
  job?: {
    date_needed?: string | null;
    start_time?: string | null;
    title?: string | null;
    budget?: number | null;
    is_group_job?: boolean | null;
    urgent_fee?: number | null;
    is_flexible_schedule?: boolean | null;
    recurrence_days?: number[] | null;
    payment_status?: string | null;
  } | null;
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

export const ResponseDeadlineDialog = ({ open, helperName, onConfirm, onClose, job, helper }: Props) => {
  const first = helperName.trim().split(/\s+/)[0] || helperName;
  // The job price shown only when it is the whole charge for this Helpr: not a crew (split) and no
  // urgent bonus on top (truth rule: never a number that isn't what was paid for this hire).
  const price = job && !job.is_group_job && !(Number(job.urgent_fee) > 0) && Number(job.budget) > 0 ? Number(job.budget) : null;
  // A series charges its first visit at post and each later visit before it comes (charge-recurring-visits).
  const series = !!job?.recurrence_days?.length;
  // Only a funded job can be hired into (trg_job_funded_before_award); the note claims payment only then.
  const funded = !job?.payment_status || ["escrow", "payout_pending", "released"].includes(job.payment_status);
  const them = first === "Helpr" ? "your Helpr" : first;
  const when = job?.date_needed ? [formatJobDate(job.date_needed), jobStartTimeLabel(job.start_time, job.is_flexible_schedule)].filter(Boolean).join(" · ") : null;
  const [hours, setHours] = useState("24");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // The failure reason, rendered INSIDE the dialog. onConfirm throws on any
  // failure (server award gate, job no longer open, missing state) — a toast
  // alone is transient and sits behind this open dialog, which is how a poster
  // tapped Send four times against the jobs_award_gate refusal with no visible
  // response at all. The dialog stays open and Send re-enables for a retry.
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [violations, setViolations] = useState<DetectedViolation[] | null>(null);
  const selectedLabel =
    deadlineOptions.find((o) => o.value === hours)?.label ?? `${hours} hours`;
  const planned = job ? offerResponseDeadline(parseInt(hours), job) : null;
  const startLabel = planned?.cutoff
    ? planned.cutoff.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })
    : null;

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
      setErrorMessage(msg);
      // Toast kept as a secondary signal (e.g. screen-reader/haptic parity
      // with other flows); the inline block above is the primary surface.
      toast.error(msg);
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
              <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
                <UserAvatar userId={helper?.userId} src={helper?.avatarUrl} name={helperName} pixelSize={40} aria-hidden className="h-10 w-10 shrink-0" />
                <div className="min-w-0">
                  <p className="font-sans text-ds-15 font-semibold text-foreground">{helperName}</p>
                  <p className="flex flex-wrap items-center gap-x-2 font-sans text-ds-12 text-muted-foreground">
                    {helper?.idVerified && (
                      <span className="inline-flex items-center gap-1"><BadgeCheck className="h-3.5 w-3.5 text-primary" aria-hidden />ID verified</span>
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
              ? `Helpr holds the money and pays each Helpr on the crew their share after the job is done.`
              : `Helpr holds the money and releases it to ${them} after the job is done.`}
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
                {deadlineOptions.map((opt) => (
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
                  Your job starts{" "}
                  <span className="font-sans font-bold" style={{ color: "hsl(var(--ink-deep))" }}>{startLabel}</span>
                  , so they have until then to respond. If they don't, the job will be reopened automatically.
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

          {/* The policy notice: neutral (lead 2026-10-21: rust is for money only; this is a rule, not an amount).
              The icon is the lucide stroke glyph the rest of the app uses —
              this was the last raw ⚠️ emoji standing in for one. */}
          <div
            className="rounded-ds-sm border border-border bg-muted/40 p-3"
          >
            <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              <span
                className="inline-flex items-center gap-1.5 font-semibold align-[-2px]"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                <TriangleAlert aria-hidden className="w-3.5 h-3.5 shrink-0" />
                Denial policy:
              </span>{" "}
              Declining an offer, or not answering it, is never a strike. Helprs who back out after accepting face escalating consequences:
            </p>
            {/* Rungs come from the shared ladder statement so this list can
                never again disagree with what the RPC actually applies —
                it did (every rung here was off by one). */}
            <ul className="text-ds-11 mt-1 space-y-0.5 list-disc pl-4" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              {RELIABILITY_LADDER_RUNGS.map((rung) => (
                <li key={rung}>{rung}</li>
              ))}
            </ul>
          </div>
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
                  Couldn't send:
                </span>{" "}
                {errorMessage}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={handleClose} disabled={submitting}>Cancel</DialogSecondaryAction>
          <DialogPrimaryAction onClick={handleConfirm} disabled={submitting}>
            {submitting ? "Sending…" : "Send offer"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};
