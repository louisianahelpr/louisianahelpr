/**
 * The small Buying / Selling pieces Declutter's first screen draws before any tab's body: the to-do counts behind the
 * tab badges, a section heading, and the strikes line. A leaf on purpose (the /declutter order chunk, lead 11-01): it
 * imports no order, handover or offer view, so DeclutterHomeView can load the Buying and Selling bodies on demand.
 * DeclutterTabParts and DeclutterTradeViews re-export these, so every older import still works.
 * Guard: src/test/declutterTabsLoadOnDemand.test.ts.
 */
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMyActiveStrikeReasons, fetchMyActiveStrikes, fetchMyCart, fetchMyOffers } from "@/lib/declutter/api";
import { strikeReasonWords } from "@/lib/declutter/strikeReasons";
import { Button } from "@/components/ui/button";
import { declutterTodo, type DeclutterTodo } from "@/lib/declutter/tabs";
import { DeclutterNotice } from "./declutterUi";
import { t } from "@/lib/i18n/language";
import "@/lib/i18n/enDeclSell";

/**
 * What needs the member on each side (the Buying / Selling badges), from the
 * same two reads the tabs show, so a tab never counts something it doesn't list.
 * `settled` is true once both reads answered (an error is an answer: no badge).
 */
export function useDeclutterTodo(): { todo: DeclutterTodo | null; settled: boolean } {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const offers = useQuery({ queryKey: ["declutter", "my-offers"], queryFn: fetchMyOffers });
  const settled = !cart.isLoading && !offers.isLoading;
  const todo = cart.data && offers.data ? declutterTodo(cart.data, offers.data) : null;
  return { todo, settled };
}

/** A Buying / Selling section's heading, with how many of its things need the member. */
export function SectionHeading({ title, todo, todoWords }: { title: string; todo?: number; todoWords?: string }) {
  return (
    <h2 className="text-base font-semibold">
      {title}
      {todo ? <span className="font-normal text-muted-foreground"> · {todo} {todoWords}</span> : null}
    </h2>
  );
}

/**
 * "You have N of 3 strikes" (rows 7, 16, 17). Nothing when there are none.
 * Design audit 11-17 #2: the full card sat above every tab's feed. It is full on Selling (`full`) and whenever
 * Declutter is paused (3 strikes); every other tab gets the one line, in the same warning tone.
 * Deep audit 11-22 #40: the line showed on every Browse visit with no reason, and screen readers announced it each time.
 * `pausedOnly` (Browse, Free, Wanted, Deliver): nothing under 3 strikes; strikes come from buying and selling, so the
 * line lives on those tabs. The line is no longer a live region, and its "Why?" opens each strike's reason, the day it
 * goes away and what happens at 3.
 */
export function StrikeCount({ userId, full = true, pausedOnly = false }: { userId: string; full?: boolean; pausedOnly?: boolean }) {
  const strikes = useQuery({ queryKey: ["declutter", "strikes", userId], queryFn: () => fetchMyActiveStrikes(userId) });
  const [why, setWhy] = useState(false);
  const whyId = useId();
  const n = strikes.data ?? 0;
  if (n === 0) return null;
  if (pausedOnly && n < 3) return null;
  const title = `You have ${Math.min(n, 3)} of 3 strikes.`;
  if (!full && n < 3) {
    return (
      <div data-strike-line="" className="rounded-xl border border-[hsl(var(--burnt-sienna)/0.3)] bg-[hsl(var(--burnt-sienna)/0.06)] px-3 py-2 text-ds-13 text-foreground">
        <p className="flex flex-wrap items-center gap-x-2">
          <span className="font-semibold">{title}</span>
          <Button type="button" variant="link" size="sm" className="px-0 text-ds-13 font-semibold underline underline-offset-2 text-[color:inherit]"
            aria-expanded={why} aria-controls={whyId} onClick={() => setWhy((w) => !w)} data-strike-why="">
            {why ? t("dsl.strike.hide") : t("dsl.strike.why")}
          </Button>
        </p>
        {why && <div id={whyId}><StrikeReasons userId={userId} /><p>{t("dsl.strike.each")}</p></div>}
      </div>
    );
  }
  return (
    <DeclutterNotice tone="warn" title={t("dsl.sw.strikesNow", { n: Math.min(n, 3) })}>
      <StrikeReasons userId={userId} />
      {n >= 3 ? t("dsl.strike.paused") : t("dsl.strike.each")}
    </DeclutterNotice>
  );
}

/** Each active strike's reason and the day it goes away (deep audit 11-22 #40). */
function StrikeReasons({ userId }: { userId: string }) {
  const rows = useQuery({ queryKey: ["declutter", "strikes", userId, "reasons"], queryFn: () => fetchMyActiveStrikeReasons(userId) });
  if (rows.isError) return <p className="text-muted-foreground" data-strike-reasons-failed="">{t("dsl.strike.whyFailed")}</p>;
  if (!rows.data?.length) return null;
  return (
    <ul className="my-1 list-disc space-y-0.5 pl-5" data-strike-reasons="">
      {rows.data.map((r, i) => (
        <li key={`${r.reason}-${i}`}>
          {strikeReasonWords(r.reason)} {t("dsl.strike.goesAway", { day: new Date(r.expires_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) })}
        </li>
      ))}
    </ul>
  );
}
