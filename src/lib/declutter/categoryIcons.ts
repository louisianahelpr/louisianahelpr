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

