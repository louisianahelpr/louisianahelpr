/**
 * Declutter top 5 #2 (owner 11-19): the Selling home at the top of Selling. A short to-do list (offers to answer and
 * sales to hand over from Selling's own to-do read; paused listings, "hasn't sold in 2 weeks" and saved listings from
 * declutter_selling_home) and the last 7 days next to the 7 before: sales, earned, views, saves. Each to-do opens the
 * list it is about (the status chips). Honest numbers only: "None last week" instead of a percent from zero.
 *
 * Shown only when the seller has something for sale or something happened in the two weeks. While its one read is on
 * the way it holds its place with bones of the same height, so the lists below never jump when it lands.
 */
import { ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchMyAway, fetchSellingHome } from "@/lib/declutter/api";
import { weekChange, type SellingHome as Home, type WeekNumbers } from "@/lib/declutter/sellerTools";
import { formatPrice } from "@/lib/declutter/formatPrice";
import { SectionHeading } from "./DeclutterTabHeads";
import type { DeclutterTodo } from "@/lib/declutter/tabs";
import "@/lib/i18n/enDeclTop5";
import { t } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";

type Group = "offers" | "listings" | "sold";

/** The to-do rows, in the order a seller should do them; a row with nothing to do is left out. */
export function sellingTodoRows(todo: Pick<DeclutterTodo, "sellerOffers" | "salesOpen"> | null, home: Pick<Home, "todo"> | null): { key: string; n: number; one: MsgKey; many: MsgKey; group: Group }[] {
  const rows: { key: string; n: number; one: MsgKey; many: MsgKey; group: Group }[] = [
    { key: "handover", n: todo?.salesOpen ?? 0, one: "dt5.home.handover1", many: "dt5.home.handoverN", group: "sold" },
    { key: "offers", n: todo?.sellerOffers ?? 0, one: "dt5.home.offers1", many: "dt5.home.offersN", group: "offers" },
    { key: "savers", n: home?.todo.savers_to_offer ?? 0, one: "dt5.home.savers1", many: "dt5.home.saversN", group: "listings" },
    { key: "drops", n: home?.todo.price_drops ?? 0, one: "dt5.home.drops1", many: "dt5.home.dropsN", group: "listings" },
    { key: "relist", n: home?.todo.to_relist ?? 0, one: "dt5.home.relist1", many: "dt5.home.relistN", group: "listings" },
  ];
  return rows.filter((r) => r.n > 0);
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

export function SellingHome({ todo, onPick, userId }: { todo: DeclutterTodo | null; onPick: (g: Group) => void; userId: string }) {
  const home = useQuery({ queryKey: ["declutter", "selling-home"], queryFn: () => fetchSellingHome(), staleTime: 60_000 });
  // Lead 11-19: while away (#5) the paused listings are paused on purpose, so "put back up" is not a to-do. The same
  // read and key as the away card, so this adds no request.
  const away = useQuery({ queryKey: ["declutter", "away", userId], queryFn: () => fetchMyAway(userId) });
  if (home.isPending) return <div className="h-[244px] animate-pulse rounded-[20px] bg-muted/60" data-selling-home-bones="" aria-hidden />;
  const h = home.data;
  if (!h || !anyActivity(h)) return null;
  const rows = sellingTodoRows(todo, h).filter((r) => !(r.key === "relist" && away.data));
  const tiles: { label: MsgKey; now: number; last: number; money?: boolean }[] = [
    { label: "dt5.home.sales", now: h.week.sales, last: h.last_week.sales },
    { label: "dt5.home.earnings", now: h.week.earnings_cents, last: h.last_week.earnings_cents, money: true },
    { label: "dt5.home.views", now: h.week.views, last: h.last_week.views },
    { label: "dt5.home.saves", now: h.week.saves, last: h.last_week.saves },
  ];
  return (
    <section className="space-y-3 rounded-[20px] border border-border bg-card p-4" aria-label={t("dt5.home.title")} data-selling-home="">
      <div className="space-y-1.5">
        <SectionHeading title={t("dt5.home.todo")} />
        {rows.length === 0 ? (
          <p className="text-ds-13 text-muted-foreground" data-selling-home-done="">{t("dt5.home.allDone")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.key}>
                <button type="button" onClick={() => onPick(r.group)} data-selling-todo={r.key}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left text-ds-14 font-medium text-foreground">
                  <span className="min-w-0">{r.n === 1 ? t(r.one) : t(r.many, { n: r.n })}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-2">
        <SectionHeading title={t("dt5.home.title")} />
        <ul className="grid grid-cols-2 gap-2" data-selling-stats="">
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
      </div>
    </section>
  );
}
