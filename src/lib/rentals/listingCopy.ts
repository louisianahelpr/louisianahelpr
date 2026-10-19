/**
 * Homes -> Rent listings: the fixed choices and their words. Pure, no I/O.
 * Every list here mirrors a CHECK in 20261019043000_rentals_listings.sql
 * (src/test/rentalsListingCopy.test.ts pins both ways). There is no choice
 * about WHO may live in a home (fair housing, spec 6a): only facts about it.
 */
export const RENT_FREQUENCY_LABEL: Record<string, string> = { monthly: "month", biweekly: "2 weeks", weekly: "week" };

export const PETS_LABEL: Record<string, string> = {
  none: "No pets",
  cats: "Cats OK",
  dogs: "Dogs OK",
  cats_dogs: "Cats and dogs OK",
  ask: "Ask about pets",
};

/** Q62: assistance animals are not pets; a "No pets" home says so on its page. */
export const ASSISTANCE_ANIMALS_LINE = "Assistance animals are welcome. They are not pets, and no pet fee applies.";

export const PARKING_LABEL: Record<string, string> = {
  none: "No parking",
  street: "Street parking",
  driveway: "Driveway",
  garage: "Garage",
  lot: "Parking lot",
};

export const UTILITY_LABEL: Record<string, string> = {
  water: "Water",
  sewer: "Sewer",
  trash: "Trash",
  electricity: "Electricity",
  gas: "Gas",
  internet: "Internet",
  lawn_care: "Lawn care",
};

/** Q63: facts about the home's access, never about a person. */
export const ACCESSIBILITY_LABEL: Record<string, string> = {
  step_free_entrance: "Step-free entrance",
  ground_floor: "Ground floor",
  elevator: "Elevator",
  wide_doorways: "Wide doorways",
  roll_in_shower: "Roll-in shower",
  grab_bars: "Grab bars",
  accessible_parking: "Accessible parking",
};

/** Q61: Yes or Ask, never No. */
export const VOUCHERS_LABEL: Record<string, string> = { yes: "Housing vouchers accepted", ask: "Ask about housing vouchers" };

const LISTING_STATUS_LABEL: Record<string, string> = {
  draft: "Draft, not showing",
  live: "Showing",
  paused: "Paused, not showing",
  leased: "Rented",
  sold: "Sold",
  removed: "Removed",
};

/** A live listing past its 30 days (Q64) is not showing: the landlord renews it. */
export function listingShowing(status: string, expiresAt: string | null, now = Date.now()): boolean {
  return status === "live" && !!expiresAt && new Date(expiresAt).getTime() > now;
}

export function listingStatusLabel(status: string, expiresAt: string | null, now = Date.now()): string {
  if (status === "live" && !listingShowing(status, expiresAt, now)) return "Expired, renew to show it again";
  return LISTING_STATUS_LABEL[status] ?? status;
}

export function rentLine(cents: number, frequency: string): string {
  const dollars = (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 });
  return `${dollars} / ${RENT_FREQUENCY_LABEL[frequency] ?? frequency}`;
}

/** A sale price, whole dollars: "$245,000". */
export function priceLine(cents: number): string {
  return (Number(cents) / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * Homes -> Buy, said on every for-sale page (owner 2026-10-18): the owner
 * lists it, nobody takes a commission, and a title company or attorney
 * handles the closing. Never words about offers or negotiating.
 */
export const SALE_HOW_IT_WORKS = "Listed by its verified owner. No commission. A title company or attorney handles the closing.";

export function bedsBathsLine(beds: number, baths: number): string {
  const b = Number(beds);
  const bedText = b === 0 ? "Studio" : `${b} bed${b === 1 ? "" : "s"}`;
  const ba = Number(baths);
  return `${bedText} · ${ba} bath${ba === 1 ? "" : "s"}`;
}

/** The ISO date (YYYY-MM-DD) as a short Central-time-free date: dates have no time zone. */
export function availableLine(isoDate: string, today = new Date()): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const when = new Date(Date.UTC(y, m - 1, d));
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (when.getTime() <= todayUtc) return "Available now";
  return `Available ${when.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })}`;
}
