// Canonical Louisiana parish registry: display name, URL-safe slug and member
// cities for all 64 parishes.
//
// Used by the admin social-post composer to tag a post with the parish it is
// about, and cited by the `/lh-marketing` agent team as the authority for
// Louisiana place names in copy.
//
// ── DERIVED, NOT HAND-TYPED ───────────────────────────────────────────────
// Every field was generated from the zip→parish seed in
// 20260418042714_*.sql — the same table `get_parish_for_zip` reads, and
// therefore the same strings that end up in `jobs.parish` and
// `profiles.parish`. That matters because `marketing_content.parish` is stored
// as this bare stem: a value that drifts from what the database writes joins to
// nothing, and reads as a market with no activity rather than as a bug.
// `parishes.test.ts` re-derives this list from that migration on every run and
// fails on any drift — the test reads the world, it does not check the list
// against itself.
//
// `name` is the exact DB string and has NO "Parish" suffix ("Orleans", not
// "Orleans Parish"). Store `name`; render `parishLabel()`.
//
// `primaryCity` is the city with the most ZIPs in the seed, NOT the legal
// parish seat — St. Tammany's seat is Covington while its largest seeded city
// is Slidell. Fine for "near you" copy; never cite it as civic fact.
//
// `slug` exists to give each parish a stable, URL-safe key. There are no
// /parish/* routes in this app and none are planned; an earlier version of
// this file was written for landing pages that were never built.

export interface Parish {
  /** Exact value stored in `jobs.parish` / `profiles.parish`. No suffix. */
  readonly name: string;
  /** URL segment for /parish/:slug. Unique across all 64. */
  readonly slug: string;
  /** Largest seeded city by ZIP count — NOT the legal parish seat. */
  readonly primaryCity: string;
  /** Seeded cities, most ZIPs first. */
  readonly cities: readonly string[];
  /** How many ZIPs the seed maps to this parish. A rough market-size proxy. */
  readonly zipCount: number;
}

