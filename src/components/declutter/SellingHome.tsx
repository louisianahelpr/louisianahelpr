/**
 * Declutter top 5 #2 (owner 11-19): the Selling home. A short to-do list (offers to answer and sales to hand over from
 * Selling's own reads; paused listings, "hasn't sold in 2 weeks" and saved listings from declutter_selling_home) and the
 * last 7 days next to the 7 before: sales, earned, views, saves. Each to-do opens the list it is about (the status
 * chips). Honest numbers only: "None last week" instead of a percent from zero.
 *
 * Post-merge check 11-20 (~/.lh-shots/declutter-top5-1120 #5): the home, Shop sale and Away cards pushed the first
 * sale to hand over ~1.5 screens down on a phone. So the home is now two parts: SellingTodo (the to-dos, at the top)
 * and SellingWeek (the week's numbers, with the shop tools below the lists). One read, one key, so this adds no request.
 * #1: each to-do is a ListRow with its chevron at the row's right edge, flush with "To do". #6: "Hand over" reads the
 * one count the Sold heading and the chip read (useSalesToHandOver). #9: while away, nothing nudges a price or an offer
 * (the listings are paused on purpose), as "put back up" already was not.
 */
import { ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchMyAway, fetchSellingHome } from "@/lib/declutter/api";
import { weekChange, type SellingHome as Home, type WeekNumbers } from "@/lib/declutter/sellerTools";
import { formatPrice } from "@/lib/declutter/formatPrice";
import { SectionHeading } from "./DeclutterTabHeads";
import { ListRow } from "@/components/ui/ListRow";
import type { DeclutterTodo } from "@/lib/declutter/tabs";
import "@/lib/i18n/enDeclTop5";
import { t } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";

type Group = "offers" | "listings" | "sold";
type TodoRow = { key: string; n: number; one: MsgKey; many: MsgKey; group: Group };

/** The rows a seller who is away is not asked to do: their listings are paused on purpose until they come back. */
const NOT_WHILE_AWAY = new Set(["savers", "drops", "relist"]);

/**
 * The to-do rows, in the order a seller should do them; a row with nothing to do is left out, and while away the
 * listing nudges are too. `handOver` is useSalesToHandOver's count (null while it loads: the cart's own count).
 */
export function sellingTodoRows(todo: Pick<DeclutterTodo, "sellerOffers" | "salesOpen"> | null, home: Pick<Home, "todo"> | null, away = false, handOver: number | null = null, reports = 0): TodoRow[] {
  const rows: TodoRow[] = [
    { key: "handover", n: handOver ?? todo?.salesOpen ?? 0, one: "dt5.home.handover1", many: "dt5.home.handoverN", group: "sold" },
    // Deep audit 11-22 #50: problem reports and refund requests waiting on the seller (useSellerReportsToAnswer, the
    // same set "To answer" lists) were left out of the to-do.
    { key: "reports", n: reports, one: "dt5.home.reports1", many: "dt5.home.reportsN", group: "offers" },
    { key: "offers", n: todo?.sellerOffers ?? 0, one: "dt5.home.offers1", many: "dt5.home.offersN", group: "offers" },
    { key: "savers", n: home?.todo.savers_to_offer ?? 0, one: "dt5.home.savers1", many: "dt5.home.saversN", group: "listings" },
    { key: "drops", n: home?.todo.price_drops ?? 0, one: "dt5.home.drops1", many: "dt5.home.dropsN", group: "listings" },
    { key: "relist", n: home?.todo.to_relist ?? 0, one: "dt5.home.relist1", many: "dt5.home.relistN", group: "listings" },
  ];
  return rows.filter((r) => r.n > 0 && !(away && NOT_WHILE_AWAY.has(r.key)));
}

function anyActivity(h: Home): boolean {
  const sum = (w: WeekNumbers) => w.sales + w.views + w.saves;
  return h.live_count > 0 || sum(h.week) + sum(h.last_week) > 0;
}

function changeWords(now: number, last: number): string {
  const c = weekChange(now, last);
  if (c.dir === "up") return t("dt5.home.up", { pct: c.pct });
  if (c.dir === "down") return t("dt5.home.down", { pct: c.pct });
  return c.dir === "new" ? t("dt5.home.new") : t("dt5.home.same");
}

const homeQuery = { queryKey: ["declutter", "selling-home"], queryFn: () => fetchSellingHome(), staleTime: 60_000 };
/** The away card's read and key (AwayMode.tsx), so the to-do and the tab's first paint add no request. */
const awayQuery = (userId: string) => ({ queryKey: ["declutter", "away", userId], queryFn: () => fetchMyAway(userId) });

/**
 * VERIFY 11-20 (~/.lh-shots/declutter-top5-1120/VERIFY.md, Medium x2): the to-do card drew with every row and dropped
 * the away-hidden ones when the away read landed (CLS 0.14-0.15 at 375/390), and it popped in above the chips and the
 * sales once the listings read answered (CLS 0.12-0.13). The whole Selling tab holds its bones until the reads the
 * first screen is laid out from have answered (or failed): the listings (whether the to-do shows), the Selling home
 * and the away state (which rows it has), or failed once. `on` is false when the to-do is not shown (a chip picked, no
 * listings).
 */
