import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// The activity reads load only for a signed-in member (badge = To-do, owner 2026-10-20).
const NeedsYouBridge = lazy(() => import("./NeedsYouBridge"));

/** Quiet time after the page's last read, so a page that reads in steps counts as one. */
export const PAGE_READS_QUIET_MS = 400;
/** The badge's reads never wait longer than this, however busy the page stays. */
export const PAGE_READS_CAP_MS = 5000;

/**
 * True once the page's own reads have finished, or at the cap. The badge's reads (about a dozen, one of them 53 kB on
 * a member with applications) used to start beside the page's, so on a slow phone Declutter's photos queued behind
 * them. Home reads the same rows for its own list, so it does not wait.
 */
function usePageReadsSettled(): boolean {
  const fetching = useIsFetching();
  const [settled, setSettled] = useState(() => window.location.pathname === "/home");
  const sawReads = useRef(false);
  useEffect(() => {
    if (settled) return;
    if (fetching > 0) {
      sawReads.current = true;
      return;
    }
    if (!sawReads.current) return;
    const quiet = setTimeout(() => setSettled(true), PAGE_READS_QUIET_MS);
    return () => clearTimeout(quiet);
  }, [fetching, settled]);
  useEffect(() => {
    if (settled) return;
    const cap = setTimeout(() => setSettled(true), PAGE_READS_CAP_MS);
    return () => clearTimeout(cap);
  }, [settled]);
  return settled;
}

function WhenPageReadsSettle({ children }: { children: React.ReactNode }) {
  return usePageReadsSettled() ? <>{children}</> : null;
}

/** Mounts NeedsYouBridge while someone is signed in, after the page's own reads; a visitor loads none of it. */
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
