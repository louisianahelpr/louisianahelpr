/**
 * SS-5 (saved audit 10-30): an item the member hearts could not be found again; the heart's only reads were the
 * hearts themselves. "Watching" lists them under Buying, each opening its item page. Same watchlist read and key as
 * the hearts (fetchWatching), so a heart tapped anywhere shows here.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { fetchWatchedItems, fetchWatching, type DeclutterItem } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";
import { declutterErrorMessage } from "@/lib/declutter/errors";

/** What a watched item's row says under its title. */
export function watchedLine(item: Pick<DeclutterItem, "status" | "current_price_cents">): string {
  if (item.status === "live") return item.current_price_cents > 0 ? formatPrice(item.current_price_cents) : "Free";
  if (item.status === "reserved") return "On hold for another buyer";
  return "No longer for sale";
}

/** "1 item you watched is no longer listed." for hearts whose item the member can't read any more. */
export function goneLine(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? "1 item you watched is no longer listed." : `${n} items you watched are no longer listed.`;
}


export function WatchingList() {
  const { user } = useCurrentUser();
  const userId = user?.id ?? "";
  const ids = useQuery({ queryKey: ["declutter", "watching", userId], queryFn: () => fetchWatching(userId), enabled: !!user });
  const list = [...(ids.data ?? [])].sort();
  const items = useQuery({
    queryKey: ["declutter", "watching-items", list],
    queryFn: () => fetchWatchedItems(list),
    enabled: list.length > 0,
  });
  const failed = ids.isError ? ids.error : items.isError ? items.error : null;
  if (failed) {
    return (
      <ErrorState
        variant="inline"
        title="We couldn't load the items you're watching."
        body={declutterErrorMessage(failed)}
        onRetry={() => void (ids.isError ? ids.refetch() : items.refetch())}
      />
    );
  }
  if (list.length === 0 || !items.data) return null;
  // Live first, then on hold, then the rest; by title within each.
  const rank = (s: string) => (s === "live" ? 0 : s === "reserved" ? 1 : 2);
  const rows = [...items.data].sort((a, b) => rank(a.status) - rank(b.status) || a.title.localeCompare(b.title));
  const gone = goneLine(list.length - rows.length);
  return (
    <section className="space-y-2" aria-label="Watching" data-watching="">
      <h2 className="text-base font-semibold">Watching</h2>
      {rows.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
          {rows.map((item) => (
            <li key={item.id}>
              <Link to={`/declutter/item/${item.id}`} className="block min-h-11 px-4 py-3">
                <span className="block break-words text-ds-15 font-semibold">{item.title}</span>
                <span className="block text-ds-13 text-muted-foreground">{watchedLine(item)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {gone && <p className="text-ds-13 text-muted-foreground">{gone}</p>}
    </section>
  );
}
