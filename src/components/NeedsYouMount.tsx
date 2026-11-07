import { Suspense } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageReadsSettled } from "@/hooks/usePageReadsSettled";
import { expectOnlineFromBadge } from "@/lib/helprTasks/onlineHandoff";

import { optionalLazy } from "@/lib/optionalLazy";

// The activity reads load only for a signed-in member (badge = To-do, owner 2026-10-20).
// Optional (the nav badges only): it mounts beside the app's routes, outside every route boundary, so a plain lazy()
// whose chunk failed threw into the app-wide boundary and replaced the whole app, nav and route error card included,
// with "Something went sideways" (Q1816, e2e-journeys stale-deploy /home, reproduced locally 11-07: on /home the page
// reads count as settled at once, so the bridge loads right beside the broken route).
const NeedsYouBridge = optionalLazy(() => import("./NeedsYouBridge"), "NeedsYouBridge");

function WhenPageReadsSettle({ children }: { children: React.ReactNode }) {
  return usePageReadsSettled() ? <>{children}</> : null;
}

/**
 * Mounts NeedsYouBridge while someone is signed in, after the page's own reads; a visitor loads none of it.
 * Its reads (about a dozen, one of them 53 kB on a member with applications) used to start beside the page's.
 */
export default function NeedsYouMount() {
  const { user } = useCurrentUser();
  if (!user) return null;
  // The badge read below also carries the online pill's row (my_badge_reads 'delivery_online'): the pill's first
  // read waits for it (src/lib/helprTasks/onlineHandoff.ts). Idempotent, so calling it during render is safe.
  expectOnlineFromBadge(user.id);
  return (
    <WhenPageReadsSettle>
      <Suspense fallback={null}>
        <NeedsYouBridge key={user.id} user={user} />
      </Suspense>
    </WhenPageReadsSettle>
  );
}
