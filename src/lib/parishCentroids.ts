// Approximate centroids for Louisiana parishes — used for distance
// estimates inside dialogs where we don't have exact lat/lng on the
// job (the open_jobs_browse view masks precise coords). Coordinates
// from Wikipedia parish pages, rounded to 4 decimals (~10m precision).
//
// Not exhaustive — covers the top ~25 parishes by population, which
// account for the vast majority of jobs. Misses fall back to "no
// distance shown."

export const PARISH_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "Orleans": { lat: 29.9511, lng: -90.0715 },
  "Jefferson": { lat: 29.9494, lng: -90.1486 },
  "St. Tammany": { lat: 30.4218, lng: -89.9986 },
  "East Baton Rouge": { lat: 30.4583, lng: -91.1403 },
  "Lafayette": { lat: 30.2241, lng: -92.0198 },
  "Caddo": { lat: 32.5776, lng: -93.8773 },
  "Calcasieu": { lat: 30.2266, lng: -93.2174 },
  "Ouachita": { lat: 32.4807, lng: -92.1193 },
  "Rapides": { lat: 31.2911, lng: -92.4451 },
  "Bossier": { lat: 32.5232, lng: -93.6629 },
  "Tangipahoa": { lat: 30.6260, lng: -90.4290 },
  "St. Bernard": { lat: 29.7574, lng: -89.7892 },
  "Plaquemines": { lat: 29.4716, lng: -89.6553 },
  "Livingston": { lat: 30.4441, lng: -90.7301 },
  "Ascension": { lat: 30.2046, lng: -90.9046 },
  "Iberia": { lat: 30.0085, lng: -91.8276 },
  "Lafourche": { lat: 29.4513, lng: -90.3085 },
  "Terrebonne": { lat: 29.5833, lng: -90.7050 },
  "St. Charles": { lat: 29.9358, lng: -90.3661 },
  "Vermilion": { lat: 29.8732, lng: -92.2987 },
  "St. Landry": { lat: 30.6905, lng: -92.0123 },
  "Acadia": { lat: 30.2775, lng: -92.4111 },
  "Natchitoches": { lat: 31.7232, lng: -93.0860 },
  "Webster": { lat: 32.7184, lng: -93.3360 },
  "Beauregard": { lat: 30.6477, lng: -93.3500 },
  "Allen": { lat: 30.6486, lng: -92.8294 },
  "St. Mary": { lat: 29.6377, lng: -91.4490 },
  "Pointe Coupee": { lat: 30.7088, lng: -91.5969 },
  "St. Martin": { lat: 30.1271, lng: -91.6021 },
  "St. James": { lat: 30.0289, lng: -90.7929 },
  "St. John the Baptist": { lat: 30.1247, lng: -90.4892 },
  "Washington": { lat: 30.8478, lng: -90.0411 },
  "Avoyelles": { lat: 31.0658, lng: -92.0061 },
  "Evangeline": { lat: 30.7349, lng: -92.4142 },
  "Vernon": { lat: 31.1080, lng: -93.1834 },
  "Sabine": { lat: 31.5650, lng: -93.5520 },
  "DeSoto": { lat: 32.0596, lng: -93.7397 },
  "Bienville": { lat: 32.3504, lng: -92.9899 },
  "Jackson": { lat: 32.2989, lng: -92.5595 },
  "Lincoln": { lat: 32.6053, lng: -92.6629 },
  "Union": { lat: 32.8323, lng: -92.3713 },
  "Morehouse": { lat: 32.8156, lng: -91.7929 },
  "West Carroll": { lat: 32.7951, lng: -91.4489 },
  "East Carroll": { lat: 32.7333, lng: -91.2358 },
  "Madison": { lat: 32.3633, lng: -91.2275 },
  "Tensas": { lat: 32.0036, lng: -91.3433 },
  "Concordia": { lat: 31.4424, lng: -91.6379 },
  "Catahoula": { lat: 31.6628, lng: -91.8551 },
  "LaSalle": { lat: 31.6747, lng: -92.1597 },
  "Grant": { lat: 31.5949, lng: -92.5638 },
  "Winn": { lat: 31.9460, lng: -92.6402 },
  "Caldwell": { lat: 32.0921, lng: -92.1225 },
  "Franklin": { lat: 32.1304, lng: -91.6749 },
  "Richland": { lat: 32.4131, lng: -91.7654 },
  "West Baton Rouge": { lat: 30.4661, lng: -91.3145 },
  "Iberville": { lat: 30.3164, lng: -91.3469 },
  "West Feliciana": { lat: 30.8772, lng: -91.4044 },
  "East Feliciana": { lat: 30.8442, lng: -91.0429 },
  "St. Helena": { lat: 30.8175, lng: -90.7068 },
  "Assumption": { lat: 29.9101, lng: -91.0628 },
  "Cameron": { lat: 29.8324, lng: -93.1700 },
  "Jefferson Davis": { lat: 30.2649, lng: -92.8127 },
  "Red River": { lat: 32.0950, lng: -93.3360 },
  "Claiborne": { lat: 32.8221, lng: -92.9963 },
};

