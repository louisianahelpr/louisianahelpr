/**
 * Audit DC-9: Selling's "To answer" counted only offers, so a buyer's question on a live listing never showed there.
 * This is the questions half: every unanswered question on the seller's listings that are on sale (live or paused),
 * oldest first, each linking to its item page, where the answer (and Claude's suggested reply) already lives
 * (DeclutterQuestions). Same read key for the Selling tab badge, the chip count and the list, so they always agree and
 * it is one cached read; it is only made for a member with a listing on sale.
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { fetchUnansweredQuestions } from "@/lib/declutter/api";
import { myItemsQuery } from "./myItemsQuery";
import { SectionHeading } from "./DeclutterTabHeads";

/** Listings a buyer can still ask about. */
const ASKABLE = new Set(["live", "paused"]);

export function useUnansweredQuestions(userId: string | undefined) {
  const mine = useQuery({ ...myItemsQuery(userId ?? ""), enabled: !!userId });
  const items = (mine.data ?? []).filter((i) => ASKABLE.has(i.status));
  const ids = items.map((i) => i.id).sort();
  const q = useQuery({
    queryKey: ["declutter", "unanswered-questions", userId, ids.join(",")],
    queryFn: () => fetchUnansweredQuestions(ids),
    // Only a member with a listing on sale can have a question waiting.
    enabled: mine.isSuccess && ids.length > 0,
  });
  const titles = new Map(items.map((i) => [i.id, i.title]));
  const rows = (q.data ?? []).filter((r) => titles.has(r.item_id)).map((r) => ({ ...r, title: titles.get(r.item_id) ?? "" }));
  // Answered (an error is an answer: no count), so the tab row can wait for it and never re-wrap late.
  const settled = !userId || mine.isError || (mine.isSuccess && (ids.length === 0 || !q.isLoading));
  return { rows, count: rows.length, settled };
}

export function QuestionsToAnswer({ userId }: { userId: string }) {
  const { rows } = useUnansweredQuestions(userId);
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Questions to answer" data-questions-to-answer="">
      <SectionHeading title="Questions to answer" todo={rows.length} todoWords="to answer" />
      <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
        {rows.map((r) => (
          <li key={r.id}>
            {/* AUD31-28: straight to the item's questions (they sat ~2 screens down at 375), not the top of the page. */}
            <Link to={`/declutter/item/${r.item_id}#declutter-questions`} className="flex min-h-14 items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <span className="min-w-0 flex-1">
                <span className="block text-ds-13 font-semibold text-muted-foreground [overflow-wrap:anywhere]">{r.title}</span>
                <span className="block text-ds-15 text-foreground [overflow-wrap:anywhere]">{r.question}</span>
              </span>
              <span className="shrink-0 text-ds-14 font-bold text-[hsl(var(--sage-ink))]">Answer</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
