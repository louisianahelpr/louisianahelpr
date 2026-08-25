import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The project's `ds-*` type scale, declared under `fontSize` in
 * tailwind.config.ts. Must stay in sync with it.
 *
 * tailwind-merge ships with Tailwind's DEFAULT scale baked in and no knowledge
 * of custom keys, so out of the box it cannot tell `text-ds-10` (a font size)
 * from `text-primary` (a colour) — and its fallback for an unrecognised
 * `text-*` is the TEXT-COLOUR group. That made `cn()` treat the two as
 * conflicting and keep only the last one.
 *
 * The result was silent and looked like a component bug: on a `<Badge>`, which
 * sets `text-primary-foreground` in its variant, adding `className="text-ds-10"`
 * DELETED the foreground colour. The seat-plan "Current" pill on
 * a dark pill on an olive surface rendered `#2e2f22 on #5f6543` = 2.21:1, a WCAG AA failure at
 * 12px, and four admin badges (AdminReferrals ×3, AdminSubscriptions ×1) had
 * the identical defect. Nothing in the markup hinted at a colour being
 * dropped.
 *
 * Teaching tailwind-merge the scale fixes the whole class at the root, so a
 * size and a colour can coexist the way they read.
 */
const DS_FONT_SIZES = [
  "ds-9", "ds-10", "ds-11", "ds-12", "ds-13", "ds-14", "ds-15", "ds-16",
  "ds-17", "ds-18", "ds-20", "ds-22", "ds-24", "ds-26", "ds-28", "ds-32",
  "ds-40",
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...DS_FONT_SIZES] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a full name as "First L." for privacy. */
export function formatName(fullName: string | null | undefined, fallback = "A neighbor"): string {
  // Trim FIRST, then check for emptiness — without this, a whitespace-only
  // string ("   ") was truthy in the `||` check but trimmed to "" and
  // split into [""], returning an empty string. Caught by utils.test.ts.
  const trimmed = (fullName ?? "").trim();
  // No real name → return the fallback verbatim. It's a literal display
  // label ("A neighbor", "this applicant", "Unknown helpr"), NOT a name to
  // run through the "First L." abbreviation — otherwise a multi-word
  // fallback gets mangled ("A neighbor" → "A n.").
  if (trimmed.length === 0) return fallback;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length > 1) {
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  }
  return parts[0];
}
