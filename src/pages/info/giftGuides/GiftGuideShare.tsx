import { SearchTriggerSlot } from "@/components/ui/ScreenHeaderRow";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { Input } from "@/components/ui/input";
import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { SITE_ORIGIN } from "@/lib/publicPageMeta.mjs";
import { ICON_STROKE_PX } from "@/lib/iconWeight";
import { giftGuides as G } from "@/content/giftGuides";
import { guideBySlug, loadSearchItems, searchGuides, searchItemDollars, searchItems, searchPages, type SearchItem } from "@/content/giftGuideCatalog";
import { MY_LIST_SLUG, useGiftList } from "./giftList";
import { pickAnchor } from "@/content/giftGuidePickAnchor";
import { openMyLists } from "./saveForPeople";
import { WISH_CORE as WISH } from "@/content/giftWishListCore";

/** The share links for a gift-guides page (owner 2026-11-18): Facebook's sharer and Pinterest's pin builder, no SDK script. */
const shareLinks = (path: string, title: string, image?: string) => {
  const url = `${SITE_ORIGIN}${path}`;
  const pin = new URLSearchParams({ url, description: title });
  if (image) pin.set("media", `${SITE_ORIGIN}${image}`);
  return {
    url,
    facebook: `https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({ u: url }).toString()}`,
    pinterest: `https://www.pinterest.com/pin/create/button/?${pin.toString()}`,
  };
};

/**
 * "Text this guide" (owner 2026-11-18): an sms: link with the guide's URL in the body. iOS reads `sms:&body=`, Android
 * and the rest `sms:?body=`.
 */
export const smsHref = (url: string, title: string, userAgent: string) =>
  `sms:${/iPhone|iPad|iPod/.test(userAgent) ? "&" : "?"}body=${encodeURIComponent(`${title} ${url}`)}`;

