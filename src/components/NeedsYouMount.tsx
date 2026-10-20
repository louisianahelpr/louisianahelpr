import { lazy, Suspense } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// The activity reads load only for a signed-in member (badge = To-do, owner 2026-10-20).
const NeedsYouBridge = lazy(() => import("./NeedsYouBridge"));

/** Mounts NeedsYouBridge while someone is signed in; a visitor loads none of it. */
export default function NeedsYouMount() {
  const { user } = useCurrentUser();
  if (!user) return null;
  return (
    <Suspense fallback={null}>
      <NeedsYouBridge key={user.id} user={user} />
    </Suspense>
  );
}
