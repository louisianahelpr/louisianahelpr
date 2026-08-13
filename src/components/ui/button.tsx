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

// Premium hover shared by ALL green primary CTAs (default / hero / bark) so the
// hover never drifts between buttons (some used to only brighten, others also
// slid an arrow). One effect everywhere: brighten + a 1px lift + a soft
// bark-tinted glow. The `active:` press (scale + shadow collapse) from
// ELEV_FILLED still wins on tap because Tailwind orders `active` after `hover`.
const GREEN_CTA_HOVER =
  "hover:brightness-110 hover:-translate-y-px " +
  "hover:shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_6px_18px_-6px_hsl(var(--bark)/0.55),0_12px_28px_-12px_hsl(var(--ink-deep)/0.22)]";

const buttonVariants = cva(
  // transition covers transform + box-shadow so the press collapse and
  // spring-back animate together. duration-150 on the press (fast, snappy)
  // and the spring easing bounces back on release without needing two
  // separate durations — `ease-ds-spring` (--ease-spring) is our brand spring.
  "squircle inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-ds-md text-ds-15 font-bold tracking-[-0.01em] ring-offset-background transition-[transform,box-shadow,filter] duration-[150ms] ease-ds-spring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0",
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
        outline:
          "border border-border/60 bg-background/70 backdrop-blur-md hover:bg-secondary hover:text-secondary-foreground " +
          ELEV_OUTLINE,
        // Secondary / parchment-tint: shadow + highlight + press, no gradient.
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 " + ELEV_FILLED,
        // Ghost / link: intentionally FLAT. No elevation — these read as
        // tertiary affordances and must not compete with filled CTAs.
        ghost: "hover:bg-secondary hover:text-secondary-foreground",
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
