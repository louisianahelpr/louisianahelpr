import { useEffect, useRef, useState, type RefObject } from "react";
import type { MKMap } from "./mapkitRuntime";
import type { MapJob } from "./config";
import { PREVIEW_CARD_MAX_W, PREVIEW_CARET, PREVIEW_EDGE, type PreviewPlacement } from "./previewPlacement";

/*
 * The selected pin's halo and the pin-anchored preview's live placement, moved out of
 * src/components/BrowseMap.tsx unchanged (Q806, the god-component ratchet). BrowseMap calls it at the spot the
 * code used to sit and renders `preview` / `previewWrapRef` into <PinPreview> exactly as before.
 */
export function usePinPreviewPlacement({
  mapRef,
  mapBoxRef,
  clearanceProbeRef,
  selectedJobId,
  mapReady,
  visibleJobs,
}: {
  mapRef: RefObject<MKMap | null>;
  mapBoxRef: RefObject<HTMLDivElement | null>;
  clearanceProbeRef: RefObject<HTMLDivElement | null>;
  selectedJobId: string | null;
  mapReady: boolean;
  visibleJobs: MapJob[];
}) {
  // ── Selected pin ⇄ preview card, visibly tied together ──────────────────
  //
  // The sheet is deliberately a BOTTOM SHEET (see the long note on the JSX
  // block below — owner's call, and the reasons still hold). What it was
  // missing is the other half of that convention: on Apple/Google Maps the
  // sheet is unambiguous about WHICH pin it describes, because the pin is
  // visibly selected. Ours rendered the tapped pin exactly like the other
  // fifteen, so the card was a card about "a job", not about that pin.
  //
  // Two cues, both driven from here:
  //   1. the tapped pin is enlarged and haloed (inline styles, not a class —
  //      the pin elements are MapKit-owned DOM and this file cannot add CSS);
  //   2. a caret on the card's top edge sits in the pin's own COLUMN, so the
  //      card literally points at it. Clamped inside the card, and hidden
  //      when the pin is clustered away or not above the card.
  //
  // Both re-measure on every frame while a preview is open (and only then):
  // MapKit animates the camera on open, so a one-shot measurement points at
  // where the pin used to be.
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  // Pin-anchored popover placement (owner, 2026-09-15: the preview card sits AT
  // the pin, not in a bottom sheet). Computed every frame from the selected
  // pin's live screen position + the card's measured size, so it tracks the
  // camera. `null` until the first measurement — the card renders hidden until
  // then so it never flashes at 0,0. `caretDir` "down" = card is ABOVE the pin
  // (caret on the card's bottom edge, pointing down at it); "up" = flipped
  // BELOW the pin when there is no room above.
  const [preview, setPreview] = useState<PreviewPlacement | null>(null);
  const prevSelectedElRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const clearPin = () => {
      const prev = prevSelectedElRef.current;
      if (prev) {
        prev.style.transform = "";
        prev.style.zIndex = "";
        prev.style.filter = "";
        prevSelectedElRef.current = null;
      }
    };
    const map = mapRef.current;
    if (!map || !selectedJobId) {
      clearPin();
      setPreview(null);
      return;
    }
    let frame = 0;
    const sync = () => {
      frame = requestAnimationFrame(sync);
      const el = map.element.querySelector<HTMLElement>(
        `.browse-map-pin[data-job-id="${CSS.escape(selectedJobId)}"]`,
      );
      if (el !== prevSelectedElRef.current) clearPin();
      if (!el) {
        setPreview(null);
        return;
      }
      if (prevSelectedElRef.current !== el) {
        // Scale from the pin's tip (transform-origin: bottom center, set in
        // pinElement) so the point stays on its coordinate, and halo it so it
        // reads as selected against any map ground.
        el.style.transform = "scale(1.45)";
        el.style.zIndex = "40";
        el.style.filter =
          "drop-shadow(0 0 0 hsl(var(--card))) drop-shadow(0 0 3px hsl(var(--card))) " +
          "drop-shadow(0 4px 8px hsl(var(--olivewood) / 0.45))";
        prevSelectedElRef.current = el;
      }
      const box = mapBoxRef.current;
      const wrap = previewWrapRef.current;
      if (!box || !wrap) {
        setPreview(null);
        return;
      }
      const pinRect = el.getBoundingClientRect();
      // Clustered to zero size ⇒ the pin isn't really on the map; drop the card
      // rather than anchor it to a collapsed point.
      if (pinRect.width === 0) {
        setPreview(null);
        return;
      }
      const boxRect = box.getBoundingClientRect();
      const cardRect = wrap.getBoundingClientRect();
      const cardW = cardRect.width || PREVIEW_CARD_MAX_W;
      const cardH = cardRect.height;
      // Pin geometry in mapBox space. The coordinate anchor is the pin's bottom
      // centre (anchorOffset lifts the element by half its height); its icon
      // spans [pinTop, pinBottom].
      const pinX = pinRect.left + pinRect.width / 2 - boxRect.left;
      const pinTop = pinRect.top - boxRect.top;
      const pinBottom = pinRect.bottom - boxRect.top;
      // Bottom band the dock + FAB cover — measured, so the card never lands
      // under them when it has to flip below the pin.
      const bottomInset = clearanceProbeRef.current?.offsetHeight ?? 0;
      // Horizontal: centre the card on the pin, clamped inside the map edges.
      let left = pinX - cardW / 2;
      left = Math.min(Math.max(left, PREVIEW_EDGE), Math.max(PREVIEW_EDGE, boxRect.width - cardW - PREVIEW_EDGE));
      // Vertical: prefer ABOVE the pin (card bottom just over the pin's top).
      // Flip BELOW only when there isn't room above.
      let top = pinTop - PREVIEW_CARET - cardH;
      let caretDir: "up" | "down" = "down";
      if (top < PREVIEW_EDGE) {
        top = pinBottom + PREVIEW_CARET;
        caretDir = "up";
      }
      const maxTop = boxRect.height - bottomInset - cardH - PREVIEW_EDGE;
      top = Math.max(PREVIEW_EDGE, Math.min(top, Math.max(PREVIEW_EDGE, maxTop)));
      // Caret x: the pin's column relative to the card's left edge, kept off
      // the rounded corners.
      const caretLeft = Math.min(Math.max(pinX - left, 16), Math.max(16, cardW - 16));
      setPreview((cur) =>
        cur &&
        Math.abs(cur.left - left) < 0.5 &&
        Math.abs(cur.top - top) < 0.5 &&
        Math.abs(cur.caretLeft - caretLeft) < 0.5 &&
        cur.caretDir === caretDir
          ? cur
          : { left, top, caretLeft, caretDir },
      );
    };
    sync();
    return () => {
      cancelAnimationFrame(frame);
      clearPin();
    };
  }, [selectedJobId, mapReady, visibleJobs]);
  return { preview, previewWrapRef };
}
