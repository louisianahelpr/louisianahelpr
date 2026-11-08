import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { hapticMedium } from "@/lib/haptics";
import { sectionByKey } from "@/components/sections/sectionsConfig";
import { Button } from "@/components/ui/button";

/**
 * "+ SELL" (owner 11-08, Declutter's Vinted header): the top bar's green "+" became this floating pill, bottom-right,
 * 16px above the bottom bar on the shared clearance (`bottom-safe-nav`: the home-indicator inset + the dock + 1rem),
 * so it never covers the dock. It goes to the same place the "+" went ("What do you want to sell?"). Portaled to
 * document.body: a fixed element inside the page is not viewport-relative (CLAUDE.md, fixed containing block).
 * SectionScreen's `fab` adds room under the last row so the pill never sits on the last grid row at rest.
 * Phone only: the desktop website keeps the bar's "+ Sell an item". Guard: src/test/declutterHeaderVinted.test.tsx.
 */
export function DeclutterSellFab() {
  const navigate = useNavigate();
  const desktop = useIsWebDesktop();
  if (desktop || typeof document === "undefined") return null;
  const add = sectionByKey("declutter").add!;
  return createPortal(
    <Button
      type="button"
      variant="primary"
      size="md"
      data-testid="declutter-sell-fab"
      aria-label={add.label}
      onClick={() => { hapticMedium(); navigate(add.path); }}
      className="fixed bottom-safe-nav right-4 z-40 gap-1.5 rounded-full pl-4 pr-5 font-semibold shadow-lg [&>svg]:h-5 [&>svg]:w-5"
      style={{ marginRight: "var(--safe-area-right, 0px)" }}
    >
      <Plus aria-hidden />
      Sell
    </Button>,
    document.body,
  );
}
