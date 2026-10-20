/**
 * THE chip (spec §1.3 "one chip style"): a pill with the label inside, olive
 * gloss when selected (btn-grad-primary, toggled in JS, never a Tailwind
 * variant over it), a hairline outline when not. Post a Job's category picker
 * (board 23) and every section's status chip row (boards 14, 21) wear it.
 */
export const CHIP =
  "inline-flex min-h-11 items-center rounded-full px-4 font-sans font-semibold text-ds-13 leading-tight break-normal hyphens-none text-left transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
export const CHIP_ON = "btn-grad-primary text-primary-foreground";
export const CHIP_OFF = "bg-transparent border border-input text-foreground";
