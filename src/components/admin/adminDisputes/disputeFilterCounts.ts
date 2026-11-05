/**
 * The Open queue's age / party / category filters and each chip's count. Moved out of
 * AdminDisputes.tsx unchanged (component size limit, Q806). Pure: no reads, no writes.
 */
import { categoriseReason } from "./adminDisputesHelpers";
import { isUnsettled } from "./unsettled";
import type { DisputedJob, DisputeRecord, AgeFilter, PartyFilter, CategoryFilter } from "./types";

export function disputeFilterCounts({ disputes, disputeRecords, ageFilter, partyFilter, categoryFilter }: {
  disputes: DisputedJob[];
  disputeRecords: Record<string, DisputeRecord>;
  ageFilter: AgeFilter;
  partyFilter: PartyFilter;
  categoryFilter: CategoryFilter;
}) {
  const passesAge = (j: DisputedJob, age: AgeFilter = ageFilter): boolean => {
    // An unsettled settlement is never filtered out of the Open queue. It is
    // stuck money, not a case waiting on someone — hiding it behind an age or
    // category chip is how it stayed invisible in the first place.
    if (isUnsettled(disputeRecords[j.id])) return true;
    if (age === "all" || !j.disputed_at) return true;
    const hours = (Date.now() - new Date(j.disputed_at).getTime()) / 3600_000;
    if (age === "0-24h") return hours < 24;
    if (age === "1-7d") return hours >= 24 && hours < 24 * 7;
    if (age === "7-30d") return hours >= 24 * 7 && hours < 24 * 30;
    if (age === ">30d") return hours >= 24 * 30;
    return true;
  };
  const passesParty = (j: DisputedJob, party: PartyFilter = partyFilter): boolean => {
    if (isUnsettled(disputeRecords[j.id])) return true;
    if (party === "all" || !j.disputed_by) return true;
    if (party === "poster") return j.disputed_by === j.customer_id;
    if (party === "helper") return !!j.helper_id && j.disputed_by === j.helper_id;
    return true;
  };
  const passesCategory = (j: DisputedJob, category: CategoryFilter = categoryFilter): boolean => {
    if (isUnsettled(disputeRecords[j.id])) return true;
    if (category === "all") return true;
    const reason = disputeRecords[j.id]?.reason ?? j.dispute_reason;
    return categoriseReason(reason) === category;
  };

  // Computed for the Open queue regardless of which tab is active, because the
  // Open TAB COUNT is rendered from it. The count used to come from raw
  // `disputes.length`, so filtering to one row still showed "Open (8)" — a tab
  // describing a list the admin cannot see. The Users view already gets this
  // right (AdminUsers.tsx renders `filtered.length`); this makes Disputes match.
  const openFiltered = disputes.filter((j) => passesAge(j) && passesParty(j) && passesCategory(j));
  // Owner 2026-10-27: every chip carries the number of open disputes it would
  // list, with the other two groups' current choices applied (as the list is).
  const ageCount = (age: AgeFilter) => disputes.filter((j) => passesAge(j, age) && passesParty(j) && passesCategory(j)).length;
  const partyCount = (party: PartyFilter) => disputes.filter((j) => passesAge(j) && passesParty(j, party) && passesCategory(j)).length;
  const categoryCount = (category: CategoryFilter) => disputes.filter((j) => passesAge(j) && passesParty(j) && passesCategory(j, category)).length;
  const filtersActive = ageFilter !== "all" || partyFilter !== "all" || categoryFilter !== "all";
  return { openFiltered, ageCount, partyCount, categoryCount, filtersActive };
}
