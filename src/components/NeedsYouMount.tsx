import { lazy, Suspense } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageReadsSettled } from "@/hooks/usePageReadsSettled";

// The activity reads load only for a signed-in member (badge = To-do, owner 2026-10-20).
const NeedsYouBridge = lazy(() => import("./NeedsYouBridge"));

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
  return (
    <WhenPageReadsSettle>
      <Suspense fallback={null}>
        <NeedsYouBridge key={user.id} user={user} />
      </Suspense>
    </WhenPageReadsSettle>
  );
}
