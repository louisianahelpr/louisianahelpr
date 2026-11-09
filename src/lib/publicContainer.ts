/**
 * F017 (owner UI audit 11-09): the one public-page container. The marketing bar (Navbar), PublicHeaderPage's title and
 * body, GuestBrowseSkeleton and the /browse HTML shell (browseShellCards.mjs, which spells the same classes) all sit in
 * the landing's 78rem measure, so the logo, the title and the content share a left edge on every public page and
 * nothing jumps between / and /browse. Guard: src/test/publicPagesShareOneContainer.test.ts.
 */
export const PUBLIC_CONTAINER = "max-w-[78rem] mx-auto";
