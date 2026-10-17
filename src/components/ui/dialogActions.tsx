import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { Button, type ButtonProps } from "@/components/ui/button";
import { POPUP_SECONDARY_CLS, POPUP_COMMIT_CLS } from "@/components/ui/popupFooter";
import { useRegisterPopupDismiss } from "@/components/ui/popupDismiss";

/**
 * Is this dialog a CONFIRM (`role="alertdialog"`)? Set by DialogContent, read
 * by the three action components, which then wrap themselves in
 * `DialogPrimitive.Close` so clicking one dismisses the dialog.
 *
 * WHY THIS EXISTS — it is the whole reason the merge was safe.
 * Confirms used to live in `ui/alert-dialog.tsx` on Radix's AlertDialog
 * primitive, where `AlertDialogAction` and `AlertDialogCancel` are BOTH
 * `DialogPrimitive.Close` under the hood, i.e. every confirm button closed its
 * dialog for free. `DialogPrimaryAction` is a plain `<Button>` and does not.
 * So a straight rename of the 43 confirm boxes — 12 direct call sites plus
 * every one of BrandConfirmDialog's 31 — would have left each of them OPEN
 * after you confirmed, with no error and no type failure. Admin ban, remove
 * review, delete note, delete account.
 *
 * Making it a CONTEXT rather than a prop is deliberate, and the same argument
 * as PopupDismissCtx in popupDismiss.tsx: a prop means editing every call site and
 * trusting each to pass it, which is exactly how the close button came to have
 * three different sizes. Here `role="alertdialog"` — which those dialogs need
 * for accessibility anyway — is the single switch, and a confirm cannot drift
 * out of the behaviour by omission.
 *
 * `Close` composes its handler with the caller's via Radix's
 * `composeEventHandlers`, which defaults to `checkForDefaultPrevented: true`.
 * So a caller that calls `e.preventDefault()` in its own onClick still
 * suppresses the close — AdminUserNotes relies on precisely that to hold the
 * dialog open while the delete is in flight. Behaviour preserved exactly.
 */
export const DialogConfirmCtx = React.createContext(false);

/**
 * The three footer actions. A dialog's footer is built from these and nothing
 * else.
 *
 * Each is the Dialog-family twin of an AlertDialog primitive that already
 * exists and is already the app's most-used treatment:
 *
 *   DialogSecondaryAction    <- AlertDialogCancel  (ghost)
 *   DialogPrimaryAction      <- AlertDialogAction  (glossy `btn-grad-primary`)
 *   DialogDestructiveAction  <- AlertDialogAction variant="destructive"
 *
 * Their widths and alignment come from `popupFooter.ts`, which is also where
 * AlertDialogAction/Cancel and the Sheet footer get theirs — one contract, one
 * file, so a change to the footer cannot land on two of the three popup
 * families and miss the third.
 *
 * NO `className`, `variant`, `size` or `asChild`. They are omitted from the
 * prop type AND destructured off at runtime, so neither a `@ts-expect-error`
 * nor a plain-JS caller can reintroduce the `rounded-ds-md` restatements or
 * the inline-styled sienna slab these replaced.
 */
type DialogActionProps = Omit<
  ButtonProps,
  "variant" | "className" | "size" | "asChild" | "shimmer"
>;

/**
 * Wraps an action in `DialogPrimitive.Close` when it sits inside a confirm
 * (`role="alertdialog"`), and leaves it alone otherwise.
 *
 * A regular dialog's primary action must NOT auto-close — it submits a form
 * and the caller decides what happens next. A confirm's must, because that is
 * what `AlertDialogAction`/`AlertDialogCancel` did before these two families
 * became one component, and 43 confirm boxes were written against it.
 */
const MaybeClose = ({ children }: { children: React.ReactNode }) => {
  const isConfirm = React.useContext(DialogConfirmCtx);
  return isConfirm ? <DialogPrimitive.Close asChild>{children}</DialogPrimitive.Close> : <>{children}</>;
};

const stripOverrides = (props: Record<string, unknown>) => {
  const { className: _c, variant: _v, size: _s, asChild: _a, shimmer: _sh, ...rest } = props;
  void _c; void _v; void _s; void _a; void _sh;
  return rest;
};

/**
 * The dismiss. Ghost, `size="sm"`, hard-left — the owner's choice, 2026-08-31:
 * "Small, I feel like left aligned makes more sense than right." 44px tall, so
 * still on the HIG tap-target floor while reading a clear step down from the
 * 56px commit beside it.
 */
