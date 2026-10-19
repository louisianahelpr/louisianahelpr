/**
 * Shops: one icon per category group, for the card a shop with no cover photo
 * shows (PhotoPlaceholder). Groups, not the ~80 categories: a bakery and a
 * food truck share the food icon. An unknown group falls back to the shop
 * icon.
 */
import {
  Briefcase,
  Car,
  Dumbbell,
  GraduationCap,
  Hammer,
  PartyPopper,
  PawPrint,
  Scissors,
  ShoppingBag,
  Sparkles,
  Store,
  Trees,
  Utensils,
  type LucideIcon,
} from "lucide-react";

export const SHOP_GROUP_ICON: Record<string, LucideIcon> = {
  food_to_order: Utensils,
  home_services: Sparkles,
  trades: Hammer,
  auto_marine: Car,
  beauty: Scissors,
  events_party: PartyPopper,
  health_fitness: Dumbbell,
  pets: PawPrint,
  lessons: GraduationCap,
  outdoors: Trees,
  local_pros: Briefcase,
  made_locally: ShoppingBag,
  other: Store,
};

export function shopGroupIcon(group: string | null | undefined): LucideIcon {
  return SHOP_GROUP_ICON[group ?? ""] ?? Store;
}