export const PARISHES: readonly Parish[] = [
  { name: "Orleans", slug: "orleans", primaryCity: "New Orleans", cities: ["New Orleans"], zipCount: 17 },
  { name: "East Baton Rouge", slug: "east-baton-rouge", primaryCity: "Baton Rouge", cities: ["Baton Rouge"], zipCount: 16 },
  { name: "Caddo", slug: "caddo", primaryCity: "Shreveport", cities: ["Shreveport", "Greenwood"], zipCount: 12 },
  { name: "Jefferson", slug: "jefferson", primaryCity: "Metairie", cities: ["Metairie", "Gretna", "Kenner", "Harvey", "Marrero", "Westwego"], zipCount: 12 },
  { name: "St. Tammany", slug: "st-tammany", primaryCity: "Slidell", cities: ["Slidell", "Covington", "Mandeville", "Folsom", "Lacombe", "Madisonville"], zipCount: 10 },
  { name: "Lafayette", slug: "lafayette", primaryCity: "Lafayette", cities: ["Lafayette", "Broussard", "Carencro", "Scott", "Youngsville"], zipCount: 9 },
  { name: "Calcasieu", slug: "calcasieu", primaryCity: "Lake Charles", cities: ["Lake Charles", "Sulphur", "DeQuincy"], zipCount: 8 },
  { name: "Livingston", slug: "livingston", primaryCity: "Denham Springs", cities: ["Denham Springs", "Holden", "Livingston", "Maurepas", "Springfield", "Walker"], zipCount: 8 },
  { name: "Tangipahoa", slug: "tangipahoa", primaryCity: "Hammond", cities: ["Hammond", "Amite", "Husser", "Independence", "Kentwood", "Ponchatoula"], zipCount: 7 },
  { name: "Bossier", slug: "bossier", primaryCity: "Bossier City", cities: ["Bossier City", "Benton", "Haughton", "Plain Dealing"], zipCount: 6 },
  { name: "Ouachita", slug: "ouachita", primaryCity: "Monroe", cities: ["Monroe", "West Monroe", "Calhoun"], zipCount: 6 },
  { name: "St. Charles", slug: "st-charles", primaryCity: "Boutte", cities: ["Boutte", "Des Allemands", "Destrehan", "Hahnville", "Luling", "Norco"], zipCount: 6 },
  { name: "Ascension", slug: "ascension", primaryCity: "Burnside", cities: ["Burnside", "Donaldsonville", "Gonzales", "Prairieville", "Sorrento"], zipCount: 5 },
  { name: "Lafourche", slug: "lafourche", primaryCity: "Galliano", cities: ["Galliano", "Golden Meadow", "Lockport", "Raceland", "Thibodaux"], zipCount: 5 },
  { name: "Rapides", slug: "rapides", primaryCity: "Alexandria", cities: ["Alexandria", "Pineville"], zipCount: 5 },
  { name: "St. Bernard", slug: "st-bernard", primaryCity: "Arabi", cities: ["Arabi", "Chalmette", "Meraux", "St. Bernard", "Violet"], zipCount: 5 },
  { name: "Vernon", slug: "vernon", primaryCity: "Leesville", cities: ["Leesville", "Fort Polk", "Pitkin", "Simpson"], zipCount: 5 },
  { name: "Concordia", slug: "concordia", primaryCity: "Acme", cities: ["Acme", "Ferriday", "Vidalia", "Wildsville"], zipCount: 4 },
  { name: "Lincoln", slug: "lincoln", primaryCity: "Ruston", cities: ["Ruston", "Grambling", "Simsboro"], zipCount: 4 },
  { name: "Morehouse", slug: "morehouse", primaryCity: "Bastrop", cities: ["Bastrop", "Bonita", "Collinston", "Mer Rouge"], zipCount: 4 },
  { name: "St. John the Baptist", slug: "st-john-the-baptist", primaryCity: "Edgard", cities: ["Edgard", "Garyville", "LaPlace", "Reserve"], zipCount: 4 },
  { name: "St. Landry", slug: "st-landry", primaryCity: "Opelousas", cities: ["Opelousas", "Arnaudville", "Eunice"], zipCount: 4 },
  { name: "Webster", slug: "webster", primaryCity: "Cotton Valley", cities: ["Cotton Valley", "Dubberly", "Minden", "Sibley"], zipCount: 4 },
  { name: "Acadia", slug: "acadia", primaryCity: "Crowley", cities: ["Crowley", "Estherwood", "Rayne"], zipCount: 3 },
  { name: "Allen", slug: "allen", primaryCity: "Elizabeth", cities: ["Elizabeth", "Kinder", "Leblanc"], zipCount: 3 },
  { name: "Assumption", slug: "assumption", primaryCity: "Belle Rose", cities: ["Belle Rose", "Napoleonville", "Pierre Part"], zipCount: 3 },
  { name: "Bienville", slug: "bienville", primaryCity: "Bienville", cities: ["Bienville", "Castor", "Ringgold"], zipCount: 3 },
  { name: "Cameron", slug: "cameron", primaryCity: "Cameron", cities: ["Cameron", "Grand Chenier", "Hackberry"], zipCount: 3 },
  { name: "DeSoto", slug: "desoto", primaryCity: "Frierson", cities: ["Frierson", "Keatchie", "Mansfield"], zipCount: 3 },
  { name: "Evangeline", slug: "evangeline", primaryCity: "Mamou", cities: ["Mamou", "Pine Prairie", "Ville Platte"], zipCount: 3 },
  { name: "Iberia", slug: "iberia", primaryCity: "New Iberia", cities: ["New Iberia", "Jeanerette"], zipCount: 3 },
  { name: "Jefferson Davis", slug: "jefferson-davis", primaryCity: "Jennings", cities: ["Jennings", "Lake Arthur", "Welsh"], zipCount: 3 },
  { name: "Natchitoches", slug: "natchitoches", primaryCity: "Campti", cities: ["Campti", "Natchitoches", "Robeline"], zipCount: 3 },
  { name: "Plaquemines", slug: "plaquemines", primaryCity: "Belle Chasse", cities: ["Belle Chasse", "Port Sulphur", "Venice"], zipCount: 3 },
  { name: "Richland", slug: "richland", primaryCity: "Delhi", cities: ["Delhi", "Mangham", "Rayville"], zipCount: 3 },
  { name: "St. Mary", slug: "st-mary", primaryCity: "Morgan City", cities: ["Morgan City", "Franklin"], zipCount: 3 },
  { name: "Terrebonne", slug: "terrebonne", primaryCity: "Houma", cities: ["Houma"], zipCount: 3 },
  { name: "Winn", slug: "winn", primaryCity: "Calvin", cities: ["Calvin", "Sikes", "Winnfield"], zipCount: 3 },
  { name: "Avoyelles", slug: "avoyelles", primaryCity: "Bunkie", cities: ["Bunkie", "Marksville"], zipCount: 2 },
  { name: "Caldwell", slug: "caldwell", primaryCity: "Columbia", cities: ["Columbia", "Grayson"], zipCount: 2 },
  { name: "Catahoula", slug: "catahoula", primaryCity: "Jonesville", cities: ["Jonesville", "Sicily Island"], zipCount: 2 },
  { name: "East Carroll", slug: "east-carroll", primaryCity: "Lake Providence", cities: ["Lake Providence", "Transylvania"], zipCount: 2 },
  { name: "East Feliciana", slug: "east-feliciana", primaryCity: "Clinton", cities: ["Clinton", "Jackson"], zipCount: 2 },
  { name: "Franklin", slug: "franklin", primaryCity: "Fort Necessity", cities: ["Fort Necessity", "Winnsboro"], zipCount: 2 },
  { name: "Iberville", slug: "iberville", primaryCity: "Plaquemine", cities: ["Plaquemine", "White Castle"], zipCount: 2 },
  { name: "Pointe Coupee", slug: "pointe-coupee", primaryCity: "Fordoche", cities: ["Fordoche", "New Roads"], zipCount: 2 },
  { name: "Sabine", slug: "sabine", primaryCity: "Florien", cities: ["Florien", "Many"], zipCount: 2 },
  { name: "St. Helena", slug: "st-helena", primaryCity: "Greensburg", cities: ["Greensburg", "Pine Grove"], zipCount: 2 },
  { name: "St. Martin", slug: "st-martin", primaryCity: "Breaux Bridge", cities: ["Breaux Bridge", "St. Martinville"], zipCount: 2 },
  { name: "Tensas", slug: "tensas", primaryCity: "St. Joseph", cities: ["St. Joseph", "Waterproof"], zipCount: 2 },
  { name: "Union", slug: "union", primaryCity: "Farmerville", cities: ["Farmerville", "Spearsville"], zipCount: 2 },
  { name: "Vermilion", slug: "vermilion", primaryCity: "Abbeville", cities: ["Abbeville", "Kaplan"], zipCount: 2 },
  { name: "Washington", slug: "washington", primaryCity: "Bogalusa", cities: ["Bogalusa", "Franklinton"], zipCount: 2 },
  { name: "Beauregard", slug: "beauregard", primaryCity: "DeRidder", cities: ["DeRidder"], zipCount: 1 },
  { name: "Claiborne", slug: "claiborne", primaryCity: "Homer", cities: ["Homer"], zipCount: 1 },
  { name: "Grant", slug: "grant", primaryCity: "Pollock", cities: ["Pollock"], zipCount: 1 },
  { name: "Jackson", slug: "jackson", primaryCity: "Jonesboro", cities: ["Jonesboro"], zipCount: 1 },
  { name: "LaSalle", slug: "lasalle", primaryCity: "Jena", cities: ["Jena"], zipCount: 1 },
  { name: "Madison", slug: "madison", primaryCity: "Tallulah", cities: ["Tallulah"], zipCount: 1 },
  { name: "Red River", slug: "red-river", primaryCity: "Coushatta", cities: ["Coushatta"], zipCount: 1 },
  { name: "St. James", slug: "st-james", primaryCity: "St. James", cities: ["St. James"], zipCount: 1 },
  { name: "West Baton Rouge", slug: "west-baton-rouge", primaryCity: "Port Allen", cities: ["Port Allen"], zipCount: 1 },
  { name: "West Carroll", slug: "west-carroll", primaryCity: "Oak Grove", cities: ["Oak Grove"], zipCount: 1 },
  { name: "West Feliciana", slug: "west-feliciana", primaryCity: "St. Francisville", cities: ["St. Francisville"], zipCount: 1 },
];

