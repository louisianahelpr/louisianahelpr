/**
 * The phone sidebar's slide-in sheet (ui/sidebar.tsx loads it on the first open, Q2705 lead 11-14): imported
 * statically, the sheet's code sat on /admin's critical path though no desktop visit ever opens it and a phone visit
 * opens it only from the menu button. Guard: src/test/adminSidebarSheetLazy.test.ts.
 */
import type * as React from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export function SidebarMobileSheet({
  open,
  onOpenChange,
  side,
  width,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "left" | "right";
  width: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        data-sidebar="sidebar"
        data-mobile="true"
        className="w-[--sidebar-width] bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
        style={{ "--sidebar-width": width } as React.CSSProperties}
        side={side}
      >
        {/* Radix points `aria-labelledby` at a SheetTitle that has to exist.
            Without one it referenced a missing id and the whole admin
            sidebar announced as bare "dialog". Visually hidden because the
            sheet's own content is the visible heading. */}
        <SheetTitle className="sr-only">Sidebar navigation</SheetTitle>
        <div className="flex h-full w-full flex-col">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