/**
 * Look up a parish centroid. Handles trailing " Parish" suffix and
 * case differences. Returns null when the parish isn't in our table.
 */
export function getParishCentroid(parishName: string | null | undefined): { lat: number; lng: number } | null {
  if (!parishName) return null;
  const normalized = parishName.replace(/\s+Parish\s*$/i, "").trim();
  return PARISH_CENTROIDS[normalized] || null;
}

/**
 * Common Louisiana city → parish lookup. Used by the dashboard distance
 * pill to derive a parish centroid when `job.parish` isn't available
 * directly (the open_jobs_browse view doesn't currently expose `parish`,
 * so we fall back to parsing the masked location's city). Covers the
 * top ~40 cities by population — misses just return null and the pill
 * silently hides.
 */
const CITY_TO_PARISH: Record<string, string> = {
  // Greater New Orleans
  "new orleans": "Orleans",
  "metairie": "Jefferson",
  "kenner": "Jefferson",
  "gretna": "Jefferson",
  "harvey": "Jefferson",
  "marrero": "Jefferson",
  "westwego": "Jefferson",
  "chalmette": "St. Bernard",
  "slidell": "St. Tammany",
  "covington": "St. Tammany",
  "mandeville": "St. Tammany",
  "hammond": "Tangipahoa",
  "ponchatoula": "Tangipahoa",
  // Baton Rouge area
  "baton rouge": "East Baton Rouge",
  "baker": "East Baton Rouge",
  "zachary": "East Baton Rouge",
  "central": "East Baton Rouge",
  "port allen": "West Baton Rouge",
  "denham springs": "Livingston",
  "walker": "Livingston",
  "gonzales": "Ascension",
  "prairieville": "Ascension",
  "donaldsonville": "Ascension",
  // Acadiana
  "lafayette": "Lafayette",
  "broussard": "Lafayette",
  "scott": "Lafayette",
  "youngsville": "Lafayette",
  "carencro": "Lafayette",
  "new iberia": "Iberia",
  "abbeville": "Vermilion",
  "crowley": "Acadia",
  "rayne": "Acadia",
  "opelousas": "St. Landry",
  "eunice": "St. Landry",
  "breaux bridge": "St. Martin",
  // Southwest
  "lake charles": "Calcasieu",
  "sulphur": "Calcasieu",
  "westlake": "Calcasieu",
  "moss bluff": "Calcasieu",
  "dequincy": "Calcasieu",
  "jennings": "Jefferson Davis",
  "deridder": "Beauregard",
  "leesville": "Vernon",
  // Central
  "alexandria": "Rapides",
  "pineville": "Rapides",
  "ball": "Rapides",
  "natchitoches": "Natchitoches",
  // Northwest
  "shreveport": "Caddo",
  "bossier city": "Bossier",
  "haughton": "Bossier",
  "benton": "Bossier",
  "minden": "Webster",
  // Northeast
  "monroe": "Ouachita",
  "west monroe": "Ouachita",
  "ruston": "Lincoln",
  "bastrop": "Morehouse",
  // Houma / Thibodaux
  "houma": "Terrebonne",
  "thibodaux": "Lafourche",
  "raceland": "Lafourche",
  "morgan city": "St. Mary",
  // River Parishes
  "luling": "St. Charles",
  "destrehan": "St. Charles",
  "boutte": "St. Charles",
  "laplace": "St. John the Baptist",
  "reserve": "St. John the Baptist",
};

/**
 * Best-effort: derive a parish centroid from a job's display location
 * (e.g. "New Orleans, LA"). Tries the trailing-token "X Parish" pattern
 * first, then falls back to a city → parish lookup over the major
 * cities. Returns null when no match — caller (the distance pill) just
 * hides itself in that case.
 *
 * The browse-feed view masks precise coords but keeps the city, so this
 * lets us put a "~X mi" chip on cards without re-running geocoding.
 */
export function getCentroidFromLocation(location: string | null | undefined): { lat: number; lng: number } | null {
  if (!location) return null;
  // 1) Explicit "X Parish" anywhere in the string.
  const parishMatch = location.match(/([A-Za-z.\s]+?)\s+Parish/i);
  if (parishMatch) {
    const c = getParishCentroid(parishMatch[1].trim());
    if (c) return c;
  }
  // 2) City lookup — extract the city token from "..., City, LA".
  const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  // Walk the segments back-to-front past the state token to find the
  // most-specific city candidate. Tolerates "Street, City, LA 70001"
  // and "City, LA" alike.
  const stateIdx = parts.findIndex((p) => /^LA\b/i.test(p) || /Louisiana/i.test(p));
  const cityToken = stateIdx > 0 ? parts[stateIdx - 1] : parts[parts.length - 2] || parts[0];
  const key = cityToken.toLowerCase().replace(/\s+/g, " ").trim();
  const parish = CITY_TO_PARISH[key];
  return parish ? getParishCentroid(parish) : null;
}
