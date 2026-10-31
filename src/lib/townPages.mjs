/**
 * OPS-4 (owner approved 10-29; lead 10-31 01:08): town + service pages for Google, e.g. "Handyman in Baton Rouge".
 * Path /hire/<service>/<town>; first towns Lafayette, New Iberia, Delcambre, Abbeville, Baton Rouge; nothing shown at
 * zero (the pages show no counts at all, so a town with no Helprs yet never reads "0 Helprs").
 *
 * Services: the everyday job categories only, under JOB_CATEGORY_LABELS' own names (the guard checks they match).
 * Licensed trades (electrical, plumbing, HVAC, roofing...) are left out on purpose: a "Plumber in Lafayette" page could
 * read as a licensed-contractor ad.
 *
 * Plain dependency-free ESM, like publicPageMeta.mjs beside it: the page (HireTownPage), api/share.ts (the pre-JS head,
 * through publicPageMetaFor) and scripts/generate-sitemap.mjs all read this one table. Types: townPages.d.mts.
 * Guard: src/pages/info/hireTownPage.test.tsx.
 */

export const TOWN_PAGE_TOWNS = [
  { slug: "lafayette", name: "Lafayette" },
  { slug: "new-iberia", name: "New Iberia" },
  { slug: "delcambre", name: "Delcambre" },
  { slug: "abbeville", name: "Abbeville" },
  { slug: "baton-rouge", name: "Baton Rouge" },
];

/** category (the job_category value), its JOB_CATEGORY_LABELS name, and what the page says the Helpr does. */
export const TOWN_PAGE_SERVICES = [
  { category: "handyman", label: "Handyman", phrase: "a handyman" },
  { category: "cleaning", label: "Cleaning", phrase: "house cleaning" },
  { category: "yard_work", label: "Yard work", phrase: "yard work" },
  { category: "moving", label: "Moving", phrase: "moving help" },
  { category: "assembly", label: "Assembly", phrase: "furniture assembly" },
  { category: "pressure_washing", label: "Pressure washing", phrase: "pressure washing" },
  { category: "errands", label: "Errands", phrase: "errands" },
  { category: "pet_care", label: "Pet care", phrase: "pet care" },
].map((s) => ({ ...s, slug: s.category.replace(/_/g, "-") }));

export function townPagePath(service, town) {
  return `/hire/${service.slug}/${town.slug}`;
}

/** The page for these URL parts, or null (an unknown service or town is a 404, never a page about nowhere). */
export function findTownPage(serviceSlug, townSlug) {
  const service = TOWN_PAGE_SERVICES.find((s) => s.slug === serviceSlug);
  const town = TOWN_PAGE_TOWNS.find((t) => t.slug === townSlug);
  return service && town ? { service, town } : null;
}

/** Every town page path (the sitemap's and the page's own links). */
export function allTownPagePaths() {
  return TOWN_PAGE_SERVICES.flatMap((s) => TOWN_PAGE_TOWNS.map((t) => townPagePath(s, t)));
}

export function townPageMeta(service, town) {
  const title = `${service.label} in ${town.name}, LA | Louisiana Helpr`;
  const description = `Need ${service.phrase} in ${town.name}? Post the job and name your price. Local Helprs apply, you pick one, and your payment is held until the work is done.`;
  const canonical = `https://www.louisianahelpr.com${townPagePath(service, town)}`;
  return { title, description, canonical, ogTitle: title, ogDescription: description, ogUrl: canonical, geoRegion: "US-LA", geoPlacename: town.name };
}

/** The head for a /hire/<service>/<town> path, or null for any other path. */
export function townPageMetaFor(pathname) {
  const m = /^\/hire\/([^/]+)\/([^/]+)$/.exec(pathname);
  const page = m ? findTownPage(m[1], m[2]) : null;
  return page ? townPageMeta(page.service, page.town) : null;
}
