/**
 * The keyboard-active row in a suggestion popup (see
 * src/hooks/useComboboxKeyboard.ts, which sets `data-active="true"`).
 *
 * One string, used by all three popups, so the highlight cannot drift.
 *
 * `secondary` on `card` is the app's designed quiet-surface pair and is the
 * only pair here that survives the theme flip: light is sand (220 14% 90%)
 * under olivewood text (64 16% 16%), dark is sand (220 10% 24%) under
 * olivewood (36 15% 80%) — both far past AA for body text. The card behind
 * it only shifts ~10% lightness, which reads as a highlight but is not on
 * its own an unmistakable one, so an inset accent ring carries the actual
 * "you are here": burnt sienna against either surface, and a shape rather
 * than a hue so it does not rely on colour vision.
 */
export const COMBOBOX_ACTIVE_OPTION_CLASS =
  "data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground " +
  "data-[active=true]:ring-2 data-[active=true]:ring-inset data-[active=true]:ring-accent";
