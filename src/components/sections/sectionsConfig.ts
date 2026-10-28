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
  /** Where the section's own "add one" leads (Declutter's "Sell an item"). Creating from the header lives in
   *  the rail's "+ Create" / the bottom bar's center "+" only (owner 2026-10-28: no section "+"). */
  add: { label: string; path: string };
}

export const SECTIONS: readonly SectionDef[] = [
  { key: "jobs", label: "Jobs", navLabel: "Jobs", path: "/jobs", icon: Briefcase, feature: null, add: { label: "Post a job", path: "/post-job" } },
  { key: "declutter", label: "Declutter", navLabel: "Declutter", path: "/declutter", icon: Sofa, feature: "declutter", add: { label: "Sell an item", path: "/declutter/sell" } },
  { key: "shops", label: "Shops", navLabel: "Shops", path: "/shops", icon: Store, feature: "shops", add: { label: "Add an item or open a shop", path: "/shops/mine" } },
  { key: "homes", label: "Homes", navLabel: "Homes", path: "/rentals", icon: KeyRound, feature: "rentals", add: { label: "Add a property", path: "/rentals?tab=own&add=1" } },
];

export const sectionByKey = (k: SectionKey) => SECTIONS.find((s) => s.key === k)!;

/** The tab every section opens on, always the leftmost segment. */
export const BROWSE = "browse" as const;
