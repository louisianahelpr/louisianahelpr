/**
 * F017 (owner UI audit 11-09): the one public-page container. The marketing bar (Navbar), PublicHeaderPage's title and
 * body, GuestBrowseSkeleton and the /browse HTML shell (browseShellCards.mjs, which spells the same classes) all sit in
 * the landing's 78rem measure, so the logo, the title and the content share a left edge on every public page and
 * nothing jumps between / and /browse. Guard: src/test/publicPagesShareOneContainer.test.ts.
 */
export const PUBLIC_CONTAINER = "max-w-[78rem] mx-auto";

/** F063: a one-subject public page's ~760px reading column (the /hire town page; the guest job page, Jobs audit 11-21
 *  P6), centred, and its header's: the column plus the shell's side padding at each breakpoint (px-5 / sm:px-8 /
 *  lg:px-12), so the title and the body share a left edge. */
export const NARROW_COLUMN = "max-w-[760px]";
export const NARROW_HEADER_COLUMN = "mx-auto max-w-[calc(760px+2.5rem)] sm:max-w-[calc(760px+4rem)] lg:max-w-[calc(760px+6rem)]";
