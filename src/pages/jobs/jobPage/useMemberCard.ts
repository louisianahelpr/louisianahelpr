/**
 * A member's seller card (name, photo) and first name, for the job page's "Waiting on Lexi" / "Eli is working" lines.
 * One query key with PostedBy and the Message button (["declutter", "seller-card", id]), so the read is shared.
 * Out of JobPage.tsx for its 600-line cap.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchSellerCard } from "@/lib/declutter/api";

export function useMemberCard(memberId: string | null | undefined, enabled = true) {
  const card = useQuery({ queryKey: ["declutter", "seller-card", memberId ?? null], queryFn: () => fetchSellerCard(memberId!), enabled: !!memberId && enabled });
  const first = (card.data?.name ?? "").trim().split(/\s+/)[0] || null;
  return { card, first };
}