const Icon = ({ d, fill = "none" }: { d: string; fill?: string }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d={d} fill={fill} stroke="currentColor" strokeWidth={ICON_STROKE_PX} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const HEART = "M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.7 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.5 0 5.8 3.4 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2z";
const SHARE = "M12 15V3.5M7.5 8 12 3.5 16.5 8M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5";
const SEARCH = "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4";
const CLOSE = "M6 6l12 12M18 6 6 18";
const SLIDERS = "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4";

/** The 25 Days sponsors page's Filter: its sections to jump to and the price limits (owner 2026-11-21). */
export interface ToolsFilter {
  sections: { id: string; title: string }[];
  onJump: (id: string) => void;
  budgets: number[];
  budget: number | null;
  onBudget: (b: number | null) => void;
  /** The For Kids guide (owner 2026-11-23, "Age + price + girls/boys"): its price order, as the Sort menu's choices. */
  sort?: { order: SortOrder; onChange: (o: SortOrder) => void };
  /** Multi-select chip groups (For Kids: Age, Price, For), each chip a menuitemcheckbox; chips in a group add up. */
  groups?: FilterChipGroup[];
  /** The live count under the chips ("23 of 119 gifts"), and Clear, while any chip is on. */
  shown?: { count: number; total: number };
  onClear?: () => void;
}

/** One group of multi-select chips in the Filter panel. */
interface FilterChipGroup {
  id: string;
  label: string;
  choices: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}

/**
 * Filter (owner 2026-11-21, on the 25 Days sponsors page: "move those things into the filter for that section"): one
 * 44px icon in the tool row, with the active count on it, that opens a small panel holding the page's section links
 * ("Jump to a section") and its price limits (Any price, Under $25 ...). Escape or a tap outside closes it. Owner
 * 2026-11-22 ("Should be the same filter icon as all the others"): the same sliders icon as the sort on Her, Him and
 * Kids (it was a funnel).
 */
function GiftGuideFilter({ filter }: { filter: ToolsFilter }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  // The panel hangs from the icon's right edge; on a phone the icon sits mid-row (search, Filter, heart, Share), so a
  // 300px panel ran 76px off the left of a 320px screen (measured 11-23). Slide it right to keep a 16px gutter.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    el.style.right = "";
    const left = el.getBoundingClientRect().left;
    if (left < 16) el.style.right = `${left - 16}px`;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    // Guide audit 1123 I3: Escape hands focus back to the button that opened it (it dropped to the page body).
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      wrap.current?.querySelector<HTMLElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const chipsOn = (filter.groups ?? []).reduce((n, g) => n + g.selected.length, 0);
  const active = (filter.budget ? 1 : 0) + chipsOn;
  // For Kids: one sliders icon holds the sort AND the filters (two identical icons side by side read as one control),
  // so a price order that is not the default shows the sort's own dot when no chip is on.
  const sortOn = !!filter.sort && filter.sort.order !== "top";
  const sortChoices: SortChoice<SortOrder>[] = [{ value: "top", label: G.sortTop }, { value: "low", label: G.sortLowHigh }, { value: "high", label: G.sortHighLow }];
  return (
    <span ref={wrap} className="gg-share-wrap">
      <RoundIconButton className="gg-icon" aria-label={active ? G.filterLabelActive(active) : G.filterLabel} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} data-gift-filter-button="">
        <Icon d={SLIDERS} />
        {active > 0 && <span className="gg-icon-count" aria-hidden="true" data-gift-filter-count="">{active}</span>}
        {active === 0 && sortOn && <span className="gg-icon-dot" aria-hidden="true" data-gift-sort-on="" />}
      </RoundIconButton>
      {/* The live count, outside the menu (a status is not a menu child), read out as chips change. */}
      {filter.shown && (
        <span className="sr-only" role="status" aria-live="polite" data-gift-filter-live="">{chipsOn > 0 ? G.filterShown(filter.shown.count, filter.shown.total) : ""}</span>
      )}
      {open && (
        // A menu like the sort menu beside it (its items the shared InlineTextButton): sections jump, a price choice is
        // a radio item (aria-checked), not a hand-rolled dialog of hand-made buttons (popupShellInventory, OWN-SHARED).
        <span ref={panel} className={filter.groups ? "gg-share-menu gg-filter-panel gg-filter-chips-panel" : "gg-share-menu gg-filter-panel"} role="menu" aria-label={G.filterLabel} data-gift-filter-panel="">
          {filter.sort && (
            <span role="group" aria-label={G.sortLabel} className="gg-filter-group" data-gift-filter-sort="">
              <span className="gg-filter-h" aria-hidden="true">{G.sortLabel}</span>
              {sortChoices.map((c) => (
                <InlineTextButton key={c.value} role="menuitemradio" aria-checked={filter.sort?.order === c.value} onClick={() => { filter.sort?.onChange(c.value); setOpen(false); }} data-gift-sort-choice={c.value}>
                  <span className="gg-sort-check" aria-hidden="true">{filter.sort?.order === c.value ? "✓" : ""}</span>{c.label}
                </InlineTextButton>
              ))}
            </span>
          )}
          {(filter.groups ?? []).map((g) => (
            // Multi-select chips (For Kids, owner 11-23): each a menuitemcheckbox (aria-checked), 44px tall, wrapping.
            <span key={g.id} role="group" aria-label={g.label} className="gg-filter-group" data-gift-filter-group={g.id}>
              <span className="gg-filter-h" aria-hidden="true">{g.label}</span>
              <span className="gg-fchips">
                {g.choices.map((c) => {
                  const on = g.selected.includes(c.value);
                  return (
                    // The app's ToggleChip look (selected = the shared olive primary), as a menu's checkbox item:
                    // aria-checked, not aria-pressed (a menuitemcheckbox takes no aria-pressed).
                    <ToggleChip key={c.value} pressed={on} role="menuitemcheckbox" aria-checked={on} aria-pressed={undefined} className="gg-fchip"
                      onClick={() => g.onToggle(c.value)} data-gift-filter-chip={`${g.id}:${c.value}`}>
                      {c.label}
                    </ToggleChip>
                  );
                })}
              </span>
            </span>
          ))}
          {filter.groups && filter.shown && (
            <span role="none" className="gg-filter-foot" data-gift-filter-foot="">
              <span className="gg-filter-count" aria-hidden="true" data-gift-filter-shown={filter.shown.count}>{G.filterShown(filter.shown.count, filter.shown.total)}</span>
              {chipsOn > 0 && filter.onClear && (
                <InlineTextButton role="menuitem" className="gg-filter-clear" onClick={filter.onClear} data-gift-filter-clear="">{G.filterClear}</InlineTextButton>
              )}
            </span>
          )}
          {filter.sections.length > 1 && (
            <span role="group" aria-label={G.sectionNavLabel} className="gg-filter-group">
              <span className="gg-filter-h" aria-hidden="true">{G.sectionNavLabel}</span>
              {filter.sections.map((s) => (
                <InlineTextButton key={s.id} role="menuitem" onClick={() => { filter.onJump(s.id); setOpen(false); }} data-gift-section-link={s.id}>{s.title}</InlineTextButton>
              ))}
            </span>
          )}
          {filter.budgets.length > 0 && (
            <span role="group" aria-label={G.budgetLabel} className="gg-filter-group" data-gift-budget="">
              <span className="gg-filter-h" aria-hidden="true">{G.budgetLabel}</span>
              {[null, ...filter.budgets].map((b) => (
                <InlineTextButton key={b ?? "all"} role="menuitemradio" aria-checked={filter.budget === b} onClick={() => filter.onBudget(b)} data-gift-budget-choice={b ?? "all"}>
                  <span className="gg-sort-check" aria-hidden="true">{filter.budget === b ? "✓" : ""}</span>{b ? G.budgetUnder(b) : G.budgetAll}
                </InlineTextButton>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/** A sort order the owner-list guides offer (src/content/giftGuidePriceSort.ts). */
type SortOrder = "top" | "low" | "high";

/** One choice in a sort menu. */
export type SortChoice<T extends string> = { value: T; label: string };

/**
 * Sort by price (owner 2026-11-21: "add the filter button up with the search icons"): one 44px icon in the tool row
 * that opens a small menu with "Price: low to high" (the default) and "Price: high to low", each a menuitemradio.
 * Escape or a tap outside closes it; arrow keys move between the two choices. The menu's choices are in order (lead
 * 11-21: "Recommended", clicked picks first in each price section, is the default). `choices` (owner 2026-11-22, the
 * Small Business Saturday page: "Let them filter z-a and a-z") gives another list its own; the first is the default.
 */
export function GiftGuideSort<T extends string = SortOrder>({ order, onChange, choices: own, label = G.sortLabel, activeLabel = G.sortLabelActive }: {
  order: T;
  onChange: (o: T) => void;
  choices?: SortChoice<T>[];
  label?: string;
  activeLabel?: (order: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const choices = own ?? ([{ value: "top", label: G.sortTop }, { value: "low", label: G.sortLowHigh }, { value: "high", label: G.sortHighLow }] as SortChoice<T>[]);
  const at = choices.findIndex((c) => c.value === order);
  useEffect(() => {
    if (!open) return;
    items.current[Math.max(0, at)]?.focus();
    const away = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    // Guide audit 1123 I3: Escape hands focus back to the button that opened it (it dropped to the page body).
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      wrap.current?.querySelector<HTMLElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, at]);
  const move = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    items.current[(i + (e.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length]?.focus();
  };
  return (
    <span ref={wrap} className="gg-share-wrap">
      <RoundIconButton className="gg-icon" aria-label={at > 0 ? activeLabel(choices[at].label) : label} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} data-gift-sort-button="">
        <Icon d={SLIDERS} />
        {at > 0 && <span className="gg-icon-dot" aria-hidden="true" data-gift-sort-on="" />}
      </RoundIconButton>
      {open && (
        <span className="gg-share-menu" role="menu" aria-label={label} data-gift-sort-menu="">
          {choices.map((c, i) => (
            <InlineTextButton key={c.value} role="menuitemradio" aria-checked={order === c.value} ref={(el) => { items.current[i] = el; }}
              onKeyDown={(e) => move(e, i)} onClick={() => { onChange(c.value); setOpen(false); }} data-gift-sort-choice={c.value}>
              <span className="gg-sort-check" aria-hidden="true">{order === c.value ? "✓" : ""}</span>{c.label}
            </InlineTextButton>
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * Share (owner redesign 11-18 PM: "Text the guides should be under share right?"): one icon; tapping it opens a small
 * menu with Copy link, Text this guide (sms:), the phone's own share sheet where there is one (navigator.share),
 * Facebook and Pinterest. Escape or a tap outside closes it.
 */
function GiftGuideShare({ path, title, image, many = false }: { path: string; title: string; image?: string; many?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLSpanElement>(null);
  const links = shareLinks(path, title, image);
  const url = links.url;
  const native = typeof navigator !== "undefined" && typeof navigator.share === "function";
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    // Holiday audit 1121 #21: Escape hands focus back to Share (it dropped to the page body).
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    // The menu pattern role="menu" promises: focus moves into the menu when it opens.
    menuItems(menu.current)[0]?.focus();
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  // Arrow keys move through the items (wrapping), Home / End jump to the ends.
  const arrows = (e: React.KeyboardEvent) => {
    const all = menuItems(menu.current);
    const i = all.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (i + 1) % all.length : e.key === "ArrowUp" ? (i - 1 + all.length) % all.length : e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    all[to]?.focus();
  };
  const copy = () => {
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      // Clipboard refused: Text and the phone's share sheet still work.
      () => setCopied(false),
    );
  };
  const shareSheet = () => {
    setOpen(false);
    // A cancelled share sheet rejects; nothing to do, the page is unchanged.
    navigator.share({ title, url }).catch(() => setOpen(false));
  };
  return (
    <span ref={wrap} className="gg-share-wrap">
      <RoundIconButton ref={button} className="gg-icon" aria-label={G.shareLabel} aria-expanded={open} aria-haspopup="menu"
        onClick={() => { setCopied(false); setOpen((o) => !o); }} data-gift-share="">
        <Icon d={SHARE} />
      </RoundIconButton>
      {open && (
        <span ref={menu} className="gg-share-menu" role="menu" aria-label={G.shareMenuLabel} onKeyDown={arrows} data-gift-share-menu="">
          <InlineTextButton role="menuitem" onClick={copy} data-gift-copy-link="">{copied ? G.linkCopied : G.copyLink}</InlineTextButton>
          <a role="menuitem" href={smsHref(links.url, title, typeof navigator === "undefined" ? "" : navigator.userAgent)} data-gift-text="">{many ? G.textGuides : G.textGuide}</a>
          <a role="menuitem" href={links.facebook} target="_blank" rel="noopener noreferrer">Facebook</a>
          <a role="menuitem" href={links.pinterest} target="_blank" rel="noopener noreferrer" data-gift-pin="">Pinterest</a>
          {/* Polish audit 1127 #149: the phone's own share sheet is last (it sat in the middle, between Text and Facebook). */}
          {native && <InlineTextButton role="menuitem" onClick={shareSheet} data-gift-share-native="">{G.moreShare}</InlineTextButton>}
        </span>
      )}
    </span>
  );
}

/** The focusable items of an open menu, in order. */
const menuItems = (menu: HTMLElement | null): HTMLElement[] => (menu ? [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")] : []);

/**
 * My Wish List as an icon with its count (a link to /gift-guides/my-list), in the toolbar beside search and sort (owner
 * 2026-11-22: "I think by the search and icons filter"; the phone head row has no heart).
 */
export function MyListIcon({ current = false }: { current?: boolean }) {
  const list = useGiftList();
  const n = list.guides.length + list.picks.length;
  return (
    // Owner 11-21: on a guide page the heart opens My lists (every person's list and My Wish List, each to manage);
    // with no sheet on the page it stays a link to My Wish List.
    <Link to={`/gift-guides/${MY_LIST_SLUG}`} className="gg-icon gg-mylist-icon" aria-label={WISH.countLabel(n)}
      onClick={(e) => { if (!current && openMyLists(null)) e.preventDefault(); }}
      {...(current ? { "aria-current": "page" as const } : {})} data-gift-my-list-link="">
      <Icon d={HEART} fill={n > 0 ? "currentColor" : "none"} />
      {/* No count badge on an empty list (pre-launch audit 11-18 PM: a red "0"). */}
      {n > 0 && <span className="gg-icon-count" aria-hidden="true" data-gift-my-list-count="">{n}</span>}
    </Link>
  );
}

/**
 * The one slim row under every title (owner redesign 11-18 PM): a search field over every guide, My list (with its
 * count) and Share. Nothing else: no pill buttons, no Codes (a page section now).
 */
/**
 * `search` off (the Holiday Hub, owner 11-22: "icons off there"): no gift search in the row, where the page has its own.
 * `heart` off (the Holiday Hub, owner 11-22 7:49 PM: "remove order by and the heart at the top ... i thought we didnt do
 * that for this section?"): no My list heart in the row.
 */
export function GiftGuideTools({ path, title, image, many = false, myList = false, sort, filter, search = true, heart = true }: { path: string; title: string; image?: string; many?: boolean; myList?: boolean; sort?: { order: SortOrder; onChange: (o: SortOrder) => void }; filter?: ToolsFilter; search?: boolean; heart?: boolean }) {
  const [query, setQuery] = useState("");
  // Owner 2026-11-21 ("make search an icon always"): at every width the search is a magnifier icon like the heart and
  // Share; tapping it opens the field (focused); Escape or its close button shuts it again, and it stays open while a
  // query is typed. The results list is unchanged.
  const [searchOpen, setSearchOpen] = useState(false);
  const open = searchOpen || !!query;
  const searchButton = useRef<HTMLButtonElement>(null);
  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
    requestAnimationFrame(() => searchButton.current?.focus());
  };
  // Holiday audit 1121 #20: the results close on a tap outside the search (they stayed over the tiles until Escape),
  // and open again when the field is focused or typed in.
  const [resultsOpen, setResultsOpen] = useState(true);
  const searchBox = useRef<HTMLDivElement>(null);
  const showResults = !!query.trim() && resultsOpen;
  useEffect(() => {
    if (!showResults) return;
    const away = (e: Event) => {
      if (!searchBox.current?.contains(e.target as Node)) setResultsOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [showResults]);
  const found = query.trim() ? searchGuides(query) : [];
  // The deals days and Shop Small (holiday audit 1121): pages, not guides, found by their own words.
  const pages = query.trim() ? searchPages(query) : [];
  // Holistic review 11-18 H5: product names too ("airpods"), from an index fetched on the first keystroke.
  const [items, setItems] = useState<SearchItem[] | null>(null);
  // Holiday audit 1121: offline, the gift results could not load and the box said "No guides match". It now says the
  // gifts did not load, and the next keystroke asks again (loadSearchItems forgets a failed fetch).
  const [itemsFailed, setItemsFailed] = useState(false);
  useEffect(() => {
    if (!query.trim() || items) return;
    let live = true;
    loadSearchItems().then((x) => { if (live) { setItems(x); setItemsFailed(false); } }, (e: unknown) => {
      // Offline or a stale deploy: the guide results still show; the box says the gift results did not load.
      console.warn("gift guides: search index failed", e);
      if (live) setItemsFailed(true);
    });
    return () => { live = false; };
  }, [query, items]);
  const foundItems = query.trim() && items ? searchItems(items, query) : [];
  // The "N results" line at the top of the list while typing (owner 11-22 search polish): every row the list shows.
  const shown = pages.length + Math.min(found.length, 12) + foundItems.length;
  return (
    <div className="gg-tools" role="group" aria-label={G.quickLabel} data-gift-quick="">
      {search && (
      <div ref={searchBox} className={open ? "gg-tools-search is-open" : "gg-tools-search"} data-gift-search-box={open ? "open" : "closed"}>
        {open ? (
          // Owner 2026-11-22 ("Polish the search bar somehow"): a soft field, a thin light-olive ring on focus (was the
          // dark 2px ring), 44px tall with 16px words (no iOS zoom), magnifier left and a 44px ✕ right.
          <label id="gift-search" className="gg-search rounded-xl focus-within:ring-2 focus-within:ring-[hsl(var(--bark)/0.22)]">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE_PX} /><path d="M20 20l-4-4" stroke="currentColor" strokeWidth={ICON_STROKE_PX} strokeLinecap="round" /></svg>
            {/* Opened by a tap on the magnifier, so the field takes the focus at once (never on page load). */}
            <Input look="bare" type="search" autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setResultsOpen(true); }} onFocus={() => setResultsOpen(true)}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeSearch(); } }}
              onBlur={(e) => { if (!query && !searchBox.current?.contains(e.relatedTarget as Node | null)) setSearchOpen(false); }}
              placeholder={G.searchPlaceholder} aria-label={G.searchLabel} role="combobox" aria-autocomplete="list" aria-expanded={showResults} aria-controls="gift-search-results" data-gift-search="" />
            <RoundIconButton className="gg-search-close" aria-label={G.searchCloseLabel} onClick={closeSearch} data-gift-search-close="">
              <Icon d={CLOSE} />
            </RoundIconButton>
          </label>
        ) : null}
        {/* The magnifier's own box stays held while the field is open (desktop: the field grows to its left), so the
            ✕ never lands where the magnifier was and a quick second tap cannot close what it just opened. */}
        {open ? (
          <SearchTriggerSlot />
        ) : (
          <RoundIconButton ref={searchButton} className="gg-icon" aria-label={G.searchLabel} aria-expanded={false} onClick={() => setSearchOpen(true)} data-gift-search-button="">
            <Icon d={SEARCH} />
          </RoundIconButton>
        )}
        {showResults && (
          <ul id="gift-search-results" className="gg-search-results" data-gift-search-results="" aria-live="polite">
            {shown > 0 && <li className="gg-search-count" data-gift-search-count={shown}>{G.searchCount(shown)}</li>}
            {itemsFailed && !items && <li className="gg-search-none" data-gift-search-offline="">{G.searchFailed}</li>}
            {found.length === 0 && foundItems.length === 0 && pages.length === 0 && !(itemsFailed && !items) && <li className="gg-search-none">{G.searchNone}</li>}
            {pages.map((p) => (
              <li key={p.to}>
                <Link to={p.to} onClick={() => setQuery("")} data-gift-found-page={p.to}>
                  <span className={`gg-search-thumb gg-check gg-${p.tint}`} aria-hidden="true" />
                  <span>{p.title}</span>
                </Link>
              </li>
            ))}
            {found.length > 0 && foundItems.length > 0 && <li className="gg-search-head" aria-hidden="true">{G.searchGuidesTitle}</li>}
            {found.slice(0, 12).map((g) => (
              <li key={g.slug}>
                <Link to={`/gift-guides/${g.slug}`} onClick={() => setQuery("")} data-gift-found={g.slug}>
                  {/* The guide's cover as a small thumbnail (holistic review 11-18 H5). */}
                  {g.cover ? <img className="gg-search-thumb" loading="lazy" decoding="async" src={g.cover} alt="" width={36} height={36} /> : <span className={`gg-search-thumb gg-check gg-${g.tint}`} aria-hidden="true" />}
                  <span>{g.age ? `${g.title}, ${g.lead.replace(/^gifts for /, "")}` : g.title}</span>
                </Link>
              </li>
            ))}
            {foundItems.length > 0 && <li className="gg-search-head" aria-hidden="true">{G.searchItemsTitle}</li>}
            {foundItems.map((item) => {
              const [name, slug, , , image] = item;
              // Holiday audit 1121 #7: the price beside the guide, by the card's own rule (fresh, rounded).
              const dollars = searchItemDollars(item);
              return (
              <li key={`${slug} ${name}`}>
                {/* Guide audit 1123 I2: lands ON the gift (its row's #link), on another guide or the one you are on. */}
                <Link to={`/gift-guides/${slug}#${pickAnchor(name)}`} onClick={() => setQuery("")} data-gift-found-item={slug}>
                  {image && <img className="gg-search-thumb gg-search-thumb-item" loading="lazy" decoding="async" src={image} alt="" width={36} height={36} />}
                  <span className="gg-search-item">
                    <span className="gg-search-item-name">{name}</span>
                    <small>{G.searchItemIn(guideBySlug(slug)?.title ?? "")}{dollars !== null && <span data-gift-found-price="">{` · ${G.priceApprox(dollars)}`}</span>}</small>
                  </span>
                </Link>
              </li>
              );
            })}
          </ul>
        )}
      </div>
      )}
      {sort && <GiftGuideSort order={sort.order} onChange={sort.onChange} />}
      {filter && <GiftGuideFilter filter={filter} />}
      {heart && <MyListIcon current={myList} />}
      <GiftGuideShare path={path} title={title} image={image} many={many} />
    </div>
  );
}
