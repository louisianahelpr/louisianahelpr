/**
 * Shared palettes for the admin analytics surfaces. A plain constants
 * module so both AdminAnalytics and AdminAnalyticsDrilldowns can import
 * them without a circular dependency.
 */

/** Subscription-tier colors — keys the subscriber pie chart. */
export const TIER_COLORS: Record<string, string> = {
  basic: "hsl(var(--secondary))",
  pro: "hsl(var(--primary))",
  plus: "hsl(var(--burnt-sienna))",
  elite: "hsl(var(--accent))",
  free: "hsl(var(--muted))",
};

/**
 * Categorical palette — pie slices + category swatches.
 * Slots 0–3 and 5 use brand tokens; slots 4 and 6–9 are intentional
 * data-viz extras (amber, pink, teal, orange, cyan) that extend the
 * categorical range beyond the product brand palette.
 */
export const PIE_COLORS = ["hsl(var(--primary))", "hsl(var(--secondary))", "hsl(var(--accent))", "hsl(var(--muted))", "#f59e0b", "hsl(var(--burnt-sienna))", "#ec4899", "#14b8a6", "#f97316", "#06b6d4"];
