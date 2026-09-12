import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "react-router-dom";
import { WifiOff, BookmarkCheck, AlertTriangle } from "lucide-react";
import { useAwardBlockReason } from "@/hooks/useAwardBlockReason";
import { helperApplyBlockNotice } from "@/lib/awardGate";
import { errorToast } from "@/lib/toast";
import { hapticMedium, hapticError } from "@/lib/haptics";
import { scanMessage, type DetectedViolation } from "@/lib/messageScanner";
import { ViolationDialog } from "@/components/richMessageInput/ViolationDialog";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { safeStorage } from "@/lib/safeStorage";
import type { ApplyConfirmDialogProps } from "./types";
import { ApplyEarningsBreakdown } from "./ApplyEarningsBreakdown";
import {
  MAX_PITCH_LENGTH,
  pitchDraftKey,
  LEGACY_PITCH_DRAFT_KEY,
  TEMPLATE_KEY,
} from "./applyConfirmDialogHelpers";

/**
 * ApplyBody — everything on the apply step except the surface it sits on.
 *
 * Extracted from ApplyConfirmDialog so the SAME markup can render in two
 * places: inline on the job-detail sheet itself (the normal route — one
 * sheet, one CTA, see JobDetailDialog), and inside a standalone sheet for the
 * QuickApply deep link, where no detail sheet is open to host it.
 *
 * What changed when it moved (owner, 2026-08-28 — "I don't like this"):
 *
 *  - THE CHIPS ARE GONE. Three pills ("Free Sunday", "Done this before", "Any
 *    questions?") sat above the field, and two hint bullets sat above them,
 *    and the field had a placeholder of its own — three separate invitations
 *    to write the same optional sentence, in the densest part of the screen.
 *    The one genuinely job-specific hint survives as the PLACEHOLDER, which is
 *    where you are already looking when you decide what to type.
 *  - The "30+ characters feels personal" line is gone. It coached the helper
 *    on a threshold nothing enforces, in a slot that then had to also say
 *    "Nice — that reads personal", which is the app congratulating someone for
 *    typing.
 *  - The counter only appears near the cap, where it is information rather
 *    than pressure.
 *
 * Two things this must keep doing, unchanged from the dialog it came from:
 *  1. The pitch is OPTIONAL. Nothing here may read as a required form.
 *  2. The earnings block is the anchor — the only card on the step.
 */

type Props = ApplyConfirmDialogProps & {
  /** Renders the submit button; the sheet chrome supplies nothing. */
  submitLabelIdle?: string;
  /** Called after a successful local confirm, so a host sheet can step back. */
  className?: string;
  /**
   * Skip the "You earn $X" earnings card. Set by JobDetailDialog, which now
   * renders this inline on the SAME screen as the job's own price pill
   * (owner, 2026-08-30: "delete [the separate apply step]" — merged into
   * one screen) — showing the payout twice on one screen read as
   * redundant. The standalone QuickApply sheet has no price shown
   * elsewhere, so it keeps the card (this defaults to false).
   */
  hideEarnings?: boolean;
};

/** Counter appears with this much room left, not before. */
const COUNTER_VISIBLE_FROM = MAX_PITCH_LENGTH - 100;

