import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/50 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        "glass-modal fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-5 p-7 duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    />
  </AlertDialogPortal>
));
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} className={cn("text-lg font-display italic font-bold leading-tight", className)} {...props} />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description ref={ref} className={cn("text-xs text-muted-foreground", className)} {...props} />
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

/**
 * AlertDialogHero — the confirm-box twin of DialogHero. AlertDialogs can't use
 * DialogHero (different Radix primitive, no X close button), so this mirrors its
 * eyebrow → title → subtitle stack and type tokens EXACTLY, using the AlertDialog
 * Title/Description primitives Radix requires for a11y. Adopt this instead of
 * hand-rolling a header inside an AlertDialog so every confirm box reads identical
 * to every other popup app-wide.
 *
 *   <AlertDialogHero eyebrow="Safety" title="Block Sarah?" subtitle="They won't…" />
 */
const AlertDialogHero = ({
  eyebrow,
  title,
  subtitle,
  className,
  titleClassName,
  titleStyle,
  eyebrowClassName,
  eyebrowStyle,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
  titleClassName?: string;
  titleStyle?: React.CSSProperties;
  eyebrowClassName?: string;
  eyebrowStyle?: React.CSSProperties;
}) => (
  <AlertDialogHeader className={cn("space-y-0 text-left", className)}>
    {eyebrow && (
      <span
        className={cn("font-serif italic uppercase block", eyebrowClassName)}
        style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em", ...eyebrowStyle }}
      >
        {eyebrow}
      </span>
    )}
    <AlertDialogTitle
      className={cn("font-display italic font-bold leading-tight pt-2", titleClassName)}
      style={{ fontSize: "clamp(1.2rem, 1.6vw + 0.4rem, 1.45rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em", ...titleStyle }}
    >
      {title}
    </AlertDialogTitle>
    {subtitle && (
      <AlertDialogDescription
        className="font-serif italic leading-relaxed pt-1.5"
        style={{ fontSize: "0.8rem", color: "hsl(var(--olivewood) / 0.85)" }}
      >
        {subtitle}
      </AlertDialogDescription>
    )}
  </AlertDialogHeader>
);
AlertDialogHero.displayName = "AlertDialogHero";

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(buttonVariants({ size: "lg" }), "rounded-2xl w-full sm:w-auto font-semibold", className)}
    {...props}
  />
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-2xl w-full sm:w-auto mt-0 font-semibold border-border/60", className)}
    {...props}
  />
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogHero,
  AlertDialogAction,
  AlertDialogCancel,
};
