import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { hapticLight } from "@/lib/haptics";
import { BROWSE } from "./sectionsConfig";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";

export interface SectionTabDef<T extends string> {
  value: T;
  label: string;
  /** The dictionary key of the shown word (Spanish option, 2026-10-29); `label` stays the English config name. */
  labelKey?: MsgKey;
  count?: number;
}

/**
 * The section's tab, read from `?tab=`. EVERY SECTION OPENS ON BROWSE (owner,
 * 2026-10-19): no tab, or an unknown one, is Browse. Changing tab drops the
 * other tab's `?status=` filter so a stale filter never hides a list.
 */
export function useSectionTab<T extends string>(valid: readonly T[]) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab = (raw && (valid as readonly string[]).includes(raw) ? raw : BROWSE) as T | typeof BROWSE;
  const setTab = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === BROWSE) p.delete("tab");
          else p.set("tab", next);
          p.delete("status");
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [tab, setTab] as const;
}

/**
 * The section's tabs (Browse | Posted | Working ...). BROWSE IS ALWAYS LEFTMOST: it is not a prop, so no caller can
 * move it (guard: src/test/sectionDashboards.test.tsx).
 *
 * THIN UNDERLINE TABS (owner, 2026-10-22, the Explore header): the section chips above are the one filled control,
 * so these are words with a 2px olive underline under the selected one, not a second pill track. Still 44px tall
 * (the tap floor), the visual weight is what got smaller. Arrow keys move between tabs (automatic activation, the
 * panels are cheap to swap), one tab stop for the row (roving tabindex), as SegmentedControl did.
 */
/** From this many tabs (Browse included) a phone row sets its words by the screen's width (A3-6). */
export const DENSE_TAB_COUNT = 5;
/**
 * From this many a phone row sets its words smaller still and closer (OWN-FREE, 2026-10-30): Declutter's sixth tab,
 * Free, was 357px of row in a 335px track at 375 with the five-tab sizes, so Browse showed "Fre" at the edge.
 */
export const DENSER_TAB_COUNT = 6;

