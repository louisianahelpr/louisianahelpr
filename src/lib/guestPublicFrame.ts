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
 * Exact paths match only themselves; an entry ending in "/" matches the pages under it. /declutter/sell,
 * /declutter/move and the other member-only pages under /declutter are not here: a guest is sent to log in there.
 * Guard: src/test/guestPagesWearPublicFrame.test.tsx.
 */
export const GUEST_PUBLIC_FRAME_ROUTES = ["/declutter", "/declutter/item/", "/hire/", "/helprs", "/search"] as const;

export const isGuestPublicFrameRoute = (pathname: string): boolean =>
  !isNativePlatform &&
  GUEST_PUBLIC_FRAME_ROUTES.some((route) =>
    route.endsWith("/") ? pathname.startsWith(route) && pathname.length > route.length : pathname === route,
  );

/**
 * "Guest" for the frame: auth settled with no user, or, before auth settles, no stored session for certain
 * (definitelyGuest, the fast path DeclutterGate takes), so a guest's first paint is already the public frame rather
 * than an AppShell paint that swaps to it a moment later.
 */
export const isGuestViewer = (user: unknown, isReady: boolean): boolean => (isReady ? !user : definitelyGuest());