export function useSellingTopSettled(userId: string, on: boolean): boolean {
  const home = useQuery({ ...homeQuery, enabled: on });
  const away = useQuery({ ...awayQuery(userId), enabled: on });
  // A read that has failed once lets the tab through at once: the app's retries (seconds of backoff) never hold Selling.
  // errorUpdateCount too: a failed read with no data goes back to pending when the to-do mounts and asks again
  // (retryOnMount), and failureCount restarts at 0, so without it the tab flipped between bones and content forever.
  const waiting = (q: { isPending: boolean; failureCount: number; errorUpdateCount: number }) =>
    q.isPending && q.failureCount === 0 && q.errorUpdateCount === 0;
  return !on || (!waiting(home) && !waiting(away));
}

/** The to-do card at the top of Selling. Bones of a heading and two rows while its read is on the way. */
export function SellingTodo({ todo, handOver, reports = 0, onPick, userId }: { todo: DeclutterTodo | null; handOver: number | null; reports?: number; onPick: (g: Group) => void; userId: string }) {
  const home = useQuery(homeQuery);
  // The same read and key as the away card, so this adds no request.
  const away = useQuery(awayQuery(userId));
  // VERIFY 11-20: never the rows before the away state is known (they would drop while the seller is away).
  if (home.isPending || away.isPending) return <div className="h-[164px] animate-pulse rounded-[20px] bg-muted/60" data-selling-home-bones="" aria-hidden />;
  const h = home.data;
  if (!h || !anyActivity(h)) return null;
  const rows = sellingTodoRows(todo, h, !!away.data, handOver, reports);
  return (
    // The rows run the card's full width (flush), so their 16px padding lines the text up under "To do" (11-20 #1:
    // they sat 16px in from it, inside the card's own padding).
    // VERIFY 11-20 (low) / deep audit 11-22 #46: as wide as the lists below it (the tab's one width at 1440).
    <section className="w-full overflow-hidden rounded-[20px] border border-border bg-card pt-4" aria-label={t("dt5.home.todo")} data-selling-home="">
      <div className="px-4"><SectionHeading title={t("dt5.home.todo")} /></div>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 pt-1 text-ds-13 text-muted-foreground" data-selling-home-done="">{t("dt5.home.allDone")}</p>
      ) : (
        <ul className="mt-1 divide-y divide-border border-t border-border">
          {rows.map((r) => (
            <li key={r.key}>
              {/* The shared ListRow: the label fills the row, the chevron sits at its right edge (ListRow's trailing). */}
              <ListRow variant="flush" onClick={() => onPick(r.group)} data-selling-todo={r.key} className="text-ds-14 font-medium text-foreground"
                trailing={<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}>
                <span className="min-w-0 flex-1" data-selling-todo-label="">{r.n === 1 ? t(r.one) : t(r.many, { n: r.n })}</span>
              </ListRow>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The last 7 days next to the 7 before, under the lists with the shop tools. Nothing while it loads (it is below). */
export function SellingWeek() {
  const home = useQuery(homeQuery);
  const h = home.data;
  if (!h || !anyActivity(h)) return null;
  const tiles: { label: MsgKey; now: number; last: number; money?: boolean }[] = [
    { label: "dt5.home.sales", now: h.week.sales, last: h.last_week.sales },
    { label: "dt5.home.earnings", now: h.week.earnings_cents, last: h.last_week.earnings_cents, money: true },
    { label: "dt5.home.views", now: h.week.views, last: h.last_week.views },
    { label: "dt5.home.saves", now: h.week.saves, last: h.last_week.saves },
  ];
  return (
    <section className="space-y-2 rounded-[20px] border border-border bg-card p-4" aria-label={t("dt5.home.title")} data-selling-week="">
      <SectionHeading title={t("dt5.home.title")} />
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-selling-stats="">
        {tiles.map((tile) => (
          <li key={tile.label} className="rounded-xl bg-muted/50 px-3 py-2" data-selling-stat={tile.label}>
            <p className="text-ds-12 text-muted-foreground">{t(tile.label)}</p>
            <p className="text-ds-20 font-bold tabular-nums leading-tight">{tile.money ? formatPrice(tile.now) : tile.now}</p>
            <p className="text-ds-12 text-muted-foreground">{changeWords(tile.now, tile.last)}</p>
          </li>
        ))}
      </ul>
      <p className="text-ds-12 text-muted-foreground">
        {t("dt5.home.window")}{" "}
        {h.live_count > 0 && (h.live_count === 1
          ? t("dt5.home.worth1", { amount: formatPrice(h.live_value_cents) })
          : t("dt5.home.worthN", { n: h.live_count, amount: formatPrice(h.live_value_cents) }))}
      </p>
    </section>
  );
}
