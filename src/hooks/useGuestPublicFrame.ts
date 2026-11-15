import { useContext } from "react";
import { UNSAFE_LocationContext } from "react-router-dom";
import { useAuthReady } from "@/hooks/useAuthReady";
import { isGuestPublicFrameRoute, isGuestViewer } from "@/lib/guestPublicFrame";

/**
 * Q2784 + Q2785: true on the web for a guest on a guest-reachable app page (GUEST_PUBLIC_FRAME_ROUTES,
 * src/lib/guestPublicFrame.ts). AppPage and SectionScreen then draw PublicLayout (the public header and footer,
 * document scroll) instead of AppShell.
 * Guard: src/test/guestPagesWearPublicFrame.test.tsx.
 */
export function useGuestPublicFrame(): boolean {
  // The context, not useLocation(): AppPage and SectionScreen also render in tests with no router, where useLocation
  // throws. Outside a router the location is null, and the frame stays AppShell.
  const pathname = useContext(UNSAFE_LocationContext)?.location?.pathname ?? null;
  const { user, isReady } = useAuthReady();
  return pathname !== null && isGuestViewer(user, isReady) && isGuestPublicFrameRoute(pathname);
}
