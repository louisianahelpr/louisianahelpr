/**
 * Declutter: one icon per item category, for the card a photo-less item
 * shows (PhotoPlaceholder). Kept apart from declutterUi.tsx so a card outside
 * the Declutter screens (the moving-sale banner) does not pull those in.
 */
import {
  Baby,
  BookOpen,
  CookingPot,
  Dumbbell,
  Flower2,
  Lamp,
  Package,
  Puzzle,
  Refrigerator,
  Shirt,
  Sofa,
  Tv,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export const CATEGORY_ICON: Record<string, LucideIcon> = {
  furniture: Sofa,
  appliances: Refrigerator,
  electronics: Tv,
  kitchen: CookingPot,
  home_decor: Lamp,
  tools: Wrench,
  outdoor_garden: Flower2,
  sports_outdoors: Dumbbell,
  toys_games: Puzzle,
  baby_kids: Baby,
  clothing: Shirt,
  books_media: BookOpen,
  other: Package,
};

export function categoryIcon(category: string | null | undefined): LucideIcon {
  return CATEGORY_ICON[category ?? ""] ?? CATEGORY_ICON.other;
}

/**
 * THE category names, one per category, everywhere in Declutter: Browse's filters and empty states, saved searches,
 * the sell form, Wanted, the item page (lead walkthrough 2026-10-28, shots 11 and 21: Browse said "Decor", "Garden",
 * "Toys", "Baby", "Books" while Sell and Wanted said "Home decor", "Outdoor and garden", ...). Browse's one-word
 * tile names (2026-10-19) went with the tiles (the categories live in the filter sheet since 2026-10-21). Lives here,
 * with no React, so saved searches can read it without loading a screen. declutterUi.tsx re-exports it.
 * Guard: src/test/declutterOneCategoryNameMap.test.ts.
 */
export const CATEGORY_LABEL: Record<string, string> = {
  furniture: "Furniture",
  appliances: "Appliances",
  electronics: "Electronics",
  kitchen: "Kitchen",
  home_decor: "Home decor",
  tools: "Tools",
  outdoor_garden: "Outdoor and garden",
  sports_outdoors: "Sports",
  toys_games: "Toys and games",
  baby_kids: "Baby and kids",
  clothing: "Clothing",
  books_media: "Books and media",
  other: "Other",
};
