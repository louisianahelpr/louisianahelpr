import { Scale, Users, Lock, type LucideIcon } from "lucide-react";
import { LEGAL_PAGE_META } from "@/lib/publicPageMeta.mjs";

// Tier pricing/fees come from the single source of truth so this page can
// never drift from the Subscription page or the in-feed fee math (LH-30).
export const legalFmtMo = (n: number | null) => (n == null ? "free" : `$${n.toFixed(2)}/mo`);

export type TabKey = "terms" | "community" | "privacy";
export const VALID_TABS: TabKey[] = ["terms", "community", "privacy"];

// Title, description and canonical per tab live in the ONE table the
// pre-JS HTML is also built from (src/lib/publicPageMeta.mjs, read by
// api/share.ts), so what a crawler sees before JavaScript and what
// usePageMeta sets after it cannot drift (lh-seo-web SW-001/SW-002).
// The default `terms` tab uses the clean /legal URL as its canonical;
// the other tabs canonicalize to their ?tab= URL (which /rules, /terms and
// /privacy also point at), so each policy view has a single, stable
// indexable URL.
export const PAGE_TITLES: Record<TabKey, string> = {
  terms: LEGAL_PAGE_META.terms.title,
  community: LEGAL_PAGE_META.community.title,
  privacy: LEGAL_PAGE_META.privacy.title,
};

export const PAGE_DESCRIPTIONS: Record<TabKey, string> = {
  terms: LEGAL_PAGE_META.terms.description,
  community: LEGAL_PAGE_META.community.description,
  privacy: LEGAL_PAGE_META.privacy.description,
};

export const PAGE_CANONICALS: Record<TabKey, string> = {
  terms: LEGAL_PAGE_META.terms.canonical,
  community: LEGAL_PAGE_META.community.canonical,
  privacy: LEGAL_PAGE_META.privacy.canonical,
};

// Per-tab revision date shown in each tab's PolicyFooter. Each policy
// revises on its own schedule, so the footer reflects the active tab's date
// rather than implying all three changed together — bump only the tab you
// actually edited.
export const LAST_UPDATED: Record<TabKey, string> = {
  terms: "Sep 2026",
  community: "Jun 2026",
  privacy: "Jun 2026",
};


export const TAB_LABELS: Record<TabKey, string> = {
  terms: "Terms",
  community: "Rules",
  privacy: "Privacy",
};

// One glyph per tab, echoing the iconography used inside the section
// cards (Scale = agreement, Users = community, Lock = privacy) so the
// strip is scannable at a glance.
export const TAB_ICONS: Record<TabKey, LucideIcon> = {
  terms: Scale,
  community: Users,
  privacy: Lock,
};

// Full origin labels for the per-result chip shown during a cross-tab
// search ("Community Rules" rather than the terse strip label "Community").
export const TAB_ORIGIN_LABELS: Record<TabKey, string> = {
  terms: "Terms",
  community: "Community Rules",
  privacy: "Privacy",
};

// (No TAB_TOC. It fed the desktop "On this page" sidebar on /legal, which was
// removed: it listed the same section headings that sat immediately to its
// right — every PolicySection header is already on screen — so it duplicated
// visible content and cost a 14rem column. Each policy's anchorIds still live
// on the sections themselves for deep-linking.)
