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

// Same class of bug as DS_FONT_SIZES above, one group over: tailwind-merge
// ships Tailwind's default `rounded-*` scale (sm/md/lg/…) but has no idea
// `rounded-ds-lg`/`rounded-ds-md`/`rounded-ds-sm` (this project's own radius
// scale, declared in tailwind.config.ts's borderRadius) belong to the SAME
// group. Unrecognised, `rounded-ds-lg` doesn't get deduped against a
// component's own default `rounded-md` — both classes ship in the DOM, and
// whichever wins the cascade (not necessarily the one written last) is what
// renders. That's exactly how FilterSheet's desktop popover — which passes
// `className="... rounded-ds-lg ..."` into <PopoverContent>, whose own
// default className already carries `rounded-md` — ended up with square
// corners: `rounded-md` (6px) was winning over the intended 20px.
const DS_RADII = ["ds-sm", "ds-md", "ds-lg", "ds-avatar", "ds-pill"] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...DS_FONT_SIZES] }],
      rounded: [{ rounded: [...DS_RADII] }],
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

/**
 * Keep the FIRST occurrence of each `id`, preserving order.
 *
 * Both job feeds page with plain OFFSET/LIMIT over a rank that can change
 * between two page fetches — `get_ranked_open_jobs` orders by `rank_score`,
 * where buying a boost adds +1000 and moves that row to position 0, and the
 * dashboard view orders by `boosted_at`. When a row jumps ABOVE the current
 * offset mid-scroll every later row shifts down one slot, so the next page
 * re-serves the row that was already the last card of the previous page.
 * Reproduced against prod: page 1 of `get_ranked_open_jobs(4,0)`, a boost on a
 * row further down, then `(4,4)` returned page 1's final id as its first.
 *
 * This kills the visible duplicate-card symptom only. The symmetric case — a
 * row shifting DOWN past the offset and never being served at all — is
 * invisible here and needs a keyset cursor to fix properly.
 */
export function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}
