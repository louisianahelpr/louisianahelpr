/**
 * H5 (share-profile audit 11-05, owner: one public profile link). The old links forward to /u/<handle>:
 *   - /book/<id> for everyone (BookHelprRoute);
 *   - /user/<id> for everyone (UserProfileRoute). The /u page gives a member /user's Save, Report and Block
 *     (PublicProfileMemberActions) and Hire me is its Invite to a job. A member who blocked this person stays on
 *     /user/<id>, where "You blocked this person" has Unblock.
 * handle_for_user (20261105171316) is NULL under exactly the public page's rules, so a member with no public page
 * never forwards: a member keeps the /user page (Report and Block stay reachable), a guest keeps its login wall, /book shows "This Helpr isn't available". Until the read is
 * deployed (PGRST202) each route keeps its old page. Loaded lazily from App.tsx (useAuthReady pulls the Supabase client).
 */
import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { UserX } from "lucide-react";
import AppPage from "@/components/AppPage";
import ProtectedRoute from "@/components/ProtectedRoute";
import { RouteSuspenseFallback } from "@/components/RouteSuspenseFallback";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useAuthReady } from "@/hooks/useAuthReady";
import { handleForUser } from "@/lib/profileLink/api";
import { rememberBookingSource } from "@/lib/bookMe";
import { useBlockedByMe } from "@/pages/user/useBlockedByMe";
import { UserProfileForwardWait } from "@/pages/user/UserProfileLoadingBody";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Forwards to the member's /u page (keeping ?query and #hash); `none` and `notDeployed` say what shows otherwise. */
export function PublicProfileForward({ userId, none, notDeployed, onForward, wait }: {
  userId: string | undefined;
  none: ReactNode;
  notDeployed: ReactNode;
  /** What shows while the handle read is pending (default: the plain route fallback). */
  wait?: ReactNode;
  /** Runs once when the visitor is forwarded (the /book link keeps its booking-source note). */
  onForward?: (userId: string) => void;
}) {
  const { search, hash } = useLocation();
  const id = UUID.test(userId ?? "") ? (userId as string).toLowerCase() : null;
  const q = useQuery({
    queryKey: ["handle-for-user", id],
    queryFn: () => handleForUser(id as string),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });
  const found = q.data?.state === "found";
  useEffect(() => {
    if (found && id) onForward?.(id);
    // Once per forward: onForward is a fresh closure every render on purpose.
  }, [found, id]);
  if (!id) return <>{none}</>;
  if (q.isPending) return <>{wait ?? <RouteSuspenseFallback />}</>;
  if (q.isError) {
    return (
      <AppPage title="Profile" backTo="/">
        <ErrorState variant="inline" title="We couldn't load this profile." onRetry={() => void q.refetch()} />
      </AppPage>
    );
  }
  if (q.data.state === "found") return <Navigate replace to={`/u/${encodeURIComponent(q.data.handle)}${search}${hash}`} />;
  return <>{q.data.state === "none" ? none : notDeployed}</>;
}

/** /user/:userId: everyone goes to the public page; without one, members keep this page and guests the login wall. */
export function UserProfileRoute({ children }: { children: ReactNode }) {
  const { user, isReady } = useAuthReady();
  const { userId } = useParams();
  const members = <ProtectedRoute>{children}</ProtectedRoute>;
  if (!isReady) return members;
  if (user) return <MemberForward me={user.id} userId={userId} members={members} />;
  return <PublicProfileForward userId={userId} none={members} notDeployed={members} />;
}

/** A member forwards too, unless they blocked this person (only /user shows "You blocked this person" + Unblock). */
function MemberForward({ me, userId, members }: { me: string; userId: string | undefined; members: ReactNode }) {
  const self = !!userId && userId.toLowerCase() === me.toLowerCase();
  const blocked = useBlockedByMe(me, userId);
  // Q1695: the wait draws /user's own loading frame, not a blank page (UserProfileForwardWait).
  const wait = <UserProfileForwardWait own={self} />;
  if (!self && UUID.test(userId ?? "")) {
    if (blocked.isPending) return wait;
    // A failed block check keeps /user, whose own check shows the error and Retry.
    if (blocked.isError || blocked.data) return <>{members}</>;
  }
  return <PublicProfileForward userId={userId} none={members} notDeployed={members} wait={wait} />;
}

/** /book/:userId: everyone goes to the public page; without one, "This Helpr isn't available". */
export function BookHelprRoute({ children }: { children: ReactNode }) {
  const { user } = useAuthReady();
  const { userId } = useParams();
  const unavailable = (
    <AppPage title="Book a Helpr" backTo={user ? "/home" : "/"}>
      <EmptyState
        icon={UserX}
        title="This Helpr isn't available"
        body="The link may be old, or this profile isn't public right now."
        action={
          <Button asChild className="btn-grad-primary rounded-full">
            <Link to={user ? "/home" : "/"}>Go to Louisiana Helpr</Link>
          </Button>
        }
      />
    </AppPage>
  );
  // "Which Helpr brought this poster" (B59): a visitor from a Book me link is remembered, so Hire me on the /u page
  // records it on Post a job exactly as "Book <First>" did (recordBookingSourceFor matches the offered Helpr).
  return <PublicProfileForward userId={userId} none={unavailable} notDeployed={children} onForward={rememberBookingSource} />;
}
