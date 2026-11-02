/** Sell a bunch (BunchFlow) pure helpers, moved out of DeclutterBunchView.tsx to keep it under its size ratchet. */
import type { BunchItem } from "@/lib/declutter/bunch";
import { bunchItemName } from "./DeclutterBunchCard";

/** The other sorted items a row can move a photo to, named apart when two share a name ("Lamp (3)"). */
export function bunchOthers(items: BunchItem[], key: string) {
  const names = items.map((it, i) => bunchItemName(it, i));
  return items.flatMap((it, i) => (it.key === key || it.notSorted ? [] : [{ key: it.key, name: names.filter((n) => n === names[i]).length > 1 ? `${names[i]} (${i + 1})` : names[i], photoKey: it.photoKeys[0] }]));
}

/** A row with something to read (a flag, a photo that failed, a merge suggestion) starts open. */
export const bunchRowStartsOpen = (it: BunchItem) => it.flagged || !!it.failedPhoto || !!it.mergeHint;

/** The bar's Next: to the list step, focused and scrolled to. */
export function focusBunchListStep() {
  const el = document.getElementById("bunch-list-step");
  el?.focus();
  el?.scrollIntoView?.({ block: "start" });
}

/** List more: the photo step renders again on the next paint; focus it then. */
export function focusBunchFilesNextPaint() {
  requestAnimationFrame(() => document.getElementById("bunch-files")?.focus());
}
