/**
 * Real Louisiana addresses for seeded jobs, and the predicate that decides
 * whether a `jobs.location` is one.
 *
 * DEPENDENCY-FREE ON PURPOSE. `scripts/probes/lib/prodEnv.mjs` reads `.env` at
 * import time and throws without it, so anything that imports it cannot be
 * loaded by a test. This file is the half `src/test/seedFixtureAddressRealism.test.ts`
 * imports; `../seed-job-address-realism.prod.mjs` adds the network.
 *
 * WHY (owner, 2026-09-19): "When i click directions, it gives directions to the
 * town but not the actual address." Every seed generator wrote a town into
 * `jobs.location`, so 210 of 257 seeded jobs on prod held "Lafayette, LA" and
 * Directions landed in the middle of Lafayette. The app was correct throughout
 * — the fixture was not.
 */

/**
 * The same predicate `hasStreetAddress()` uses in
 * `src/components/activity/appliedJobCard/JobAddressLine.tsx`: a digit in the
 * first comma-segment, and at least one comma.
 *
 * Transcribed rather than imported — this is plain ESM run by node, and the
 * component is TSX behind Vite's `@/` alias — and the guard asserts the two
 * answer identically over a table of cases, so the copy cannot drift into
 * promising something the card does not print.
 */
export function hasStreetAddress(location) {
  const s = location ?? "";
  const first = s.split(",")[0]?.trim() ?? "";
  return /\d/.test(first) && s.includes(",");
}

/** "215 E Main St, New Iberia, LA 70560" -> "New Iberia, LA" */
export function cityKey(location) {
  const parts = (location ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  // Last two segments with any ZIP stripped off the state — the same shape
  // `public.mask_job_location()` produces, so a masked town and a full address
  // key to the same city.
  const state = parts[parts.length - 1].replace(/\s*\d{5}(-\d{4})?\s*$/, "").trim();
  return `${parts[parts.length - 2]}, ${state}`;
}

/**
 * Keyed by the town a row already claims, so a repair NEVER moves a job to a
 * different city — a Lafayette street on New Orleans coordinates would trade a
 * wrong address for a more convincing one. Several per city so 124 Lafayette
 * fixtures do not all land on one doorstep, and (because the pin moves with the
 * address) so the browse map stops stacking every pin on one point.
 *
 * Each entry is `[address, latitude, longitude]` and the coordinates are that
 * address's own point, not a city centroid. The first entry of a city is the
 * address that city's generator writes, so the catalogue and the generators
 * never disagree about what a real address in that town looks like.
 */
export const ADDRESSES = {
  "Lafayette, LA": [
    ["2000 Johnston St, Lafayette, LA 70503", 30.2103, -92.0308],
    ["412 Guilbeau Rd, Lafayette, LA 70506", 30.2241, -92.0198],
    ["1103 Kaliste Saloom Rd, Lafayette, LA 70508", 30.1832, -92.0264],
    ["315 E Vermilion St, Lafayette, LA 70501", 30.2213, -92.0154],
  ],
  "Baton Rouge, LA": [
    ["4412 Highland Rd, Baton Rouge, LA 70808", 30.4028, -91.1714],
    ["7420 Jefferson Hwy, Baton Rouge, LA 70806", 30.4459, -91.1275],
    ["1820 Perkins Rd, Baton Rouge, LA 70808", 30.4141, -91.1403],
    ["2351 Government St, Baton Rouge, LA 70806", 30.4432, -91.1595],
  ],
  "New Orleans, LA": [
    ["3419 Magazine St, New Orleans, LA 70115", 29.9273, -90.0879],
    ["1201 Camp St, New Orleans, LA 70130", 29.9377, -90.0713],
    ["4600 Freret St, New Orleans, LA 70115", 29.9331, -90.1042],
    ["2372 St Claude Ave, New Orleans, LA 70117", 29.9646, -90.0435],
  ],
  "New Iberia, LA": [
    ["215 E Main St, New Iberia, LA 70560", 30.0035, -91.8187],
    ["1103 Center St, New Iberia, LA 70560", 30.0091, -91.8265],
  ],
  "Shreveport, LA": [["3505 Line Ave, Shreveport, LA 71104", 32.4771, -93.7523]],
  "Lake Charles, LA": [["1011 Ryan St, Lake Charles, LA 70601", 30.221, -93.2174]],
  "Houma, LA": [["1418 St Charles St, Houma, LA 70360", 29.5936, -90.7268]],
  "Alexandria, LA": [["1125 Jackson St, Alexandria, LA 71301", 31.305, -92.452]],
  "Gonzales, LA": [["905 W Cornerview St, Gonzales, LA 70737", 30.2388, -90.9201]],
  "Denham Springs, LA": [["2140 Range Ave, Denham Springs, LA 70726", 30.4855, -90.9573]],
};

/**
 * Louisiana's bounding box, rounded outward — 28.85..33.05 N, -94.10..-88.70 W.
 * A pair outside it is not a plausible pairing for an address in this state,
 * whatever the street says.
 */
export const LOUISIANA_BBOX = { minLat: 28.85, maxLat: 33.05, minLng: -94.1, maxLng: -88.7 };

export const inLouisiana = (lat, lng) =>
  lat >= LOUISIANA_BBOX.minLat && lat <= LOUISIANA_BBOX.maxLat &&
  lng >= LOUISIANA_BBOX.minLng && lng <= LOUISIANA_BBOX.maxLng;
