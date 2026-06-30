// Canonical list of all 64 Louisiana parishes. Single source of truth for
// the parish directory grid (ParishesPage) and the slug → name resolver
// used by individual community pages (ParishPage). Names must match the
// values stored in the jobs `parish` column exactly (queries are
// case-insensitive via ilike, but spelling/punctuation must line up).
export const LOUISIANA_PARISH_NAMES = [
  "Acadia",
  "Allen",
  "Ascension",
  "Assumption",
  "Avoyelles",
  "Beauregard",
  "Bienville",
  "Bossier",
  "Caddo",
  "Calcasieu",
  "Caldwell",
  "Cameron",
  "Catahoula",
  "Claiborne",
  "Concordia",
  "DeSoto",
  "East Baton Rouge",
  "East Carroll",
  "East Feliciana",
  "Evangeline",
  "Franklin",
  "Grant",
  "Iberia",
  "Iberville",
  "Jackson",
  "Jefferson",
  "Jefferson Davis",
  "Lafayette",
  "Lafourche",
  "LaSalle",
  "Lincoln",
  "Livingston",
  "Madison",
  "Morehouse",
  "Natchitoches",
  "Orleans",
  "Ouachita",
  "Plaquemines",
  "Pointe Coupee",
  "Rapides",
  "Red River",
  "Richland",
  "Sabine",
  "St. Bernard",
  "St. Charles",
  "St. Helena",
  "St. James",
  "St. John the Baptist",
  "St. Landry",
  "St. Martin",
  "St. Mary",
  "St. Tammany",
  "Tangipahoa",
  "Tensas",
  "Terrebonne",
  "Union",
  "Vermilion",
  "Vernon",
  "Washington",
  "Webster",
  "West Baton Rouge",
  "West Carroll",
  "West Feliciana",
  "Winn",
] as const;

/**
 * Derives the URL slug for a parish name. Lowercases, drops periods, and
 * turns spaces into hyphens — e.g. "St. Tammany" → "st-tammany",
 * "East Baton Rouge" → "east-baton-rouge". Matches the slugs the parish
 * routes already used for the original eight featured parishes.
 */
export function parishSlug(name: string): string {
  return name.toLowerCase().replace(/\./g, "").replace(/\s+/g, "-");
}

export interface ParishEntry {
  name: string;
  slug: string;
}

export const LOUISIANA_PARISHES: ParishEntry[] = LOUISIANA_PARISH_NAMES.map(
  (name) => ({ name, slug: parishSlug(name) }),
);

/** slug → canonical parish name (as stored in the jobs `parish` column). */
export const PARISH_BY_SLUG: Record<string, string> = Object.fromEntries(
  LOUISIANA_PARISHES.map(({ slug, name }) => [slug, name]),
);
