/** The last step of Sell a bunch: what the saved settings say, or the choices if none are saved, the one tick, and List. */
import type { Dispatch, SetStateAction } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import type { PickupWindow, SellerHandover } from "@/lib/declutter/api";
import { BUNCH_SECONDS_EACH, bunchListingMinutes, type BunchItem, type PhotoProgress } from "@/lib/declutter/bunch";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { Switch } from "@/components/ui/switch";
import { BunchChoicesCard, type useBunchChoices } from "./BunchChoices";
import { DROPS_SWITCH_LABEL } from "./sellForm";
import { bunchDropsValue, makeFreeValue, SellingSettingsRows, usePickupLines } from "./SellingSettingsRows";
import { SellProgress, bunchItemSteps } from "./SellProgress";
import { BunchSection } from "./DeclutterBunchSection";
import { PickupTimesEditor, pickupWindowsProblem } from "./DeclutterPickupTimes";
import { SellHandoverChoices } from "./SellHandoverChoices";
import { TaxStatementsCheck } from "./declutterUi";
import type { useSavedPickup } from "./useSavedPickup";

/** "Takes about 1 minute. Keep this page open." (15 seconds for one item.) */
function bunchTimeLine(count: number): string {
  const min = bunchListingMinutes(count);
  const time = count <= 1 ? `${BUNCH_SECONDS_EACH} seconds` : `${min} ${min === 1 ? "minute" : "minutes"}`;
  return `Takes about ${time}. Keep this page open.`;
}

