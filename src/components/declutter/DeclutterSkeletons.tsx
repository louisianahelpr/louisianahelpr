/**
 * What each Declutter screen looks like while the hidden 'declutter' switch
 * (and then the screen's own data) loads.
 *
 * DeclutterGate used to render NOTHING while the switch loaded, so the first
 * frame was a blank page and the whole screen arrived at once: measured
 * 2026-10-15 06:27Z on prod (scripts/audit/measure-loading-states.mjs), a
 * +754px jump on /declutter and /declutter/item/:id for both test accounts,
 * and 10 check-loading-state-shape problems.
 *
 * Each skeleton wears the screen's real shell, AppPage, with the screen's
 * real title (the ProfileTabFallback rule: the header is real, so nothing
 * moves when the page replaces it), and shared <Skeleton> bones only where
 * the page's data will land. The 404 for a member without the switch still
 * comes after the switch's answer, never a flash of it for a tester.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { usePageTitle } from "@/hooks/usePageTitle";
import { safeStorage } from "@/lib/safeStorage";
import { hasPersistedAuthToken } from "@/lib/persistedAuthToken";
import { DeclutterNotice } from "./declutterUi";
import { ITEM_PHOTO_ASPECT, ITEM_PHOTO_FRAME_BASE } from "./itemPhotoFrame";
import { useScreenfulBelow } from "@/hooks/useScreenfulBelow";
import { CHIPS_ROW_PAD } from "@/components/sections/browseHeaderSpacing";

/**
 * /declutter: the section shell (top bar), the tab row and the first cards.
 *
 * Q1695 (loading-states refresh 2026-11-03 19:40Z, bot PR #3963, 375, customer and anon): the phone's search and
 * filters END the tabs row (DeclutterBrowseView's phone header, owner 10-30), so there is no search row under the
 * tabs any more. The bone for one stayed: the body started 43px lower than the page that replaced it
 * ("row 672px -> 715px", the header region 140px -> 97px).
 */
export function DeclutterHomeSkeleton({ guestJoin }: { guestJoin?: ReactNode } = {}) {
  const desktop = useIsWebDesktop();
  const map = desktop && safeStorage.getItem("helpr.declutterMapVisible") !== "0";
  return (
    // The Browse silhouette, so no "Search all sections" field: Browse draws its own search at the end of the tabs
    // row, on a phone and on desktop alike.
    <SectionScreen
      section="declutter"
      title="Declutter"
      globalSearch={false}
      // Phone (owner 11-08, the Vinted header): the search bar's bone in the bar, the chips' bones under it.
      search={desktop ? undefined : <Skeleton className="h-11 w-full rounded-full" aria-hidden />}
      tabs={desktop ? <Skeleton className="h-11 w-full rounded-ds-md" aria-hidden /> : (
        <>
          {/* F153: a member's phone has the section tabs under the search; a guest's has none. index.html's copy
              (guestJoin) always draws the row, and its guest rule hides it (index.css, data-lh-declutter-guest). */}
          {(guestJoin || hasPersistedAuthToken()) && <DeclutterPhoneTabBones />}
          <DeclutterChipBones />
        </>
      )}
    >
      {/* Q2705 (11-09): index.html's copy of this frame carries a guest's sign-up line where Browse draws it (above the
          cards), hidden unless index.html's guest script marks <html> data-lh-declutter-guest, so a guest's drawn
          photos sit where Browse's land (262px at 375, not 116px). The app never passes it. */}
      {guestJoin && <div data-lh-guest-join="" style={{ display: "none" }}>{guestJoin}</div>}
      <DeclutterBrowseBones map={map} full={desktop && !map} />
    </SectionScreen>
  );
}

/**
 * F153 (owner UI audit 11-09): a member's phone tab row (Browse Buying Selling Deliver Wanted Free) while Declutter
 * loads, in SectionTabs' own box: a 44px row of tabs over its 1px rule, so the chips and cards start where the page
 * puts them and nothing moves when the real row arrives.
 */
function DeclutterPhoneTabBones() {
  return (
    <div className="flex items-end gap-1 border-b border-border/60" aria-hidden data-lh-member-tabs="">
      <div className="flex h-11 items-center gap-3">
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-14" />
      </div>
    </div>
  );
}

/**
 * The phone's category chips while Browse loads (Q2705, 11-09): the chips' own box (DeclutterBrowseView's pb-2 row
 * around DeclutterCategoryChips' pb-1 row of 40px chips), so the first cards start where Browse puts them (124px at
 * 375, not 116px) and the header does not grow when the chips arrive (CLS 0.062 at 375 on 11-09, the cards moving
 * 56px down). index.html draws this frame with the first photos in it, and they must not jump either.
 */
