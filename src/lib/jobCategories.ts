import type { Database } from "@/integrations/supabase/types";
import { formatCategory } from "./format";

/**
 * THE canonical job-category table: value → label → display order.
 *
 * Every surface that lists or labels a category (post-a-job picker, browse
 * filter chips, the map popup, admin, saved searches) reads from here. It
 * used to be four hand-maintained copies, which had drifted three ways:
 * different order, `storm_prep` rendering as "Storm prep" when filtering but
 * "Storm" when posting, and the browse filter offering categories the poster
 * couldn't select.
 *
 * ORDER is the post-a-job popularity order (most-requested first, "Other"
 * last as the escape hatch) — deliberate, and now shared everywhere.
 *
 * VALUES are the `job_category` Postgres enum and are fixed; this is a
 * presentation-layer table only. `JobCategory` is typed off the generated
 * enum so adding/removing a DB value fails the build here first.
 */
export type JobCategory = Database["public"]["Enums"]["job_category"];

export const JOB_CATEGORY_LABELS: Record<JobCategory, string> = {
  cleaning: "Cleaning",
  yard_work: "Yard Work",
  handyman: "Handyman",
  moving: "Moving",
  errands: "Errands",
  delivery: "Delivery",
  pet_care: "Pet Care",
  assembly: "Assembly",
  painting: "Painting",
  storm_prep: "Storm Prep",
  events: "Events",
  // Trades (owner decision T1, 2026-10-14): every common trade gets its own
  // category, and "Other" stays last as the escape hatch for anything else.
  electrical: "Electrical",
  plumbing: "Plumbing",
  hvac: "HVAC",
  roofing: "Roofing",
  welding: "Welding",
  carpentry: "Carpentry",
  auto_repair: "Auto & Small Engine",
  appliance_repair: "Appliance Repair",
  flooring: "Flooring & Tile",
  concrete_masonry: "Concrete & Masonry",
  fencing: "Fencing",
  pressure_washing: "Pressure Washing",
  // Mobile, "we come to you" services (owner decision 2026-10-19). IV hydration
  // and other medical services are deliberately left out (owner: not for now).
  tire_service: "Tire Service",
  dent_windshield: "Dent & Windshield",
  car_detailing: "Car Detailing",
  locksmith: "Locksmith & Car Keys",
  pet_grooming: "Pet Grooming",
  pet_waste_removal: "Pet Waste Removal",
  mobile_vet: "Mobile Vet",
  gutter_cleaning: "Gutter Cleaning",
  window_washing: "Window Washing",
  tv_mounting: "Smart Home & TV",
  hair_stylist: "Hair Stylist",
  makeup_spray_tan: "Makeup & Spray Tan",
  massage: "Massage",
  mobile_bartending: "Mobile Bartending",
  drink_carts: "Coffee & Drink Carts",
  food_truck: "Food Truck Catering",
  photo_booth: "Photo Booth & Rentals",
  other: "Other",
};

/** Canonical ordered value list. */
export const JOB_CATEGORY_VALUES = Object.keys(JOB_CATEGORY_LABELS) as JobCategory[];

/** Canonical ordered `{ value, label }` list for pickers and chip rows. */
export const JOB_CATEGORIES: ReadonlyArray<{ value: JobCategory; label: string }> =
  JOB_CATEGORY_VALUES.map((value) => ({ value, label: JOB_CATEGORY_LABELS[value] }));

/**
 * The wording a category's SKILL chip uses on the profile editor (saved into
 * profiles.skills). "Moving" and "Events" get a nudge ("Moving Help" / "Event
 * Help") since they describe a skill offered, not a job being posted. Mirrored
 * by supabase/functions/_shared/categorySkillMatch.ts SKILL_CHIP_LABELS, which
 * job-match scoring reads (Q1832; src/test/edge/instant-job-match.test.ts).
 */
export function skillChipLabel(value: JobCategory): string {
  return value === "moving" ? "Moving Help" : value === "events" ? "Event Help" : JOB_CATEGORY_LABELS[value];
}

