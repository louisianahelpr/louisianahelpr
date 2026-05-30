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
//   1. ELEVATION  — 2-layer drop shadow that mimics real lift (a tight 1px
//      contact shadow + a wider 2px/4px ambient shadow). Two layers prevent
//      the "single hard line" pasted-on look.
//   2. HIGHLIGHT  — inner 1px top-edge cream highlight, picking up light
//      from above so the button feels embossed / lit, not painted flat.
//   3. PRESS      — on `:active`, translate down 1px and collapse the
//      ambient shadow so the button physically depresses under the finger.
//   4. GRADIENT   — barely-perceptible 0% → 92% vertical gradient on the
//      bark PRIMARY CTA only. Just enough that the surface reads as
//      "solid + lit from above" instead of a flat fill.
//
// Brand tokens live as raw HSL CSS vars (NOT in tailwind.config.ts), so they
// MUST be referenced as `hsl(var(--token) / alpha)` — `bg-ink-deep` is a
// no-op class.
// ─────────────────────────────────────────────────────────────────────────────
const ELEV_FILLED =
  "shadow-[inset_0_1px_0_hsl(var(--parchment)/0.18),0_1px_1px_hsl(var(--ink-deep)/0.10),0_2px_4px_hsl(var(--ink-deep)/0.12)] " +
  "active:translate-y-px active:shadow-[inset_0_1px_0_hsl(var(--parchment)/0.18),0_1px_1px_hsl(var(--ink-deep)/0.12)]";
const ELEV_OUTLINE =
  "shadow-[0_1px_1px_hsl(var(--ink-deep)/0.10),0_2px_4px_hsl(var(--ink-deep)/0.12)] " +
  "active:translate-y-px active:shadow-[0_1px_1px_hsl(var(--ink-deep)/0.12)]";

const buttonVariants = cva(
  "squircle inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-3xl text-ds-15 font-bold tracking-[-0.01em] ring-offset-background transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 disabled:active:translate-y-0 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0",
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
        default:
          "bg-[linear-gradient(180deg,hsl(var(--primary))_0%,hsl(var(--primary)/0.92)_100%)] !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))] hover:brightness-110 " +
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
        link: "text-primary underline-offset-4 hover:underline shadow-none",
        // Hero is the marketing-page primary CTA — same family as bark/default,
        // so it gets all 4 treatments (gradient + highlight + 2-layer shadow
        // + active press), plus its existing shimmer sweep.
        hero:
          "relative overflow-hidden bg-[linear-gradient(180deg,hsl(var(--primary))_0%,hsl(var(--primary)/0.92)_100%)] !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))] text-base hover:brightness-110 before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/25 before:to-transparent before:-translate-x-full hover:before:translate-x-full before:transition-transform before:duration-700 before:ease-out " +
          ELEV_FILLED,
        // Hero-outline: outline family, shadow #1 only.
        "hero-outline":
          "relative border-2 border-primary/40 bg-background/60 backdrop-blur-md text-primary text-base hover:border-primary hover:bg-primary/5 " +
          ELEV_OUTLINE,
        // Bark CTA (auth-screen "Sign in" / "Send reset link"). Same
        // cascade-loss defense as `default`: pin cream text with `!text-[...]`
        // + descendant `[&_*]` so it never renders dark-on-olive in the
        // WebView.
        //
        // Depth: all 4 treatments — this is THE primary CTA the TestFlight
        // feedback flagged as flat.
        bark:
          "bg-[linear-gradient(180deg,hsl(var(--bark))_0%,hsl(var(--bark)/0.92)_100%)] !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))] border border-[hsl(var(--bark))] [font-family:Montserrat,system-ui,sans-serif] font-semibold tracking-[0.01em] hover:brightness-110 " +
          ELEV_FILLED,
      },
      size: {
        default: "h-14 px-6 py-2 text-[16px]",
        sm: "h-11 rounded-3xl px-4 text-[14px]",
        lg: "h-[60px] rounded-3xl px-8 text-ds-17",
        xl: "h-16 rounded-3xl px-10 text-[18px]",
        icon: "h-14 w-14",
        "icon-sm": "h-9 w-9 rounded-xl",
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
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
