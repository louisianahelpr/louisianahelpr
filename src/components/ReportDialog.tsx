import { useEffect, useId, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHero,
  DialogSecondaryAction,
  DialogPrimaryAction,
  DialogBody,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Banknote,
  BadgeAlert,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  EyeOff,
  FileWarning,
  Loader2,
  MoreHorizontal,
  ShieldAlert,
  Star,
  UserX,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";

/**
 * WHY THIS IS ONE COLUMN OF FULL-WIDTH ROWS, NOT A GRID OF CHIPS
 *
 * The reason picker used to be `grid-cols-2` of inline-flex chips with the
 * odd one out spanning both columns. That layout only ever looked right when
 * every label happened to fit on one line: "Spam or scam" and "Fake profile"
 * sat on a single line with the icon leading, while "Inappropriate content"
 * and "Harassment or abuse" wrapped to two and self-centred, so the icons in
 * a single row sat at different vertical positions, the label baselines never
 * agreed, and the two columns carried visibly different weight. The five-item
 * count then orphaned "Other" across the bottom. (Owner, 2026-08-31: "I don't
 * like these we need to update and polish or restructure they're ugly.")
 *
 * A grid of variable-length labels is structurally incapable of being tidy —
 * so it is gone rather than tuned. Each reason is now a full-width row
 * (icon tile · label · chevron), the standard "pick a reason" list on iOS:
 * every icon lands on the same x, every label starts on the same x, a label
 * may wrap to two lines without disturbing its neighbours, and the list takes
 * any number of reasons per context without an orphan.
 */

type ReportedType = "job" | "message" | "user" | "review";

interface Reason {
  label: string;
  Icon: LucideIcon;
}

/**
 * REASONS ARE PER-CONTEXT. This dialog is the single report surface for four
 * different things (job / message / user / review — see the call-site map in
 * the props doc below), and the old shared list asked every reporter about a
 * "Fake profile" even when they were reporting a job listing or a single chat
 * message. Each context now offers only reasons that can actually be true of
 * it, which is also what makes the admin queue's `reason` column worth
 * reading.
 *
 * `reason` is stored as free text (`reports.reason`, no CHECK), so adding or
 * renaming an entry here is safe; it is rendered verbatim in AdminReports.
 */
const REASONS: Record<ReportedType, readonly Reason[]> = {
  job: [
    { label: "Spam or scam", Icon: AlertTriangle },
    { label: "Misleading or fake listing", Icon: FileWarning },
    { label: "Unsafe or illegal work", Icon: ShieldAlert },
    { label: "Inappropriate content", Icon: EyeOff },
    { label: "Payment requested off Helpr", Icon: Banknote },
    { label: "Something else", Icon: MoreHorizontal },
  ],
  message: [
    { label: "Spam or scam", Icon: AlertTriangle },
    { label: "Harassment or abuse", Icon: UserX },
    { label: "Threats or violence", Icon: ShieldAlert },
    { label: "Inappropriate content", Icon: EyeOff },
    { label: "Payment requested off Helpr", Icon: Banknote },
    { label: "Something else", Icon: MoreHorizontal },
  ],
  user: [
    { label: "Fake profile or impersonation", Icon: BadgeAlert },
    { label: "Spam or scam", Icon: AlertTriangle },
    { label: "Harassment or abuse", Icon: UserX },
    { label: "Unsafe or threatening behavior", Icon: ShieldAlert },
    { label: "Inappropriate content", Icon: EyeOff },
    { label: "Payment requested off Helpr", Icon: Banknote },
    { label: "Something else", Icon: MoreHorizontal },
  ],
  review: [
    { label: "Fake or dishonest review", Icon: Star },
    { label: "Harassment or abuse", Icon: UserX },
    { label: "Inappropriate content", Icon: EyeOff },
    { label: "Shares private information", Icon: BadgeAlert },
    { label: "Something else", Icon: MoreHorizontal },
  ],
};

/**
 * Title Case display noun per PLATFORM_CONVENTIONS §1 (popup titles). The
 * title is COMPUTED from `reportedType`, which is why the 2026-08-24 casing
 * sweep missed it — the literal "Report User" never appears in source for a
 * lexical grep to find.
 */
const REPORTED_NOUN: Record<ReportedType, string> = {
  job: "Job",
  message: "Message",
  user: "User",
  review: "Review",
};

/**
 * Lower-case noun for running prose. Separate from REPORTED_NOUN because the
 * title's noun and the sentence's noun genuinely differ for one case: the
 * popup is titled "Report User", but "decides what happens to the user" reads
 * wrong mid-sentence where "account" is the thing being acted on.
 */
const REPORTED_NOUN_INLINE: Record<ReportedType, string> = {
  job: "job",
  message: "message",
  user: "account",
  review: "review",
};

/**
 * The question the reason list answers, in the reporter's own terms. It is
 * the list's ACCESSIBLE name only — it is deliberately not painted (see the
 * reason step below); the dialog title and lede already say it on screen.
 */
const REASON_PROMPT: Record<ReportedType, string> = {
  job: "What's wrong with this job?",
  message: "What's wrong with this message?",
  user: "What's wrong with this account?",
  review: "What's wrong with this review?",
};

const MIN_LENGTH = 10;
const MAX_LENGTH = 500;

type Step = "reason" | "details" | "confirmation";

interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Which of the four report contexts this is. Call sites, 2026-08-31:
   *   job     — Dashboard, Activity, PostedJobActions (the job feed's "Report")
   *   message — Messages (a single chat message's action sheet)
   *   user    — UserProfile, Messages (report the person, not the thread)
   *   review  — userProfile/ReviewsSection, reviewPanel/ReviewList
   *
   * "profile" USED to be in this union and was never passed by any call site;
   * it is also not in the `reports_reported_type_check` CHECK constraint, so
   * a stray `reportedType="profile"` would have failed the insert with 23514
   * and surfaced only as a generic toast. Removed rather than mapped, so the
   * union and the database now agree exactly.
   */
  reportedType: ReportedType;
  reportedId: string;
}

/**
 * Multi-step report flow:
 *   1) Reason — a single-column list of full-width rows. One tap picks the
 *      reason AND advances (the chevron is the promise that it will), so the
 *      user never wonders "what's next".
 *   2) Details — required free text with 10/500-char guardrails, reversible
 *      via Back.
 *   3) Confirmation — visible case # + a truthful "what happens next". The
 *      case # is the first 8 hex chars of the inserted report row's UUID,
 *      uppercased behind an HLP- prefix, so the user has something concrete
 *      to quote to support rather than a half-leaked database id.
 *
 * Shell: the shared `DialogContent` (`.glass-modal`) + `DialogHero` + a real
 * `DialogFooter` on EVERY step — no hand-rolled surface, no width override,
 * no bare floating "Cancel" text. Only the body morphs between steps.
 */
const ReportDialog = ({ open, onClose, reportedType, reportedId }: ReportDialogProps) => {
  const [step, setStep] = useState<Step>("reason");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [caseNumber, setCaseNumber] = useState<string | null>(null);

  const uid = useId();
  const detailsId = `${uid}-details`;
  const detailsHintId = `${uid}-details-hint`;

  // Reset the wizard whenever the dialog opens. Without this a second
  // open after a confirmation would still show the case # screen.
  useEffect(() => {
    if (open) {
      setStep("reason");
      setReason("");
      setDescription("");
      setCaseNumber(null);
      setSubmitting(false);
    }
  }, [open]);

  const trimmedLength = description.trim().length;
  const tooShort = trimmedLength > 0 && trimmedLength < MIN_LENGTH;
  const charsLeft = MAX_LENGTH - description.length;
  const canSubmit = !!reason && trimmedLength >= MIN_LENGTH && !submitting;

  const noun = REPORTED_NOUN[reportedType];
  const reasons = REASONS[reportedType];

  const handleSubmit = async () => {
    if (!reason) { hapticError(); toast.error("Pick a reason first."); return; }
    if (trimmedLength < MIN_LENGTH) { hapticError(); toast.error(`Add at least ${MIN_LENGTH} characters of detail.`); return; }
    hapticMedium();
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("You must be logged in."); setSubmitting(false); return; }

    const { data, error } = await supabase
      .from("reports")
      .insert({
        reporter_id: user.id,
        reported_type: reportedType,
        reported_id: reportedId,
        reason,
        description: description.trim() || null,
      })
      .select("id")
      .single();

    if (error || !data) {
      hapticError();
      toast.error("We couldn't send your report — please try again.");
      setSubmitting(false);
      return;
    }
    hapticSuccess();
    const shortId = String(data.id).replace(/-/g, "").slice(0, 8).toUpperCase();
    setCaseNumber(`HLP-${shortId}`);
    setStep("confirmation");
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const copyCaseNumber = async () => {
    if (!caseNumber) return;
    try {
      await navigator.clipboard?.writeText(caseNumber);
      hapticSuccess();
    } catch {
      hapticError();
      toast.error("Couldn't copy — long-press the number to select it.");
    }
  };

  const title = step === "confirmation" ? "Report Received" : `Report ${noun}`;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      {/* Park focus on the dialog container instead of letting Radix autofocus
          the first reason row. Two reasons: (a) a row that opens wearing the
          focus ring reads as ALREADY PICKED, which on a destructive-ish trust
          flow is exactly the wrong first impression, and (b) it is the shared
          convention — DialogContent turns a prevented autofocus into
          `content.focus()`, so the dialog still owns focus, a screen reader
          announces the title, and Tab starts inside the modal. */}
      <DialogContent
          stepped onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHero title={title} />

        {step === "reason" && (
          <div className="space-y-3">
            {/* The weight this screen was missing. Reporting is a trust
                action; say what it sets in motion BEFORE the user commits,
                not only on the receipt. Both claims are true of the code:
                the row lands in the admin Reports queue, and nothing
                anywhere notifies the reported party. */}
            <p
              className="font-serif italic leading-relaxed text-ds-13"
              style={{ color: "hsl(var(--olivewood) / 0.9)" }}
            >
              Reports go straight to the Louisiana Helpr trust &amp; safety team.
              We never tell the other person who reported them.
            </p>

            {/* NO EYEBROW ABOVE THE LIST (owner, 2026-08-31: "Remove
                eyebrow."). The rust letterspaced "WHAT'S WRONG WITH THIS
                JOB?" line that used to sit here said nothing the dialog had
                not already said twice — the hero title reads "Report job" and
                the lede directly above explains where the report goes. Three
                stacked framing lines before the first tappable row is a
                preamble, not a heading.

                The question survives as the group's ACCESSIBLE name: a screen
                reader still hears "What's wrong with this job?, group" before
                the first radio, so nothing is lost non-visually. */}
            <div
              role="group"
              aria-label={REASON_PROMPT[reportedType]}
              className="space-y-1.5"
            >
              {reasons.map(({ label, Icon }) => {
                const active = reason === label;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      hapticMedium();
                      setReason(label);
                      // Auto-advance: the row IS the action (that's what the
                      // chevron promises), and the details step is required
                      // anyway. The short delay lets the glossy selected
                      // state register as confirmation of the tap.
                      setTimeout(() => setStep("details"), 140);
                    }}
                    // Deliberately a bare <button>, not the shared <Button>:
                    // button.tsx's base class list carries `whitespace-nowrap`,
                    // which would stop a long label from ever wrapping and
                    // would clip it at 320px. The global `button { min-height:
                    // 44px }` floor still applies; min-h-[3.5rem] takes it to
                    // 56px so a two-line label still has room.
                    className={`group w-full flex items-center gap-3 min-h-[3.5rem] px-3 py-2.5 rounded-ds-md text-left transition-all duration-150 ease-ds-spring active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      active
                        ? "btn-grad-primary border border-[hsl(var(--bark))] shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_1px_1px_hsl(var(--ink-deep)/0.10),0_2px_6px_hsl(var(--ink-deep)/0.12)]"
                        : "bg-secondary/45 border border-border/60 hover:bg-secondary/70 hover:border-border shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
                    }`}
                  >
                    <span
                      className="shrink-0 w-9 h-9 rounded-ds-sm flex items-center justify-center"
                      style={
                        active
                          ? {
                              background: "hsl(var(--parchment) / 0.20)",
                              border: "0.5px solid hsl(var(--parchment) / 0.30)",
                            }
                          : {
                              background: "hsl(var(--burnt-sienna) / 0.10)",
                              border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
                            }
                      }
                    >
                      <Icon
                        className="w-[18px] h-[18px]"
                        style={{
                          color: active
                            ? "hsl(var(--parchment))"
                            : "hsl(var(--burnt-sienna))",
                        }}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    </span>
                    {/* `whitespace-normal` + `break-words` live on the LABEL,
                        not the row, so nothing in the cascade can pin the
                        text to one line. `min-w-0` is what actually lets a
                        flex child shrink far enough to wrap at 320px. */}
                    <span
                      className="flex-1 min-w-0 whitespace-normal break-words font-sans font-semibold leading-snug text-ds-14"
                      style={{
                        color: active
                          ? "hsl(var(--parchment))"
                          : "hsl(var(--ink-deep))",
                      }}
                    >
                      {label}
                    </span>
                    <ChevronRight
                      className="shrink-0 w-4 h-4 transition-transform duration-150 group-hover:translate-x-0.5"
                      style={{
                        color: active
                          ? "hsl(var(--parchment) / 0.8)"
                          : "hsl(var(--muted-foreground))",
                      }}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>

            {/* A real footer button on the shared `DialogFooter`, matching
                every other dialog — was a bare ghost "Cancel" floating in a
                hand-rolled `justify-end` row with no button treatment and no
                alignment to the list above it.
                It was then given `outline` on the argument that a lone ghost
                reads as "text floating at the bottom". The owner has since
                settled the treatment directly (2026-08-31, shown all three
                variants their screenshots contained): "Small, I feel like left
                aligned makes more sense than right." A lone dismiss is the
                same small ghost, in the same place, as one that has a commit
                beside it — see popupFooter.ts. */}
            <DialogFooter>
              <DialogSecondaryAction type="button" onClick={handleClose}>
                Cancel
              </DialogSecondaryAction>
            </DialogFooter>
          </div>
        )}

        {step === "details" && (
          <div className="space-y-4">
            <div
              className="rounded-ds-md px-3 py-2.5 flex items-center justify-between gap-2"
              style={{
                background: "hsl(var(--primary) / 0.06)",
                border: "0.5px solid hsl(var(--primary) / 0.22)",
              }}
            >
              <span
                className="font-sans font-medium min-w-0 whitespace-normal break-words text-ds-13"
                style={{ color: "hsl(var(--primary))" }}
              >
                {reason}
              </span>
              <button
                type="button"
                onClick={() => setStep("reason")}
                className="shrink-0 font-sans font-medium underline-offset-2 hover:underline text-ds-11"
                style={{ color: "hsl(var(--primary))" }}
              >
                Change
              </button>
            </div>

            {/* Says who reads this and what it decides — the same weight the
                reason step carries, and it is what makes a free-text box feel
                worth filling in properly. It ALSO settles this step's width:
                the shared shell is `sm:w-auto` (shrink-to-fit) above `sm`, so
                without a full-measure line of prose the details step rendered
                ~185px narrower than the reason and confirmation steps and the
                dialog visibly shrank mid-flow. Fixed with content, not with a
                width override on the shell. */}
            <p
              className="font-serif italic leading-relaxed text-ds-13"
              style={{ color: "hsl(var(--olivewood) / 0.9)" }}
            >
              An admin reads this to decide what happens next — dates, amounts,
              and exactly what was said help most.
            </p>

            <div className="space-y-1.5">
              {/* A VISIBLE label, associated via htmlFor/id. The field used to
                  carry only `aria-label="Report description"` and a
                  placeholder, so a sighted user had no persistent label at
                  all once they started typing. */}
              <label
                htmlFor={detailsId}
                className="font-serif italic uppercase block text-ds-10"
                style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
              >
                What happened?
              </label>
              <Textarea
                id={detailsId}
                aria-describedby={detailsHintId}
                placeholder="Start with when it happened…"
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, MAX_LENGTH))}
                rows={4}
                required
                className="rounded-ds-md border-border/60 bg-background/80 focus-visible:bg-background focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15 text-ds-14 leading-relaxed resize-none"
              />
              <div id={detailsHintId} className="flex items-center justify-between gap-2 text-ds-11">
                <span
                  className={
                    tooShort ? "text-destructive font-medium" : "text-muted-foreground"
                  }
                >
                  {tooShort
                    ? `${MIN_LENGTH - trimmedLength} more character${MIN_LENGTH - trimmedLength === 1 ? "" : "s"} required`
                    : trimmedLength === 0
                    ? `At least ${MIN_LENGTH} characters`
                    : "Looks good"}
                </span>
                <span
                  className="tabular-nums shrink-0"
                  style={{
                    color: charsLeft < 50
                      ? "hsl(var(--burnt-sienna))"
                      : "hsl(var(--muted-foreground))",
                  }}
                >
                  {charsLeft}
                </span>
              </div>
            </div>

            {/* No `sm:!justify-between`. The shared footer already puts the
                dismiss hard-left and the commit hard-right at every width,
                which is what that override was reaching for — and this
                dialog's compact secondary is now the app-wide standard, so it
                no longer has to state it locally. */}
            <DialogFooter>
              <DialogSecondaryAction
                type="button"
                onClick={() => setStep("reason")}
                disabled={submitting}
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </DialogSecondaryAction>
              {/* Glossy primary (`btn-grad-primary` via DialogPrimaryAction),
                  not the flat inline bark fill this used to hand-roll. */}
              <DialogPrimaryAction
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  "Submit Report"
                )}
              </DialogPrimaryAction>
            </DialogFooter>
          </div>
        )}

        {step === "confirmation" && caseNumber && (
          <div className="space-y-4">
            <div
              className="rounded-ds-md p-4 text-center space-y-3"
              style={{
                background: "hsl(var(--success-tint))",
                border: "0.5px solid hsl(var(--success-border) / 0.35)",
              }}
            >
              <div className="flex justify-center">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{
                    background: "hsl(var(--success-tint-strong))",
                    border: "1px solid hsl(var(--success-border-strong) / 0.35)",
                  }}
                >
                  <Check
                    className="w-6 h-6"
                    style={{ color: "hsl(var(--success-ink))" }}
                    strokeWidth={2.5}
                  />
                </div>
              </div>
              {/* WHAT THIS COPY MAY SAY IS BOUNDED BY WHAT THE CODE DOES.
                  It used to promise "most are handled within 24 hours;
                  complex cases can take up to 3 business days" — a review
                  timeline nothing in the system delivers. What actually
                  happens on insert:
                    • the row lands in `public.reports` with status 'pending'
                      and appears in the admin queue (AdminReports.tsx), where
                      an admin can assign it to themselves and move it to
                      investigating / resolved / dismissed;
                    • `auto_escalate_reports_tg` fires, and ONLY for
                      reported_type='user': at 3+ unresolved reports on that
                      account in 90 days it notifies every admin (throttled to
                      once per 7 days);
                    • nothing notifies the reported party, and nothing
                      notifies the REPORTER of the outcome either.
                  The 24h figure exists only as the admin queue's own overdue
                  colouring (SLA_BREACH_HOURS) — an internal triage target, not
                  a commitment to the user — so it is not quoted here. */}
              <p
                className="font-serif italic leading-relaxed text-ds-15"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Your report is in the trust &amp; safety queue. An admin reviews
                every report and decides what happens to the {REPORTED_NOUN_INLINE[reportedType]} —
                and the other person is never told who reported them.
              </p>
              <p className="text-ds-12 text-muted-foreground leading-relaxed">
                There&apos;s no automatic status update — keep this case number if
                you want to follow up.
              </p>
              <div className="space-y-1">
                <p
                  className="font-serif italic uppercase text-ds-10"
                  style={{
                    color: "hsl(var(--olivewood) / 0.8)",
                    letterSpacing: "0.16em",
                  }}
                >
                  Your case number
                </p>
                <button
                  type="button"
                  onClick={copyCaseNumber}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-ds-sm font-mono tabular-nums text-ds-15 font-semibold transition-colors hover:bg-secondary/40"
                  style={{
                    color: "hsl(var(--ink-deep))",
                    background: "var(--surface-premium)",
                    border: "0.5px solid hsl(var(--olivewood) / 0.2)",
                    letterSpacing: "0.04em",
                  }}
                  // WCAG 2.5.3: the accessible name CONTAINS the visible text
                  // (the case number itself), it does not replace it.
                  aria-label={`Copy case number ${caseNumber}`}
                >
                  {caseNumber}
                  <Copy className="w-3.5 h-3.5 opacity-60" aria-hidden="true" />
                </button>
              </div>
              <DialogBody>
                <p>
                  Email{" "}
                  <a href="mailto:admin@louisianahelpr.com" className="underline">
                    admin@louisianahelpr.com
                  </a>{" "}
                  with this number if you have more to add.
                </p>
              </DialogBody>
            </div>
            <DialogFooter>
              <DialogPrimaryAction type="button" onClick={handleClose}>
                Done
              </DialogPrimaryAction>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ReportDialog;
