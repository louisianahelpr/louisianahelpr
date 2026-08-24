/**
 * avatarGradient — deterministic warm-palette gradient classes for avatar
 * fallbacks, hashed from a stable seed (typically `user_id`).
 *
 * Why arbitrary `[hsl(var(--token))]` strings rather than bare tokens?
 * Tailwind's theme only exposes a small set of semantic colors
 * (`primary`, `accent`, `card`, `muted`, …); the warm brand tokens
 * (`--parchment`, `--bark`, `--burnt-sienna`, `--olivewood`, `--gold-warm`,
 * `--sand`) live in `src/index.css` as CSS custom properties and are
 * consumed across the codebase via `hsl(var(--…))`. The two-stop strings
 * below pair an always-warm cream base with a deeper brand accent so a
 * dark-ink initial is comfortably readable on every variant.
 *
 * Output is a Tailwind class fragment (no leading `bg-gradient-to-*`) —
 * callers compose it via `cn("bg-gradient-to-br", avatarGradientFor(id))`,
 * matching the conventions used by `Button` / signup hero panels.
 *
 * The hash is djb2 over the seed string and is pure + deterministic, so the
 * same user always gets the same gradient across mounts, devices, and
 * re-renders.
 *
 * Palette rationale (each pair):
 *  - Starts at a light, warm cream (parchment or ivory-sand) so the dark-ink
 *    initials have maximum legibility at the lightest point.
 *  - Ends at a mid-depth brand tone at ~50% opacity so the gradient feels
 *    rich without going so dark that text contrast suffers. The opacity
 *    range 0.50–0.68 was recalibrated (2026-08-24 — owner: initials read faint at a glance) to stay above WCAG AA for dark initials.
 */

const GRADIENTS: readonly string[] = [
  // 1. Parchment → bark: soft olive deepening — the "default" warm tone
  "from-[hsl(var(--parchment))] to-[hsl(var(--bark)/0.62)]",
  // 2. Parchment → burnt sienna: warm rust accent, the brand emphasis color
  "from-[hsl(var(--parchment))] to-[hsl(var(--burnt-sienna)/0.56)]",
  // 3. Parchment → olivewood: deep dark-ground, serious and earthy
  "from-[hsl(var(--parchment))] to-[hsl(var(--olivewood)/0.62)]",
  // 4. Parchment → gold-warm: antique gold, the prestige variant
  "from-[hsl(var(--parchment))] to-[hsl(var(--gold-warm)/0.66)]",
  // 5. Ivory-sand → bark: crisp, elevated card surface with an olive depth
  "from-[hsl(var(--ivory-sand))] to-[hsl(var(--bark)/0.66)]",
  // 6. Sand → burnt sienna: warm-on-warm boldness, rich terracotta finish
  "from-[hsl(var(--sand))] to-[hsl(var(--burnt-sienna)/0.62)]",
  // 7. Parchment → sage: quiet green accent, calm and grounded
  "from-[hsl(var(--parchment))] to-[hsl(var(--sage)/0.62)]",
  // 8. Ivory-sand → gold-warm: parchment-and-gold, the heritage-warmth pair
  "from-[hsl(var(--ivory-sand))] to-[hsl(var(--gold-warm)/0.58)]",
];

/**
 * Returns a deterministic Tailwind gradient class fragment
 * (`from-… to-…`) keyed off `seed`.
 *
 * Compose with `bg-gradient-to-br`:
 * ```tsx
 * <div className={cn("bg-gradient-to-br", avatarGradientFor(userId))} />
 * ```
 *
 * Empty / nullish seeds always map to the first variant — that's
 * intentional: the anonymous-user case stays visually stable rather than
 * flashing between gradients when a user_id loads in async.
 */
export function avatarGradientFor(seed: string | null | undefined): string {
  const s = seed ?? "";
  // djb2 — small, stable, well-distributed for short string keys.
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}