/** Label for a category value, falling back to the raw value. */
export function jobCategoryLabel(value: string): string {
  return JOB_CATEGORY_LABELS[value as JobCategory] ?? formatCategory(value);
}

/**
 * The main categories for the two-step picker (main category first, then its
 * subs; owner 2026-10-19). Every category sits in exactly one group
 * (jobCategoryGroups.test.ts). "Other" is its own last group so the escape
 * hatch stays one tap from the top.
 */
export interface JobCategoryGroup {
  slug: string;
  label: string;
  /** The category whose icon and colour stand for the whole group. */
  icon: JobCategory;
  items: ReadonlyArray<JobCategory>;
}

export const JOB_CATEGORY_GROUPS: ReadonlyArray<JobCategoryGroup> = [
  {
    slug: "home",
    label: "Home",
    icon: "handyman",
    items: ["cleaning", "yard_work", "handyman", "assembly", "painting", "storm_prep", "pressure_washing", "gutter_cleaning", "window_washing", "tv_mounting", "appliance_repair"],
  },
  { slug: "moving_errands", label: "Moving & Errands", icon: "moving", items: ["moving", "errands", "delivery"] },
  {
    slug: "trades",
    label: "Trades",
    icon: "electrical",
    items: ["electrical", "plumbing", "hvac", "roofing", "welding", "carpentry", "flooring", "concrete_masonry", "fencing"],
  },
  { slug: "automotive", label: "Automotive", icon: "auto_repair", items: ["auto_repair", "tire_service", "dent_windshield", "car_detailing", "locksmith"] },
  { slug: "pets", label: "Pets", icon: "pet_care", items: ["pet_care", "pet_grooming", "pet_waste_removal", "mobile_vet"] },
  { slug: "beauty", label: "Beauty & Self-Care", icon: "hair_stylist", items: ["hair_stylist", "makeup_spray_tan", "massage"] },
  { slug: "events", label: "Events", icon: "events", items: ["events", "mobile_bartending", "drink_carts", "food_truck", "photo_booth"] },
  { slug: "other", label: "Other", icon: "other", items: ["other"] },
];

/** `{ slug, label, items: { slug, label }[] }` groups for TwoStepCategoryPicker. */
export const JOB_CATEGORY_PICKER_GROUPS = JOB_CATEGORY_GROUPS.map((g) => ({
  slug: g.slug,
  label: g.label,
  items: g.items.map((value) => ({ slug: value, label: JOB_CATEGORY_LABELS[value] })),
}));

/** The main group a category belongs to (undefined for an unknown value). */
export function jobCategoryGroupOf(value: string): JobCategoryGroup | undefined {
  return JOB_CATEGORY_GROUPS.find((g) => (g.items as ReadonlyArray<string>).includes(value));
}

/**
 * Categories where a Helpr must hold a VERIFIED license that covers the
 * category before they can apply to, quote on or accept a job in it (owner
 * 2026-10-19: "license required"). A poster can always post in any of them;
 * the job card says "Licensed pros only". The server is the authority: the
 * same set is `public.category_requires_license()` (migration
 * 20261019184158_category_license_required.sql), enforced on applications,
 * quotes and awards; categoryLicenseParity.test.ts keeps the two equal.
 * The license each one means (shown to the Helpr when they upload it):
 */
export const LICENSE_REQUIRED_CATEGORIES: Readonly<Partial<Record<JobCategory, string>>> = {
  locksmith: "a Louisiana locksmith license",
  mobile_vet: "a Louisiana veterinary license",
  hair_stylist: "a Louisiana Board of Cosmetology license",
  massage: "a Louisiana massage therapy license",
  mobile_bartending: "a Louisiana ATC server permit (bar card)",
};

export function categoryRequiresLicense(value: string | null | undefined): boolean {
  return !!value && Object.prototype.hasOwnProperty.call(LICENSE_REQUIRED_CATEGORIES, value);
}
