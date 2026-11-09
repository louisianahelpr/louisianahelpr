/**
 * THE small picture on a list row (design audit 11-08 B §4.5 ItemThumb; owner pick 3, 11-08): 56 px on order, offer,
 * cart, request and trade rows, 40 px on notification rows, radius 10. The caller hands the picture (a section's own
 * photo element, which knows its sizes and fallbacks) or nothing; with nothing, the `placeholder` (a category icon on
 * its tint, never a blank box) fills it.
 */
import type { ReactNode } from "react";

export type ItemThumbSize = "md" | "sm";

const SIZE: Record<ItemThumbSize, string> = { md: "h-14 w-14", sm: "h-10 w-10" };

export function ItemThumb({ children, placeholder, size = "md", className = "" }: {
  /** The photo (an <img> filling the box), or nothing. */
  children?: ReactNode;
  /** Shown under the photo, and alone when there is none. */
  placeholder?: ReactNode;
  size?: ItemThumbSize;
  className?: string;
}) {
  return (
    <span data-item-thumb={size} className={`relative block shrink-0 overflow-hidden rounded-[10px] bg-photo-empty ${SIZE[size]} ${className}`}>
      {placeholder}
      {children}
    </span>
  );
}