export function BunchListStep({ step, items, pricedDraftsOffered, readyCount, heldForFee, savedSetup, savedWindows, savedWays, windows, setWindows, choices, ways, setWays, sellerDeliveryOpen, attested, setAttested, problem, blocked, listing, photoProgress, listingProgress = null, runNames = [], onList }: {
  step: number;
  items: BunchItem[];
  /** The one tick also covers the saved drafts, so a priced one on offer means the four statements, even if every item here is free. */
  pricedDraftsOffered: boolean;
  readyCount: number;
  heldForFee: number;
  savedSetup: ReturnType<typeof useSavedPickup>;
  savedWindows: UseQueryResult<unknown[]>;
  savedWays: SellerHandover[];
  windows: PickupWindow[];
  setWindows: Dispatch<SetStateAction<PickupWindow[]>>;
  choices: ReturnType<typeof useBunchChoices>;
  ways: SellerHandover[];
  setWays: Dispatch<SetStateAction<SellerHandover[]>>;
  sellerDeliveryOpen: boolean;
  attested: boolean;
  setAttested: (on: boolean) => void;
  problem: string | null;
  blocked: boolean;
  listing: boolean;
  photoProgress: PhotoProgress | null;
  /** The run's progress and its items' names, for the in-progress view. */
  listingProgress?: { done: number; total: number } | null;
  runNames?: readonly string[];
  onList: () => void;
}) {
  const anyPriced = items.some((it) => !it.free);
  const pickup = usePickupLines(savedWays, savedSetup.pickup?.areaLabel ?? "", windows);
  return (
    <>
      <span id="bunch-list-step" tabIndex={-1} className="block focus:outline-none" />
      <BunchSection id="bunch-list" title={`${step}. List ${readyCount} ${readyCount === 1 ? "item" : "items"}`}>
          {savedSetup.hasSettings && savedWindows.isSuccess && savedWays.length > 0 && !pickupWindowsProblem(windows) ? (
            // The seller's settings as the summary's rows, the same as Sell one's (owner 2026-11-01), with ONE Change (to
            // Settings). LEAD-BUNCH-PCT-LABEL (owner 2026-10-31): price drops can still be switched for this bunch alone,
            // by the switch in its row (remembered, as every choice made here).
            <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card" data-bunch-list-saved="">
              <SellingSettingsRows
                pickup={pickup}
                drops={anyPriced ? bunchDropsValue(choices.choices) : null}
                // Sell a bunch never sets "make it free" on what it lists (only Sell one does): it is never, whatever is saved.
                makeFree={anyPriced ? makeFreeValue(null) : null}
                dropsControl={anyPriced ? (
                  <Switch aria-label={`${DROPS_SWITCH_LABEL} for this bunch`} checked={choices.choices.drops} onCheckedChange={(v) => choices.set({ drops: v === true })} data-bunch-drops={choices.choices.drops ? "on" : "off"} />
                ) : undefined}
              />
            </ul>
          ) : (<>
          <h3 className="text-sm font-semibold">Your usual pickup times</h3>
          <p className="text-xs text-muted-foreground">Buyers pick one of these times. They apply to all your listings.</p>
          {savedWindows.isError ? (
            <ErrorState variant="inline" title="We couldn't load your pickup times." body={declutterErrorMessage(savedWindows.error)} onRetry={() => void savedWindows.refetch()} />
          ) : savedWindows.isSuccess ? (
            <PickupTimesEditor windows={windows} setWindows={setWindows} />
          ) : (
            <p className="text-sm text-muted-foreground" role="status">Loading your pickup times…</p>
          )}
          <BunchChoicesCard c={choices} anyPriced={items.some((it) => !it.free)} />
          <h3 className="pt-2 text-sm font-semibold">How buyers can get them</h3>
          <SellHandoverChoices ways={ways} setWays={setWays} free={false} sellerDeliveryOpen={sellerDeliveryOpen} pickupDays={windows.map((w) => w.weekday)} />
          </>)}
          {items.some((it) => it.free) && <p className="text-xs text-muted-foreground" data-bunch-free-note="">Free items are claimed, not bought: no offers and no price drops, and they're picked up from your porch.</p>}
          <h3 className="pt-2 text-sm font-semibold">Confirm about these items</h3>
          <p className="text-xs text-muted-foreground">Louisiana doesn't charge sales tax on occasional sales of your own things. One tick covers every item and saved draft you list now.</p>
          <TaxStatementsCheck id="bunch-tax" checked={attested} onChange={setAttested} free={items.every((it) => it.free) && !pricedDraftsOffered} />
          {heldForFee > 0 && <p className="text-sm" data-bunch-fee-held="">{heldForFee} priced {heldForFee === 1 ? "item waits" : "items wait"} for the setup fee above. {heldForFee === 1 ? "It stays" : "They stay"} on this list.</p>}
          {problem && <p className="text-sm text-destructive-ink" role="alert" data-bunch-problem-list="">{problem}</p>}
          {/* Owner 2026-11-01: each item's progress while the run works (Uploading photos -> Checking -> Live). */}
          {listing && listingProgress && (
            <SellProgress title={`Listing ${readyCount} ${readyCount === 1 ? "item" : "items"}…`}
              rows={bunchItemSteps(listingProgress.done, listingProgress.total).map((step, i) => ({ name: runNames[i]?.trim() || `Item ${i + 1}`, step }))} />
          )}
          <Button type="button" disabled={blocked || readyCount === 0 || !savedWindows.isSuccess} onClick={onList}>
            {listing ? "Listing…" : `List ${readyCount} ${readyCount === 1 ? "item" : "items"}`}
          </Button>
          {listing && photoProgress && (
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite" data-bunch-photo-progress="">
              Sending photo {photoProgress.photo} of {photoProgress.of}{photoProgress.itemName ? ` (${photoProgress.itemName})` : ""}.{photoProgress.retrying ? " The connection dropped, so we're trying again." : ""}
            </p>
          )}
          {/* One line (owner 2026-11-01): how long, honestly (audit finding 3: never "a few seconds each"), and to stay. */}
          <p className="text-xs text-muted-foreground" data-bunch-time="">{bunchTimeLine(readyCount)}</p>
      </BunchSection>
    </>
  );
}
