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
/**
 * Phone audit 11-25 #1: the open pill still sat on the END of a list ("That's every open job…" on Jobs, Home's last
 * card) whenever the list's end was on screen, at rest too, since nothing was scrolling. Within END_FOLD_PX of the
 * scroll's end, the pill is the round "+" as well, so the end card reads whole. Measured 11-25 at 375 (webkit, local build):
 * Declutter Browse at rest with its end card on screen had 299px left to scroll (the dock's room, the pill's room and
 * the end block's own margin), so 320.
 */
export const END_FOLD_PX = 320;
/** How far the element scrolls before its end: scrollHeight - scrollTop - clientHeight (0 for one that cannot scroll). */
function scrollLeft(el: Pick<Element, "scrollHeight" | "scrollTop" | "clientHeight">): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}
/** The list's end is on screen (a laid-out panel only: one with no height, as before layout, is not "at its end"). */
export function endNear(el: Pick<Element, "scrollHeight" | "scrollTop" | "clientHeight">): boolean {
  return el.clientHeight > 0 && scrollLeft(el) <= END_FOLD_PX;
}
/** The panel that scrolls under the pill: the nearest scrolling ancestor of what is drawn at the pill's spot. */
function scrollerUnderPill(pill: Element | null): Element | null {
  if (!pill || typeof document.elementsFromPoint !== "function") return null;
  const r = pill.getBoundingClientRect();
  const under = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).find((e) => e !== pill && !pill.contains(e));
  for (let e: Element | null = under ?? null; e; e = e.parentElement) {
    const oy = getComputedStyle(e).overflowY;
    if ((oy === "auto" || oy === "scroll") && e.scrollHeight > e.clientHeight + 1) return e;
  }
  return document.scrollingElement;
}

function useFoldsWhileScrollingDown(on: boolean, pill: () => Element | null): boolean {
  const [folded, setFolded] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  useEffect(() => {
    if (!on || typeof document === "undefined") return;
    const last = new WeakMap<EventTarget, number>();
    const onScroll = (e: Event) => {
      const el = e.target === document ? document.scrollingElement : (e.target as Element | null);
      if (!el || typeof (el as Element).scrollTop !== "number") return;
      const top = (el as Element).scrollTop;
      const before = last.get(el) ?? 0;
      last.set(el, top);
      setAtEnd(endNear(el as Element));
      if (top <= 8) setFolded(false);
      else if (top - before > 4) setFolded(true);
      else if (before - top > 4) setFolded(false);
    };
    // At rest (nothing scrolled yet): look again as the list arrives and settles.
    const look = () => {
      const el = scrollerUnderPill(pill());
      if (el) setAtEnd(endNear(el));
    };
    const timers = [0, 400, 1200, 2500].map((ms) => setTimeout(look, ms));
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", look);
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", look);
      timers.forEach(clearTimeout);
    };
  }, [on, pill]);
  return folded || atEnd;
}

/**
 * `add`: this member's own action when it is not the section's usual one (Shops: a member who already has a shop is
 * offered "+ Add an item", not "+ Open a shop"; ShopsHomeView). Guard: src/test/shopOwnerAddNotOpenShop.test.tsx.
 */
const findPill = () => (typeof document === "undefined" ? null : document.querySelector("[data-testid='section-create-fab']"));

/**
 * `round` (lead 11-25, phone audit #1): the pill is the round "+" from the start (Declutter Browse, whose two-column
 * photo grid it sat on at rest); its name stays on aria-label.
 */
/** Phone polish C (11-25, lead): the always-round + on Declutter Browse sits 6px from the edge, not 16px. At rest on a
 * 375 phone the 16px spot covered the end of the right card's "$40.60 incl. fee" line (measured: text x232-319, + x311-359);
 * at 6px the + starts at x321. Guard: src/test/phonePolishC1125.test.tsx. */
const FAB_ROUND_RIGHT = "right-1.5";

export function SectionCreateFab({ section, text: given, add: own, round = false }: { section?: SectionKey; text?: string; add?: SectionAdd; round?: boolean }) {
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
  const folded = useFoldsWhileScrollingDown(shown, findPill) || round;
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
      className={`fixed bottom-safe-nav ${round ? FAB_ROUND_RIGHT : "right-4"} z-40 rounded-full font-semibold shadow-lg [&>svg]:h-5 [&>svg]:w-5 ${folded ? "w-12 px-0" : "gap-1.5 pl-4 pr-5"}`}
      style={{ marginRight: "var(--safe-area-right, 0px)" }}
    >
      <Plus aria-hidden />
      {!folded && text}
    </Button>,
    document.body,
  );
}
