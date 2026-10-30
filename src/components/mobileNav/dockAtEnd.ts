/**
 * DA-9 (Declutter audit 2026-10-30, item page at 375 WebKit): the dock hides while the member scrolls down, but at
 * the END of a page that left its clearance (pb-safe-nav) as a blank band with nothing under it. At the end there is
 * nothing more to read, so MobileNav brings the dock back there, as Safari's toolbar does.
 *
 * True when a surface that can really scroll (more than 8px of travel) sits at, or overscrolls past, its end.
 */
export function dockRevealsAtEnd(scrollHeight: number, clientHeight: number, scrollTop: number): boolean {
  const travel = scrollHeight - clientHeight;
  return travel > 8 && scrollTop > 0 && travel - scrollTop <= 2;
}
