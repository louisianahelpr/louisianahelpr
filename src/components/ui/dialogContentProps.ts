/**
 * DialogContent's own props (beyond Radix's), with the reasons each exists. Split out of dialog.tsx so the
 * component stays under its size line (componentSizeRatchet); dialog.tsx imports it.
 */
import type * as React from "react";

export interface DialogContentOwnProps {
  /**
   * Extra icon buttons (Share/Save/Report, etc.) rendered in the SAME
   * flex row as the close X, immediately to its left — not a second,
   * independently-positioned element the caller has to hand-offset to
   * line up beside it (owner, 2026-08-30: "it does not belong to the
   * component ... not pieced together" — JobDetailDialog used to render
   * its own icon row at a magic-number `right-[2.875rem]` so it wouldn't
   * collide with this button's own `right-3`, two siblings faking one
   * toolbar). Pass the icon buttons here instead; this component owns
   * the single row they all share.
   */
  topRightSlot?: React.ReactNode;
  /**
   * This dialog cannot be dismissed — no X, no tap-outside, no Escape. For
   * the one case where leaving is not a legitimate outcome: TermsReconsent,
   * which has no `onOpenChange` because the user must accept before the app
   * continues.
   *
   * It has to be spelled out HERE because of the very difference that made
   * the alert-dialog merge worth doing. Radix's AlertDialog hard-codes
   * `onPointerDownOutside`/`onInteractOutside` to `preventDefault` — assigned
   * AFTER the caller's props, so it is not overridable — which is why the
   * owner's "allow tap out to close on all" was unimplementable for the 43
   * confirm boxes that lived on it. Dialog has the opposite default: it DOES
   * close on outside click. Excellent for the other 42; for this one it would
   * have meant a user could tap the backdrop and skip re-consenting to the
   * terms. Migrating without this prop would have shipped exactly that.
   */
  closeDisabled?: boolean;
  /**
   * This dialog CHANGES ITS CONTENT IN PLACE — job detail -> apply, the
   * three-step report, the rate -> tip -> share sequence, the onboarding
   * tour. It pins its TOP edge instead of its centre.
   *
   * WHY, measured: a vertically-centred box absorbs a height change
   * symmetrically, so it moves by HALF of it. Stepping the job sheet from
   * detail (442px) to apply (575px) moved the whole surface UP 66.4px —
   * every word the user was reading slid out from under them, mid-flow, in
   * the middle of applying for a job. `apply-single-sheet.spec.ts` has been
   * failing on exactly that since a46d6bdc5 centred it, and the assertion is
   * right: what changed was the code, not the requirement.
   *
   * Owner ruled 2026-09-02, shown both measurements: top-anchor the ones
   * that step, leave every single-step confirm centred. It is also what
   * Apple and Google both do — a surface that changes in place does not
   * move, because the user's eye is already fixed on it.
   *
   * Deliberately NOT the same thing as "this dialog is tall". Three dialogs
   * once opted out of centring by hand with `top-[7vh]` to cure a *symptom*
   * of this ("opens small then gets bigger?"), were centred again by
   * a46d6bdc5, and the real distinction was never named. This is the name.
   */
  stepped?: boolean;
  /**
   * Keep the corner X even though the footer offers a labelled way out (audit 11-01 JA-54). For a dialog that
   * is a SHEET on a phone (the Job done review): owner 10-31, "every sheet has an X" (popupDismiss.tsx's
   * sheet exception), and its footer's "Skip for now" is a later-not-never, not a plain Cancel.
   */
  keepClose?: boolean;
}
