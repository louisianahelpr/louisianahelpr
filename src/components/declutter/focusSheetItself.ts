/**
 * D4-5 (gap sweep 2026-10-29): a Declutter sheet that opens must take focus, or a keyboard or screen-reader member is
 * left on the page behind it. Radix's own default focuses the first control, which pops the phone keyboard over a
 * sheet whose first control is a text box and rings a button nobody touched, so these sheets used to cancel it and
 * focus nothing at all. The sheet itself takes it instead: the next Tab goes to the sheet's first control, nothing pops
 * up, and SheetContent hands focus back to the button that opened it when it closes.
 */
export function focusSheetItself(e: Event): void {
  e.preventDefault();
  (e.target as HTMLElement | null)?.focus?.({ preventScroll: true });
}
