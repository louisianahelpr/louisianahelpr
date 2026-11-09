import type { ReactNode } from "react";
import { DeclutterHomeSkeleton } from "@/components/declutter/DeclutterSkeletons";

/**
 * The /declutter route fallback (Q2705 B, lead 11-05 8:30 PM): a cold open paints Declutter's own loading frame
 * (DeclutterHomeSkeleton: the Explore header, the tabs bone and the first Browse cards, the frame DeclutterGate and
 * Browse draw next) while the page's chunk downloads, instead of the generic RouteSuspenseFallback. The same
 * component the page draws, so the swap from route fallback to gate to Browse moves nothing.
 * Guard: src/test/routeSkeletonsMessagesDeclutter.test.tsx.
 *
 * guestJoin: only index.html's copy (src/test/messagesDeclutterShellsMatchSkeletons.test.tsx renders it with the
 * guest's sign-up line, hidden unless a guest opens it; Q2705, 11-09). The app's route fallback never passes it.
 */
export default function DeclutterRouteSkeleton({ guestJoin }: { guestJoin?: ReactNode } = {}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-testid="declutter-route-skeleton">
      <span className="sr-only">Loading Declutter…</span>
      <DeclutterHomeSkeleton guestJoin={guestJoin} />
    </div>
  );
}
