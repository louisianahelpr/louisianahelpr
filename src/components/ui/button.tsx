import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Elevation system — TestFlight #2 feedback "buttons look flat next to cards"
//
// Four cumulative depth treatments, applied selectively per variant so the
// hierarchy stays legible (a ghost button and a primary CTA must NOT read at
// the same elevation):
//
//   1. ELEVATION  — 3-layer drop shadow: tight 1px contact shadow + a medium
//      2px/6px ambient + a very soft 8px halo. Three layers prevent the
//      "single hard line" pasted-on look and give the button real lift.
//   2. HIGHLIGHT  — inner 1px top-edge cream highlight (cream for filled,
//      white for outline), picking up light from above so the button feels
//      embossed / lit rather than painted flat.
//   3. PRESS      — on `:active`, scale 0.97 (crisper than translate alone)
//      AND collapse the ambient + halo shadows so the button physically
//      depresses under the finger. Spring easing bounces back cleanly.
//   4. GRADIENT   — barely-perceptible 0% → 92% vertical gradient on the
//      bark PRIMARY CTA only. Just enough that the surface reads as
//      "solid + lit from above" instead of a flat fill.
//
// Brand tokens live as raw HSL CSS vars (NOT in tailwind.config.ts), so they
// MUST be referenced as `hsl(var(--token) / alpha)` — `bg-ink-deep` is a
// no-op class.
// ─────────────────────────────────────────────────────────────────────────────
const ELEV_FILLED =
  "shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_1px_1px_hsl(var(--ink-deep)/0.10),0_2px_6px_hsl(var(--ink-deep)/0.12),0_4px_12px_-2px_hsl(var(--ink-deep)/0.08)] " +
  "active:scale-[0.97] active:shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_1px_1px_hsl(var(--ink-deep)/0.14)]";
const ELEV_OUTLINE =
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_1px_1px_hsl(var(--ink-deep)/0.08),0_2px_6px_hsl(var(--ink-deep)/0.10),0_4px_12px_-2px_hsl(var(--ink-deep)/0.06)] " +
  "active:scale-[0.97] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_1px_1px_hsl(var(--ink-deep)/0.10)]";

// Hover shared by ALL green primary CTAs. `hover:brightness-110` and nothing
// else — the filled-surface arm of the one interaction treatment (see "THE ONE
// INTERACTION TREATMENT" in src/index.css). A gradient fill cannot take a
// `bg-*` utility without being overwritten, so brightening it is the only way
// to tint it; that is the whole reason two mechanisms exist.
//
// WHAT THIS USED TO BE, and why it is gone (owner, 2026-09-19: "some back
// buttons or any button moves on hover, some has a square grey background on
// hover, etc. all of these need to be consistent"):
//
//   hover:-translate-y-px  — REMOVED. This is the single most-rendered control
//     in the app, so it was the largest source of the complaint. A control
//     that lifts moves the target out from under a cursor still arriving at
//     it: a Fitts's-law regression, worse on a trackpad, and in a stacked
//     footer it nudges the button you were aiming at. It also made the primary
//     the ONLY variant that moved — ghost, outline and secondary swapped a
//     background and held still — which is precisely the inconsistency named.
//
//   hover:shadow-[...bark glow...]  — REMOVED. A second, competing treatment
//     on the same gesture: the primary grew a glow while every other variant
//     did not. The resting 3-layer ELEV_FILLED shadow already says "this is
//     raised"; restating it louder on hover said nothing new.
//
// The `active:` press (scale + shadow collapse) from ELEV_FILLED is untouched
// and still wins on tap, because Tailwind orders `active` after `hover`.
const GREEN_CTA_HOVER = "hover:brightness-110";

