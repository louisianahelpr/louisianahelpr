import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

/**
 * BarkPillButton — the bark-filled rounded pill used for the primary CTA
 * on empty-state cards (Browse tasks / Post a Job / Post the first job).
 *
 * Thin wrapper over the shared Button so the fill, border, and shadow
 * recipe lives in one place instead of being copy-pasted per screen.
 * Caller-supplied className/style still merge in last.
 */
export function BarkPillButton({ className, style, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      className={`rounded-full px-6 h-12 ${className ?? ""}`}
      style={{
        background: "hsl(var(--bark))",
        color: "hsl(var(--parchment))",
        border: "1px solid hsl(70 22% 24%)",
        fontFamily: "Montserrat, system-ui, sans-serif",
        fontWeight: 600,
        boxShadow:
          "inset 0 1px 0 0 rgba(255, 255, 255, 0.12), " +
          "0 1px 2px hsl(70 20% 18% / 0.18), " +
          "0 8px 18px -6px hsl(var(--bark) / 0.45)",
        ...style,
      }}
    />
  );
}
