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
import { useNavigate } from "react-router-dom";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DeclutterNotice } from "./declutterUi";

/** /declutter: the title row, the intro, the Browse / My listings tabs, the distance row and the first cards. */
export function DeclutterHomeSkeleton() {
  const navigate = useNavigate();
  return (
    <AppPage
      title="Declutter"
      titleActions={
        <Button type="button" size="sm" className="whitespace-nowrap" onClick={() => navigate("/declutter/sell")}>
          Sell an item
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">Buy and sell used household items near you. Pick up in person.</p>
      <Skeleton className="h-12 w-full rounded-full" aria-hidden />
      <DeclutterBrowseBones />
    </AppPage>
  );
}

/**
 * The Browse view's body while it loads: the distance row and the first
 * cards. Shared by the page skeleton above and BrowseView itself, which shows
 * it until where you are AND the items are both in, then paints everything at
 * once (Q?declutter-settle: the distance row used to land above an already
 * painted "Loading items…" line and push it 238px down at 375).
 */
export function DeclutterBrowseBones() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading items">
      {/* The distance choices wrap to three rows on a phone (140px at 375)
          and sit in one row from sm up. */}
      <Skeleton className="h-[140px] sm:h-12 w-full rounded-2xl" />
      <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="min-w-0">
            <Skeleton className="aspect-square w-full rounded-2xl" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** /declutter/item/:id: the photo strip and the price-and-pickup card. Also the item's own loading state. */
export function DeclutterItemSkeleton() {
  return (
    <AppPage title="Item" backTo="/declutter">
      <div className="flex gap-2 overflow-hidden -mx-1 px-1" role="status" aria-label="Loading the item">
        <Skeleton className="shrink-0 w-[80%] max-w-sm aspect-square rounded-2xl" />
        <Skeleton className="shrink-0 w-[80%] max-w-sm aspect-square rounded-2xl" />
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
    <AppPage title="Sell an item" backTo="/declutter?view=mine">
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

/** /declutter/move: the real header, no bones (as the sell form: its first rows come and go with the member). */
export function DeclutterMoveSkeleton() {
  return (
    <AppPage title="Moving out" backTo="/declutter?view=mine">
      <p role="status" className="sr-only">Loading your moving sale</p>
    </AppPage>
  );
}
