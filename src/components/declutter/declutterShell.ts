import { DECLUTTER_SHELL_ID } from "@/components/landing/homeShell";
import { removeShellOncePainted } from "@/components/landing/landingShell";

/**
 * Q2705 (lead 11-09): index.html's /declutter skeleton (#lh-declutter-shell) can carry the first card photos, drawn
 * from the HTML (the guest and member scripts mark it data-lh-photos). Taking it away when DeclutterPage first paints
 * showed Browse's own bare bones for a second, so the photos went and came back (filmstrip 11-09,
 * ~/.lh-shots/speed-declutter/a1-member-film...: photos at 2.2 s, gone at 6.0 s, cards at 7.0 s). So a skeleton with
 * photos stays until Browse has painted its cards (releaseDeclutterShellForCards), at most SHELL_PHOTO_HOLD_MS after
 * the page painted (another screen, an error or the 404 never waits longer than that). One without photos goes at once.
 */
export const SHELL_PHOTO_HOLD_MS = 3000;

export function releaseDeclutterShell(doc: Document = document): () => void {
  const el = doc.getElementById(DECLUTTER_SHELL_ID);
  if (!el) return () => {};
  if (!el.hasAttribute("data-lh-photos")) {
    removeShellOncePainted(DECLUTTER_SHELL_ID, doc);
    return () => {};
  }
  const t = setTimeout(() => removeShellOncePainted(DECLUTTER_SHELL_ID, doc), SHELL_PHOTO_HOLD_MS);
  return () => clearTimeout(t);
}

/** Browse's cards are on screen: the skeleton (and the photos drawn into it) can go. */
export function releaseDeclutterShellForCards(doc: Document = document): void {
  removeShellOncePainted(DECLUTTER_SHELL_ID, doc);
}
