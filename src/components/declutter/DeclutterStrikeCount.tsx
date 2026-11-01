/**
 * "You have N of 3 strikes" (rows 7, 16, 17) on top of every Declutter tab. Its own module (B77, 2026-11-01): it sat in
 * DeclutterTradeViews, so Declutter's first screen downloaded that whole checkout chunk (~24 KB gz) for one notice.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchMyActiveStrikes } from "@/lib/declutter/api";
import { DeclutterNotice } from "./declutterUi";

/** "You have N of 3 strikes" (rows 7, 16, 17). Nothing when there are none. */
export function StrikeCount({ userId }: { userId: string }) {
  const strikes = useQuery({ queryKey: ["declutter", "strikes", userId], queryFn: () => fetchMyActiveStrikes(userId) });
  const n = strikes.data ?? 0;
  if (n === 0) return null;
  return (
    <DeclutterNotice tone="warn" title={`You have ${Math.min(n, 3)} of 3 strikes.`}>
      {n >= 3
        ? "Declutter is paused for you until one of them goes away. Each strike goes away 1 year after you got it."
        : "Each strike goes away 1 year after you got it. At 3 strikes you can't buy or sell on Declutter until one goes away."}
    </DeclutterNotice>
  );
}
