/**
 * Declutter's item categories: THE one list (owner 2026-10-30, via the lead: "the more the better so people can
 * filter easily, make it Louisiana-specific plus general"). Adding a category is one entry in CATEGORIES below plus
 * the same key in the listing helper's list (supabase/functions/declutter-ai-draft/sanitize.ts
 * DECLUTTER_CATEGORIES, which the edge function cannot import from here); src/test/declutterCategoryList.test.ts
 * fails until both say the same. The database takes any lower_snake key (declutter_items_category_check), so no
 * migration is needed, and an item keeps the category it was listed with.
 *
 * Each entry: the key stored on the item, its one name everywhere in Declutter (Browse's filters and empty states,
 * saved searches, the sell form, Wanted, the item page: lead walkthrough 2026-10-28, shots 11 and 21), the icon a
 * photo-less card shows (PhotoPlaceholder), and the heading it sits under in the Sell picker and the Browse filter
 * (about 32 categories, so they are grouped). "Other" is last. No React here, so saved searches can read it without
 * loading a screen; declutterUi.tsx re-exports the names. Guard: src/test/declutterOneCategoryNameMap.test.ts.
 */
import {
  Archive,
  Baby,
  Bath,
  Bike,
  BookOpen,
  Briefcase,
  Car,
  CookingPot,
  Dumbbell,
  Fish,
  Flag,
  Flower2,
  Gem,
  Gift,
  Guitar,
  HeartPulse,
  Hourglass,
  Lamp,
  Package,
  PackageOpen,
  Palette,
  PartyPopper,
  PawPrint,
  Puzzle,
  Refrigerator,
  Sailboat,
  Shirt,
  Sofa,
  Sparkles,
  Tent,
  Tv,
  Wrench,
  type LucideIcon,
} from "lucide-react";

// A3-110: the last heading is "More", so "Other" shows once (as the chip), not as a heading over its own chip.
const CATEGORY_GROUP_HEADINGS = ["Home", "Outdoors", "Family", "Hobbies and fun", "More"] as const;
export type CategoryGroupHeading = (typeof CATEGORY_GROUP_HEADINGS)[number];

interface CategoryEntry {
  key: string;
  label: string;
  icon: LucideIcon;
  group: CategoryGroupHeading;
}

export const CATEGORIES: readonly CategoryEntry[] = [
  { key: "furniture", label: "Furniture", icon: Sofa, group: "Home" },
  { key: "appliances", label: "Appliances", icon: Refrigerator, group: "Home" },
  { key: "electronics", label: "Electronics", icon: Tv, group: "Home" },
  { key: "kitchen", label: "Kitchen", icon: CookingPot, group: "Home" },
  { key: "home_decor", label: "Home decor", icon: Lamp, group: "Home" },
  { key: "bedding_bath", label: "Bedding and bath", icon: Bath, group: "Home" },
  { key: "storage_organization", label: "Storage and organization", icon: Archive, group: "Home" },
  { key: "tools", label: "Tools", icon: Wrench, group: "Home" },
  { key: "outdoor_garden", label: "Outdoor and garden", icon: Flower2, group: "Outdoors" },
  { key: "sports_outdoors", label: "Sports", icon: Dumbbell, group: "Outdoors" },
  { key: "exercise_fitness", label: "Exercise and fitness", icon: HeartPulse, group: "Outdoors" },
  { key: "hunting_fishing", label: "Hunting and fishing", icon: Fish, group: "Outdoors" },
  { key: "boats_marine", label: "Boats and marine", icon: Sailboat, group: "Outdoors" },
  { key: "camping", label: "Camping", icon: Tent, group: "Outdoors" },
  { key: "bikes", label: "Bikes", icon: Bike, group: "Outdoors" },
  { key: "auto_parts", label: "Auto parts and accessories", icon: Car, group: "Outdoors" },
  { key: "baby_kids", label: "Baby and kids", icon: Baby, group: "Family" },
  { key: "toys_games", label: "Toys and games", icon: Puzzle, group: "Family" },
  { key: "clothing", label: "Clothing", icon: Shirt, group: "Family" },
  { key: "jewelry_accessories", label: "Jewelry and accessories", icon: Gem, group: "Family" },
  { key: "health_beauty", label: "Health and beauty", icon: Sparkles, group: "Family" },
  { key: "pets", label: "Pets", icon: PawPrint, group: "Family" },
  { key: "office_school", label: "Office and school", icon: Briefcase, group: "Family" },
  { key: "books_media", label: "Books and media", icon: BookOpen, group: "Hobbies and fun" },
  { key: "crafts_hobbies", label: "Crafts and hobbies", icon: Palette, group: "Hobbies and fun" },
  { key: "musical_instruments", label: "Musical instruments", icon: Guitar, group: "Hobbies and fun" },
  { key: "collectibles_antiques", label: "Collectibles and antiques", icon: Hourglass, group: "Hobbies and fun" },
  { key: "holiday_seasonal", label: "Holiday and seasonal", icon: Gift, group: "Hobbies and fun" },
  { key: "tailgating_game_day", label: "Tailgating and game day", icon: Flag, group: "Hobbies and fun" },
  { key: "party_events", label: "Party and events", icon: PartyPopper, group: "Hobbies and fun" },
  { key: "moving_supplies", label: "Moving boxes and supplies", icon: PackageOpen, group: "More" },
  { key: "other", label: "Other", icon: Package, group: "More" },
];

export const CATEGORY_ICON: Record<string, LucideIcon> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.icon]));

export function categoryIcon(category: string | null | undefined): LucideIcon {
  return CATEGORY_ICON[category ?? ""] ?? CATEGORY_ICON.other;
}

/** THE category names, one per category, in picker order ("Other" last). */
export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

/** The categories under their headings, for the Sell picker and the Browse filter. */
export const CATEGORY_GROUPS: { heading: CategoryGroupHeading; values: string[] }[] = CATEGORY_GROUP_HEADINGS.map((heading) => ({
  heading,
  values: CATEGORIES.filter((c) => c.group === heading).map((c) => c.key),
}));

/** CATEGORY_GROUPS in the shape of the shared TwoStepCategoryPicker: a short form's category control (no <optgroup>). */
export const CATEGORY_PICKER_GROUPS = CATEGORY_GROUPS.map((g) => ({
  slug: g.heading,
  label: g.heading,
  items: g.values.map((k) => ({ slug: k, label: CATEGORY_LABEL[k] })),
}));
