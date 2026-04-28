import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "squircle inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-3xl text-[15px] font-bold tracking-[-0.01em] ring-offset-background transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-primary to-primary/85 text-primary-foreground hover:brightness-110 shadow-[0_1px_0_0_hsl(0_0%_100%/0.15)_inset,0_2px_4px_-2px_hsl(var(--primary)/0.35),0_8px_16px_-4px_hsl(var(--primary)/0.35),0_16px_32px_-8px_hsl(var(--primary)/0.3)] hover:shadow-[0_1px_0_0_hsl(0_0%_100%/0.2)_inset,0_4px_8px_-2px_hsl(var(--primary)/0.4),0_12px_24px_-4px_hsl(var(--primary)/0.45),0_24px_48px_-8px_hsl(var(--primary)/0.35)] hover:-translate-y-px",
        destructive:
          "bg-gradient-to-b from-destructive to-destructive/85 text-destructive-foreground hover:brightness-110 shadow-[0_1px_0_0_hsl(0_0%_100%/0.15)_inset,0_2px_4px_-2px_hsl(var(--destructive)/0.35),0_8px_16px_-4px_hsl(var(--destructive)/0.35),0_16px_32px_-8px_hsl(var(--destructive)/0.3)] hover:-translate-y-px",
        outline:
          "border border-border/60 bg-background/70 backdrop-blur-md hover:bg-secondary hover:text-secondary-foreground shadow-[0_1px_2px_0_hsl(var(--foreground)/0.04),0_4px_12px_-4px_hsl(var(--foreground)/0.08)]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-[0_1px_2px_0_hsl(var(--foreground)/0.04),0_4px_12px_-4px_hsl(var(--foreground)/0.08)]",
        ghost: "hover:bg-secondary hover:text-secondary-foreground",
        link: "text-primary underline-offset-4 hover:underline shadow-none",
        hero: "relative overflow-hidden bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground text-base shadow-[0_1px_0_0_hsl(0_0%_100%/0.2)_inset,0_4px_8px_-2px_hsl(var(--primary)/0.4),0_12px_24px_-4px_hsl(var(--primary)/0.5),0_24px_48px_-12px_hsl(var(--primary)/0.5)] hover:shadow-[0_1px_0_0_hsl(0_0%_100%/0.25)_inset,0_6px_12px_-2px_hsl(var(--primary)/0.45),0_18px_36px_-6px_hsl(var(--primary)/0.55),0_32px_64px_-12px_hsl(var(--primary)/0.55)] hover:-translate-y-0.5 before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/25 before:to-transparent before:-translate-x-full hover:before:translate-x-full before:transition-transform before:duration-700 before:ease-out",
        "hero-outline":
          "relative border-2 border-primary/40 bg-background/60 backdrop-blur-md text-primary text-base shadow-[0_2px_8px_-2px_hsl(var(--foreground)/0.08)] hover:border-primary hover:bg-primary/5 hover:shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.35)] hover:-translate-y-0.5",
      },
      size: {
        default: "h-14 px-6 py-2 text-[16px]",
        sm: "h-11 rounded-[14px] px-4 text-[14px]",
        lg: "h-[60px] rounded-[20px] px-8 text-[17px]",
        xl: "h-16 rounded-[22px] px-10 text-[18px]",
        icon: "h-14 w-14",
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
