/**
 * The moving-sale banner on the shareable profile /u/<handle> (profile leftovers 11-05: "See the whole sale" on an item
 * goes to /user/<seller>, which now forwards a member to /u, and /u had no sale). The SAME MovingSaleBanner /user draws,
 * with its own switches (declutter + declutter_moving_out, off for guests) and its own read.
 *
 * The page knows only the handle. Your own page: your own id. Someone else's: the id from rpc_hire_target_by_handle on
 * the key PublicProfileMemberActions already reads (signed-in only; nothing across a block), so no second request.
 * Guests: nothing (the banner's switches are off for them anyway). Guard: src/test/publicProfileMovingSale.test.tsx.
 */
import { useQuery } from "@tanstack/react-query";
import { MovingSaleBanner } from "@/components/declutter/MovingSaleBanner";
import { hireTargetByHandle } from "@/lib/hireMe";

export function PublicProfileMovingSale({ handle, currentUserId, isMe }: { handle: string; currentUserId: string | null; isMe: boolean }) {
  const q = useQuery({
    queryKey: ["public-profile-member-id", handle, currentUserId],
    queryFn: () => hireTargetByHandle(handle),
    enabled: !!currentUserId && !isMe,
    staleTime: 5 * 60_000,
  });
  const sellerId = isMe ? currentUserId : q.data?.id ?? null;
  if (!currentUserId || !sellerId) return null;
  return (
    <div id="moving-sale" data-testid="pp-moving-sale" className="empty:hidden">
      <MovingSaleBanner sellerId={sellerId} />
    </div>
  );
}