const buttonVariants = cva(
  // transition covers transform + box-shadow so the press collapse and
  // spring-back animate together, plus `filter` (the filled-surface hover
  // tint) and `background-color` (the unfilled-surface hover tint, applied by
  // `.ctl-tint` on ghost/outline). All four are named here because this
  // utility overrides `.ctl-tint`'s own transition — see the note beside
  // `.ctl-tint` in src/index.css. duration-150 on the press (fast, snappy)
  // and the spring easing bounces back on release without needing two
  // separate durations — `ease-ds-spring` (--ease-spring) is our brand spring.
  "squircle inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-ds-md text-ds-15 font-bold tracking-[-0.01em] ring-offset-background transition-[transform,box-shadow,filter,background-color] duration-[150ms] ease-ds-spring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary CTA. `text-primary-foreground` nominally resolves to the
        // light parchment cream via a two-hop token chain
        // (text-primary-foreground -> --primary-foreground -> --parchment),
        // but that chain has repeatedly lost the cascade in the Capacitor
        // WebView and rendered dark-on-olive (reported multiple times). Pin
        // the cream explicitly with `!text-[...]` plus a descendant `[&_*]`
        // rule so an `asChild` <a> child can't inherit a darker color
        // either — independent of variant token resolution.
        //
        // Depth: all 4 treatments (filled primary CTA).
        //
        // ONE primary button (C2). `default`, `bark` and `hero` were three
        // names for the same thing: all three applied btn-grad-primary, the
        // pinned cream text, GREEN_CTA_HOVER and ELEV_FILLED. `bark` added a
        // border and re-declared Montserrat (already the global sans); `hero`
        // added a shimmer sweep. Three names meant a reviewer could not tell
        // from a diff whether a CTA had changed importance.
        //
        // `primary` is the name; `default` is kept as the cva fallback so a
        // <Button> with no variant still works, and points at the same string.
        primary:
          "btn-grad-primary !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))] " +
          GREEN_CTA_HOVER + " " +
          ELEV_FILLED,
        default:
          "btn-grad-primary !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))] " +
          GREEN_CTA_HOVER + " " +
          ELEV_FILLED,
        // Destructive: shadow + highlight + press, NO gradient — keep red
        // flat-looking so it doesn't get accidentally pressed.
        destructive:
          "bg-destructive !text-[hsl(var(--destructive-foreground))] [&_*]:!text-[hsl(var(--destructive-foreground))] hover:brightness-110 " + ELEV_FILLED,
        // Outline: shadow #1 ONLY — outlines stay clean and minimal, no
        // inner highlight, no gradient.
        //
        // Hover was `hover:bg-secondary hover:text-secondary-foreground` — a
        // SOLID sand fill that replaced the translucent background outright,
        // which is the "square grey background on hover" the owner reported.
        // `.ctl-tint` is the unfilled-surface arm of the one treatment: an
        // 8% olivewood wash, the same wash every other unfilled control in
        // the app now gets. The text colour no longer changes with it — an
        // outline button inherits its ink and had no reason to restate it.
        outline:
          "ctl-tint border border-border/60 bg-background/70 backdrop-blur-md " +
          ELEV_OUTLINE,
        // Secondary / parchment-tint: shadow + highlight + press, no gradient.
        //
        // This one is FILLED (sand), so it takes the filled arm — a tint by
        // filter, because a `bg-*` on hover would swap the fill rather than
        // tint it. `brightness-95` darkens, where the old `hover:bg-secondary/80`
        // went more transparent and therefore LIGHTER over the parchment page.
        // Darker is the direction every unfilled control moves under
        // `.ctl-tint`, so this is what makes secondary agree with ghost and
        // outline rather than reading as a different species of button.
        secondary:
          "bg-secondary text-secondary-foreground hover:brightness-95 " + ELEV_FILLED,
        // Ghost / link: intentionally FLAT. No elevation — these read as
        // tertiary affordances and must not compete with filled CTAs.
        // Same `.ctl-tint` wash as outline: a ghost and an outline button side
        // by side must not hover differently, and they used to.
        ghost: "ctl-tint",
        link: "link-standard text-primary shadow-none",
      },
      size: {
        default: "h-14 px-6 py-2 text-ds-16",
        sm: "h-11 px-4 text-ds-14",
        lg: "h-[60px] px-8 text-ds-17",
        xl: "h-16 px-10 text-ds-18",
        icon: "h-14 w-14",
        // NOTE: an "icon-sm" size (h-9 w-9 = 36px) used to live here. It was a
        // 36×36 tap target — under Apple's 44pt and Android's 48dp minimums —
        // sitting in the shared primitive where it was the variant most likely
        // to spread. It had ZERO call sites, so it was deleted rather than
        // resized: nothing rendered smaller, and the trap is gone.
        //
        // If you need a smaller-LOOKING icon button, do NOT re-add a smaller
        // box. Keep the 44px target and shrink the glyph inside it — the hit
        // area is the accessibility contract, the glyph is just paint.
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Marketing shimmer sweep — the only thing the old `hero` variant added
   *  over the primary CTA. A prop rather than a variant, so "is this the
   *  primary action?" and "does it sparkle?" stay separate questions. */
  shimmer?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, shimmer = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const SHIMMER =
      "relative overflow-hidden before:absolute before:inset-0 before:bg-gradient-to-r " +
      "before:from-transparent before:via-white/25 before:to-transparent before:-translate-x-full " +
      "hover:before:translate-x-full before:transition-transform before:duration-700 before:ease-out";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }), shimmer && SHIMMER)}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
