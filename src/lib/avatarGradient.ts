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
 */

const GRADIENTS: readonly string[] = [
  // Warm parchment → bark (soft olive deepening)
  "from-[hsl(var(--parchment))] to-[hsl(var(--bark)/0.40)]",
  // Parchment → burnt sienna (warm rust accent, the brand emphasis)
  "from-[hsl(var(--parchment))] to-[hsl(var(--burnt-sienna)/0.35)]",
  // Parchment → olivewood (deep dark-ground)
  "from-[hsl(var(--parchment))] to-[hsl(var(--olivewood)/0.30)]",
  // Parchment → antique gold (the only true gold variant)
  "from-[hsl(var(--parchment))] to-[hsl(var(--gold-warm)/0.40)]",
  // Ivory-sand surface → bark (matches `--card` warm cream)
  "from-[hsl(var(--ivory-sand))] to-[hsl(var(--bark)/0.45)]",
  // Sand → burnt sienna (slightly bolder warm-on-warm)
  "from-[hsl(var(--sand))] to-[hsl(var(--burnt-sienna)/0.45)]",
  // Parchment → sage (the quieter green accent)
  "from-[hsl(var(--parchment))] to-[hsl(var(--sage)/0.45)]",
  // Ivory-sand → gold-warm (subtle parchment-and-gold)
  "from-[hsl(var(--ivory-sand))] to-[hsl(var(--gold-warm)/0.35)]",
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
