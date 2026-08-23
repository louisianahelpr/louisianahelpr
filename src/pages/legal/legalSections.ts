import { Scale, Users, Lock, type LucideIcon } from "lucide-react";

// Tier pricing/fees come from the single source of truth so this page can
// never drift from the Subscription page or the in-feed fee math (LH-30).
export const legalFmtMo = (n: number | null) => (n == null ? "free" : `$${n.toFixed(2)}/mo`);

export type TabKey = "terms" | "community" | "privacy";
export const VALID_TABS: TabKey[] = ["terms", "community", "privacy"];

export const PAGE_TITLES: Record<TabKey, string> = {
  terms: "Terms of Service — Helpr",
  community: "Community Rules — Helpr",
  privacy: "Privacy Policy — Helpr",
};

export const PAGE_DESCRIPTIONS: Record<TabKey, string> = {
  terms:
    "Helpr's Terms of Service — eligibility, binding job agreements, escrow, split fees, membership tiers, and tax responsibilities for Louisiana's job marketplace.",
  community:
    "Helpr's Community Rules — cancellation windows, escrow release, the revision-and-dispute process, strikes, bans, and money-and-taxes guidance.",
  privacy:
    "Helpr's Privacy Policy — what we collect, how we use it, who we share with, data security, and your rights. We never sell your personal data.",
};

// The default `terms` tab uses the clean /legal URL as its canonical;
// the other tabs canonicalize to their ?tab= URL (which /rules and
// /terms-style redirect stubs also point at), so each policy view has a
// single, stable indexable URL.
export const PAGE_CANONICALS: Record<TabKey, string> = {
  terms: "https://www.louisianahelpr.com/legal",
  community: "https://www.louisianahelpr.com/legal?tab=community",
  privacy: "https://www.louisianahelpr.com/legal?tab=privacy",
};

// Per-tab revision date shown in each tab's PolicyFooter. Each policy
// revises on its own schedule, so the footer reflects the active tab's date
// rather than implying all three changed together — bump only the tab you
// actually edited.
export const LAST_UPDATED: Record<TabKey, string> = {
  terms: "Jun 2026",
  community: "Jun 2026",
  privacy: "Jun 2026",
};

// Short editorial line shown under the tab strip so each policy view
// opens with a human, plain-English framing instead of a blank jump
// straight into dense sections.
export const TAB_TAGLINES: Record<TabKey, string> = {
  terms: "The agreement you accept when you use Helpr.",
  community: "How we keep jobs fair, safe, and accountable.",
  privacy: "What we collect, why, and the control you keep.",
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
