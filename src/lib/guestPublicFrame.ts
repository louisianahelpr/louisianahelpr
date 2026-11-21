import { isNativePlatform } from "@/lib/nativeInit";
import { definitelyGuest } from "@/lib/persistedAuthToken";

/**
 * Q2784 + Q2785 (landing audit L006 / L025, 2026-11-09): the guest-reachable app pages. Before, /declutter and its item
 * page had no footer (and no header at 375), /helprs and /search had no header, logo or footer, and all of them (and
 * /hire) sat in AppShell's fixed viewport: the page scrolled inside an inner box (on /hire, which already wore the
 * public header, not at all), so the iOS Safari toolbar never collapsed.
 *
 * For a guest on the web each one now wears the public frame (PublicLayout's header and footer: useGuestPublicFrame in
 * AppPage and SectionScreen; /hire is PublicHeaderPage already) and scrolls the document (useAppShellViewport lifts the
 * html lock). A member, and the native app, keep AppShell exactly as before.
 *
 * /jobs/<id> (the job's share-link page) already drew PublicLayout for a guest, but under the html lock it did not
 * scroll (measured 11-15 at 375: body 1542px, window.scrollY stuck at 0).
 *
 * /shops/<id> (a shop's share link, PublicShopView for a guest) and /book/<userId> (a Helpr's booking link) were the last
 * two: both are AppPage pages, so they wear the frame the same way (Q2784 leftovers, 11-15).
 *
 * /post-job (owner 11-20, ease batch): a guest can start a job post before signing up (src/lib/guestPostDraft.ts).
 *
 * Exact paths match only themselves; an entry ending in "/" matches the pages under it. /declutter/sell,
 * /declutter/move and the other member-only pages under /declutter are not here: a guest is sent to log in there.
 * Guard: src/test/guestPagesWearPublicFrame.test.tsx.
 */
export const GUEST_PUBLIC_FRAME_ROUTES = ["/declutter", "/declutter/item/", "/hire/", "/helprs", "/search", "/jobs/", "/shops/", "/book/", "/post-job"] as const;
/** Member-only pages under a prefix above (a guest is sent to log in there). */
const NOT_GUEST_PAGES = ["/jobs/settings", "/shops/mine", "/shops/orders", "/shops/dashboard"];

export const isGuestPublicFrameRoute = (pathname: string): boolean =>
  !isNativePlatform &&
  !NOT_GUEST_PAGES.includes(pathname) &&
  GUEST_PUBLIC_FRAME_ROUTES.some((route) =>
    route.endsWith("/") ? pathname.startsWith(route) && pathname.length > route.length : pathname === route,
  );

/**
 * "Guest" for the frame: auth settled with no user, or, before auth settles, no stored session for certain
 * (definitelyGuest, the fast path DeclutterGate takes), so a guest's first paint is already the public frame rather
 * than an AppShell paint that swaps to it a moment later.
 */
export const isGuestViewer = (user: unknown, isReady: boolean): boolean => (isReady ? !user : definitelyGuest());
