/**
 * THE tag a photo wears (design audit 11-08 B §5.1; owner pick 4, 11-08): "Porch pickup", "Trades OK", "May drop
 * tonight", "Helpr delivery", "New". ONE style for every section, so a Declutter card, a shop card and a home card
 * never drift: a small opaque pill (it reads the same on any photo) at `t-xs` 600. `tone="deal"` is the sienna tint for
 * the money-ish tags (a drop, new); the default is the plain surface pill.
 *
 * Place it inside a `relative` photo box; PhotoTagStack lines several up in the top-left corner, wrapping, never wider
 * than the photo.
 */
import type { ReactNode } from "react";

export type PhotoTagTone = "plain" | "deal";

const TONE: Record<PhotoTagTone, string> = {
  plain: "bg-card/95 text-foreground",
  deal: "bg-card/95 text-[hsl(var(--sienna-ink))] [background-image:linear-gradient(hsl(var(--burnt-sienna)/0.14),hsl(var(--burnt-sienna)/0.14))]",
};

export const PHOTO_TAG_CLASS = "block max-w-full truncate rounded-full px-2 py-1 text-ds-11 font-semibold leading-none shadow-sm";

export function PhotoTag({ children, tone = "plain", title, ...rest }: {
  children: ReactNode;
  tone?: PhotoTagTone;
  title?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <span {...rest} title={title} className={`${PHOTO_TAG_CLASS} ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function PhotoTagStack({ children, className = "left-2 top-2" }: { children: ReactNode; className?: string }) {
  return (
    <span data-photo-tags="" className={`pointer-events-none absolute flex max-w-[calc(100%-3.5rem)] flex-col items-start gap-1 ${className}`}>
      {children}
    </span>
  );
}
