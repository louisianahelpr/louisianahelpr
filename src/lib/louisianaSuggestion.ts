/**
 * Deep audit 11-22 #25: address search offered out-of-state addresses first, then refused them. Typing
 * "200 Jefferson St Lafayette" listed Lafayette, Oregon at the top; picking it showed "Helpr works in Louisiana only"
 * and Continue stayed off. MapKit's search region only BIASES results toward Louisiana, so the suggestion list drops
 * any result whose display lines name another US state (by its postal code or its name), or another country, before
 * it is shown. A suggestion that names no state is kept: the pick is still checked downstream (AddressBlock,
 * SellerAddressField refuse a non-Louisiana state).
 */

const OTHER_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR",
]);

const OTHER_STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Maine", "Maryland", "Massachusetts",
  "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania",
  "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
  "West Virginia", "Wisconsin", "Wyoming", "Puerto Rico",
];
const OTHER_STATE_NAME = new RegExp(`(?:^|,)\\s*(?:${OTHER_STATE_NAMES.join("|")})\\b`);

/** True unless the suggestion's place lines say it is outside Louisiana. `displayLines[0]` is the street or name. */
export function isLouisianaSuggestion(displayLines: readonly string[]): boolean {
  const place = displayLines.slice(1).join(", ");
  if (!place.trim()) return true;
  // "Lafayette, OR 97127", "Lafayette, OR, United States": a state code after a comma.
  for (const m of place.matchAll(/,\s*([A-Z]{2})(?=\s+\d{5}|\s*,|\s*$)/g)) {
    if (m[1] === "LA") return true;
    if (OTHER_STATE_CODES.has(m[1])) return false;
  }
  if (/\bLouisiana\b/.test(place)) return true;
  if (OTHER_STATE_NAME.test(place)) return false;
  // Another country named last ("Lafayette, Canada"): only the United States is served.
  const country = place.split(",").map((s) => s.trim()).filter(Boolean).pop() ?? "";
  if (/^(United States|USA|US)$/i.test(country)) return true;
  return !/^(Canada|Mexico|France|United Kingdom|Belgium|Switzerland|Australia)$/i.test(country);
}
