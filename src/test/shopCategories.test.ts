/**
 * The Shops category list as the migrations leave it (owner L54 starter list,
 * 20261017061155_shops_profiles; owner rules 2026-10-17 ~23:25Z and ~23:30Z,
 * relayed by the lead: Shops is for LOCAL businesses that build a clientele,
 * where people order, book or rent and pick up or get served, not delivery-app
 * food service. 20261017224153_shop_categories_v2 states the whole v2.2 list (final) from
 * the lead's draft ~/.lh-wt/shop-categories-proposal-1017.md, made final by
 * the owner ~23:37Z).
 *
 * Read from EVERY migration in order, comments blanked (blankSqlComments):
 *   INSERT INTO public.shop_categories ... VALUES rows add a slug (ON CONFLICT
 *     DO UPDATE overwrites its label, group and order; DO NOTHING keeps the first);
 *   DELETE ... WHERE slug IN (...) removes the slugs named;
 *   DELETE ... WHERE slug <> ALL (...) keeps only the slugs that file upserted.
 *
 * Behaviour (shops on a removed slug move; 3x replay):
 * src/test/pglite/shopCategoriesV2.pglite.mjs.
 */
// @mutate supabase/migrations/20261017224153_shop_categories_v2.sql |   DELETE FROM public.shop_categories WHERE slug <> ALL (v_keep); | 
// @mutate supabase/migrations/20261017224153_shop_categories_v2.sql |     ('equipment_rental', 'trades', 'Trades', 'Equipment rental', 313),\n | 
// @mutate supabase/migrations/20261017224153_shop_categories_v2.sql | 'events_party', 'Events and party', 'Party rentals' | 'events_party', 'Rentals', 'Party rentals'
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG_DIR = join(process.cwd(), "supabase/migrations");

type Row = { slug: string; group: string; groupLabel: string; label: string; position: number };

function effectiveCategories(): { rows: Map<string, Row>; files: string[] } {
  const rows = new Map<string, Row>();
  const files: string[] = [];
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
    const upsertedHere = new Set<string>();
    const re = /INSERT\s+INTO\s+public\.shop_categories\s*\([^)]*\)\s*VALUES([\s\S]*?)ON\s+CONFLICT\s*\(slug\)\s*DO\s+(UPDATE|NOTHING)|DELETE\s+FROM\s+public\.shop_categories\s+WHERE\s+slug\s+(IN\s*\(([^)]*)\)|<>\s*ALL)/gi;
    for (const m of sql.matchAll(re)) {
      if (m[1] !== undefined) {
        files.push(f);
        const update = m[2].toUpperCase() === "UPDATE";
        for (const t of m[1].matchAll(/\(\s*'([a-z0-9_]+)'\s*,\s*'([a-z0-9_]+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(\d+)\s*\)/g)) {
          upsertedHere.add(t[1]);
          if (update || !rows.has(t[1])) rows.set(t[1], { slug: t[1], group: t[2], groupLabel: t[3], label: t[4], position: Number(t[5]) });
        }
      } else if (m[4] !== undefined) {
        for (const x of m[4].matchAll(/'([a-z0-9_]+)'/g)) rows.delete(x[1]);
      } else {
        for (const slug of [...rows.keys()]) if (!upsertedHere.has(slug)) rows.delete(slug);
      }
    }
  }
  return { rows, files };
}

/** The v2.2 list (final), group by group, in order. */
const V2 = [
  "Food to order: Bakery and cakes, Catering, Crawfish and seafood, BBQ and smoked meats, Meal prep, Home kitchen",
  "Home services: Cleaning, Lawn and landscaping, Pressure washing, Pest control, Pool, Moving, Junk removal, Organizing, Tree service, Gutters, Window washing",
  "Trades: Electrical, Plumbing, HVAC, Roofing, Welding, Carpentry, Flooring, Concrete and masonry, Fencing, Painting, Remodeling, Appliance repair, Handyman, Equipment rental",
  "Events and party: DJ, Photography, Videography, Venues, Decor, Florist, Party rentals, Bounce houses, Tables, chairs and tents",
  "Auto and marine: Mechanic, Mobile mechanic, Detailing, Towing, Tires, Boat repair",
  "Beauty: Hair, Barber, Nails, Lashes and brows, Makeup, Spa, Tattoo",
  "Health and fitness: Personal trainer, Yoga, Massage, Nutrition",
  "Pets: Grooming, Sitting and walking, Training, Boarding",
  "Made locally: Boutique, Crafts and gifts, Home decor, Plants and garden, Custom shirts and printing, Jewelry, Candles and soap",
  "Lessons: Tutoring, Music lessons, Classes",
  "Local pros: Tax and bookkeeping, Notary, Printing, IT and phone repair",
  "Outdoors: Fishing charters, Hunting guides, Swamp tours, Deer processing",
  "Other: Other",
];

describe("Shops categories v2: local businesses people order, book or rent from (owner 2026-10-17)", () => {
  const { rows, files } = effectiveCategories();
  const sorted = [...rows.values()].sort((a, b) => a.position - b.position);

  it("reads a real list (floors)", () => {
    expect(files).toContain("20261017061155_shops_profiles.sql");
    expect(files).toContain("20261017224153_shop_categories_v2.sql");
    expect(rows.size).toBeGreaterThan(60);
  });

  it("walk-in food service, farmers market, driving school, real estate, insurance and gym are gone", () => {
    for (const slug of ["food_truck", "restaurant", "coffee", "snowballs", "farmers_market", "driving_school", "real_estate", "insurance", "cakes", "gym"]) {
      expect(rows.has(slug), slug).toBe(false);
    }
  });

  it("the whole list is exactly v2, group by group, in order (80 categories)", () => {
    const groups: string[] = [];
    for (const r of sorted) {
      const last = groups[groups.length - 1];
      if (last?.startsWith(`${r.groupLabel}: `)) groups[groups.length - 1] = `${last}, ${r.label}`;
      else groups.push(`${r.groupLabel}: ${r.label}`);
    }
    expect(groups).toEqual(V2);
    expect(rows.size).toBe(80);
  });

  it("no group is called just 'Rentals' (that is the homes section); equipment rental sits in Trades", () => {
    const labels = new Set(sorted.map((r) => r.groupLabel));
    expect(labels.has("Rentals")).toBe(false);
    expect(rows.get("equipment_rental")?.groupLabel).toBe("Trades");
    expect(rows.get("party_rentals")?.groupLabel).toBe("Events and party");
  });
});
