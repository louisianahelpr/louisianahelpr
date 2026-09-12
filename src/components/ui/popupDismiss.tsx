import * as React from "react";

/**
 * THE ONE DISMISSAL RULE, for every popup surface in the app.
 *
 *   A surface that offers a LABELLED dismissing action does not also show a
 *   corner ×. A surface without one keeps the × as its only way out.
 *   Never both. Never neither.
 *
 * Both platforms this app lives beside agree and neither draws the second one:
 * Apple's UIAlertController has no close control at all — you dismiss by
 * choosing an action — and Material 3's basic dialog is actions only. The ×
 * belongs to full-screen and sheet surfaces that have nothing else, not to a
 * surface that already says "Cancel" in words.
 *
 * The owner has now asked for this three times, about three different
 * surfaces: a dialog ("the X … looking wrong"), a toast ("not now and x do the
 * same thing. one or the other.", 2026-09-11) and a sheet ("i thought we did
 * no x if there is a cancel button globally", 2026-09-11). Each time it was
 * implemented where it was reported and nowhere else, which is why it kept
 * coming back — dialog.tsx had it, sheet.tsx did not, and `lib/toast.ts` had a
 * third copy of the same sentence. This file is the rule itself, imported by
 * every family that has to obey it, exactly as `popupFooter.ts` is the one
 * footer.
 *
 * ─── REGISTRATION, NOT A PROP ──────────────────────────────────────────────
 *
 * A `hideClose` prop would mean editing ~40 call sites and trusting each to
 * pass it, which is precisely how the close button came to have three
 * different sizes in the first place. Here the rule enforces itself: render a
 * DialogSecondaryAction / SheetSecondaryAction and the × goes away. Nothing to
 * remember, nothing to pass, and a popup cannot drift out of the convention by
 * omission — including a popup written next year by someone who never read
 * this comment.
 *
 * This deliberately keys on the shared SECONDARY ACTION PRIMITIVE, not on the
 * word "Cancel": those primitives reject `className`/`variant`/`size` and are
 * the only sanctioned way to draw a popup's dismiss, so "has a labelled
 * dismiss" and "renders one of them" are the same statement. A hand-rolled
 * `<Button variant="ghost">Cancel</Button>` does NOT register — and that is the
 * correct outcome, because it is already a violation of the footer contract
 * that `popupShellInventory.test.ts` polices. Fix such a button by moving it
 * into the shared footer, not by teaching this file to recognise it.
 */
export const PopupDismissCtx = React.createContext<((present: boolean) => void) | null>(null);

/**
 * For the CONTENT component (DialogContent, SheetContent): returns whether a
 * labelled dismiss is present, plus the provider value to wrap children in.
 * Render the × only when `hasDismiss` is false.
 */
export function usePopupDismissPresence() {
  const [hasDismiss, setHasDismiss] = React.useState(false);
  return [hasDismiss, setHasDismiss] as const;
}

/**
 * For the SECONDARY ACTION component: announces to the surrounding surface
 * that this popup has a labelled way out. Cleared on unmount, so a multi-step
 * flow that loses its back action gets its × back.
 */
export function useRegisterPopupDismiss() {
  const register = React.useContext(PopupDismissCtx);
  React.useEffect(() => {
    register?.(true);
    return () => register?.(false);
  }, [register]);
}
