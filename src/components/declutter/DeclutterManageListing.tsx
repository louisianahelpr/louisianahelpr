/**
 * Board 158 (2026-10-20): "Manage a listing" and Paused -> Relist.
 *
 * The rows are only what the server really does (migration
 * 20261020064354_declutter_manage_listing.sql):
 *   Change price or lowest price -> declutter_set_listing_price
 *   Lower the price if it doesn't sell? (on = drops) -> declutter_set_listing_drops
 *   Pause listing / Relist       -> declutter_pause_listing / declutter_relist_listing
 *   Mark sold elsewhere / Delete -> declutter_withdraw_item (takes it down, no fees)
 * Left off the board's sheet until the server supports them: "Edit listing"
 * for a live listing (an edit has to clear the photo check and the four tax
 * confirmations, B19) and relisting a SOLD item as a copy. The paused card
 * shows no "N people saved it": no read gives the seller that count.
 */
import { Link } from "react-router-dom";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ShareListingRow } from "./DeclutterShareCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDestructiveAction,
  SheetFooter,
  SheetHero,
  SheetPrimaryAction,
  SheetSecondaryAction,
} from "@/components/ui/sheet";
import { dropPctOf } from "@/lib/declutter/priceDrop";
import { suggestedDropCents } from "@/lib/declutter/priceNudge";
import {
  fetchItemDropState,
  fetchManageState,
  pauseListing,
  relistListing,
  setListingDrops,
  setListingPrice,
  withdrawItem,
  markSoldElsewhere,
  type DeclutterItem,
} from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice, itemPriceLabel } from "@/lib/declutter/distance";
import { centsToDollars, dollarsToCents } from "@/lib/declutter/money";
import { ItemDeliveryRow } from "./SellerDeliverySettings";
import { AutoFreeRow } from "./AutoFreeRow";
import { DeclutterOfferRules } from "./DeclutterOfferRules";
import { KeepUpRow } from "./KeepUpRow";
import { FallbackImg } from "./FallbackImg";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { DeclutterEditListing } from "./DeclutterEditListing";
import { DROPS_SWITCH_LABEL } from "./sellForm";
import { focusSheetItself } from "./focusSheetItself";
import { TAKE_DOWN_WORDS } from "./takeDownWords";

type View = "menu" | "price" | "sold" | "delete" | "edit";

const ROW =
  "flex w-full items-center gap-3 px-4 py-3.5 text-left min-h-[60px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function useManageState(itemId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["declutter", "manage", itemId],
    queryFn: () => fetchManageState(itemId),
    enabled,
  });
}

/** What changed, in the words the toast uses, and a fresh read of every Declutter list. */
function useListingAction<V>(fn: (v: V) => Promise<unknown>, done: string, after?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast(done);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
      after?.();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
}

