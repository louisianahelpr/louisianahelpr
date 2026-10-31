/**
 * OPS-4 (owner approved 10-29; lead 10-31 01:08): town + service pages for Google, e.g. "Handyman in Baton Rouge".
 * Path /hire/<service>/<town>; first towns Lafayette, New Iberia, Delcambre, Abbeville, Baton Rouge; nothing shown at
 * zero (the pages show no counts at all, so a town with no Helprs yet never reads "0 Helprs").
 *
 * Services: the everyday job categories only (JOB_CATEGORY_LABELS' own names). Licensed trades (electrical, plumbing,
 * HVAC, roofing...) are left out on purpose: a "Plumber in Lafayette" page could read as a licensed-contractor ad.
 * Guard: src/pages/info/hireTownPage.test.tsx.
 */
import { JOB_CATEGORY_LABELS, type JobCategory } from "@/lib/jobCategories";

export const TOWN_PAGE_TOWNS = [
  { slug: "lafayette", name: "Lafayette" },
  { slug: "new-iberia", name: "New Iberia" },
  { slug: "delcambre", name: "Delcambre" },
  { slug: "abbeville", name: "Abbeville" },
  { slug: "baton-rouge", name: "Baton Rouge" },
] as const;

const SERVICE_CATEGORIES: readonly JobCategory[] = [
  "handyman", "cleaning", "yard_work", "moving", "assembly", "pressure_washing", "errands", "pet_care",
];

/** What a page says the Helpr does, as a lower-case phrase ("help with yard work"). */
const SERVICE_PHRASE: Partial<Record<JobCategory, string>> = {
  handyman: "a handyman", cleaning: "house cleaning", yard_work: "yard work", moving: "moving help",
  assembly: "furniture assembly", pressure_washing: "pressure washing", errands: "errands", pet_care: "pet care",
};

export const TOWN_PAGE_SERVICES = SERVICE_CATEGORIES.map((category) => ({
  slug: category.replace(/_/g, "-"),
  category,
  label: JOB_CATEGORY_LABELS[category],
  phrase: SERVICE_PHRASE[category] ?? JOB_CATEGORY_LABELS[category].toLowerCase(),
}));

export type TownPageService = (typeof TOWN_PAGE_SERVICES)[number];
export type TownPageTown = (typeof TOWN_PAGE_TOWNS)[number];

export function townPagePath(service: { slug: string }, town: { slug: string }): string {
  return `/hire/${service.slug}/${town.slug}`;
}

/** The page for these URL parts, or null (an unknown service or town is a 404, never a page about nowhere). */
export function findTownPage(serviceSlug: string | undefined, townSlug: string | undefined): { service: TownPageService; town: TownPageTown } | null {
  const service = TOWN_PAGE_SERVICES.find((s) => s.slug === serviceSlug);
  const town = TOWN_PAGE_TOWNS.find((t) => t.slug === townSlug);
  return service && town ? { service, town } : null;
}

/** Every town page path (for the sitemap and the page's own links). */
export function allTownPagePaths(): string[] {
  return TOWN_PAGE_SERVICES.flatMap((s) => TOWN_PAGE_TOWNS.map((t) => townPagePath(s, t)));
}

export function townPageMeta(service: TownPageService, town: TownPageTown) {
  const title = `${service.label} in ${town.name}, LA | Louisiana Helpr`;
  const description = `Need ${service.phrase} in ${town.name}? Post the job and name your price. Local Helprs apply, you pick one, and your payment is held until the work is done.`;
  const canonical = `https://www.louisianahelpr.com${townPagePath(service, town)}`;
  return { title, description, canonical, ogTitle: title, ogDescription: description, ogUrl: canonical, geoRegion: "US-LA", geoPlacename: town.name };
}
