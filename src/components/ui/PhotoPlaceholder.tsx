/**
 * What a card shows where its photo would be when there is no photo
 * (owner-approved card designs, 2026-10-19 14:55Z): the thing's category
 * icon on a soft tint of our palette, never a blank grey box. ONE component
 * for every photo-less Declutter item, shop and home, so the three never
 * drift (guard: src/test/photoPlaceholderEverywhere.test.ts).
 *
 * The tint is picked from the category key, so every "Furniture" card wears
 * the same colour and neighbouring categories usually differ.
 */
import type { LucideIcon } from "lucide-react";

/**
 * Background tint and icon colour per tone: olive and rust are the palette's
 * own tokens (dark values in src/index.css); gold and teal are the category
 * hues (src/lib/categoryHues.ts: events, cleaning) with a lifted icon on dark.
 * Shots 2026-10-19: sage and stormy-sky tints read as a grey box, so neither
 * is used.
 */
const TONES = [
  "bg-[hsl(var(--olive)/0.35)] text-[hsl(var(--bark))]",
  "bg-[hsl(var(--burnt-sienna)/0.13)] text-[hsl(var(--accent-ink))]",
  "bg-[hsl(43_60%_50%/0.18)] text-[hsl(38_55%_32%)] dark:text-[hsl(43_60%_62%)]",
  "bg-[hsl(182_30%_44%/0.16)] text-[hsl(182_30%_30%)] dark:text-[hsl(182_30%_62%)]",
] as const;

export const PHOTO_PLACEHOLDER_TONES = TONES.length;
/** The warm sand tint (the gold tone): the job page photo banner wears it for every category. */
const WARM_TONE = 2;

/** A stable tone for a category key: the same key always gets the same tint. */
export function placeholderTone(seed: string | null | undefined): number {
  let h = 0;
  for (const ch of seed ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % TONES.length;
}

export function PhotoPlaceholder({
  icon: Icon,
  seed,
  className = "",
  iconClassName = "h-1/4 w-1/4 min-h-6 min-w-6 max-h-14 max-w-14",
  warm = false,
}: {
  /** The category's icon. */
  icon: LucideIcon;
  /** The category key; picks the tint. */
  seed: string | null | undefined;
  /** Size and shape: the photo box it stands in for (e.g. "aspect-square w-full"). */
  className?: string;
  iconClassName?: string;
  /** One warm tint whatever the seed (the job page's photo banner; lead review 2026-10-20). */
  warm?: boolean;
}) {
  const tone = TONES[warm ? WARM_TONE : placeholderTone(seed)];
  return (
    <span
      data-photo-placeholder=""
      aria-hidden
      className={`flex items-center justify-center ${tone} ${className}`}
    >
      <Icon className={iconClassName} strokeWidth={1.75} />
    </span>
  );
}