export function ManageListingSheet({
  item,
  coverUrl,
  open,
  onOpenChange,
  startOn = "menu",
  suggestDrop = false,
}: {
  item: DeclutterItem;
  coverUrl: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startOn?: View;
  /** CMP-5: opened from the "drop the price?" nudge: Change price starts at the suggested price (the seller saves it). */
  suggestDrop?: boolean;
}) {
  const [view, setView] = useState<View>(startOn);
  const close = () => onOpenChange(false);
  const state = useManageState(item.id, open);
  // Before migration 20261020064354 reaches prod only "take it down" works (withdraw).
  const deployed = state.data !== "not_deployed";
  const manage = state.data && state.data !== "not_deployed" ? state.data : null;
  // Owner 2026-10-28: a listing put up with drops OFF (drop_pct 0, its lowest price = its price) never drops,
  // so it reads as stopped here, and the switch cannot claim "back on" (money review 2026-10-28 #3).
  const dropState = useQuery({ queryKey: ["declutter", "drop-state", item.id], queryFn: () => fetchItemDropState(item.id), enabled: open });
  const listedOff = dropState.data ? dropPctOf(dropState.data) === 0 : false;
  // A lowest price at the price can't drop whatever the switch says, so it never reads "On".
  const atFloor = !!manage && !manage.drops_stopped && !listedOff && manage.floor_price_cents >= item.current_price_cents;
  const stopped = (manage?.drops_stopped ?? false) || listedOff || atFloor;
  const drops = useListingAction((on: boolean) => setListingDrops(item.id, on), stopped ? "Price drops are back on." : `Price drops are off. It stays at ${formatPrice(item.current_price_cents)}.`);
  const pause = useListingAction(() => pauseListing(item.id), "Paused. It's hidden from buyers.", close);
  const relist = useListingAction(() => relistListing(item.id), "Back on sale.", close);
  // A2-5: "Mark sold elsewhere" keeps the listing in the seller's history; Delete stays a withdraw.
  const takeDown = useListingAction(() => (view === "sold" ? markSoldElsewhere(item.id) : withdrawItem(item.id)),
    view === "sold" ? "Marked sold elsewhere. It's off sale and in your selling history." : "Listing deleted.", close);
  const busy = drops.isPending || pause.isPending || relist.isPending || takeDown.isPending;
  const paused = item.status === "paused";
  // A free item (20261027170717) has no price to change, no drops and no seller delivery: only pause, relist, take down.
  const free = item.current_price_cents === 0;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setView(startOn);
      }}
    >
      <SheetContent side="bottom" floor onOpenAutoFocus={focusSheetItself} className="max-h-[90dvh] overflow-y-auto" data-manage-listing="">
        <SheetHero title={view === "edit" ? "Edit listing" : view === "price" ? "Change price" : view === "sold" ? "Sold somewhere else?" : view === "delete" ? "Delete this listing?" : "Manage listing"} />
        {view === "menu" && (
          <div className="space-y-3">
            <ListingSummary item={item} coverUrl={coverUrl} />
            <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
              {item.status === "live" ? (
              <li>
                <Link to={`/declutter/item/${item.id}?preview=buyer`} className={ROW} data-manage-preview="" onClick={close}>
                  <RowText title="Preview">See your listing as buyers do</RowText>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
              ) : null}
              {/* Audit 1028 D1-1: a live listing can be edited (declutter_edit_listing; the owner's review rule). */}
              {item.status === "live" && (
              <li>
                <button type="button" className={ROW} onClick={() => setView("edit")} disabled={busy}>
                  <RowText title="Edit listing">Title, description, category, condition, size, how buyers get it</RowText>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
              )}
              {deployed && (<>
              {!free && (<>
              <li>
                <button type="button" className={ROW} onClick={() => setView("price")} disabled={busy}>
                  <RowText title="Change price or lowest price">
                    Now {itemPriceLabel(item.current_price_cents)}
                    {manage ? ` · lowest ${formatPrice(manage.floor_price_cents)}` : ""}
                  </RowText>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
              {/* Audit DC-5: the sell form's own words and direction, on = it drops (it said "Stop price drops", on = stopped). */}
              <li className={ROW}>
                <RowText title={DROPS_SWITCH_LABEL} id="manage-drops">
                  {listedOff ? "Off: you listed it without price drops" : atFloor ? "Off: its lowest price is its price" : stopped ? `Off. It stays at ${itemPriceLabel(item.current_price_cents)}.` : "On. It drops each evening, never below your lowest price."}
                </RowText>
                <Switch
                  aria-labelledby="manage-drops"
                  checked={!stopped}
                  disabled={!manage || busy || listedOff || atFloor}
                  onCheckedChange={(on) => drops.mutate(on)}
                />
              </li>
              {/* Smart offers (owner 2026-10-29): Accept offers, Lowest you'll take (with Claude's suggestion), auto answers. */}
              <DeclutterOfferRules itemId={item.id} priceCents={item.current_price_cents} acceptsOffers={item.accepts_offers} floorCents={manage?.floor_price_cents ?? null} rowClassName={ROW} />
              <ItemDeliveryRow itemId={item.id} rowClassName={ROW} />
              {/* OWN-FREE: make it free after Never/7/14/21/30 days if unsold (only while it is live or paused and still priced). */}
              <AutoFreeRow itemId={item.id} rowClassName={ROW} />
              </>)}
              {/* Owner 2026-10-29: renews every 30 days until it sells (free listings run in the same rounds). */}
              <KeepUpRow itemId={item.id} rowClassName={ROW} />

              <li>
                {paused ? (
                  <button type="button" className={ROW} onClick={() => relist.mutate(undefined)} disabled={busy}>
                    <RowText title="Relist">Back on sale with its photos and price</RowText>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                ) : (
                  <button type="button" className={ROW} onClick={() => pause.mutate(undefined)} disabled={busy}>
                    <RowText title="Pause listing">Hide it without losing it. Open offers close.</RowText>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                )}
              </li>
              </>)}
              <li>
                <button type="button" className={ROW} onClick={() => setView("sold")} disabled={busy}>
                  <RowText title="Mark sold elsewhere">Takes it down and keeps it in your history; no fees</RowText>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
              <li>
                <button type="button" className={ROW} onClick={() => setView("delete")} disabled={busy}>
                  <span className="flex-1 min-w-0 text-ds-15 font-semibold text-[hsl(var(--alert,4_71%_41%))]">Delete listing</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            </ul>
          </div>
        )}
        {view === "edit" && <DeclutterEditListing item={item} onDone={close} />}
        {view === "price" && !manage && (
          state.isError ? (
            <p role="alert" className="text-ds-13 text-[hsl(var(--alert,4_71%_41%))]">{declutterErrorMessage(state.error)}</p>
          ) : (
            <Skeleton className="h-40 w-full rounded-[20px]" />
          )
        )}
        {view === "price" && manage && (
          <PriceEditor
            item={item}
            floorCents={manage.floor_price_cents}
            initialCents={suggestDrop ? suggestedDropCents(item.current_price_cents, manage.floor_price_cents) : null}
            relist={paused && startOn === "price"}
            onBack={() => (startOn === "price" ? close() : setView("menu"))}
            onSaved={() => (startOn === "price" ? close() : setView("menu"))}
          />
        )}
        {(view === "sold" || view === "delete") && (
          <div className="space-y-4">
            <p className="text-ds-15">
              {view === "sold"
                ? "We'll take it off sale and keep it in your selling history. There's no fee, and anyone with an open offer is told nothing was charged."
                : TAKE_DOWN_WORDS}
            </p>
            <SheetFooter>
              <SheetSecondaryAction onClick={() => setView("menu")} disabled={takeDown.isPending}>
                Keep it
              </SheetSecondaryAction>
              {view === "sold" ? (
                <SheetPrimaryAction onClick={() => takeDown.mutate(undefined)} disabled={takeDown.isPending}>
                  {takeDown.isPending ? "Working…" : "Mark sold"}
                </SheetPrimaryAction>
              ) : (
                <SheetDestructiveAction onClick={() => takeDown.mutate(undefined)} disabled={takeDown.isPending}>
                  {takeDown.isPending ? "Deleting…" : "Delete listing"}
                </SheetDestructiveAction>
              )}
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ListingSummary({ item, coverUrl }: { item: DeclutterItem; coverUrl: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-[20px] border border-border bg-card px-4 py-3">
      <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-photo-empty">
        {/* DA-15: the one missing-photo look, the category icon, under the photo as on every card. */}
        <PhotoPlaceholder icon={categoryIcon(item.category)} seed={item.category} className="absolute inset-0 h-full w-full" iconClassName="h-6 w-6" />
        {coverUrl && <FallbackImg src={coverUrl} alt="" className="relative h-full w-full object-cover" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ds-15 font-semibold">{item.title}</span>
        <span className="block truncate text-ds-13 text-muted-foreground">
          {[item.area_label, item.porch_ok !== false ? "porch pickup" : null].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="shrink-0 text-ds-15 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]">{itemPriceLabel(item.current_price_cents)}</span>
    </div>
  );
}

function RowText({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <span className="flex-1 min-w-0">
      <span id={id} className="block text-ds-15 font-semibold">{title}</span>
      <span className="block text-ds-13 text-muted-foreground">{children}</span>
    </span>
  );
}

function PriceEditor({
  item,
  floorCents,
  onBack,
  onSaved,
  relist = false,
  initialCents = null,
}: {
  item: DeclutterItem;
  floorCents: number;
  relist?: boolean;
  initialCents?: number | null;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [price, setPrice] = useState(centsToDollars(initialCents ?? item.current_price_cents));
  const [floor, setFloor] = useState(centsToDollars(floorCents));
  const [touched, setTouched] = useState(false);
  const priceCents = dollarsToCents(price);
  const floorC = dollarsToCents(floor);
  const problem =
    priceCents == null || priceCents < 100 || priceCents > 100_000
      ? "The price must be between $1 and $1,000."
      : priceCents > item.price_cents
        ? `You can lower the price, or raise it back up to ${formatPrice(item.price_cents)}, the price you listed it at.`
        : floorC != null && floorC >= 100 && floorC > priceCents
        ? `${formatPrice(priceCents)} is under your lowest price, ${formatPrice(floorC)}.`
        : floorC == null || floorC < 100 || floorC > priceCents
        ? "Your lowest price must be at least $1 and no more than your price."
        : null;
  // NIGHT-SELL-Sellinglist-6: a price typed under the lowest is said at once (not only on Save), with a one-tap fix,
  // so the seller isn't left to find the second box they never touched.
  const underFloor = priceCents != null && priceCents >= 100 && priceCents <= item.price_cents && floorC != null && floorC >= 100 && floorC > priceCents;
  const save = useListingAction(
    async () => {
      await setListingPrice(item.id, priceCents!, floorC!);
      if (relist) await relistListing(item.id);
    },
    `${relist ? "Back on sale at" : "Price set to"} ${priceCents ? formatPrice(priceCents) : ""}.`,
    onSaved,
  );
  const field = "flex h-[52px] items-center gap-1 rounded-[14px] border border-border bg-card px-4 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring";
  const inputCls = "w-full bg-transparent text-ds-15 font-semibold text-[hsl(var(--burnt-sienna))] outline-none focus-visible:outline-none focus-visible:ring-0";
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!problem) save.mutate(undefined);
      }}
    >
      <div className="space-y-2">
        <label htmlFor="manage-price" className="block text-sm font-semibold">Price</label>
        <div className={field}>
          <span className="text-ds-15 font-semibold text-[hsl(var(--burnt-sienna))]" aria-hidden>$</span>
          <input id="manage-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} className={inputCls} />
        </div>
      </div>
      <div className="space-y-2">
        <label htmlFor="manage-floor" className="block text-sm font-semibold">Lowest you'll take</label>
        <div className={field}>
          <span className="text-ds-15 font-semibold text-[hsl(var(--burnt-sienna))]" aria-hidden>$</span>
          <input id="manage-floor" inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value.replace(/[^0-9.]/g, ""))} className={inputCls} />
        </div>
        <p className="text-ds-13 text-muted-foreground">Only you see this. Prices never drop below it.</p>
      </div>
      {(touched || underFloor) && problem && (
        <p role="alert" className="text-ds-13 text-[hsl(var(--alert,4_71%_41%))]">{problem}</p>
      )}
      {underFloor && (
        <button type="button" className="min-h-11 text-ds-14 font-semibold underline underline-offset-2" onClick={() => setFloor(price)}>
          Also set lowest to {formatPrice(priceCents ?? 0)}
        </button>
      )}
      <SheetFooter>
        <SheetSecondaryAction type="button" onClick={onBack} disabled={save.isPending}>
          Back
        </SheetSecondaryAction>
        <SheetPrimaryAction type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : relist ? "Relist at this price" : "Save price"}
        </SheetPrimaryAction>
      </SheetFooter>
    </form>
  );
}

