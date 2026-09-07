// Canonical Louisiana parish registry: display name, URL-safe slug and member
// cities for all 64 parishes.
//
// Used by the admin social-post composer to tag a post with the parish it is
// about, and cited by the `/lh-marketing` agent team as the authority for
// Louisiana place names in copy.
//
// ── DERIVED, NOT HAND-TYPED ───────────────────────────────────────────────
// Every field was generated from the zip→parish migrations — the original seed
// (20260418042714), the 2026-09-04 correction (20260904211910) and the
// completion to all 720 Louisiana ZIPs (20260907051306) — i.e. from the same
// table `get_parish_for_zip` reads, and therefore the same strings that end up
// in `jobs.parish` and `profiles.parish`. That matters because
// `marketing_content.parish` is stored as this bare stem: a value that drifts
// from what the database writes joins to nothing, and reads as a market with no
// activity rather than as a bug. `parishes.test.ts` re-derives this list from
// those migrations on every run and fails on any drift — the test reads the
// world, it does not check the list against itself.
//
// `name` is the exact DB string and has NO "Parish" suffix ("Orleans", not
// "Orleans Parish"). Store `name`; render `parishLabel()`.
//
// `primaryCity` is the city with the most ZIPs, NOT the legal parish seat —
// St. Tammany's seat is Covington while its largest city by ZIP count is
// Slidell. Fine for "near you" copy; never cite it as civic fact.
//
// `slug` exists to give each parish a stable, URL-safe key. There are no
// /parish/* routes in this app and none are planned; an earlier version of
// this file was written for landing pages that were never built.

export interface Parish {
  /** Exact value stored in `jobs.parish` / `profiles.parish`. No suffix. */
  readonly name: string;
  /** URL segment for /parish/:slug. Unique across all 64. */
  readonly slug: string;
  /** Largest city by ZIP count — NOT the legal parish seat. */
  readonly primaryCity: string;
  /** Every USPS delivery city in this parish, most ZIPs first. */
  readonly cities: readonly string[];
  /** How many of Louisiana's 720 ZIPs land in this parish. Market-size proxy. */
  readonly zipCount: number;
}

