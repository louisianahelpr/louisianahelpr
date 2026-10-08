import { act, fireEvent } from "@testing-library/react";

/**
 * Open every job-card `More` on the page so the controls inside it render
 * (since 2026-10-08 every action but the primary lives under More, owner:
 * "move everything besides the primary button into the more tab"). Returns the
 * open panels' controls.
 */
export async function openMore(root: ParentNode = document): Promise<HTMLElement[]> {
  const triggers = [...root.querySelectorAll<HTMLElement>("[data-job-step-overflow]")];
  for (const t of triggers) {
    if (t.getAttribute("aria-expanded") === "true") continue;
    await act(async () => { fireEvent.click(t); });
  }
  return [...document.querySelectorAll<HTMLElement>("[data-job-step-overflow-panel] button, [data-job-step-overflow-panel] a[href]")];
}