export function DeclutterChipBones() {
  return (
    <div className={CHIPS_ROW_PAD} aria-hidden data-declutter-chip-bones="">
      <div className="flex gap-2 overflow-hidden pb-1">
        <Skeleton className="h-10 w-14 shrink-0 rounded-full" />
        <Skeleton className="h-10 w-32 shrink-0 rounded-full" />
        <Skeleton className="h-10 w-36 shrink-0 rounded-full" />
      </div>
    </div>
  );
}

/**
 * The Buying or Selling body while its code loads (DeclutterHomeView loads both on demand, lead 11-01): the filter
 * chips row and two order-card bones, where the tab's own chips and first cards land. Normally never seen: the chunk
 * starts loading once the page settles, before the member taps either tab.
 */
export function DeclutterTabBones() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" data-declutter-tab-bones="">
      <span className="sr-only">Loading…</span>
      <div className="flex gap-2" aria-hidden>
        <Skeleton className="h-9 w-24 rounded-full" />
        <Skeleton className="h-9 w-20 rounded-full" />
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>
      <Skeleton className="h-28 w-full rounded-[20px]" aria-hidden />
      <Skeleton className="h-28 w-full rounded-[20px]" aria-hidden />
    </div>
  );
}

/** The Browse grid: 2 across on a phone, 3 on a small tablet, 4 on very wide screens (owner, 2026-10-19 14:55Z). */
export const DECLUTTER_GRID = "grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 2xl:grid-cols-4";
/** The same grid across the whole panel (desktop, map hidden): 4 across, 5 on wide screens, so a card stays card-sized. */
export const DECLUTTER_GRID_FULL = `${DECLUTTER_GRID} lg:grid-cols-4 xl:grid-cols-5`;
/** How many cards the grids above put in their first row at this width (sm 640, lg 900, xl 1280, 2xl 1536). */
export function declutterFirstRowCount(full: boolean, width: number): number {
  if (width < 640) return 2;
  if (!full) return width < 1536 ? 3 : 4;
  if (width < 900) return 3;
  if (width < 1280) return 4;
  return width < 1536 ? 5 : 4;
}

/**
 * Where the grids above put their first photo row on a phone, and the card's text and row gap under each photo
 * (measured 11-07, guest Browse at 375x812, live: photo rows at 338 and 599 px, 162 px photos). From sm up a card's photo
 * is about 250 px (CARD_PHOTO_SIZES).
 */
const GRID_TOP_PX = 338;
const CARD_BELOW_PHOTO_PX = 99;
/** At most this many rows count as above the fold, so a very tall window never starts a screenful of photos at once. */
const MAX_FOLD_ROWS = 4;

/**
 * How many cards the grid draws above the fold at this window size (Q2705, 11-07): every row whose photo is at least
 * half on screen. Their photos load at once and the entry preloads them (src/boot/declutterPrefetch.ts holds a copy,
 * bootAboveFoldCount); only the first row's also ask for high priority. 375x812: 4 (live, the 3rd card on the second
 * row was the largest paint, at 10.9 s on Slow 4G); 375x667: 2.
 */
export function declutterAboveFoldCount(full: boolean, width: number, height: number): number {
  const photo = width < 640 ? (width - 52) / 2 : 250;
  let rows = 1;
  while (rows < MAX_FOLD_ROWS && GRID_TOP_PX + rows * (photo + CARD_BELOW_PHOTO_PX) + photo / 2 < height) rows++;
  return declutterFirstRowCount(full, width) * rows;
}

/**
 * The Browse view's body while it loads: the first cards, and on desktop with the map shown the map column beside
 * them (Browse's list | map). Shared by the page skeleton above and Browse itself, which shows it until where you
 * are AND the items are both in, then paints everything at once (Q?declutter-settle: the distance row used to land
 * above an already painted "Loading items..." line and push it 238px down at 375).
 */
export function DeclutterBrowseBones({ map = false, full = false }: { map?: boolean; full?: boolean }) {
  const cards = (
    <ul className={full ? DECLUTTER_GRID_FULL : DECLUTTER_GRID} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="min-w-0">
          <Skeleton className="aspect-square w-full rounded-2xl bg-photo-empty" />
          {/* The card's text block is 110px at 375 (DeclutterItemCard: price, fee, title, condition, town, how), so the
              second row lands where Browse's does (Q2705, 11-09). */}
          <div className="h-[110px] space-y-1.5 px-0.5 pt-2">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <div className={map ? "grid grid-cols-[minmax(0,1fr)_48%] gap-6" : undefined} role="status" aria-label="Loading items">
      <div className="min-w-0">{cards}</div>
      {map && <Skeleton className="h-[480px] rounded-2xl" />}
    </div>
  );
}

