/**
 * What a first-time seller still has to give before a listing goes up, and the one way it is saved. Shared by the
 * "Set up selling" screen in front of Sell a bunch and the moving sale (SellerSetup.tsx) and the one Sell screen, which
 * asks inline (FirstSalePickup.tsx, ease batch owner-approved 2026-11-20). Plain functions, no React.
 */
import type { QueryClient } from "@tanstack/react-query";
import { setPickupWindows, type PickupWindow } from "@/lib/declutter/api";
import { MY_PORCH_PLACES_KEY, saveMyPorchPlace } from "@/lib/declutter/porchPlaces";
import { SELLER_DEFAULTS, saveSellerDefaults, type SellerDefaults } from "@/lib/declutter/sellerDefaults";

/** What a seller still has to choose before posting. Pure, so the rule is tested on its own. */
export interface SetupNeeds {
  /** Asked: the pickup address. */
  pickup: boolean;
  /** Asked: the days and times buyers can come. */
  times: boolean;
  /** Never asked (F124): no saved selling settings yet, so SELLER_DEFAULTS are saved along with the answers above. */
  defaults: boolean;
}

export function setupNeeds(s: { hasPickup: boolean; hasWindows: boolean; hasSettings: boolean }): SetupNeeds {
  return {
    // No saved address, or none with an exact point (useSavedPickup never counts one without): asked here.
    pickup: !s.hasPickup,
    times: !s.hasWindows,
    defaults: !s.hasSettings,
  };
}

/** Only the two questions open the screen; missing settings alone never do (every read gives SELLER_DEFAULTS). */
export const anyNeeded = (n: SetupNeeds) => n.pickup || n.times;

/**
 * Saves what a first-time seller was missing, in the one order both places that ask use (SellerSetup.tsx, for Sell a bunch
 * and the moving sale; the one Sell screen asks inline, FirstSalePickup.tsx). The address is placed first, so a lookup
 * that can't place it writes nothing; after that each save is its own step, so a failure part way never asks again for
 * what already went through.
 */
export async function saveSellerSetup({ userId, needs, address, area, locate, windows, savedWindows, qc }: {
  userId: string;
  needs: SetupNeeds;
  address: string;
  area: string;
  locate: (address: string) => Promise<{ lat: number; lng: number }>;
  windows: PickupWindow[];
  savedWindows: PickupWindow[];
  qc: QueryClient;
}): Promise<void> {
  let pickup: { lat: number; lng: number; area: string } | null = null;
  if (needs.pickup) {
    const found = await locate(address);
    // The city from the pick, or as typed. An address with none says so; nothing is guessed.
    if (!area.trim()) throw new Error("setup_area");
    pickup = { lat: found.lat, lng: found.lng, area: area.trim() };
  }
  if (needs.defaults) {
    const defaults: SellerDefaults = { ...SELLER_DEFAULTS, acceptsTrades: false };
    await saveSellerDefaults(userId, defaults);
    await qc.invalidateQueries({ queryKey: ["declutter", "seller-defaults", userId] });
  }
  if (needs.times) {
    await setPickupWindows(windows);
    await qc.invalidateQueries({ queryKey: ["declutter", "windows", userId] });
  }
  if (pickup) {
    const days = [...new Set((needs.times ? windows : savedWindows).map((w) => w.weekday))];
    await saveMyPorchPlace({ id: null, label: "Home", address: address.trim(), area: pickup.area, lat: pickup.lat, lng: pickup.lng, weekdays: days });
    await qc.invalidateQueries({ queryKey: MY_PORCH_PLACES_KEY });
  }
}