export const PARISHES: readonly Parish[] = [
  {
    name: "Orleans", slug: "orleans", primaryCity: "New Orleans", zipCount: 56,
    cities: ["New Orleans"],
  },
  {
    name: "Caddo", slug: "caddo", primaryCity: "Shreveport", zipCount: 47,
    cities: ["Shreveport", "Belcher", "Bethany", "Blanchard", "Gilliam", "Greenwood", "Hosston", "Ida", "Keithville", "Mooringsport", "Oil City", "Rodessa", "Vivian"],
  },
  {
    name: "East Baton Rouge", slug: "east-baton-rouge", primaryCity: "Baton Rouge", zipCount: 47,
    cities: ["Baton Rouge", "Baker", "Greenwell Springs", "Pride", "Zachary"],
  },
  {
    name: "Jefferson", slug: "jefferson", primaryCity: "Metairie", zipCount: 34,
    cities: ["Metairie", "Kenner", "New Orleans", "Gretna", "Harvey", "Marrero", "Westwego", "Barataria", "Grand Isle", "Lafitte"],
  },
  {
    name: "Rapides", slug: "rapides", primaryCity: "Alexandria", zipCount: 30,
    cities: ["Alexandria", "Pineville", "Ball", "Boyce", "Cheneyville", "Deville", "Echo", "Elmer", "Flatwoods", "Forest Hill", "Gardner", "Glenmora", "Hineston", "Lecompte", "Lena", "Libuse", "Longleaf", "Otis", "Ruby", "Sieper", "Tioga", "Woodworth"],
  },
  {
    name: "Calcasieu", slug: "calcasieu", primaryCity: "Lake Charles", zipCount: 21,
    cities: ["Lake Charles", "Sulphur", "Bell City", "DeQuincy", "Hayes", "Iowa", "Starks", "Vinton", "Westlake"],
  },
  {
    name: "St. Tammany", slug: "st-tammany", primaryCity: "Slidell", zipCount: 20,
    cities: ["Slidell", "Covington", "Mandeville", "Abita Springs", "Bush", "Folsom", "Lacombe", "Madisonville", "Pearl River", "St. Benedict", "Sun", "Talisheek"],
  },
  {
    name: "Lafayette", slug: "lafayette", primaryCity: "Lafayette", zipCount: 18,
    cities: ["Lafayette", "Broussard", "Carencro", "Duson", "Milton", "Scott", "Youngsville"],
  },
  {
    name: "Natchitoches", slug: "natchitoches", primaryCity: "Natchitoches", zipCount: 17,
    cities: ["Natchitoches", "Ashland", "Campti", "Clarence", "Cloutierville", "Flora", "Goldonna", "Gorum", "Marthaville", "Melrose", "Mora", "Natchez", "Powhatan", "Provencal", "Robeline"],
  },
  {
    name: "Ouachita", slug: "ouachita", primaryCity: "Monroe", zipCount: 17,
    cities: ["Monroe", "West Monroe", "Calhoun", "Fairbanks", "Sterlington", "Swartz"],
  },
  {
    name: "Tangipahoa", slug: "tangipahoa", primaryCity: "Hammond", zipCount: 17,
    cities: ["Hammond", "Akers", "Amite", "Fluker", "Husser", "Independence", "Kentwood", "Loranger", "Natalbany", "Ponchatoula", "Robert", "Roseland", "Tangipahoa", "Tickfaw"],
  },
  {
    name: "St. Landry", slug: "st-landry", primaryCity: "Opelousas", zipCount: 15,
    cities: ["Opelousas", "Arnaudville", "Eunice", "Grand Coteau", "Krotz Springs", "Lawtell", "Lebeau", "Leonville", "Melville", "Morrow", "Palmetto", "Port Barre", "Sunset", "Washington"],
  },
  {
    name: "Avoyelles", slug: "avoyelles", primaryCity: "Bordelonville", zipCount: 14,
    cities: ["Bordelonville", "Bunkie", "Center Point", "Cottonport", "Dupont", "Effie", "Evergreen", "Hamburg", "Hessmer", "Mansura", "Marksville", "Moreauville", "Plaucheville", "Simmesport"],
  },
  {
    name: "Pointe Coupee", slug: "pointe-coupee", primaryCity: "Batchelor", zipCount: 14,
    cities: ["Batchelor", "Fordoche", "Glynn", "Innis", "Jarreau", "Lakeland", "Lettsworth", "Livonia", "Lottie", "Morganza", "New Roads", "Oscar", "Rougon", "Ventress"],
  },
  {
    name: "Terrebonne", slug: "terrebonne", primaryCity: "Houma", zipCount: 13,
    cities: ["Houma", "Bourg", "Chauvin", "Donner", "Dulac", "Gibson", "Gray", "Montegut", "Schriever", "Theriot"],
  },
  {
    name: "Lafourche", slug: "lafourche", primaryCity: "Thibodaux", zipCount: 12,
    cities: ["Thibodaux", "Cut Off", "Galliano", "Gheens", "Golden Meadow", "Kraemer", "Larose", "Lockport", "Mathews", "Raceland"],
  },
  {
    name: "Vernon", slug: "vernon", primaryCity: "Leesville", zipCount: 12,
    cities: ["Leesville", "Anacoco", "Evans", "Fort Polk", "Hornbeck", "Kurthwood", "New Llano", "Pitkin", "Rosepine", "Simpson", "Slagle"],
  },
  {
    name: "Acadia", slug: "acadia", primaryCity: "Crowley", zipCount: 11,
    cities: ["Crowley", "Branch", "Church Point", "Egan", "Estherwood", "Evangeline", "Iota", "Mermentau", "Morse", "Rayne"],
  },
  {
    name: "Ascension", slug: "ascension", primaryCity: "Gonzales", zipCount: 11,
    cities: ["Gonzales", "Brittany", "Burnside", "Darrow", "Donaldsonville", "Duplessis", "Geismar", "Prairieville", "Sorrento", "St. Amant"],
  },
  {
    name: "Bossier", slug: "bossier", primaryCity: "Bossier City", zipCount: 11,
    cities: ["Bossier City", "Barksdale AFB", "Benton", "Elm Grove", "Haughton", "Plain Dealing", "Princeton"],
  },
  {
    name: "Livingston", slug: "livingston", primaryCity: "Denham Springs", zipCount: 11,
    cities: ["Denham Springs", "Albany", "French Settlement", "Holden", "Livingston", "Maurepas", "Springfield", "Walker", "Watson"],
  },
  {
    name: "Webster", slug: "webster", primaryCity: "Minden", zipCount: 11,
    cities: ["Minden", "Cotton Valley", "Cullen", "Doyline", "Dubberly", "Heflin", "Sarepta", "Shongaloo", "Sibley", "Springhill"],
  },
  {
    name: "Plaquemines", slug: "plaquemines", primaryCity: "Belle Chasse", zipCount: 10,
    cities: ["Belle Chasse", "Boothville", "Braithwaite", "Buras", "Empire", "Pilottown", "Pointe A La Hache", "Port Sulphur", "Venice"],
  },
  {
    name: "St. Charles", slug: "st-charles", primaryCity: "Ama", zipCount: 10,
    cities: ["Ama", "Boutte", "Des Allemands", "Destrehan", "Hahnville", "Luling", "New Sarpy", "Norco", "Paradis", "St. Rose"],
  },
  {
    name: "St. Mary", slug: "st-mary", primaryCity: "Morgan City", zipCount: 10,
    cities: ["Morgan City", "Amelia", "Baldwin", "Berwick", "Centerville", "Charenton", "Franklin", "Garden City", "Patterson"],
  },
  {
    name: "DeSoto", slug: "desoto", primaryCity: "Frierson", zipCount: 9,
    cities: ["Frierson", "Gloster", "Grand Cane", "Keatchie", "Logansport", "Longstreet", "Mansfield", "Pelican", "Stonewall"],
  },
  {
    name: "Iberville", slug: "iberville", primaryCity: "Plaquemine", zipCount: 9,
    cities: ["Plaquemine", "Carville", "Grosse Tete", "Maringouin", "Rosedale", "St. Gabriel", "Sunshine", "White Castle"],
  },
  {
    name: "Sabine", slug: "sabine", primaryCity: "Belmont", zipCount: 9,
    cities: ["Belmont", "Converse", "Fisher", "Florien", "Many", "Negreet", "Noble", "Pleasant Hill", "Zwolle"],
  },
  {
    name: "Allen", slug: "allen", primaryCity: "Elizabeth", zipCount: 8,
    cities: ["Elizabeth", "Grant", "Kinder", "Leblanc", "Mittie", "Oakdale", "Oberlin", "Reeves"],
  },
  {
    name: "Bienville", slug: "bienville", primaryCity: "Arcadia", zipCount: 8,
    cities: ["Arcadia", "Bienville", "Castor", "Gibsland", "Jamestown", "Ringgold", "Saline", "Taylor"],
  },
  {
    name: "Evangeline", slug: "evangeline", primaryCity: "Basile", zipCount: 8,
    cities: ["Basile", "Chataignier", "Mamou", "Pine Prairie", "Reddell", "St. Landry", "Turkey Creek", "Ville Platte"],
  },
  {
    name: "Franklin", slug: "franklin", primaryCity: "Baskin", zipCount: 8,
    cities: ["Baskin", "Chase", "Crowville", "Fort Necessity", "Gilbert", "Jigger", "Winnsboro", "Wisner"],
  },
  {
    name: "St. James", slug: "st-james", primaryCity: "Convent", zipCount: 8,
    cities: ["Convent", "Gramercy", "Hester", "Lutcher", "Paulina", "St. James", "Uncle Sam", "Vacherie"],
  },
  {
    name: "Vermilion", slug: "vermilion", primaryCity: "Abbeville", zipCount: 8,
    cities: ["Abbeville", "Delcambre", "Erath", "Gueydan", "Kaplan", "Maurice", "Perry"],
  },
  {
    name: "Beauregard", slug: "beauregard", primaryCity: "DeRidder", zipCount: 7,
    cities: ["DeRidder", "Dry Creek", "Longville", "Merryville", "Ragley", "Singer", "Sugartown"],
  },
  {
    name: "Iberia", slug: "iberia", primaryCity: "New Iberia", zipCount: 7,
    cities: ["New Iberia", "Avery Island", "Jeanerette", "Loreauville", "Lydia"],
  },
  {
    name: "Jefferson Davis", slug: "jefferson-davis", primaryCity: "Elton", zipCount: 7,
    cities: ["Elton", "Fenton", "Jennings", "Lacassine", "Lake Arthur", "Roanoke", "Welsh"],
  },
  {
    name: "Lincoln", slug: "lincoln", primaryCity: "Ruston", zipCount: 7,
    cities: ["Ruston", "Choudrant", "Dubach", "Grambling", "Simsboro"],
  },
  {
    name: "Morehouse", slug: "morehouse", primaryCity: "Bastrop", zipCount: 7,
    cities: ["Bastrop", "Bonita", "Collinston", "Jones", "Mer Rouge", "Oak Ridge"],
  },
  {
    name: "Union", slug: "union", primaryCity: "Bernice", zipCount: 7,
    cities: ["Bernice", "Downsville", "Farmerville", "Junction City", "Lillie", "Marion", "Spearsville"],
  },
  {
    name: "Winn", slug: "winn", primaryCity: "Atlanta", zipCount: 7,
    cities: ["Atlanta", "Calvin", "Dodson", "Joyce", "Sikes", "St. Maurice", "Winnfield"],
  },
  {
    name: "Assumption", slug: "assumption", primaryCity: "Belle Rose", zipCount: 6,
    cities: ["Belle Rose", "Labadieville", "Napoleonville", "Paincourtville", "Pierre Part", "Plattenville"],
  },
  {
    name: "Catahoula", slug: "catahoula", primaryCity: "Aimwell", zipCount: 6,
    cities: ["Aimwell", "Enterprise", "Harrisonburg", "Jonesville", "Rhinehart", "Sicily Island"],
  },
  {
    name: "Concordia", slug: "concordia", primaryCity: "Acme", zipCount: 6,
    cities: ["Acme", "Clayton", "Ferriday", "Monterey", "Vidalia", "Wildsville"],
  },
  {
    name: "East Feliciana", slug: "east-feliciana", primaryCity: "Clinton", zipCount: 6,
    cities: ["Clinton", "Ethel", "Jackson", "Norwood", "Slaughter", "Wilson"],
  },
  {
    name: "Grant", slug: "grant", primaryCity: "Bentley", zipCount: 6,
    cities: ["Bentley", "Colfax", "Dry Prong", "Georgetown", "Montgomery", "Pollock"],
  },
  {
    name: "St. Bernard", slug: "st-bernard", primaryCity: "Chalmette", zipCount: 6,
    cities: ["Chalmette", "Arabi", "Meraux", "St. Bernard", "Violet"],
  },
  {
    name: "St. John the Baptist", slug: "st-john-the-baptist", primaryCity: "LaPlace", zipCount: 6,
    cities: ["LaPlace", "Edgard", "Garyville", "Mount Airy", "Reserve"],
  },
  {
    name: "Washington", slug: "washington", primaryCity: "Bogalusa", zipCount: 6,
    cities: ["Bogalusa", "Angie", "Franklinton", "Mount Hermon", "Varnado"],
  },
  {
    name: "Claiborne", slug: "claiborne", primaryCity: "Athens", zipCount: 5,
    cities: ["Athens", "Haynesville", "Homer", "Lisbon", "Summerfield"],
  },
  {
    name: "Jackson", slug: "jackson", primaryCity: "Chatham", zipCount: 5,
    cities: ["Chatham", "Eros", "Hodge", "Jonesboro", "Quitman"],
  },
  {
    name: "LaSalle", slug: "lasalle", primaryCity: "Jena", zipCount: 5,
    cities: ["Jena", "Olla", "Trout", "Tullos", "Urania"],
  },
  {
    name: "Richland", slug: "richland", primaryCity: "Archibald", zipCount: 5,
    cities: ["Archibald", "Delhi", "Mangham", "Rayville", "Start"],
  },
  {
    name: "West Carroll", slug: "west-carroll", primaryCity: "Epps", zipCount: 5,
    cities: ["Epps", "Forest", "Kilbourne", "Oak Grove", "Pioneer"],
  },
  {
    name: "West Feliciana", slug: "west-feliciana", primaryCity: "Angola", zipCount: 5,
    cities: ["Angola", "St. Francisville", "Tunica", "Wakefield", "Weyanoke"],
  },
  {
    name: "Caldwell", slug: "caldwell", primaryCity: "Clarks", zipCount: 4,
    cities: ["Clarks", "Columbia", "Grayson", "Kelly"],
  },
  {
    name: "Cameron", slug: "cameron", primaryCity: "Cameron", zipCount: 4,
    cities: ["Cameron", "Creole", "Grand Chenier", "Hackberry"],
  },
  {
    name: "St. Martin", slug: "st-martin", primaryCity: "Breaux Bridge", zipCount: 4,
    cities: ["Breaux Bridge", "Cade", "Cecilia", "St. Martinville"],
  },
  {
    name: "West Baton Rouge", slug: "west-baton-rouge", primaryCity: "Addis", zipCount: 4,
    cities: ["Addis", "Brusly", "Erwinville", "Port Allen"],
  },
  {
    name: "East Carroll", slug: "east-carroll", primaryCity: "Lake Providence", zipCount: 3,
    cities: ["Lake Providence", "Sondheimer", "Transylvania"],
  },
  {
    name: "Madison", slug: "madison", primaryCity: "Tallulah", zipCount: 3,
    cities: ["Tallulah", "Delta"],
  },
  {
    name: "Tensas", slug: "tensas", primaryCity: "Newellton", zipCount: 3,
    cities: ["Newellton", "St. Joseph", "Waterproof"],
  },
  {
    name: "Red River", slug: "red-river", primaryCity: "Coushatta", zipCount: 2,
    cities: ["Coushatta", "Hall Summit"],
  },
  {
    name: "St. Helena", slug: "st-helena", primaryCity: "Greensburg", zipCount: 2,
    cities: ["Greensburg", "Pine Grove"],
  },];

