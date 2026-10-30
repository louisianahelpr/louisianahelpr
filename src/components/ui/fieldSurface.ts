/**
 * THE look of a one-line form field: the shared <Input> wears it, and so does any control that sits among inputs as a
 * button (the two-step category picker's trigger), so the two never read as different controls.
 */
export const FIELD_SURFACE_CLS =
  // Idle border: faint ink-deep so the field is visible but quiet.
  "rounded-2xl border px-4 py-2 text-ds-15 border-[hsl(var(--ink-deep)/0.15)] glass-field " +
  // iOS-feel focus ring: olivewood accent, no double outline.
  "focus-visible:outline-none focus-visible:border-[hsl(var(--olivewood)/0.6)] " +
  "focus-visible:ring-2 focus-visible:ring-[hsl(var(--olivewood)/0.25)] focus-visible:ring-offset-0 " +
  // Smooth color + ring transitions.
  "transition-[border-color,box-shadow] duration-200";
