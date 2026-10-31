import { formatName } from "@/lib/utils";
import type { RequestQuote } from "@/lib/quotes/api";

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const until = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * Board 115 (poster compares quotes): the live quotes side by side, one column
 * each (phone: up to three show, more scroll sideways), then the rows that
 * differ. Every value is the quote row's own (get_quotes_for_request): name,
 * the quoted job price in rust, when they can do it, how many past-work photos,
 * how long the quote stands. Never the Helpr's take-home (poster screen). The
 * Accept / Counter actions stay on each quote's own card below: one place to
 * act, so nothing here can accept a quote by a second path.
 */
export function QuotesSideBySide({ quotes }: { quotes: RequestQuote[] }) {
  const live = quotes.filter((q) => q.status === "pending");
  if (live.length < 2) return null;
  const first = (q: RequestQuote) => formatName(q.quoter_name, "Member").split(" ")[0];
  // AUD31-50: the names were joined with one "'s" ("Dana, Maximiliano's card"); each name owns its card.
  const cardsOf = (names: string[]) => {
    const own = names.map((n) => `${n}'s`);
    return `${own.length > 1 ? `${own.slice(0, -1).join(", ")} or ${own[own.length - 1]}` : own[0]} card`;
  };
  return (
    <section aria-label="Quotes side by side" className="space-y-2">
      <h2 className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">Side by side</h2>
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <table className="w-full min-w-[320px] border-collapse text-left text-ds-13">
          <thead>
            <tr>
              <th className="w-24 py-2" />
              {live.map((q) => (
                <th key={q.id} scope="col" className="py-2 pr-3 text-ds-14 font-bold">{formatName(q.quoter_name, "Member")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border align-top">
              <th scope="row" className="py-2 pr-3 font-semibold text-muted-foreground">Price</th>
              {live.map((q) => (
                <td key={q.id} className="py-2 pr-3 text-ds-16 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]">{dollars(q.price_cents)}</td>
              ))}
            </tr>
            <tr className="border-t border-border align-top">
              <th scope="row" className="py-2 pr-3 font-semibold text-muted-foreground">When</th>
              {live.map((q) => <td key={q.id} className="py-2 pr-3">{q.available_note || "—"}</td>)}
            </tr>
            <tr className="border-t border-border align-top">
              <th scope="row" className="py-2 pr-3 font-semibold text-muted-foreground">Past work photos</th>
              {live.map((q) => <td key={q.id} className="py-2 pr-3 tabular-nums">{(q.photo_paths ?? []).length}</td>)}
            </tr>
            <tr className="border-t border-border align-top">
              <th scope="row" className="py-2 pr-3 font-semibold text-muted-foreground">Good until</th>
              {live.map((q) => <td key={q.id} className="py-2 pr-3">{q.respond_until ? until(q.respond_until) : "—"}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-ds-12 text-muted-foreground">
        Each amount is the job price. Your total, with any tax, is shown before you pay. To accept,
        use {cardsOf(live.map(first))} below.
      </p>
    </section>
  );
}