const DialogSecondaryAction = React.forwardRef<HTMLButtonElement, DialogActionProps>(
  ({ children, ...props }, ref) => {
    // Tell the surrounding DialogContent that this dialog has a Cancel, so it
    // can drop its redundant X. See popupDismiss.tsx.
    useRegisterPopupDismiss();
    return (
      // No `size="sm"`. The dismiss matches the commit's height (h-14, 56px) rather
    // than stepping down to 44: in a ROW the WIDTH already carries the hierarchy
    // (a quarter against three quarters), so a shorter box read as mismatched
    // rather than ranked. `size="sm"` was right when the two were stacked full
    // width, where height was the only signal available. Owner, 2026-09-02, from
    // the rendered row.
    <MaybeClose>
        <Button ref={ref} variant="ghost" className={POPUP_SECONDARY_CLS} {...stripOverrides(props)}>
          {children}
        </Button>
      </MaybeClose>
    );
  },
);
DialogSecondaryAction.displayName = "DialogSecondaryAction";

/**
 * `data-commit` marks a control that DOES the consequential thing: the commit
 * of a confirm (`role="alertdialog"`, e.g. every BrandConfirmDialog) and every
 * destructive commit. The prod press sweep classes a control carrying it as
 * mutating whatever its words say (isCommitControl, scripts/audit/pressProdSafety.mjs):
 * "End series" and "Leave series" named no verb in its vocabulary (2026-10-17).
 */
const useCommitMarker = (destructive: boolean) => {
  const isConfirm = React.useContext(DialogConfirmCtx);
  return destructive ? "destructive" : isConfirm ? "confirm" : undefined;
};

/** The commit. Always the glossy green `btn-grad-primary` CTA. */
const DialogPrimaryAction = React.forwardRef<HTMLButtonElement, DialogActionProps>(
  ({ children, ...props }, ref) => {
    const commit = useCommitMarker(false);
    return (
      <MaybeClose>
        <Button ref={ref} variant="primary" className={POPUP_COMMIT_CLS} data-commit={commit} {...stripOverrides(props)}>
          {children}
        </Button>
      </MaybeClose>
    );
  },
);
DialogPrimaryAction.displayName = "DialogPrimaryAction";

/**
 * The commit of a popup that only TELLS you something ("Got it", "OK"): the
 * same glossy commit as DialogPrimaryAction, but all it can do is close the
 * dialog. It is a Radix `Close` and takes NO event handler (every `on*` prop is
 * dropped from the type and at runtime), so pressing it is exactly the dialog's
 * own × or Escape: the Dialog's `onOpenChange(false)`.
 *
 * `data-popup-dismiss` says so to press-every-control, which presses such a
 * control as a read even when its words sound like a write ("got it" acks a
 * backout notice on a job card and pays the seller in Declutter). A label
 * cannot tell those apart; this primitive can, because it cannot be given the
 * write. src/test/pressDrivesTheRealPressPath.test.tsx.
 */
type DialogAcknowledgeProps = Omit<DialogActionProps, `on${string}` | "type" | "asChild">;
const DialogAcknowledgeAction = React.forwardRef<HTMLButtonElement, DialogAcknowledgeProps>(
  ({ children, ...props }, ref) => {
    const rest = Object.fromEntries(Object.entries(stripOverrides(props)).filter(([k]) => !/^on[A-Z]/.test(k)));
    return (
      <DialogPrimitive.Close asChild>
        <Button ref={ref} type="button" variant="primary" className={POPUP_COMMIT_CLS} data-popup-dismiss="" {...rest}>
          {children}
        </Button>
      </DialogPrimitive.Close>
    );
  },
);
DialogAcknowledgeAction.displayName = "DialogAcknowledgeAction";

/**
 * The commit, when it is irreversible or takes something away — solid
 * `--destructive` red, deliberately NOT glossy so it cannot be tapped by
 * muscle memory for the green one (button.tsx: "keep red flat-looking so it
 * doesn't get accidentally pressed").
 *
 * ONE destructive colour app-wide. `--burnt-sienna` is the brand ACCENT — it
 * paints eyebrows, callout borders, and things that are merely notable — so a
 * sienna commit button says "notable" in the same breath it says "permanent".
 * BrandConfirmDialog gave up its sienna tone for this reason; CancellationDialog's
 * hand-styled sienna button (`backgroundImage: "none"`, i.e. gloss explicitly
 * switched off) was the last one left.
 */
const DialogDestructiveAction = React.forwardRef<HTMLButtonElement, DialogActionProps>(
  ({ children, ...props }, ref) => {
    const commit = useCommitMarker(true);
    return (
      <MaybeClose>
        <Button ref={ref} variant="destructive" className={POPUP_COMMIT_CLS} data-commit={commit} {...stripOverrides(props)}>
          {children}
        </Button>
      </MaybeClose>
    );
  },
);
DialogDestructiveAction.displayName = "DialogDestructiveAction";

export {
  DialogSecondaryAction,
  DialogPrimaryAction,
  DialogAcknowledgeAction,
  DialogDestructiveAction,
};