/** Slug → parish. Built once; /parish/:slug resolves through this. */
const BY_SLUG: ReadonlyMap<string, Parish> = new Map(PARISHES.map((p) => [p.slug, p]));
/** DB name → parish, for turning a `jobs.parish` value into a link. */
const BY_NAME: ReadonlyMap<string, Parish> = new Map(PARISHES.map((p) => [p.name, p]));

export const parishBySlug = (slug: string | undefined): Parish | null =>
  slug ? (BY_SLUG.get(slug.toLowerCase()) ?? null) : null;

export const parishByName = (name: string | null | undefined): Parish | null =>
  name ? (BY_NAME.get(name) ?? null) : null;

/** City name (case-insensitive) → the parish that lists it. Used only for a
 * soft "does this ZIP match the city you typed" sanity check at
 * signup/profile-edit.
 *
 * The registry now names all 480 USPS delivery cities in Louisiana rather than
 * a handful per parish, so a null answer is much rarer than it used to be —
 * but it is STILL not evidence of a mismatch. A user may type a neighbourhood,
 * an unincorporated community, or a spelling USPS does not use, none of which
 * is wrong. Callers must treat null as "unknown" and only a match against a
 * DIFFERENT parish as evidence.
 *
 * A city listed under more than one parish (a real border town, not a data
 * bug) is deliberately excluded rather than assigned to whichever parish
 * iterates last: silently picking one would flag a false mismatch for every
 * real resident of the OTHER parish it's also listed under. */
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