export function ApplyBody({
  open,
  confirmApplyJob,
  platformFee,
  applyMessage,
  setApplyMessage,
  applyLoading,
  handleApplyConfirm,
  hideEarnings = false,
}: Props) {
  const { online } = useOnlineStatus();
  // `helper_unknown` is excluded deliberately — see helperApplyBlockNotice.
  // It means the profile could not be read at all, which is not something to
  // report to somebody mid-application.
  const awardBlockReason = useAwardBlockReason();
  const applyBlockNotice =
    awardBlockReason && awardBlockReason !== "helper_unknown"
      ? helperApplyBlockNotice(awardBlockReason)
      : null;
  const isInstantBook = !!(confirmApplyJob as any)?.instant_book;
  const jobId = confirmApplyJob?.id ?? null;
  const draftKey = pitchDraftKey(jobId);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [pendingViolations, setPendingViolations] = useState<DetectedViolation[] | null>(null);

  const savedTemplate = safeStorage.getItem(TEMPLATE_KEY);
  const differsFromTemplate = !!applyMessage.trim() && applyMessage !== savedTemplate;

  // DOES THE HOST SHEET ACTUALLY SCROLL? The submit row's sticky treatment —
  // `position: sticky` plus the negative bottom margin that cancels the scroll
  // container's own bottom padding — is built for the overflowing sheet and
  // is WRONG on one that fits.
  //
  // The negative margin makes the container compute its content 20px shorter
  // than the row really renders. When the sheet scrolls that is harmless (it
  // just means 20px less scrollable content). When it does NOT scroll, the
  // container's height comes FROM that short measurement, so the row no longer
  // fits inside it — and `bottom: 0` then does exactly what it is told and
  // drags the row up into the element above it.
  //
  // Measured live on the merged job sheet at 1440 before this gate existed:
  // the payout-gate notice ended at y=703.5 and the submit row began at
  // y=697.5 — a 6px overlap that squared off the notice's bottom corners, on
  // the one screen that explains why a helper cannot be hired yet (owner,
  // 2026-09-11: "the you can apply button is cut off by apply"). The same
  // mismatch left dead space under the button, which is the second half of
  // the same report.
  //
  // The comment on `.sheet-sticky-actions` in index.css claimed this "costs
  // nothing when the sheet fits". It cost 6px; the claim was never measured.
  const stickyRowRef = useRef<HTMLDivElement>(null);
  const [hostScrolls, setHostScrolls] = useState(false);
  useEffect(() => {
    if (!open) return;
    const row = stickyRowRef.current;
    if (!row) return;
    // Nearest ancestor that actually scrolls — the dialog surface in both
    // hosts (the merged job sheet and the standalone QuickApply sheet).
    let scroller: HTMLElement | null = row.parentElement;
    while (scroller) {
      const oy = getComputedStyle(scroller).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    const el = scroller;
    // 1px of slack: sub-pixel layout routinely leaves scrollHeight a hair
    // above clientHeight on a sheet that visibly does not scroll.
    const measure = () => setHostScrolls(el.scrollHeight - el.clientHeight > 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(row);
    return () => ro.disconnect();
    // `applyMessage` is in the deps because the note field grows with it,
    // which is the one thing on this step that can tip a fitting sheet into
    // a scrolling one.
  }, [open, applyMessage, applyBlockNotice, online]);

  // No placeholder on the note field (owner, 2026-08-29). It carried a coaching
  // tip ("Higher-budget jobs go to Helprs who mention relevant experience"),
  // which is the app telling someone how to win a job inside the box where they
  // are trying to write. The label already says "Add a note (optional)".

  // Restore a saved draft for THIS job when the step (re)opens with an empty
  // field — per-job scoping so switching jobs doesn't bleed text between
  // unrelated pitches. One-time migration of the legacy single draft key so a
  // pre-update in-flight pitch isn't lost on the upgrade.
  useEffect(() => {
    if (!open) return;
    if (applyMessage) return;
    if (!jobId) return;
    const saved = safeStorage.getItem(draftKey);
    if (saved) {
      setApplyMessage(saved);
      return;
    }
    const legacy = safeStorage.getItem(LEGACY_PITCH_DRAFT_KEY);
    if (legacy) {
      setApplyMessage(legacy);
      safeStorage.setItem(draftKey, legacy);
      safeStorage.removeItem(LEGACY_PITCH_DRAFT_KEY);
    }
    // Intentionally keyed on `open` + jobId only — restore once per open.

  }, [open, jobId]);

  // When no draft was found, pre-fill from the saved pitch template so the
  // helpr doesn't start from a blank field every time.
  useEffect(() => {
    if (!open) return;
    const template = safeStorage.getItem(TEMPLATE_KEY);
    if (template && !applyMessage) {
      setApplyMessage(template);
    }
    // Fire once per open; applyMessage intentionally omitted so we don't loop.

  }, [open]);

  // Auto-save the in-progress pitch, so stepping back or dismissing the sheet
  // never loses what the helpr typed.
  useEffect(() => {
    if (!open || !jobId) return;
    if (applyMessage.length === 0) {
      safeStorage.removeItem(draftKey);
      return;
    }
    const handle = setTimeout(() => safeStorage.setItem(draftKey, applyMessage), 200);
    return () => clearTimeout(handle);
  }, [open, jobId, draftKey, applyMessage]);

  const handleConfirm = () => {
    hapticMedium();
    // SAME CONTRACT AS MESSAGES. The server scans this note exactly as it scans
    // a chat message and, when it trips a rule, stores the application with
    // `flagged_hidden` set — the poster never sees the note. The helpr was told
    // "Application sent!" and nothing else, so they waited on a reply to a
    // sentence nobody had read. Messages has always blocked the same content
    // BEFORE sending and said which words were the problem; this is that same
    // scanner and that same dialog, on the surface that was silently dropping
    // it instead. The server-side scan stays exactly where it is — this is the
    // UI half of a defence in depth, not a replacement for it.
    if (applyMessage.trim()) {
      const violations = scanMessage(applyMessage);
      if (violations.length > 0) {
        hapticError();
        setPendingViolations(violations);
        return;
      }
    }
    // Offline: don't fire a mutation that rolls back silently. Persist the
    // pitch and keep the step up with a clear retry affordance instead.
    if (!online) {
      if (applyMessage) safeStorage.setItem(draftKey, applyMessage);
      errorToast("You're offline", {
        description: "We saved your pitch. Try again once you're back online.",
        critical: true,
        id: "apply-offline",
        onRetry: () => {
          if (navigator.onLine) {
            safeStorage.removeItem(draftKey);
            handleApplyConfirm();
          }
        },
      });
      return;
    }
    safeStorage.removeItem(draftKey);
    if (saveAsTemplate && applyMessage.trim()) {
      safeStorage.setItem(TEMPLATE_KEY, applyMessage.trim());
    }
    setSaveAsTemplate(false);
    handleApplyConfirm();
  };

  return (
    <div className="min-w-0 flex flex-col gap-3.5">
      <ViolationDialog violations={pendingViolations} onOpenChange={(o) => { if (!o) setPendingViolations(null); }} />
      {!confirmApplyJob && (
        <p className="font-sans text-ds-13 leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
          Are you sure you want to proceed?
        </p>
      )}

      {confirmApplyJob && !hideEarnings && (
        <ApplyEarningsBreakdown confirmApplyJob={confirmApplyJob} platformFee={platformFee} />
      )}

      <div className="space-y-1.5">
        {/* ONE prompt for the pitch. Sans, sentence case — the small-caps
            italic burnt-sienna eyebrow it replaces was styled like a section
            masthead for what is an optional note field. */}
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="apply-message" className="font-sans font-semibold text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
            Note to the poster{" "}
            <span className="font-normal" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              (optional)
            </span>
          </label>
          {applyMessage.length >= COUNTER_VISIBLE_FROM && (
            <span
              className="font-sans tabular-nums text-ds-11 shrink-0"
              style={{
                color: MAX_PITCH_LENGTH - applyMessage.length < 50
                  ? "hsl(var(--burnt-sienna))"
                  : "hsl(var(--muted-foreground))",
              }}
            >
              {applyMessage.length}/{MAX_PITCH_LENGTH}
            </span>
          )}
        </div>

        <Textarea
          id="apply-message"
          value={applyMessage}
          onChange={(e) => setApplyMessage(e.target.value.slice(0, MAX_PITCH_LENGTH))}
          maxLength={MAX_PITCH_LENGTH}
          rows={3}
          className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-sans text-ds-14 leading-relaxed"
        />

        {/* Saved pitch, as ONE control instead of two. Restoring the template
            and saving a new one used to be a sage text button above the field
            and a checkbox below it, both visible at once even when they
            contradicted each other. Now only the applicable one renders. */}
        {savedTemplate && applyMessage !== savedTemplate && (
          <button
            type="button"
            onClick={() => setApplyMessage(savedTemplate)}
            className="inline-flex items-center gap-1.5 font-sans text-ds-12 min-h-[32px] active:opacity-70"
            style={{ color: "hsl(var(--bark))" }}
          >
            <BookmarkCheck className="w-3.5 h-3.5" />
            Use saved pitch
          </button>
        )}
        {/* ALWAYS RENDERED, never conditional on the field's contents. It used
            to mount only once `differsFromTemplate` went true, i.e. on the
            first keystroke — so the row appeared out of nowhere mid-typing and
            shoved the submit button 25px down at 375 (50px at 1440), under a
            thumb that was already on its way there. An option that materialises
            under a moving target is worse than one that was simply always
            there. It is disabled, not hidden, while there is nothing to save;
            the height is identical in both states, so nothing moves. */}
        <label
          htmlFor="save-default-pitch"
          className={`flex items-center gap-2 min-h-[44px] -my-1 ${
            differsFromTemplate ? "cursor-pointer" : "cursor-default"
          }`}
        >
          <Checkbox
            id="save-default-pitch"
            checked={saveAsTemplate}
            disabled={!differsFromTemplate}
            onCheckedChange={(checked) => setSaveAsTemplate(checked === true)}
          />
          {/* Colour, not opacity, carries the disabled state — dimming the
              whole row with opacity-* drops the label under WCAG AA. */}
          <span
            className={`font-sans text-ds-12 ${
              differsFromTemplate ? "text-muted-foreground" : "text-muted-foreground/70"
            }`}
          >
            Save as my default pitch
          </span>
        </label>

      </div>

      {/* NO per-application file picker (owner, 2026-08-29). Certificates and
          work photos are uploaded ONCE on the profile (Edit Profile → Recent
          work) and posters see them on the applicant's profile via
          HelperWorkPhotos — so re-attaching the same file on every application
          was pure repeated work. Existing applications keep their stored
          `attachment_urls`; ApplicantsPanel still renders them. */}

      {/* THE GATE NOTICE TRAVELS WITH THE BUTTON. One sticky block, not two
          siblings where one is sticky and the other is not.

          Why: `position: sticky; bottom: 0` inside a scroller ALWAYS lifts the
          row off its flow position by exactly the distance its natural top is
          below the scrollport bottom — that is the entire mechanism, and at
          scroll-top on an overflowing sheet that distance is the whole
          remaining overflow. Whatever sits immediately above the row in flow
          is therefore covered until the sheet is scrolled to its very end.
          Measured on the phone (375x812) with this block split in two: the
          payout notice ended at y=691.3 and the lifted row began at y=670.2 —
          21.1px over the notice's last line, which is the line carrying the
          "Set Up Payouts" link (owner, 2026-09-11: "the you can apply button
          is cut off by apply"; the failure is plain in a screenshot).

          Reserving space under the row does not fix it — a spacer adds to the
          scrollable height, so the row is lifted further and covers exactly as
          much. Nothing can fix it while the notice is a separate sibling BELOW
          the fold, because the lift is a definition, not a bug.

          So the notice stops being the thing the row lands on and becomes part
          of the thing that lands: the explanation of why you cannot be hired,
          the link that fixes it, and the button it qualifies are one unit that
          stays on screen together at every scroll position. What the row now
          covers on the way past is the note field and the save-pitch checkbox
          — ordinary scrolled-under content the user reaches by scrolling.

          The wrapper is ALWAYS a `flex flex-col gap-3.5` column so the
          spacing is byte-identical to the two blocks it replaces (the body's
          own `gap-3.5`, plus the row's `pt-2`); only the sticky treatment is
          conditional. */}
      <div
        ref={stickyRowRef}
        className={`flex flex-col gap-3.5 ${
          hostScrolls ? "sheet-sticky-actions -mb-4 pb-4 sm:-mb-5 sm:pb-5" : ""
        }`}
      >
      {/* THE HELPER'S OWN COPY OF THE AWARD GATE.
          Applying stays ungated on purpose (see useAwardBlockReason), so this
          explains rather than blocks — and it sits ABOVE the submit row, where
          the helper is already looking, rather than arriving as a refusal
          after the tap. Without it, seven of eight live non-seed profiles
          apply into a state where no poster can hire them and nothing ever
          says why; the silence reads as posters passing them over.
          Suppressed while offline so the two advisories never stack — the
          offline one is about THIS tap and takes precedence. */}
      {applyBlockNotice && online && (
        <div
          className="flex items-start gap-2.5 rounded-ds-md border px-3 py-2.5"
          style={{
            borderColor: "hsl(var(--burnt-sienna) / 0.3)",
            background: "hsl(var(--burnt-sienna) / 0.06)",
          }}
          role="status"
        >
          <AlertTriangle
            className="w-4 h-4 shrink-0 mt-0.5"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          />
          <p className="flex-1 min-w-0 font-sans text-ds-11 text-foreground leading-snug">
            <span className="font-semibold">{applyBlockNotice.headline}</span>{" "}
            {applyBlockNotice.body}{" "}
            <Link
              to={applyBlockNotice.href}
              className="font-semibold underline underline-offset-2 whitespace-nowrap"
              style={{ color: "hsl(var(--burnt-sienna))" }}
            >
              {applyBlockNotice.ctaLabel}
            </Link>
          </p>
        </div>
      )}

      {!online && (
        <p
          className="flex items-center gap-1.5 font-sans text-ds-12 leading-snug"
          style={{ color: "hsl(var(--burnt-sienna))" }}
          role="status"
        >
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          You're offline. We'll hold onto your pitch — apply again once you're back online.
        </p>
      )}

      {/* STICKY, NOT PINNED. This form is part of the job-detail sheet's own
          run of content now (one sheet, one CTA — owner, 2026-09-09) and that
          sheet is routinely taller than the viewport, so `position: sticky`
          keeps the submit row on screen while the note field and the payout
          explainer scroll past it. It costs nothing when the sheet fits: a
          short job leaves this row exactly where it sits in flow, with no
          reserved space under it — that is what the negative bottom margins
          buy, by cancelling the scroll container's own bottom padding.
          THEY DO NOT MAKE THE PAINT REACH THE BOTTOM; a negative margin also
          lifts where `bottom: 0` parks the row, which left a 16px band under
          it where content kept scrolling into view (a stray "Set Up Payouts"
          under the CTA — owner, 2026-09-09). The `box-shadow` in
          `.sheet-sticky-actions` is what closes that band; see the long note
          on the rule in index.css before touching either half. No horizontal
          bleed either way — apply-dialog-fit.spec.ts holds every element
          inside the content box.

          ALL OF THAT IS GATED ON THE SHEET ACTUALLY SCROLLING (`hostScrolls`,
          measured above), and it is applied to the WRAPPER opened above, not
          to this row — the notice rides with it. On a sheet that fits, the
          same negative margin under-measures the container and `bottom: 0`
          pulls the block up over whatever is above it — so a fitting sheet
          gets plain flow: no sticky, no negative margin, no shadow, and the
          row's own `pb` is the only thing under the button. */}
      <div className="flex gap-1.5 pt-2">
        {/* Same primitive and surface as every other primary CTA in the app,
            JobDetailFooter's included — one button, one set of effects: the glossy
            `btn-grad-primary` radial, the hover brighten/lift/glow and the
            active press collapse all come from <Button>'s primary variant.
            That sentence used to be aspirational: BOTH buttons then overrode
            the variant with an inline `background: linear-gradient(bark →
            bark/0.86)` — the surface of the deleted `bark` variant, painted
            by hand. Inline background beats the class, so the computed
            background-image here was the flat two-stop linear, not the
            radial every other primary CTA resolves to. Assert the COMPUTED
            `background-image` if you are checking this — the class list said
            `btn-grad-primary` the whole time it was flat.
            Geometry (`h-11 sm:h-12`) stays local and unchanged — it matches
            the footer CTA slot this button replaces. */}
        <Button
          size="lg"
          type="button"
          onClick={handleConfirm}
          disabled={applyLoading}
          className="flex-1 min-w-0 rounded-ds-md h-11 sm:h-12 px-4 group disabled:opacity-60"
        >
          <span>
            {applyLoading
              ? isInstantBook ? "Booking…" : "Applying…"
              : !online ? "Try Again" : isInstantBook ? "Book Now" : "Apply Now"}
          </span>
        </Button>
      </div>
      </div>
    </div>
  );
}
