import { Briefcase, Sofa, Store, KeyRound, type LucideIcon } from "lucide-react";

/**
 * The four sections (owner final decisions, 2026-10-19). One list for the
 * bottom nav, Home's "Your sections" boxes and the Customize sheet, so the
 * three cannot drift. `feature` is the switch that makes a section live for a
 * viewer (null = always live); a switched-off section shows greyed, "coming soon".
 */
export type SectionKey = "jobs" | "declutter" | "shops" | "homes";

export interface SectionDef {
  key: SectionKey;
  label: string;
  /** Short label for the bottom nav. */
  navLabel: string;
  path: string;
  icon: LucideIcon;
  feature: "declutter" | "shops" | "rentals" | null;
  /** The section's own "+" in its top bar. */
  add: { label: string; path: string };
  /** One line under the section's name on Explore. */
  blurb: string;
  /** Its tile in the center "+" sheet (owner-approved mock-up, 2026-10-20). Copy must be true today. */
  create: { title: string; blurb: string };
}

export const SECTIONS: readonly SectionDef[] = [
  { key: "jobs", label: "Jobs", navLabel: "Jobs", path: "/jobs", icon: Briefcase, feature: null, add: { label: "Post a job", path: "/post-job" }, blurb: "Hire local help or find work", create: { title: "Post a job", blurb: "Local help, money held until it's done" } },
  { key: "declutter", label: "Declutter", navLabel: "Declutter", path: "/declutter", icon: Sofa, feature: "declutter", add: { label: "Sell an item", path: "/declutter/sell" }, blurb: "Buy and sell things near you", create: { title: "Sell an item", blurb: "Photos, price, done" } },
  { key: "shops", label: "Shops", navLabel: "Shops", path: "/shops", icon: Store, feature: "shops", add: { label: "Add an item or open a shop", path: "/shops/mine" }, blurb: "Local makers and stores", create: { title: "Open a shop", blurb: "Your page, orders and payouts" } },
  { key: "homes", label: "Homes", navLabel: "Homes", path: "/rentals", icon: KeyRound, feature: "rentals", add: { label: "Add a property", path: "/rentals?tab=own&add=1" }, blurb: "Homes to rent or buy", create: { title: "List a home", blurb: "Rent it out or put it up for sale" } },
];

export const sectionByKey = (k: SectionKey) => SECTIONS.find((s) => s.key === k)!;

/** The tab every section opens on, always the leftmost segment. */
export const BROWSE = "browse" as const;
