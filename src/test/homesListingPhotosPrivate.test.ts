/**
 * Homes listing photos stay PRIVATE and leave the server only by signed ref
 * (Q2211, Q2212, Q2213; homes launch blockers).
 *
 * The class: a listing read that hands out a storage path (which starts with
 * the landlord's user id, Q2213), a photo stored where a plain URL serves it
 * (a public bucket keeps a taken-down listing's photos online, Q2211), or a
 * client that builds a Storage URL for a listing photo instead of going
 * through the listing-photo proxy (which re-encodes and strips location
 * metadata, Q2212). Built from the LIVE definitions (effectiveDefs replays
 * every migration, drops included) and the app's own listing sources.
 *
 * Proven red 2026-10-19 on the old behaviour: with 20261019071203 moved out of
 * the migrations folder every SQL assertion fails (the live reads select
 * ph.storage_path, attach takes job-photos, no listing-photos bucket), and the
 * pre-Q2211 listings.ts (getPublicUrl on job-photos) fails the client checks.
 */
// @mutate supabase/migrations/20261019071203_rentals_listing_photos_private.sql | ARRAY(SELECT public.rentals_photo_ref(ph.id, 'm') FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position LIMIT 5), | ARRAY(SELECT ph.storage_path FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position LIMIT 5),
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase/migrations");
const defs = effectiveDefs(MIG);

/** Every listing read a member or a stranger can call, and what it must return instead of paths. */
const READS = ["rentals_browse_listings", "rentals_browse_sale_listings", "rentals_listing", "rentals_public_listing", "rentals_my_listing_photos"];

describe("listing photos: private bucket, refs only", () => {
  it("every listing read returns signed refs and never selects a storage path", () => {
    const checked: string[] = [];
    for (const name of READS) {
      const def = defs.get(name);
      expect(def, `${name} is defined`).toBeTruthy();
      const body = blankSqlComments(def!.stmt);
      expect(body, `${name} (${def!.file}) must not hand out storage_path`).not.toMatch(/storage_path/);
      expect(body, `${name} (${def!.file}) must mint refs`).toMatch(/rentals_photo_ref\(/);
      checked.push(name);
    }
    expect(checked.length).toBeGreaterThan(4);
  });

  it("the id-only public lookup is gone and the proxy lookup checks a signature", () => {
    expect(defs.has("rentals_public_listing_photo_path")).toBe(false);
    const obj = defs.get("rentals_listing_photo_object");
    expect(obj).toBeTruthy();
    expect(blankSqlComments(obj!.stmt)).toMatch(/rentals_photo_sig\(/);
  });

  it("a photo is attached only from the private listing-photos bucket", () => {
    const add = blankSqlComments(defs.get("rentals_add_listing_photo")!.stmt);
    expect(add).toMatch(/bucket_id\s*=\s*'listing-photos'/);
    expect(add).not.toMatch(/'job-photos'/);
  });

  it("the take-down detaches the listing's photos", () => {
    const body = blankSqlComments(defs.get("rentals_admin_remove_listing")!.stmt);
    expect(body).toMatch(/DELETE\s+FROM\s+public\.rental_listing_photos\s+WHERE\s+listing_id\s*=\s*p_listing_id/i);
  });

  it("the newest declaration of the listing-photos bucket is private", () => {
    let last: string | null = null;
    for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
      const m = sql.match(/INSERT\s+INTO\s+storage\.buckets[\s\S]*?VALUES\s*\(\s*'listing-photos'\s*,\s*'listing-photos'\s*,\s*(true|false)[\s\S]*?;/i);
      if (m) last = m[0];
    }
    expect(last, "a migration declares listing-photos").not.toBeNull();
    expect(last).toMatch(/VALUES\s*\(\s*'listing-photos'\s*,\s*'listing-photos'\s*,\s*false/i);
    expect(last).not.toMatch(/public\s*=\s*true/i);
  });
});

describe("listing photos: the app goes through the proxy", () => {
  const lib = blankComments(readFileSync(join(ROOT, "src/lib/rentals/listings.ts"), "utf8"));

  it("the listings lib never builds a Storage URL for a listing photo", () => {
    expect(lib).not.toMatch(/getPublicUrl|createSignedUrl/);
    expect(lib).toMatch(/LISTING_PHOTO_BUCKET\s*=\s*"listing-photos"/);
    expect(lib).toMatch(/\/functions\/v1\/listing-photo\?r=/);
  });

  it("no Homes listing screen reads a storage path or a photo_paths field", () => {
    const dir = join(ROOT, "src/components/rentals/listings");
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."));
    const offenders = files.filter((f) => /storage_path|photo_paths|photo_ids/.test(blankComments(readFileSync(join(dir, f), "utf8"))));
    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(3);
  });
});
