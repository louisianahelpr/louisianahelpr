/**
 * A3-C18 (owner 2026-10-29): the privacy policy lists what a member's profile
 * shows to other members. It said "first name, profile photo, ratings and
 * reviews" (and, on the summary card, "only ... first name, photo, and
 * ratings") while the profile also shows the last initial, area, bio, badges
 * and every completed job with its price.
 *
 * Tied to the source of truth: every column the NEWEST get_safe_profiles
 * returns that a profile screen shows must have its line in PROFILE_SHOWS, the
 * policy must render that list, and neither "only first name" sentence may
 * come back.
 */
// @mutate src/pages/info/legal/PrivacySection.tsx |               {PROFILE_SHOWS.map((item) => <li key={item}>{item}</li>)} |               {null}
// @mutate src/pages/info/legal/PrivacySection.tsx | Other members see your first name and last initial, photo, area, profile, badges, reviews and job record, never your surname, contact details or address. | Other users only see your first name, photo, and ratings.
// @mutate src/pages/info/legal/profileVisibility.ts |   "The town or area you list", |   "Your neighbourhood",
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";
import { PROFILE_SHOWS, PROFILE_NEVER_SHOWS } from "@/pages/info/legal/profileVisibility";

const policy = blankComments(readFileSync("src/pages/info/legal/PrivacySection.tsx", "utf8"));
const safe = latestFunctionDefs(join(process.cwd(), "supabase", "migrations")).get("get_safe_profiles");
const returns = readFileSync(join(process.cwd(), "supabase", "migrations", safe?.file ?? "missing"), "utf8")
  .match(/FUNCTION public\.get_safe_profiles\(user_ids uuid\[\]\)\s*RETURNS TABLE\(([^)]*)\)/)?.[1] ?? "";

/** get_safe_profiles column -> the words its PROFILE_SHOWS line must carry. */
const SHOWN: Record<string, RegExp> = {
  full_name: /first name and the first letter of your last name/,
  avatar_url: /profile photo/,
  location: /town or area/,
  bio: /write about yourself/,
  skills: /skills/,
  portfolio_urls: /work photos/,
  created_at: /when you joined/i,
  is_id_verified: /ID verified/,
  is_payout_ready: /payouts set up/,
  license_status: /license or insurance/,
  business_name: /business name/,
  subscription_tier: /membership/,
};

describe("A3-C18: the privacy policy says what profiles show", () => {
  it("reads the newest get_safe_profiles (floor)", () => {
    expect(safe?.file ?? "").toMatch(/\.sql$/);
    expect(returns.split(",").length).toBeGreaterThan(15);
  });

  it("every shown get_safe_profiles column has its line", () => {
    const missing: string[] = [];
    for (const [col, words] of Object.entries(SHOWN)) {
      expect(returns, `get_safe_profiles no longer returns ${col}; update SHOWN and the policy`).toMatch(new RegExp(`\\b${col}\\b`));
      if (!PROFILE_SHOWS.some((line) => words.test(line))) missing.push(col);
    }
    expect(missing).toEqual([]);
  });

  it("the job record, reviews and sale items are listed too", () => {
    expect(PROFILE_SHOWS.some((l) => /jobs you have completed .*title, date, type of work and price/.test(l))).toBe(true);
    expect(PROFILE_SHOWS.some((l) => /reviews people leave you/.test(l))).toBe(true);
    expect(PROFILE_SHOWS.some((l) => /worked on together/.test(l))).toBe(true);
    expect(PROFILE_SHOWS.some((l) => /for sale/.test(l))).toBe(true);
    expect(PROFILE_NEVER_SHOWS).toMatch(/surname, email, phone, street address/);
  });

  it("the policy renders the list, and the old 'only first name' lines are gone", () => {
    expect(policy).toMatch(/\{PROFILE_SHOWS\.map\(\(item\) => <li key=\{item\}>\{item\}<\/li>\)\}/);
    expect(policy).toMatch(/\{PROFILE_NEVER_SHOWS\}/);
    expect(policy).not.toMatch(/only see your first name/i);
    expect(policy).not.toMatch(/Your first name, profile photo, ratings, and reviews are visible/);
  });
});
