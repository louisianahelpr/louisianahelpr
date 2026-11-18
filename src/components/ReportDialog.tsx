import { useEffect, useId, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { reportSubmitError } from "@/lib/reportErrors";
import { type ReportedType, REASONS } from "./reportDialog/reportReasons";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enReport";
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
import { RadioCardList } from "@/components/ui/RadioCardList";
import { Switch } from "@/components/ui/switch";
import {
  Check,
  Copy,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";

// F260h (audit 11-10): the Cancel / Send report row sticks to the sheet's bottom
// edge (the sheet scrolls, DialogContent is overflow-y-auto with p-4), so the
// buttons stay in reach while the reason list and the details box are long.
// Design audit r3 #3: the dialog's own colour plus a top hairline (was bg-card, a white slab on the dialog).
const REPORT_FOOTER_PINNED = "sticky bottom-0 -mx-4 -mb-4 px-4 pb-4 pt-3 bg-background border-t border-border";

/** A reason's words key: the stored value stays the English label; the member reads t(reasonKey(label)). */
export const reasonKey = (label: string) =>
  `rep.r.${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}` as MsgKey;
/** Listing-like reports get a listing placeholder (design audit r3 #12); people and messages keep "when it happened". */
const LISTING_TYPES: readonly ReportedType[] = ["declutter_item", "declutter_wanted", "shop_item", "home_listing"];

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

const MIN_LENGTH = 10;
const MAX_LENGTH = 500;

type Step = "form" | "confirmation";

export interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Which of the five report contexts this is. Call sites, 2026-09-24:
   *   job     — Dashboard, Activity, PostedJobActions (the job feed's "Report")
   *   message — Messages (a single chat message's action sheet)
   *   user    — UserProfile, Messages (report the person, not the thread)
   *   review  — userProfile/ReviewsSection
   *   application — postedJobs/ApplicantsPanel (the applicant card, Q366)
   *
   * "profile" USED to be in this union and was never passed by any call site;
   * it is also not in the `reports_reported_type_check` CHECK constraint, so
   * a stray `reportedType="profile"` would have failed the insert with 23514
   * and surfaced only as a generic toast. Removed rather than mapped, so the
   * union and the database now agree exactly.
   */
  reportedType: ReportedType;
  reportedId: string;
  /** Board 157: offer "Also block <name>" (user reports). When on, Done hands
   *  over to the caller's Block dialog; nothing is blocked from here. */
  alsoBlock?: { name: string; onBlock: () => void };
}

/**
 * Report flow (board 157): ONE form screen, then the receipt.
 *   1) Form — the reasons as a RadioCardList, the required details box
 *      (10/500 characters), on a person's profile the "Also block" switch, and
 *      "Send report".
 *   2) Receipt — visible case # + a truthful "what happens next". The case #
 *      is the first 8 hex chars of the inserted report row's UUID, uppercased
 *      behind an HLP- prefix. With "Also block" on, its button reads
 *      "Block <name>" and is the only way into the caller's Block dialog.
 *
 * Shell: the shared `DialogContent` + `DialogHero` + a real `DialogFooter`.
 */
const ReportDialog = ({ open, onClose, reportedType, reportedId, alsoBlock }: ReportDialogProps) => {
  const { t } = useLanguage();
  const [blockAfter, setBlockAfter] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // `submitting` is state: two taps in one frame both read false. The ref sees the first.
  const submitInFlight = useRef(false);
  const [caseNumber, setCaseNumber] = useState<string | null>(null);

  const uid = useId();
  const detailsId = `${uid}-details`;
  const detailsHintId = `${uid}-details-hint`;

  // Reset the wizard whenever the dialog opens. Without this a second
  // open after a confirmation would still show the case # screen.
  useEffect(() => {
    if (open) {
      setStep("form");
      setBlockAfter(false);
      setReason("");
      setDescription("");
      setCaseNumber(null);
      submitInFlight.current = false;
      setSubmitting(false);
    }
  }, [open]);

  const trimmedLength = description.trim().length;
  const tooShort = trimmedLength > 0 && trimmedLength < MIN_LENGTH;
  const charsLeft = MAX_LENGTH - description.length;
  const canSubmit = !!reason && trimmedLength >= MIN_LENGTH && !submitting;

  const reasons = REASONS[reportedType];

  const handleSubmit = async () => {
    if (!reason) { hapticError(); toast.error(t("rep.pickReason")); return; }
    if (trimmedLength < MIN_LENGTH) { hapticError(); toast.error(t("rep.addDetail", { n: MIN_LENGTH })); return; }
    hapticMedium();
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitting(true);
    let user: { id: string } | null;
    try {
      ({ data: { user } } = await supabase.auth.getUser());
    } catch {
      // A thrown session read must not leave the dialog stuck "Sending…"
      // with Cancel and Escape disabled (lh-silent-failure note 5).
      hapticError();
      toast.error(t("rep.failed"));
      submitInFlight.current = false;
      setSubmitting(false);
      return;
    }
    if (!user) { toast.error(t("rep.signIn")); submitInFlight.current = false; setSubmitting(false); return; }

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
      toast.error(reportSubmitError(error, t("rep.failed")));
      submitInFlight.current = false; // release after a refused insert
      setSubmitting(false);
      return;
    }
    hapticSuccess();
    const shortId = String(data.id).replace(/-/g, "").slice(0, 8).toUpperCase();
    setCaseNumber(`HLP-${shortId}`);
    setStep("confirmation");
    submitInFlight.current = false;
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  // "Also block" was on and the report went in: ONLY the receipt's explicit
  // button hands over to the caller's Block dialog (which states what blocking
  // closes and asks again). Escape, the overlay and the X just close.
  const finishReceipt = () => {
    const block = step === "confirmation" && blockAfter && alsoBlock;
    handleClose();
    if (block) alsoBlock.onBlock();
  };

  const copyCaseNumber = async () => {
    if (!caseNumber) return;
    try {
      await navigator.clipboard?.writeText(caseNumber);
      hapticSuccess();
    } catch {
      hapticError();
      toast.error(t("rep.copyFailed"));
    }
  };

  // F260h: a report about a person names them in the title ("Report Hallie H.").
  const title = step === "confirmation"
    ? t("rep.sent")
    : reportedType === "user" && alsoBlock
      ? t("rep.titleNamed", { name: alsoBlock.name })
      : t(`rep.title.${reportedType}` as MsgKey);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      {/* Park focus on the dialog container instead of letting Radix autofocus
          the first reason row. Two reasons: (a) a row that opens wearing the
          focus ring reads as ALREADY PICKED, which on a destructive-ish trust
          flow is exactly the wrong first impression, and (b) it is the shared
          convention — DialogContent turns a prevented autofocus into
          `content.focus()`, so the dialog still owns focus, a screen reader
          announces the title, and Tab starts inside the modal. */}
      {/* keepClose: on a phone this is a sheet whose Cancel sits under the reasons and the text box; the X at the top
          is the near exit (audit 1110 F359j; owner 10-31, every sheet keeps its X). */}
      <DialogContent
          stepped keepClose onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHero title={title} />

        {step === "form" && (
          <div className="space-y-4">
            {/* Board 157 / 54: one screen, not a reason step that auto-advances
                into a details step. The reasons are the shared RadioCardList
                (the same list Something's not right uses), the details box
                sits under them, and the commit is one "Send report". Where the
                report goes is said once, under the list. */}
            <RadioCardList
              required
              label={t(`rep.q.${reportedType}` as MsgKey)}
              options={reasons.map(({ label }) => ({ value: label, label: t(reasonKey(label)) }))}
              value={reason}
              onChange={(v, via) => { if (via === "click") hapticMedium(); setReason(v); }}
            />

            <div className="space-y-1.5">
              <label htmlFor={detailsId} className="font-sans font-semibold text-ds-13 block" style={{ color: "hsl(var(--ink-deep))" }}>
                {t("rep.more")}
              </label>
              <Textarea
                id={detailsId}
                aria-describedby={detailsHintId}
                placeholder={LISTING_TYPES.includes(reportedType) ? t("rep.phListing") : t("rep.ph")}
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, MAX_LENGTH))}
                rows={3}
                required
                className="rounded-2xl border-border bg-card focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15 text-ds-14 leading-relaxed resize-none"
              />
              <div id={detailsHintId} className="flex items-center justify-between gap-2 text-ds-11">
                <span className={tooShort ? "font-medium" : "text-muted-foreground"} style={tooShort ? { color: "hsl(var(--alert-ink))" } : undefined}>
                  {tooShort
                    ? (MIN_LENGTH - trimmedLength === 1 ? t("rep.needOne") : t("rep.needN", { n: MIN_LENGTH - trimmedLength }))
                    : trimmedLength === 0
                    ? t("rep.atLeast", { n: MIN_LENGTH })
                    : t("rep.good")}
                </span>
                <span
                  className="tabular-nums shrink-0"
                  style={{
                    color: charsLeft < 50
                      ? "hsl(var(--alert-ink))"
                      : "hsl(var(--muted-foreground))",
                  }}
                >
                  {t("rep.count", { len: description.length, max: MAX_LENGTH })}
                </span>
              </div>
            </div>

            {alsoBlock && (
              // Board 157's "Also block". It never blocks on its own: blocking
              // closes open deals with their real cancellation rules, so after
              // the report is sent this hands over to the Block dialog, which
              // states those consequences and asks again.
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-card border border-border px-4 min-h-[52px]">
                <label htmlFor={`${uid}-also-block`} className="font-sans font-semibold text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>
                  {t("rep.blockToo", { name: alsoBlock.name })}
                </label>
                <Switch id={`${uid}-also-block`} checked={blockAfter} onCheckedChange={setBlockAfter} />
              </div>
            )}

            {/* Verified live 2026-10-21 (pg_policies, pg_trigger on prod):
                only admins may read others' reports or change a report's
                status (no trigger or job resolves one), and the reported
                person cannot read the row; the insert triggers only rate-limit,
                notify ADMINS at 3+ reporters, and write the ops ledger. */}
            <p className="font-sans text-ds-12 leading-relaxed text-muted-foreground">
              {t("rep.privacy")}
            </p>

            <DialogFooter className={REPORT_FOOTER_PINNED}>
              <DialogSecondaryAction type="button" onClick={handleClose} disabled={submitting}>
                {t("rep.cancel")}
              </DialogSecondaryAction>
              <DialogPrimaryAction
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("rep.sending")}
                  </>
                ) : (
                  t("rep.send")
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
                    • `auto_escalate_reports_tg` fires for reported_type
                      'user' and 'application' (counted against the applicant,
                      20260924182505): at 3+ unresolved reports on that
                      account in 90 days it notifies every admin (throttled to
                      once per 7 days);
                    • nothing notifies the reported party;
                    • when the report is resolved or dismissed, the REPORTER
                      gets one notice (trg_reports_zz_reporter_outcome,
                      20261102015348, A3-113) quoting this case number.
                  The 24h figure exists only as the admin queue's own overdue
                  colouring (SLA_BREACH_HOURS) — an internal triage target, not
                  a commitment to the user — so it is not quoted here. */}
              <p
                className="font-sans leading-relaxed text-ds-15"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {t("rep.inQueue", { noun: t(`rep.noun.${reportedType}` as MsgKey) })}
              </p>
              <p className="text-ds-12 text-muted-foreground leading-relaxed">
                {t("rep.notice")}
              </p>
              <div className="space-y-1">
                <p className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {t("rep.caseLabel")}
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
                  aria-label={t("rep.copyCase", { n: caseNumber })}
                >
                  {caseNumber}
                  <Copy className="w-3.5 h-3.5 opacity-60" aria-hidden="true" />
                </button>
              </div>
              <DialogBody>
                <p>
                  {t("rep.email")}{" "}
                  <a href="mailto:admin@louisianahelpr.com" className="underline">
                    admin@louisianahelpr.com
                  </a>{" "}
                  {t("rep.emailTail")}
                </p>
              </DialogBody>
            </div>
            {blockAfter && alsoBlock && (
              <p className="font-sans text-ds-12 text-muted-foreground text-center">
                {t("rep.tapBlock", { name: alsoBlock.name })}
              </p>
            )}
            <DialogFooter>
              <DialogPrimaryAction type="button" onClick={finishReceipt}>
                {blockAfter && alsoBlock ? t("rep.block", { name: alsoBlock.name }) : t("rep.done")}
              </DialogPrimaryAction>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ReportDialog;