/**
 * The seller's own card on the item page (board 158): live -> "Manage
 * listing"; paused -> Relist / Relist at a new price.
 */
export function SellerListingPanel({ item, coverUrl }: { item: DeclutterItem; coverUrl: string | null }) {
  const [open, setOpen] = useState<null | "menu" | "price">(null);
  const relist = useListingAction(() => relistListing(item.id), "Back on sale.");
  const paused = item.status === "paused";
  // A free item (20261027170717) has no price and no drops (B106 found "Change the price, stop the drops" on one).
  const free = item.current_price_cents === 0;
  return (
    <section className="space-y-2" aria-label="Your listing" data-seller-panel={item.status}>
      <div className="rounded-[20px] border border-border bg-card px-4 py-4 space-y-3">
        <div>
          <p className="text-ds-17 font-bold">{paused ? "Paused" : free ? "Your free item is up" : "Your listing is for sale"}</p>
          <p className="text-ds-13 text-muted-foreground" data-seller-panel-line="">
            {paused
              ? free ? "Hidden from neighbors. Its photos are kept." : "Hidden from buyers. Its photos and price are kept."
              : free ? "Pause it or take it down." : "Change the price, stop the drops, pause it or take it down."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {paused ? (
            <>
              <Button type="button" size="sm" onClick={() => relist.mutate(undefined)} disabled={relist.isPending}>
                {relist.isPending ? "Relisting…" : "Relist"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen("price")} disabled={relist.isPending}>
                Relist at a new price
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen("menu")}>
              Manage listing
            </Button>
          )}
        </div>
        {/* Q2426: share only a listing buyers can open now, never a paused one. */}
        {!paused && (
          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-ds-13 text-muted-foreground">Post it in your local Facebook groups. {free ? "The link shows its photo and town, and that it's free." : "The link shows its photo, price and town."}</p>
            <ShareListingRow item={item} />
          </div>
        )}
      </div>
      {paused && (
        <p className="px-1 text-ds-13 text-muted-foreground">Relisting brings it back with its photos and price.</p>
      )}
      {open && (
        <ManageListingSheet
          key={open}
          item={item}
          coverUrl={coverUrl}
          open
          startOn={open}
          onOpenChange={(o) => {
            if (!o) setOpen(null);
          }}
        />
      )}
    </section>
  );
}
