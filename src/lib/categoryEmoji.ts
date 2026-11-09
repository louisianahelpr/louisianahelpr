import type { LucideIcon } from "lucide-react";
import { Car, ClipboardList, Handshake, House, Leaf, MessageCircle, PartyPopper, PawPrint, Repeat, Sparkles, Truck, Wrench } from "lucide-react";
import type { JobCategory } from "./jobCategories";
import type { JobCategoryGroupId } from "./jobCategoryGroups";

/**
 * POST A JOB'S ICONS ARE LINE ICONS (owner UI audit 11-09, F113: "Category cards and the shortcut links use colourful
 * emoji ... while the rest of the app uses thin line icons. Swap the emoji for the same line-icon set used in the left
 * menu"; owner decision 11-09, replacing the 10-21 emoji preference below for the Post a Job screens). Category tiles
 * draw getCategoryIcon (src/lib/categoryIcons.ts, the app's one category -> lucide map); group tiles and the start
 * links draw these. Decorative: always aria-hidden. Guard: src/test/postJobStartFlow.test.tsx.
 */
export const GROUP_ICON: Record<JobCategoryGroupId, LucideIcon> = {
  home: House,
  yard: Leaf,
  moving_errands: Truck,
  auto: Car,
  pets: PawPrint,
  events: PartyPopper,
  trades: Wrench,
  other: MessageCircle,
};

/** The start screen's links (templates, a saved Helpr, the AI builder, repost). */
export const START_ICON = { templates: ClipboardList, offer: Handshake, ai: Sparkles, repost: Repeat } as const;

/**
 * The emoji the Post a Job start screens drew (owner 2026-10-21: "she prefers the EMOJI icons from the
 * mock", ~/Desktop/helpr-postjob-flow-mockup.png; SUPERSEDED on Post a Job by the owner's 11-09 decision above, F113).
 * Jobs Browse's group filter (JobFilters) draws GROUP_ICON too since 11-09 (lead, same owner decision); CATEGORY_EMOJI
 * stays for the start-flow guard's enum check (GROUP_EMOJI, START_EMOJI and categoryEmoji went with F113: unused). ONE map, so a category has exactly one emoji on
 * every start screen. Decorative: always rendered aria-hidden; the label is the accessible name.
 *
 * Typed as a Record over the generated enum, so a new category fails typecheck here until it gets one.
 */
export const CATEGORY_EMOJI: Record<JobCategory, string> = {
  cleaning: "🧹",
  handyman: "🛠️",
  assembly: "🔩",
  painting: "🎨",
  pressure_washing: "💦",
  declutter_help: "🗂️",
  storm_prep: "🌀",
  yard_work: "🌿",
  moving: "📦",
  errands: "🛍️",
  delivery: "🚚",
  auto_repair: "🚗",
  pet_care: "🐾",
  events: "🎉",
  electrical: "⚡",
  plumbing: "🚰",
  hvac: "❄️",
  roofing: "🏠",
  welding: "🔥",
  carpentry: "🪚",
  flooring: "🪵",
  concrete_masonry: "🧱",
  fencing: "🚧",
  appliance_repair: "🧺",
  other: "💬",
};
