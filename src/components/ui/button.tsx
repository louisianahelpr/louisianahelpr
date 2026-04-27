import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-semibold tracking-[-0.01em] ring-offset-background transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-primary to-primary/85 text-primary-foreground hover:brightness-110 shadow-[0_6px_18px_-6px_hsl(var(--primary)/0.45)] hover:shadow-[0_10px_28px_-8px_hsl(var(--primary)/0.55)]",
        destructive:
          "bg-gradient-to-b from-destructive to-destructive/85 text-destructive-foreground hover:brightness-110 shadow-[0_6px_18px_-6px_hsl(var(--destructive)/0.45)] hover:shadow-[0_10px_28px_-8px_hsl(var(--destructive)/0.55)]",
        outline:
          "border border-border/60 bg-background/70 backdrop-blur-md hover:bg-secondary hover:text-secondary-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-secondary hover:text-secondary-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        hero: "relative overflow-hidden bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground text-base shadow-[0_10px_30px_-10px_hsl(var(--primary)/0.6)] hover:shadow-[0_20px_50px_-12px_hsl(var(--primary)/0.7)] hover:-translate-y-0.5 before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/25 before:to-transparent before:-translate-x-full hover:before:translate-x-full before:transition-transform before:duration-700 before:ease-out",
        "hero-outline":
          "relative border-2 border-primary/40 bg-background/60 backdrop-blur-md text-primary text-base shadow-sm hover:border-primary hover:bg-primary/5 hover:shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.35)] hover:-translate-y-0.5",
      },
      size: {
        default: "h-11 px-5 py-2",
        sm: "h-9 rounded-xl px-3.5",
        lg: "h-13 rounded-2xl px-8 text-[15px]",
        xl: "h-14 rounded-2xl px-10 text-base",
        icon: "h-11 w-11",
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
