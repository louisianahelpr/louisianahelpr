/** The blocker's "Unblock" on a member's profile (split out of UserProfile.tsx to keep it under its size line). */
import { useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { unblockUser } from "@/lib/userBlocks";

export function useUnblock(currentUserId: string | null | undefined, userId: string | null | undefined, blockedByMeKey: QueryKey) {
  const queryClient = useQueryClient();
  const [unblocking, setUnblocking] = useState(false);
  const handleUnblock = async () => {
    if (!currentUserId || !userId) return;
    setUnblocking(true);
    const ok = await unblockUser(currentUserId, userId);
    setUnblocking(false);
    if (!ok) {
      toast.error("Couldn't unblock this person. Please try again.");
      return;
    }
    toast.success("Unblocked");
    await queryClient.invalidateQueries({ queryKey: blockedByMeKey });
  };
  return { unblocking, handleUnblock };
}