/** Slug → parish. Built once; /parish/:slug resolves through this. */
const BY_SLUG: ReadonlyMap<string, Parish> = new Map(PARISHES.map((p) => [p.slug, p]));
/** DB name → parish, for turning a `jobs.parish` value into a link. */
const BY_NAME: ReadonlyMap<string, Parish> = new Map(PARISHES.map((p) => [p.name, p]));

export const parishBySlug = (slug: string | undefined): Parish | null =>
  slug ? (BY_SLUG.get(slug.toLowerCase()) ?? null) : null;

export const parishByName = (name: string | null | undefined): Parish | null =>
  name ? (BY_NAME.get(name) ?? null) : null;

/** City name (case-insensitive) → the parish that lists it, for the small set
 * of cities this registry actually names. Used only for a soft "does this
 * ZIP match the city you typed" sanity check at signup/profile-edit — NOT
 * exhaustive (the registry only lists a handful of cities per parish; a
 * small town missing from it returns null, not "no parish"), so callers
 * must never treat a null result as evidence of a mismatch, only a match
 * against a DIFFERENT parish as evidence.
 *
 * A city listed under more than one parish (e.g. "Robeline" appears in both
 * Sabine's and Natchitoches's seeded city lists — a real border town, not a
 * data bug) is deliberately excluded rather than assigned to whichever
 * parish iterates last: silently picking one would flag a false mismatch
 * for every real resident of the OTHER parish it's also listed under. */
const AMBIGUOUS_CITY_MARKER = Symbol("ambiguous city — listed under multiple parishes");
const BY_CITY_LOWER: ReadonlyMap<string, Parish | typeof AMBIGUOUS_CITY_MARKER> = (() => {
  const map = new Map<string, Parish | typeof AMBIGUOUS_CITY_MARKER>();
  for (const p of PARISHES) {
    for (const c of p.cities) {
      const key = c.toLowerCase();
      const existing = map.get(key);
      if (existing && existing !== p) {
        map.set(key, AMBIGUOUS_CITY_MARKER);
      } else {
        map.set(key, p);
      }
    }
  }
  return map;
})();

export const parishForCity = (city: string | null | undefined): Parish | null => {
  if (!city) return null;
  const found = BY_CITY_LOWER.get(city.trim().toLowerCase());
  return found && found !== AMBIGUOUS_CITY_MARKER ? found : null;
};

/**
 * Human-facing name. Louisiana calls them parishes, not counties, and the DB
 * stores the bare stem — so every rendered string adds the word here rather
 * than each caller remembering to.
 */
export const parishLabel = (parish: Parish): string => `${parish.name} Parish`;
