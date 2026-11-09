import { ITEM_SHELL_ID } from "@/components/landing/homeShell";
import { removeShellOncePainted } from "@/components/landing/landingShell";

/**
 * ITEM PAGE SPEED (lead 11-09, the owner's under-2 s rule). index.html draws a phone's /declutter/item/:id loading
 * frame (#lh-item-shell, rendered from DeclutterItemSkeleton) and puts the item's first photo into its photo frame, so
 * the page's largest paint (that photo) comes with the HTML instead of after the item page's JavaScript. Taking the
 * frame away when the page mounted would show the page's own bare skeleton, and the photo would go and come back. So
 * the frame stays until the page has its own first photo complete under it (the gallery asks for the same URL, so it
 * comes from the cache), until the page shows something that is not the item's loading frame (no photos, the item is
 * gone, the 404), or at most ITEM_SHELL_HOLD_MS after the page mounted. index.html caps it at 10 s on its own.
 * Guard: src/test/itemShellMatchesSkeleton.test.tsx.
 */
export const ITEM_SHELL_HOLD_MS = 3000;
const STEP_MS = 50;

/** Whether the page under the frame has painted what the frame stood in for. */
export function itemPageReady(doc: Document = document): boolean {
  const root = doc.getElementById("root");
  if (!root) return true;
  const photo = root.querySelector<HTMLImageElement>("[data-gallery-track] img");
  if (photo) return photo.complete;
  if (root.querySelector("[data-gallery-empty]")) return true;
  // Still loading (the gate's or the item's own skeleton): hold. Anything else on screen (the item is gone, the 404,
  // an error card): go.
  return !root.querySelector("[data-item-loading]");
}

export function releaseItemShell(doc: Document = document): () => void {
  if (!doc.getElementById(ITEM_SHELL_ID)) return () => {};
  let waited = 0;
  const t = setInterval(() => {
    waited += STEP_MS;
    if (!doc.getElementById(ITEM_SHELL_ID)) return clearInterval(t);
    if (waited >= ITEM_SHELL_HOLD_MS || itemPageReady(doc)) {
      clearInterval(t);
      removeShellOncePainted(ITEM_SHELL_ID, doc);
    }
  }, STEP_MS);
  return () => clearInterval(t);
}
