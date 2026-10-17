/**
 * A job card's controls, ON THE ROW OR IN ITS "More" OVERFLOW.
 *
 * A step whose action row cannot hold every chip parks the rest behind
 * JobActionRow's overflow chip (`data-job-step-overflow`), whose panel
 * (`data-job-step-overflow-panel`) is a Radix popover PORTALED to <body> —
 * so a locator scoped to the card cannot see a chip in it, open or shut.
 * Measured 2026-09-26 (e2e-journeys probe runs 36212737517 / 36213134702,
 * wip/vac1797-probe-journeys): the poster's Done card of the marketplace
 * journey (it carries proof photos, so its row is Photos · More · Hire Again)
 * had its review row in `reviews` (02:34:06Z), and its "Reviewed" chip was in
 * the More panel next to "Tip" — `card.getByRole("button", { name:
 * /^Reviewed\b/ })` counted 0 while the page had it.
 *
 * Again 2026-10-17 (e2e-journeys 39020810698, chromium): the poster's booked
 * card at 390px is More + "I'm Still On" (one row = More + the primary), so
 * "Message Helpr" sat in the More panel and `pp.getByRole("button", { name:
 * "Message Helpr" })` timed out. Moved here from 02-marketplace.spec.ts so
 * every journey file looks a chip up the same way.
 * Guarded by src/test/journeyChipsReachOverflow.test.ts.
 */
import type { Locator, Page } from "@playwright/test";

/** The visible control named `name` on the card's row or in its More panel, or null by `timeout`. */
export async function findChip(page: Page, scope: Locator, name: RegExp, timeout: number): Promise<Locator | null> {
  const deadline = Date.now() + timeout;
  const panel = page.locator("[data-job-step-overflow-panel]").filter({ visible: true });
  for (;;) {
    const inOpenPanel = panel.getByRole("button", { name }).first();
    if (await inOpenPanel.isVisible().catch(() => false)) return inOpenPanel;
    const onRow = scope.getByRole("button", { name }).filter({ visible: true }).first();
    if (await onRow.isVisible().catch(() => false)) return onRow;
    const more = scope.locator("[data-job-step-overflow]").filter({ visible: true }).first();
    if (await more.isVisible().catch(() => false)) {
      await more.click();
      const inPanel = panel.getByRole("button", { name }).first();
      if (await inPanel.waitFor({ state: "visible", timeout: 3_000 }).then(() => true, () => false)) return inPanel;
      await page.keyboard.press("Escape");
    }
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(1_000);
  }
}

/** The one job card whose title heading is `title` (a card, not the whole list: other cards carry the same chips). */
export function cardByTitle(page: Page, title: string): Locator {
  return page.locator("div.liquid-glass").filter({ has: page.getByRole("heading", { name: title, level: 2 }) }).last();
}
