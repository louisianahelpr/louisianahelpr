import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Focus handling for a HAND-ROLLED overlay (a portal with role="dialog" that
 * does not go through Radix, so nothing owns focus for it).
 *
 * Measured 2026-09-07 on both photo viewers (dashboard/PhotoLightbox and
 * MessageAttachment's lightbox): opening one left focus on the thumbnail
 * BEHIND it, and Tab walked the chat / the job sheet underneath while a
 * full-screen viewer was on top — a keyboard user could not reach the close
 * button, and a screen reader never had the viewer announced.
 *
 * On open: move focus to the first focusable descendant (the close button, in
 * both viewers). While open: keep Tab and Shift+Tab inside the overlay.
 * Focus RETURN on close is deliberately not here — both viewers already do
 * it, and each records the opener at a different moment.
 */
export function useOverlayFocus(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const focusables = () =>
      Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) {
        e.preventDefault();
        el.focus();
        return;
      }
      const i = list.indexOf(document.activeElement as HTMLElement);
      let next: number;
      if (e.shiftKey) next = i <= 0 ? list.length - 1 : i - 1;
      else next = i < 0 || i === list.length - 1 ? 0 : i + 1;
      e.preventDefault();
      list[next].focus();
    };
    // Radix FocusScope (the job sheet under the dashboard photo viewer) keeps
    // a `focusin`/`focusout` pair on document that yanks focus back into its
    // own content whenever it lands outside — which is exactly what happens
    // when this overlay is a portal beside the dialog rather than inside it.
    // Measured: with the viewer open, Tab cycled on the "View photos"
    // thumbnail underneath, never reaching the viewer's close button. Radix
    // registers in the bubble phase; these capture-phase listeners run first
    // and stop the event before it gets there, but only for focus moves that
    // land INSIDE this overlay, so the dialog's own trap is otherwise intact.
    const shield = (e: FocusEvent) => {
      const target = e.type === "focusout" ? e.relatedTarget : e.target;
      if (target instanceof Node && el.contains(target)) e.stopImmediatePropagation();
      // The focused control unmounted (the photo viewer's grid -> single
      // switch drops "Close grid view") and focus fell to <body> while the
      // overlay is still up. Put it back on the first control once React has
      // committed the new content.
      if (e.type === "focusout" && e.relatedTarget === null && e.target instanceof Node && el.contains(e.target)) {
        setTimeout(() => {
          if (el.isConnected && !el.contains(document.activeElement)) (focusables()[0] ?? el).focus({ preventScroll: true });
        }, 0);
      }
    };
    document.addEventListener("focusin", shield, true);
    document.addEventListener("focusout", shield, true);
    document.addEventListener("keydown", onKey, true);
    // After the shield is up, or the dialog underneath takes it straight back.
    const first = focusables()[0] ?? el;
    if (!el.contains(document.activeElement)) first.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("focusin", shield, true);
      document.removeEventListener("focusout", shield, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [ref, open]);
}
