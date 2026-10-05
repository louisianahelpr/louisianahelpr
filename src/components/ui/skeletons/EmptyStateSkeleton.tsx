import { useContext, type CSSProperties } from "react";
import { QueryClientContext, type QueryKey } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * EmptyStateSkeleton: the outline of an `<EmptyState>` while its data loads.
 *
 * OWNER DECISION, 2026-10-05 (Q722, relayed by the lead): on a COLD visit,
 * My Posts and the guest Browse feed draw the empty-state outline instead of
 * job cards; warm visits are unchanged. A cold visit is one whose list is not
 * in the query cache (the persisted cache, src/lib/queryPersister.ts, paints a
 * warm visit's real list with no placeholder at all), and a cold visit is
 * mostly a new account or, before launch, the empty public marketplace. The
 * card placeholders drew the populated layout and the empty state replaced
 * them: measured at 375 on prod 2026-10-05, My Posts 52px row -> 133px and
 * anon Browse 27px -> 212px.
 *
 * The box is EmptyState's own (same classes, same dock padding per variant),
 * holding the same three parts in the same places: the 88px icon bubble, the
 * title + body lines, and the action. Keep it in step with
 * src/components/ui/EmptyState.tsx.
 */
export function EmptyStateSkeleton({
  variant = "dock",
  hiddenEyebrow = false,
  titleH = 28,
  bodyLines = 2,
  bodyH,
  actionHeights = [44],
  testId,
}: {
  variant?: "dock" | "inline" | "bare";
  /** The real state passes an eyebrow its CSS hides (`display: none`): it
   *  takes no height but still gives the title its 8px `space-y-2` margin. */
  hiddenEyebrow?: boolean;
  /** Height of the title's line box at 375. */
  titleH?: number;
  /** Lines the body copy wraps to at 375. */
  bodyLines?: number;
  /** The body's measured height at 375; when set, the lines sit inside one
   *  box of exactly that height instead of each taking its own margin. */
  bodyH?: number;
  /** Each stacked action's height (gap 10px, EmptyState's action column). */
  actionHeights?: number[];
  testId?: string;
}) {
  const isDock = variant === "dock";
  const style: CSSProperties = isDock
    ? {
        borderRadius: 0,
        borderBottom: "none",
        paddingBottom: "calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px) + 2rem)",
      }
    : {};
  const box =
    variant === "inline"
      ? "flex-1 min-w-0 max-w-full liquid-glass flex flex-col items-center text-center justify-center gap-5 px-5 sm:px-8 py-14 rounded-2xl"
      : `${isDock ? "empty-state-dock " : ""}flex-1 min-w-0 max-w-full flex flex-col items-center text-center justify-center gap-5 px-5 sm:px-8 py-10`;
  const bodyWidths = ["w-64", "w-52", "w-40"];
  return (
    <div className={box} style={style} aria-hidden data-testid={testId}>
      <Skeleton className="w-[88px] h-[88px] rounded-full" />
      <div className="w-full min-w-0 flex flex-col items-center gap-3">
        <div className="w-full min-w-0 space-y-2">
          {hiddenEyebrow && <span className="hidden" />}
          <Skeleton className="w-56 mx-auto rounded" style={{ height: titleH }} />
          {bodyH != null ? (
            <div className="flex flex-col items-center justify-around" style={{ height: bodyH }}>
              {Array.from({ length: bodyLines }, (_, i) => (
                <Skeleton key={i} className={`h-[14px] ${bodyWidths[i % bodyWidths.length]} rounded`} />
              ))}
            </div>
          ) : (
            Array.from({ length: bodyLines }, (_, i) => (
              <Skeleton key={i} className={`h-[18px] ${bodyWidths[i % bodyWidths.length]} mx-auto rounded`} />
            ))
          )}
        </div>
        <div className="flex flex-col items-center gap-2.5">
          {actionHeights.map((h, i) => (
            <Skeleton key={i} className={`${i === 0 ? "w-44 rounded-2xl" : "w-36 rounded"}`} style={{ height: i === 0 ? h : 14, marginBlock: i === 0 ? 0 : (h - 14) / 2 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Whether the query cache already holds a NON-EMPTY list for `queryKey`
 * (prefix match). `count` reads the list out of the cached value. Safe outside
 * a QueryClientProvider (route fallbacks render in tests without one): no
 * client means nothing is known, which reads as cold.
 */
export function useCachedListCount<T>(queryKey: QueryKey, count: (data: T) => number): number {
  const client = useContext(QueryClientContext);
  if (!client) return 0;
  let n = 0;
  for (const [, data] of client.getQueriesData<T>({ queryKey })) {
    if (data != null) n = Math.max(n, count(data));
  }
  return n;
}
