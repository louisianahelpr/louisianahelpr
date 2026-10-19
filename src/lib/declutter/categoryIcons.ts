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
 * One word per category for Browse's category tiles (lead, 2026-10-19: icon
 * plus one word). The full names (CATEGORY_LABEL in declutterUi.tsx) stay on
 * the item page and in the sell form.
 */
export const CATEGORY_WORD: Record<string, string> = {
  furniture: "Furniture",
  appliances: "Appliances",
  electronics: "Electronics",
  kitchen: "Kitchen",
  home_decor: "Decor",
  tools: "Tools",
  outdoor_garden: "Garden",
  sports_outdoors: "Sports",
  toys_games: "Toys",
  baby_kids: "Baby",
  clothing: "Clothing",
  books_media: "Books",
  other: "Other",
};
