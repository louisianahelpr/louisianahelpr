/**
 * avatarGradient — deterministic warm-palette gradient classes for avatar
 * fallbacks, hashed from a stable seed (typically `user_id`).
 *
 * ── WHY THESE ARE LITERALS AND NOT `hsl(var(--token))` ────────────────────
 *
 * They used to be tokens, and that is exactly what broke them.
 *
 * The palette below is a CALIBRATION: a light warm base, a mid-depth accent
 * at an opacity tuned so dark ink stays above WCAG AA at the darkest point.
 * Every token it used — `--parchment`, `--ivory-sand`, `--sand`, `--bark`,
 * `--burnt-sienna`, `--olivewood`, `--gold-warm`, `--sage` — INVERTS under
 * `[data-theme="dark"]`. So in dark mode the base flipped to near-black
 * (`--parchment` 95% → 9%) and the accents flipped to near-white
 * (`--olivewood` 16% → 80%), and "cream → deep accent" silently became
 * "near-black → near-white". A gradient spanning that range has no ink colour
 * that works at both ends, and none of the three candidates comes close:
 * measured across all eight variants in dark mode, `--ink-deep` bottoms out at
 * 2.54:1, pure white at 3.54:1, and the light-mode ink at 1.04:1. The sweep
 * caught it at 3.21:1 on 32 screens because only one seed appears in the
 * fixtures; the worst variant is worse.
 *
 * The fix is not a different ink. It is to stop the palette inverting at all.
 * These are identity colours hashed from a user id — the fallback stands in
 * for a PHOTOGRAPH, and the photograph beside it in the same component does
 * not invert between themes either. So the stops and the initials are pinned
 * to the light-mode values of the tokens they came from, named in the comment
 * on each line, and the avatar now looks the same in both themes and measures
 * the same in both themes. `avatarGradient.test.ts` asserts no `var(--…)`
 * comes back, because reaching for a token here looks tidier and silently
 * re-breaks it — light mode would still look correct.
 *
 * The `to` stops are OPAQUE, and that is the second half of the fix. They were
 * written as the accent at 0.5-0.66 alpha, and a semi-transparent gradient stop
 * on a `bg-transparent` element does not composite over the `from` colour — it
 * composites over whatever is BEHIND THE ELEMENT. So even after the stops were
 * pinned, in dark mode the accent end still landed on the dark card and the
 * gold variant painted #89672b: 3.04:1, on 18 screens. Each `to` value below is
 * therefore the accent already composited over its own `from` colour, baked to
 * an opaque hex, which removes the backdrop from the calculation entirely.
 *
 * Worst point across all eight after the fix: 4.68:1 against 4.5 required
 * (16px/700 initials are not "large text"), identical in both themes.
 * Recomputed by hand; if you add a variant, compute it — the margin is thin by
 * design, because a mid-depth accent is the point.
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
 *
 * The measured worst point of each pair against the pinned ink #23231a, so a
 * future edit does not have to re-derive them:
 *   1 bark .62      5.48:1      5 bark .66      5.40:1
 *   2 sienna .56    5.59:1      6 sienna .62    4.68:1
 *   3 olivewood .52 4.69:1      7 sage .62      7.65:1
 *   4 gold .66      7.67:1      8 gold .58      8.81:1
 */

const GRADIENTS: readonly string[] = [
  // 1. Parchment → bark: soft olive deepening — the "default" warm tone
  //    --parchment 220 14% 95%, then --bark 70 20% 33% at .62 baked over it
  "from-[#f0f2f4] to-[#979a86]",
  // 2. Parchment → burnt sienna: warm rust accent, the brand emphasis color
  //    --parchment, then --burnt-sienna 19 75% 35% at .56 baked over it
  "from-[#f0f2f4] to-[#c18f78]",
  // 3. Parchment → olivewood: deep dark-ground, serious and earthy.
  //    --parchment → --olivewood 64 16% 16%, at 0.52 rather than the 0.62
  //    every other slot would use. --olivewood is the primary TEXT colour; at
  //    0.62 it composites to #787972, which is 3.59:1 against the initials —
  //    the one variant that failed AA in LIGHT mode too, and would have kept
  //    failing after the theme pinning above. 0.52 bakes to #8c8d87, 4.69:1.
  "from-[#f0f2f4] to-[#8c8d87]",
  // 4. Parchment → gold-warm: antique gold, the prestige variant
  //    --parchment, then --gold-warm 38 60% 48% at .66 baked over it
  "from-[#f0f2f4] to-[#d3b073]",
  // 5. Ivory-sand → bark: crisp, elevated card surface with an olive depth
  //    --ivory-sand 0 0% 100%, then --bark at .66 baked over it
  "from-[#ffffff] to-[#969983]",
  // 6. Sand → burnt sienna: warm-on-warm boldness, rich terracotta finish
  //    --sand 220 14% 90%, then --burnt-sienna at .62 baked over it
  "from-[#e2e4e9] to-[#b77f66]",
  // 7. Parchment → sage: quiet green accent, calm and grounded
  //    --parchment, then --sage 78 9% 53% at .62 baked over it
  "from-[#f0f2f4] to-[#b2b6aa]",
  // 8. Ivory-sand → gold-warm: parchment-and-gold, the heritage-warmth pair
  //    --ivory-sand, then --gold-warm at .58 baked over it
  "from-[#ffffff] to-[#ddbd87]",
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
