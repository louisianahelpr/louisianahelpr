/** The last step of Sell a bunch: what the saved settings say, or the choices if none are saved, the one tick, and List. */
import { useState, type Dispatch, type SetStateAction } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import type { PickupWindow, SellerHandover } from "@/lib/declutter/api";
import { BUNCH_SECONDS_EACH, bunchListingMinutes, type BunchItem, type PhotoProgress } from "@/lib/declutter/bunch";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { BunchChoicesCard, BunchDropsSwitch, bunchDropsLine, type useBunchChoices } from "./BunchChoices";
import { BunchSection } from "./DeclutterBunchSection";
import { PickupTimesEditor, pickupWindowsProblem, windowsSummary } from "./DeclutterPickupTimes";
import { handoverSummary, SellHandoverChoices } from "./SellHandoverChoices";
import { UsesSettingsNote } from "./SellLastSetup";
import { TaxStatementsCheck } from "./declutterUi";
import type { useSavedPickup } from "./useSavedPickup";

export function BunchListStep({ step, items, pricedDraftsOffered, readyCount, heldForFee, savedSetup, savedWindows, savedWays, windows, setWindows, choices, ways, setWays, sellerDeliveryOpen, attested, setAttested, problem, blocked, listing, photoProgress, onList }: {
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
  onList: () => void;
}) {
  // LEAD-BUNCH-PCT-LABEL (owner 2026-10-31): with saved settings the price-drops choice was only a line; it can be
  // changed here for this bunch (and is remembered, as every choice made here).
  const [changingDrops, setChangingDrops] = useState(false);
  return (
    <>
      <span id="bunch-list-step" tabIndex={-1} className="block focus:outline-none" />
      <BunchSection id="bunch-list" title={`${step}. List ${readyCount} ${readyCount === 1 ? "item" : "items"}`}>
          {savedSetup.hasSettings && savedWindows.isSuccess && savedWays.length > 0 && !pickupWindowsProblem(windows) ? (
            <div className="space-y-1" data-bunch-list-saved="">
              <p className="text-ds-15 font-semibold text-foreground [overflow-wrap:anywhere]">{[handoverSummary(savedWays), windowsSummary(windows)].filter(Boolean).join(" · ")}</p>
              {items.some((it) => !it.free) && (<>
                <p className="flex flex-wrap items-center gap-x-2 text-ds-14 text-foreground">
                  <span data-bunch-outcome="">{bunchDropsLine(choices.choices)}</span>
                  <Button type="button" variant="link" size="sm" className="px-0 font-semibold" aria-expanded={changingDrops} onClick={() => setChangingDrops((o) => !o)} data-bunch-change-drops="">
                    {changingDrops ? "Done" : "Change"}
                  </Button>
                </p>
                {changingDrops && <BunchDropsSwitch c={choices} />}
              </>)}
              {savedSetup.pickup && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]" data-saved-pickup="">{savedSetup.pickup.line}</p>}
              <UsesSettingsNote />
            </div>
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
          <Button type="button" disabled={blocked || readyCount === 0 || !savedWindows.isSuccess} onClick={onList}>
            {listing ? "Listing…" : `List ${readyCount} ${readyCount === 1 ? "item" : "items"}`}
          </Button>
          {listing && photoProgress && (
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite" data-bunch-photo-progress="">
              Sending photo {photoProgress.photo} of {photoProgress.of}{photoProgress.itemName ? ` (${photoProgress.itemName})` : ""}.{photoProgress.retrying ? " The connection dropped, so we're trying again." : ""}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Each item gets the same photo check and review as a single listing, so some may wait for a review first. Listing takes about {BUNCH_SECONDS_EACH} seconds each{readyCount > 1 ? `, so about ${bunchListingMinutes(readyCount)} ${bunchListingMinutes(readyCount) === 1 ? "minute" : "minutes"} for these` : ""}. Keep this page open and your phone unlocked until it's done.
          </p>
      </BunchSection>
    </>
  );
}
