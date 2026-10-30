import { Briefcase, Sofa, Store, KeyRound, type LucideIcon } from "lucide-react";
import { SELL_CHOOSER_PATH } from "@/lib/declutter/sellChooser";

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
  /** The section's own "add one": the desktop website's soft "+ Post a job"-style button in the top bar
   *  (AppTopBar; owner 2026-10-28, later the same day: "add the post a job and post an item or whatever buttons
   *  back on the top nav maybe just make it the lighter green") and Declutter's "Sell an item". `cta`: shorter
   *  visible words when `label` is long (the label stays the accessible name). */
  add: { label: string; path: string; cta?: string };
}

export const SECTIONS: readonly SectionDef[] = [
  { key: "jobs", label: "Jobs", navLabel: "Jobs", path: "/jobs", icon: Briefcase, feature: null, add: { label: "Post a job", path: "/post-job" } },
  { key: "declutter", label: "Declutter", navLabel: "Declutter", path: "/declutter", icon: Sofa, feature: "declutter", add: { label: "Sell an item", path: SELL_CHOOSER_PATH } },
  { key: "shops", label: "Shops", navLabel: "Shops", path: "/shops", icon: Store, feature: "shops", add: { label: "Add an item or open a shop", path: "/shops/mine", cta: "Open a shop" } },
  { key: "homes", label: "Homes", navLabel: "Homes", path: "/rentals", icon: KeyRound, feature: "rentals", add: { label: "Add a property", path: "/rentals?tab=own&add=1" } },
];

export const sectionByKey = (k: SectionKey) => SECTIONS.find((s) => s.key === k)!;

/** The tab every section opens on, always the leftmost segment. */
export const BROWSE = "browse" as const;
