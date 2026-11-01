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
import AppPage from "@/components/AppPage";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { safeStorage } from "@/lib/safeStorage";
import { DeclutterNotice } from "./declutterUi";

/** /declutter: the section shell (top bar), the tab row, the phone's search row and the first cards. */
export function DeclutterHomeSkeleton() {
  const desktop = useIsWebDesktop();
  const map = desktop && safeStorage.getItem("helpr.declutterMapVisible") !== "0";
  return (
    // The Browse silhouette, so no "Search all sections" field: Browse draws its own search (the row under the
    // tabs on a phone, the end of the tabs row on desktop).
    <SectionScreen
      section="declutter"
      title="Declutter"
      globalSearch={false}
      tabs={
        <>
          <Skeleton className="h-11 w-full rounded-ds-md" aria-hidden />
          {!desktop && <Skeleton className="h-10 w-full rounded-full" aria-hidden />}
        </>
      }
    >
      <DeclutterBrowseBones map={map} full={desktop && !map} />
    </SectionScreen>
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
          <div className="space-y-1.5 px-0.5 pt-2">
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

/** /declutter/item/:id: the photo strip and the price-and-pickup card. Also the item's own loading state. */
export function DeclutterItemSkeleton() {
  return (
    <AppPage title="Item" backTo="/declutter">
      <div className="flex gap-2 overflow-hidden -mx-1 px-1" role="status" aria-label="Loading the item">
        <Skeleton className="shrink-0 w-[80%] max-w-sm aspect-square rounded-2xl bg-photo-empty" />
        <Skeleton className="shrink-0 w-[80%] max-w-sm aspect-square rounded-2xl bg-photo-empty" />
      </div>
      <Skeleton className="h-52 w-full rounded-2xl" aria-hidden />
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
export function DeclutterItemUnavailable({ detail }: { detail?: string }) {
  return (
    <AppPage title="Item" backTo="/declutter">
      <DeclutterNotice tone="warn" title="This item isn't available.">
        {detail ?? "It may have sold or been taken down."}
      </DeclutterNotice>
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