/**
 * /declutter/item/:id: the photo and the price-and-pickup card. Also the item's own loading state.
 * Q1837 (loading-states run 41949893912, helper, its own draft item): the frame is the real page's. Same header
 * (back + help, title only for screen readers, pinned: DeclutterItemView's AppPage props), the same grid, and ONE
 * photo bone in the gallery's own frame (a strip of two 80% bones stood in for one full-width square).
 */
export function DeclutterItemSkeleton() {
  // The details card reserves the rest of the screen (owner ruling 2026-09-19: "SKELETON FILLS THE SCREEN, GROWS
  // BELOW"); the real column is taller and grows below the fold.
  const { ref: columnRef, reserve } = useScreenfulBelow();
  return (
    <AppPage title="Item" backTo="/declutter" phoneHidesTitle hidesTitle stickyHeader>
      <div className="lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-8" role="status" aria-label="Loading the item">
        <div>
          <Skeleton className={`${ITEM_PHOTO_FRAME_BASE} ${ITEM_PHOTO_ASPECT.item}`} />
        </div>
        <div ref={columnRef} className="mt-4 lg:mt-0 min-w-0 space-y-5">
          <Skeleton className="h-52 w-full rounded-2xl" style={{ minHeight: reserve }} aria-hidden />
        </div>
      </div>
    </AppPage>
  );
}

/**
 * /declutter/sell: the real header, and NO bones. The form below it is static
 * (nothing to wait for on a new listing) except its first row, the "Set up
 * payouts" note, which only some members get. Bones for the form were
 * measured 2026-10-15 (measure-loading-states, local build, prod backend):
 * -652px and 2 -> 3 rows for the poster test account, -582px and 2 -> 4 rows
 * for the Helpr one, because the note's row comes and goes with the member.
 * A placeholder that cannot know its first row would lie about the shape, so
 * the frame holds the title in its final place and says it is loading.
 */
export function DeclutterSellSkeleton() {
  return (
    <AppPage title="Sell an item" backTo="/declutter?view=selling">
      <p role="status" className="sr-only">Loading the form</p>
    </AppPage>
  );
}

const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a /declutter/item/:id link can name an item at all (item ids are uuids). */
export function isItemId(id: string | undefined): id is string {
  return !!id && ITEM_ID.test(id);
}

/**
 * The item page for an item that is not there: sold, taken down, or a link
 * that never named one. Also the gate's frame for a malformed link, where we
 * know before loading anything that no item will arrive, so a skeleton of
 * photos would be a promise the page then breaks.
 */
export function DeclutterItemUnavailable({ detail, more, top, notFound }: { detail?: string; more?: ReactNode; top?: ReactNode; notFound?: boolean }) {
  // Q2565 (Auditor 1, audit 1102a): a sold or taken-down item opened from a share, a notice or a saved link was a
  // dead end (a notice and an empty screen). It now offers the way on, and the page is titled for where it is.
  // Audit 11-10 F316: a link whose id is not an item id at all (/declutter/item/abc) is a broken link, not a sale:
  // "We couldn't find that item." and a tab titled for it, never "It sold". This effect runs after AppPage's own
  // usePageTitle (a child's effect runs first), so its title wins.
  usePageTitle(notFound ? "Item not found — Helpr" : "Declutter — Helpr");
  return (
    <AppPage title="Declutter" backTo="/declutter">
      {/* F061 (lead rule 11-09): a sold item's greyed card (the item page passes SoldItemCard); nothing else of a
          listing that was pulled or removed. */}
      {top}
      <DeclutterNotice tone="warn" title={notFound ? "We couldn't find that item." : "No longer available."}>
        {notFound ? "The link may be broken." : detail ?? "It sold or is no longer on Declutter."}
      </DeclutterNotice>
      <Button asChild variant="primary" className="mt-4 w-full sm:w-auto" data-item-unavailable-onward="">
        <Link to="/declutter">See more on Declutter</Link>
      </Button>
      {/* F061 (UI audit 11-09): something to look at instead of a blank page (the item page passes the newest row). */}
      {more}
    </AppPage>
  );
}

/** /declutter/settings while the 'declutter' switch is read. */
export function DeclutterSettingsSkeleton() {
  return (
    <AppPage title="Declutter settings" backTo="/declutter?tab=selling">
      <p role="status" className="sr-only">Loading your settings</p>
    </AppPage>
  );
}

/** While a tab's own code arrives (B77): the listing rows' shimmer, under the tabs row that is already drawn. */
export function TabSkeleton() {
  return <div className="space-y-6"><Skeleton className="h-24 w-full rounded-[20px]" /><ListingsSkeleton /></div>;
}

/** Grey shimmer rows shaped like the listing cards (owner 2026-10-18, tweak 5). */
export function ListingsSkeleton() {
  return (
    <ul className="space-y-3" role="status" aria-label="Loading your listings">
      {[0, 1, 2].map((i) => (
        <li key={i} className="rounded-2xl bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3.5 w-1/4" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-4/5" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}
