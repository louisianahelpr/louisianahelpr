import type { SectionMineMenu } from "@/components/sections/sectionMine";
import type { MaintenanceRequest } from "@/lib/rentals/api";

/** Homes' own lists: one word each, Browse always first (owner, 2026-10-19). Desktop: the tabs row; phone: "My Homes". */
export const HOMES_TABS = [
  { value: "rent", label: "Renting" },
  { value: "own", label: "Owning" },
] as const;
export const HOMES_TAB_VALUES = HOMES_TABS.map((t) => t.value);
/**
 * The phone's "My Homes" sheet under the photo (the Vinted header, owner 11-08). Owning carries the repair requests
 * waiting for my answer as the landlord (Owning's "Needs you" box: submitted, landlord_id = me), from the page's own
 * rentals-home read; Renting has nothing waiting on the member.
 */
export function myHomes(requests: readonly MaintenanceRequest[] | undefined, uid: string): SectionMineMenu {
  const ownNeeds = requests ? requests.filter((r) => r.landlord_id === uid && r.status === "submitted").length : undefined;
  return { title: "My Homes", items: HOMES_TABS.map((t) => ({ key: t.value, label: t.label, to: `/rentals?tab=${t.value}`, count: t.value === "own" ? ownNeeds : undefined })) };
}
export const RENT_GROUPS = ["waiting", "approved", "closed"] as const;
export const OWN_GROUPS = ["needs", "repairs", "properties"] as const;
export const requestGroup = (r: MaintenanceRequest) => (r.status === "submitted" ? "waiting" : r.status === "approved" ? "approved" : "closed");
