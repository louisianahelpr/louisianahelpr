import type { CSSProperties } from "react";

// The Once / Monthly / Annual segments of the Membership billing toggle, and
// the paint of the sliding pill behind the active one. Pure data, moved out of
// SubscriptionTab.tsx so that file stays under its component-size baseline;
// nothing about the pill's look or the options changed.
export const BILLING_OPTIONS = [
  { key: "one_time" as const, label: "Once" },
  { key: "monthly" as const, label: "Monthly" },
  { key: "annual" as const, label: "Annual" },
];

export const BILLING_PILL_STYLE: CSSProperties = {
  border: "1px solid hsl(var(--bark-border))",
  boxShadow:
    "inset 0 1px 0 hsl(var(--parchment) / 0.22), " +
    "0 1px 1px hsl(var(--ink-deep) / 0.10), " +
    "0 2px 6px hsl(var(--ink-deep) / 0.12), " +
    "0 4px 12px -2px hsl(var(--ink-deep) / 0.08)",
};
