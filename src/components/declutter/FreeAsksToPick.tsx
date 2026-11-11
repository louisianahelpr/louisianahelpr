/**
 * F359b (audit 11-10): a new ask on a free listing never showed under Selling's "To answer" (the count stayed put and
 * the only sign was a "Requests (1)" button on the listing row). This is that half: each free listing people asked
 * for, oldest first ask first, linking to its item page where the giver picks (DeclutterFreeClaim). The same read and
 * key Home's "Pick who gets <item>" to-do uses (useNeedsYouTodos), so the chip count and the list always agree.
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { fetchFreeAsksToPick, type FreeAskToPick } from "@/lib/declutter/api";
import { SectionHeading } from "./DeclutterTabHeads";

/** Read only while the giver has a free listing up (anyFreeLive), as the row's "Requests (n)" read is. */
export function useFreeAsksToPick(userId: string | null, anyFreeLive: boolean): FreeAskToPick[] {
  const q = useQuery({
    queryKey: ["declutter", "free-asks-to-pick", userId],
    queryFn: () => fetchFreeAsksToPick(userId as string),
    enabled: !!userId && anyFreeLive,
  });
  return anyFreeLive ? q.data ?? [] : [];
}

export function FreeAsksToPick({ rows }: { rows: FreeAskToPick[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Free items to give" data-free-asks-to-pick="">
      <SectionHeading title="Free items to give" todo={rows.length} todoWords="to pick" />
      <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
        {rows.map((r) => (
          <li key={r.item_id}>
            <Link to={`/declutter/item/${r.item_id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <span className="min-w-0 flex-1">
                <span className="block text-ds-15 font-semibold text-foreground [overflow-wrap:anywhere]">{r.title}</span>
                <span className="block text-ds-13 text-muted-foreground">Free · {r.asked} asked</span>
              </span>
              <span className="shrink-0 text-ds-14 font-bold text-[hsl(var(--sage-ink))]">Pick</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
