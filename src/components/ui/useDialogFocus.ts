import { useRef } from "react";

/**
 * Where focus goes when DialogContent opens and closes (a pure move out of dialog.tsx for the opening half, which the
 * god-component ratchet caps).
 *
 * ON CLOSE. Radix returns focus only to a Dialog.Trigger, and nearly every dialog here is opened from its own state with
 * no Trigger, so closing one left focus on the page body (sheet.tsx had the same gap, D4-5). The control that had focus
 * when the dialog opened gets it back, if it is still on the page. A caller's own handler still decides first.
 * document.body is no opener: WebKit doesn't focus a clicked button, and Radix must still reach a real Trigger then.
 *
 * ON OPEN. Nine dialogs pass `onOpenAutoFocus={(e) => e.preventDefault()}` to stop Radix focusing their first Input,
 * because on iOS that pops the keyboard the instant the dialog opens. The intent is right; the raw preventDefault was
 * not. It left focus on the TRIGGER, outside the dialog, so a screen reader never announced what had opened and Tab
 * walked the page BEHIND the modal. (Found by the overlay sweep on SavedSearches, SecurityTab's change-email, and
 * TwoFactorCard.)
 *
 * Park focus on the dialog container instead: no field is focused, so no keyboard, but the dialog owns focus and Tab
 * starts inside it. Radix's FocusScope gives Content `tabIndex={-1}`, so it accepts focus. This runs DURING the
 * AUTOFOCUS_ON_MOUNT dispatch, before FocusScope reads `defaultPrevented`, so our focus is the one that sticks.
 *
 * FOCUS THE DIALOG, NOT ITS FIRST BUTTON. Radix focuses the first tabbable child on open, which since the footer rework
 * is Cancel, so every confirm dialog opened with a visible focus ring drawn around Cancel. The owner read that as a stray
 * border on the button and asked for it removed. It was not a border; it was a real focus indicator, and deleting it
 * would have left keyboard and switch users with no way to see where they are.
 *
 * The fix is to stop putting focus on a BUTTON at all. Focus moves to the dialog itself, which is what a screen reader
 * should land on anyway: it announces the title and body before the actions, instead of announcing "Cancel button" as
 * though that were the point of the screen. Tab then moves to the actions and draws the ring properly, for the people
 * the ring exists for. It also removes a small hazard: with Cancel pre-focused, a stray Enter or Space dismissed the
 * dialog before it had been read.
 */
export function useDialogFocus(onOpenAutoFocus?: (event: Event) => void, onCloseAutoFocus?: (event: Event) => void) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpen: (event: Event) => {
      const had = document.activeElement;
      opener.current = had instanceof HTMLElement && had !== document.body ? had : null;
      onOpenAutoFocus?.(event);
      event.preventDefault();
      (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
    },
    onClose: (event: Event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented || !opener.current?.isConnected) return;
      event.preventDefault();
      opener.current.focus({ preventScroll: true });
    },
  };
}