export function SectionTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  end,
  browseCount,
  onlySelected = false,
}: {
  label: string;
  tabs: readonly SectionTabDef<T>[];
  value: T | typeof BROWSE;
  onChange: (v: string) => void;
  /** A control at the row's right end (Jobs settings' gear on a phone). */
  end?: ReactNode;
  /** How many results Browse lists, shown quietly beside its label (owner 2026-10-28: "move the 1 next to browse"). */
  browseCount?: number;
  /** A phone's open search takes the row: only the selected tab stays, whole, as Posted / Working's lit chip does (audit F20). */
  onlySelected?: boolean;
}) {
  const { t: tr } = useLanguage();
  const options = [{ value: BROWSE as string, label: "Browse" }, ...tabs.map((t) => ({ value: t.value as string, label: t.labelKey ? tr(t.labelKey) : t.label, count: t.count }))] as Array<{ value: string; label: string; count?: number; quiet?: number }>;
  options[0].quiet = browseCount;
  const dense = options.length >= DENSE_TAB_COUNT;
  const denser = options.length >= DENSER_TAB_COUNT;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // A row that still does not fit (Declutter's six tabs with search, filters and gear beside them; owner 10-30: "Wanted"
  // was clipped) scrolls sideways. A tab the row's edge would cut waits unpainted until it is whole, so no word is ever
  // cut, and a chevron says there is more and brings the next tab in. The row keeps the selected tab whole by itself (on
  // load, on a new tab, when a search opens or closes, when the chevron narrows the track) until the member moves the
  // row; from then the selected tab follows the same rule as the others, whole or not painted (tester T10, 10-30:
  // "Wantec" on load, a lone "e" after a chevron).
  const listRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  // Moved along, the row also has a way back, so a selected tab off the start is one tap away (T12, 10-30).
  const [less, setLess] = useState(false);
  // A3-97 (audit 7, 11-01): at 375 Declutter shows Browse and Buying only, so a seller's to-do count on Selling sat off
  // screen behind a bare chevron. The chevrons carry the to-do counts of the tabs they hide.
  const [aheadCount, setAheadCount] = useState(0);
  const [behindCount, setBehindCount] = useState(0);
  const memberMoved = useRef(false);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    memberMoved.current = false;
    const update = () => {
      const selected = list.querySelector('[role="tab"][aria-selected="true"]');
      if (selected && !memberMoved.current) {
        const box = list.getBoundingClientRect();
        const t = selected.getBoundingClientRect();
        if (t.right > box.right) list.scrollLeft += t.right - box.right;
        else if (t.left < box.left) list.scrollLeft -= box.left - t.left;
      }
      setMore(list.scrollWidth - list.clientWidth - list.scrollLeft > 2);
      setLess(list.scrollLeft > 2);
      const box = list.getBoundingClientRect();
      let ahead = 0;
      let behind = 0;
      for (const tab of Array.from(list.children)) {
        const t = tab.getBoundingClientRect();
        const cut = t.width > 0 && (t.left < box.left - 1 || t.right > box.right + 1);
        // Wider than the row itself (nothing can make it whole), the selected tab still shows until the member moves on.
        tab.toggleAttribute("data-tab-cut", cut && (tab !== selected || memberMoved.current));
        const n = Number(tab.getAttribute("data-tab-count")) || 0;
        if (n > 0 && t.right > box.right + 1) ahead += n;
        else if (n > 0 && t.left < box.left - 1) behind += n;
      }
      setAheadCount(ahead);
      setBehindCount(behind);
    };
    update();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(list);
    for (const tab of Array.from(list.children)) ro?.observe(tab);
    list.addEventListener("scroll", update, { passive: true });
    return () => {
      ro?.disconnect();
      list.removeEventListener("scroll", update);
    };
  }, [options.length, value, onlySelected]);
  /** The first tab the end of the row hides comes in whole. */
  const showNext = () => {
    const list = listRef.current;
    if (!list) return;
    memberMoved.current = true;
    const edge = list.getBoundingClientRect().right;
    const next = Array.from(list.children).find((tab) => tab.getBoundingClientRect().right > edge + 1);
    if (next) list.scrollLeft += next.getBoundingClientRect().right - edge;
  };
  /** The last tab the start of the row hides comes back whole. */
  const showPrevious = () => {
    const list = listRef.current;
    if (!list) return;
    memberMoved.current = true;
    const edge = list.getBoundingClientRect().left;
    const previous = Array.from(list.children).reverse().find((tab) => tab.getBoundingClientRect().left < edge - 1);
    list.scrollLeft = previous ? list.scrollLeft - (edge - previous.getBoundingClientRect().left) : 0;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const at = options.findIndex((o) => o.value === value);
    let next = -1;
    if (step) next = (at + step + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    if (options[next].value !== value) { hapticLight(); onChange(options[next].value); }
    refs.current[next]?.removeAttribute("data-tab-cut");
    refs.current[next]?.focus();
  };
  return (
    <div data-testid="section-tabs" className="flex items-end gap-1 border-b border-border/60">
      {/* A row that also carries controls at its end (Jobs: search, filters, gear; owner 2026-10-28) packs its tabs
          8px apart below 420px, so "Browse Posted Working" and three 44px controls fit a 375 phone without the last
          tab scrolling out of sight (measured: 218px of tabs in a 191px track at 375 with 20px gaps). */}
      {/* FIVE OR MORE TABS ON A PHONE (A3-6, Declutter audit 3, 2026-10-28): Browse Buying Selling Deliver Wanted were
          362px of row in 280 / 335 / 350px at 320 / 375 / 390, so the last tab read "Wante" at the scroll edge. Below
          420px such a row sets its words by the screen's width (.section-tabs-dense in index.css: 12px at 320, 14px at
          390, never over 15px) 12px apart, and fits (measured 0 overflow at 320/375/390, ~/.lh-shots/b3-1028/a3-6). A
          row that still overflows (two to-do counts at 320) keeps scrolling, as before. */}
      {/* SIDEWAYS ONLY (owner bug 2026-10-30, iPhone Safari: "the tabs disappear when the page scrolls"). overflow-x:auto
          alone computes overflow-y to auto, and the selected tab's underline (::after, bottom -1px) made the row 45px
          of content in a 44px box, so the row was a VERTICAL scroller too: a vertical swipe on it moved its words
          (measured in WebKit: scrollTop 0 -> 1 on a wheel over the row) and on iOS rubber-banded them out of the clip,
          leaving the border and the icons beside it. overflow-y:hidden makes it a sideways-only scroller.
          Guard: e2e/sectionTabsStayPut.spec.ts (WebKit 375 + 1440). */}
      {less && !onlySelected && (
        <button type="button" aria-label={behindCount > 0 ? tr("tabs.lessToDo", { n: behindCount }) : tr("tabs.less")} data-tabs-less-button="" onClick={showPrevious}
          className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-0.5 text-muted-foreground">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {behindCount > 0 && <span data-testid="tabs-less-count" aria-hidden className="segmented-count-attention tabular-nums text-ds-11 font-bold rounded-full px-1.5 min-w-[1.25rem] leading-5 text-center">{behindCount}</span>}
        </button>
      )}
      <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} data-tabs-more={more ? "" : undefined}
        onPointerDown={() => { memberMoved.current = true; }} onWheel={() => { memberMoved.current = true; }}
        className={cn("flex min-w-0 items-end overflow-x-auto overflow-y-hidden no-scrollbar", onlySelected ? "flex-none" : "flex-1", end ? "gap-2 min-[420px]:gap-5" : denser ? "gap-1.5 min-[360px]:gap-2 min-[420px]:gap-5" : dense ? "gap-3 min-[420px]:gap-5" : "gap-5", dense && "section-tabs-dense", denser && "section-tabs-denser")}>
        {options.map((o, i) => {
          const active = o.value === value;
          if (onlySelected && !active) return null;
          return (
            <button
              key={o.value}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              data-section-tab={o.value}
              data-tab-count={o.count && o.count > 0 ? o.count : undefined}
              onClick={() => { if (!active) { hapticLight(); onChange(o.value); } }}
              className={cn(
                "section-tab relative inline-flex h-11 min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap font-sans text-ds-15 font-semibold data-[tab-cut]:invisible",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bark))] rounded-sm",
                active ? "text-foreground section-tab-selected" : "text-muted-foreground",
              )}
            >
              {o.value === BROWSE ? tr("tabs.browse") : o.label}
              {o.quiet !== undefined && (
                <span data-testid="browse-count" className="tabular-nums text-ds-13 font-medium text-muted-foreground">{o.quiet}</span>
              )}
              {o.count !== undefined && o.count > 0 && (
                <span className="segmented-count-attention tabular-nums text-ds-11 font-bold rounded-full px-1.5 min-w-[1.25rem] leading-5 text-center">{o.count}</span>
              )}
            </button>
          );
        })}
      </div>
      {more && !onlySelected && (
        <button type="button" aria-label={aheadCount > 0 ? tr("tabs.moreToDo", { n: aheadCount }) : tr("tabs.more")} data-tabs-more-button="" onClick={showNext}
          className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-0.5 text-muted-foreground">
          {aheadCount > 0 && <span data-testid="tabs-more-count" aria-hidden className="segmented-count-attention tabular-nums text-ds-11 font-bold rounded-full px-1.5 min-w-[1.25rem] leading-5 text-center">{aheadCount}</span>}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      )}
      {end}
    </div>
  );
}
