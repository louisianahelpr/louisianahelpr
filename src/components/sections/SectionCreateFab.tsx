import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useAgeGate } from "@/hooks/useAgeGate";
import { hapticMedium } from "@/lib/haptics";
import { sectionByKey, type SectionAdd, type SectionKey } from "@/components/sections/sectionsConfig";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/language";
import { setCreateSheetOpen, useCreateSheetOpen } from "@/components/mobileNav/createSheetStore";
import { useSectionCreateFabHidden } from "./createFabHidden";

/**
 * THE SECTION'S CREATE PILL (owner 11-08, the Vinted header): the top bar's green "+" became this floating pill,
 * bottom-right, 16px above the bottom bar on the shared clearance (`bottom-safe-nav`: the home-indicator inset + the
 * dock + 1rem), so it never covers the dock. "+ Sell" on Declutter, "+ Post a job" on Jobs (behind the same age gate
 * as every Post a job), the section's own create elsewhere; it goes where the bar's "+" went (sectionsConfig `add`).
 * Portaled to document.body: a fixed element inside the page is not viewport-relative (CLAUDE.md, fixed containing
 * block). SectionScreen's `fab` adds room under the last row so the pill never sits on the last row at rest.
 * Phone only: the desktop website keeps the bar's soft "+ Post a job" (etc.). Guard: src/test/declutterHeaderVinted.test.tsx.
 */
/**
 * F150 (owner UI audit 11-09: the floating "+ Create" / "+ Sell" / "+ Post a job" sat on card text; "Bottom padding =
 * dock + floating button height"). While a pill is on screen, <html> wears `has-section-fab`, which sets
 * --section-fab-clearance (index.css: the pill's 48px + its 16px gap over the dock). A list that scrolls under the pill
 * adds it to its own dock clearance, so its last row ends above the pill. SectionScreen's `pb-20` already does this.
 */
let fabsShown = 0;
function useFabClearance(on: boolean) {
  useEffect(() => {
    if (!on || typeof document === "undefined") return;
    fabsShown += 1;
    document.documentElement.classList.add("has-section-fab");
    return () => {
      fabsShown -= 1;
      if (fabsShown === 0) document.documentElement.classList.remove("has-section-fab");
    };
  }, [on]);
}

/**
 * F262 (audit 11-10): bottom room clears only the LAST row; mid-list the pill sat on a card's progress bar, its
 * "Manage job" row and Browse's town and time. While the member scrolls DOWN the pill folds to its round "+" (the
 * TaskRabbit / Gmail pattern; its name stays on aria-label), and scrolling back up (or reaching the top) opens it
 * again. The app scrolls inside its own panels, not the window, so this listens to every scroll in capture phase
 * and reads the scrolled element's own position.
 */
function useFoldsWhileScrollingDown(on: boolean): boolean {
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    if (!on || typeof document === "undefined") return;
    const last = new WeakMap<EventTarget, number>();
    const onScroll = (e: Event) => {
      const el = e.target === document ? document.scrollingElement : (e.target as Element | null);
      if (!el || typeof (el as Element).scrollTop !== "number") return;
      const top = (el as Element).scrollTop;
      const before = last.get(el) ?? 0;
      last.set(el, top);
      if (top <= 8) setFolded(false);
      else if (top - before > 4) setFolded(true);
      else if (before - top > 4) setFolded(false);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, [on]);
  return folded;
}

/**
 * `add`: this member's own action when it is not the section's usual one (Shops: a member who already has a shop is
 * offered "+ Add an item", not "+ Open a shop"; ShopsHomeView). Guard: src/test/shopOwnerAddNotOpenShop.test.tsx.
 */
export function SectionCreateFab({ section, text: given, add: own }: { section?: SectionKey; text?: string; add?: SectionAdd }) {
  const { t: tr } = useLanguage();
  const text = own?.cta ?? own?.label ?? given ?? tr("nav.create");
  const navigate = useNavigate();
  const desktop = useIsWebDesktop();
  const gate = useAgeGate();
  const sheetOpen = useCreateSheetOpen();
  // An empty state showing its own create button hides the pill, so the action is never on screen twice (createFabHidden).
  const hidden = useSectionCreateFabHidden();
  // No section (Dashboard): the pill opens the Create sheet ("What are we doing?"), as the bar's "+" did there.
  const add = own ?? (section ? sectionByKey(section).add : null);
  const shown = !desktop && !hidden && !(section && !add);
  useFabClearance(shown);
  const folded = useFoldsWhileScrollingDown(shown);
  if (!shown || typeof document === "undefined") return null;
  const isPost = add?.path === "/post-job";
  const go = () => { hapticMedium(); if (add) navigate(add.path); else setCreateSheetOpen((o) => !o); };
  return createPortal(
    <Button
      type="button"
      variant="primary"
      size="md"
      data-testid="section-create-fab"
      data-folded={folded ? "" : undefined}
      data-create-section={section ?? "sheet"}
      aria-label={add ? add.label : text}
      {...(add ? {} : { "aria-haspopup": "dialog" as const, "aria-expanded": sheetOpen })}
      onClick={isPost ? gate.gate("post", go) : go}
      {...(isPost ? gate.gatedProps("post") : {})}
      className={`fixed bottom-safe-nav right-4 z-40 rounded-full font-semibold shadow-lg [&>svg]:h-5 [&>svg]:w-5 ${folded ? "w-12 px-0" : "gap-1.5 pl-4 pr-5"}`}
      style={{ marginRight: "var(--safe-area-right, 0px)" }}
    >
      <Plus aria-hidden />
      {!folded && text}
    </Button>,
    document.body,
  );
}
