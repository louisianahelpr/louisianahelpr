import { act, fireEvent } from "@testing-library/react";

/**
 * Opens every closed price section on a gift guide page (owner 2026-11-21: the first section opens, the rest are
 * closed until tapped), so a check sees every row. Returns the root for chaining.
 */
export function openPriceSections<T extends ParentNode>(root: T): T {
  for (const b of [...root.querySelectorAll<HTMLButtonElement>('[data-gift-section-toggle][aria-expanded="false"]')]) {
    act(() => { fireEvent.click(b); });
  }
  return root;
}

/** A price section's heading text (its toggle's label, without the count). */
export const sectionTitle = (sec: Element) =>
  (sec.querySelector("[data-gift-section-toggle] > span") ?? sec.querySelector("h2"))?.firstChild?.textContent ?? "";
