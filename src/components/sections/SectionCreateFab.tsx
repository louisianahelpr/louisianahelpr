import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useAgeGate } from "@/hooks/useAgeGate";
import { hapticMedium } from "@/lib/haptics";
import { sectionByKey, type SectionKey } from "@/components/sections/sectionsConfig";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/language";
import { setCreateSheetOpen, useCreateSheetOpen } from "@/components/mobileNav/createSheetStore";

/**
 * THE SECTION'S CREATE PILL (owner 11-08, the Vinted header): the top bar's green "+" became this floating pill,
 * bottom-right, 16px above the bottom bar on the shared clearance (`bottom-safe-nav`: the home-indicator inset + the
 * dock + 1rem), so it never covers the dock. "+ Sell" on Declutter, "+ Post a job" on Jobs (behind the same age gate
 * as every Post a job), the section's own create elsewhere; it goes where the bar's "+" went (sectionsConfig `add`).
 * Portaled to document.body: a fixed element inside the page is not viewport-relative (CLAUDE.md, fixed containing
 * block). SectionScreen's `fab` adds room under the last row so the pill never sits on the last row at rest.
 * Phone only: the desktop website keeps the bar's soft "+ Post a job" (etc.). Guard: src/test/declutterHeaderVinted.test.tsx.
 */
export function SectionCreateFab({ section, text: given }: { section?: SectionKey; text?: string }) {
  const { t: tr } = useLanguage();
  const text = given ?? tr("nav.create");
  const navigate = useNavigate();
  const desktop = useIsWebDesktop();
  const gate = useAgeGate();
  const sheetOpen = useCreateSheetOpen();
  if (desktop || typeof document === "undefined") return null;
  // No section (Dashboard): the pill opens the Create sheet ("What are we doing?"), as the bar's "+" did there.
  const add = section ? sectionByKey(section).add : null;
  if (section && !add) return null;
  const isPost = add?.path === "/post-job";
  const go = () => { hapticMedium(); if (add) navigate(add.path); else setCreateSheetOpen((o) => !o); };
  return createPortal(
    <Button
      type="button"
      variant="primary"
      size="md"
      data-testid="section-create-fab"
      data-create-section={section ?? "sheet"}
      aria-label={add ? add.label : text}
      {...(add ? {} : { "aria-haspopup": "dialog" as const, "aria-expanded": sheetOpen })}
      onClick={isPost ? gate.gate("post", go) : go}
      {...(isPost ? gate.gatedProps("post") : {})}
      className="fixed bottom-safe-nav right-4 z-40 gap-1.5 rounded-full pl-4 pr-5 font-semibold shadow-lg [&>svg]:h-5 [&>svg]:w-5"
      style={{ marginRight: "var(--safe-area-right, 0px)" }}
    >
      <Plus aria-hidden />
      {text}
    </Button>,
    document.body,
  );
}
