/**
 * Shared palettes for the admin analytics surfaces. A plain constants
 * module so both AdminAnalytics and AdminAnalyticsDrilldowns can import
 * them without a circular dependency.
 */

/**
 * Subscription-tier colors — keys the subscriber pie chart and the tier chips.
 * ONE ENTRY PER TIER ON THE LADDER: a missing key is not a cosmetic gap, it
 * renders an undefined fill (CC-019 — Plus had no colour, no chip and no pie
 * slice on any admin surface). `TIER_CHIP_CLASSES` below is the same map for
 * the Badge variants.
 */
export const TIER_COLORS: Record<string, string> = {
  free: "hsl(var(--muted))",
  basic: "hsl(var(--secondary))",
  pro: "hsl(var(--primary))",
  plus: "hsl(var(--burnt-sienna))",
  elite: "hsl(var(--accent))",
};

/**
 * Badge classes per tier for the ANALYTICS chips and drill-downs.
 *
 * Values carried over verbatim from the per-tier literals they replace,
 * including the contrast fix on Elite: `--accent-ink`, not `--accent`, because
 * the accent label measured 3.9:1 in dark. AdminSubscriptions keeps its own
 * gold palette (documented in that file) — this map is not it.
 */
export const TIER_CHIP_CLASSES: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  basic: "bg-secondary text-secondary-foreground",
  pro: "bg-primary/10 text-primary",
  plus: "bg-[hsl(var(--burnt-sienna))]/10 text-[hsl(var(--burnt-sienna))]",
  elite: "bg-accent/20 text-[hsl(var(--accent-ink))]",
};

/**
 * Categorical palette — pie slices + category swatches.
 * Slots 0–3 and 5 use brand tokens; slots 4 and 6–9 are intentional
 * data-viz extras (amber, pink, teal, orange, cyan) that extend the
 * categorical range beyond the product brand palette.
 */
export const PIE_COLORS = ["hsl(var(--primary))", "hsl(var(--secondary))", "hsl(var(--accent))", "hsl(var(--muted))", "#f59e0b", "hsl(var(--burnt-sienna))", "#ec4899", "#14b8a6", "#f97316", "#06b6d4"];
