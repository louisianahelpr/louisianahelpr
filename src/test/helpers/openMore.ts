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
  // Area 03 M11 (11-18): the panel is a bottom sheet; its own Close is not one of the job's actions.
  return [...document.querySelectorAll<HTMLElement>("[data-job-step-overflow-list] button, [data-job-step-overflow-list] a[href]")];
}
