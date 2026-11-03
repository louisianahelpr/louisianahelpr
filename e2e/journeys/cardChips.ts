/**
 * A job card's controls, ON THE ROW OR IN ITS "More" OVERFLOW.
 *
 * A step whose action row cannot hold every chip parks the rest behind
 * JobActionRow's overflow chip (`data-job-step-overflow`), whose panel
 * (`data-job-step-overflow-panel`) is a Radix popover PORTALED to <body> —
 * so a locator scoped to the card cannot see a chip in it, open or shut.
 * Measured 2026-09-26 (e2e-journeys probe runs 36212737517 / 36213134702,
 * wip/vac1797-probe-journeys): the poster's Done card of the marketplace
 * journey (it carries proof photos, so its row is Photos · More · Hire again)
 * had its review row in `reviews` (02:34:06Z), and its "Reviewed" chip was in
 * the More panel next to "Tip" — `card.getByRole("button", { name:
 * /^Reviewed\b/ })` counted 0 while the page had it.
 *
 * Again 2026-10-17 (e2e-journeys 39020810698, chromium): the poster's booked
 * card at 390px is More + "I'm still on" (one row = More + the primary), so
 * "Message Helpr" sat in the More panel and `pp.getByRole("button", { name:
 * "Message Helpr" })` timed out. Moved here from 02-marketplace.spec.ts so
 * every journey file looks a chip up the same way.
 * Guarded by src/test/journeyChipsReachOverflow.test.ts.
 */
import { expect, type Locator, type Page } from "@playwright/test";

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

/** The one job card whose face is `title` (a card, not the whole list: other cards carry the same chips).
 *  A Posted card's face is a LINK named "Open <title>" to /jobs/:id (MineJobFace), not a level-2 heading: the heading
 *  went with the face rebuild, and e2e-journeys 41553090940 timed out on it (04-admin-safety no-show). */
export function cardByTitle(page: Page, title: string): Locator {
  return page.locator("div.liquid-glass").filter({ has: page.getByRole("link", { name: `Open ${title}`, exact: true }) }).last();
}

/**
 * OPEN a Posted card in place, and prove it opened: the open card carries its "Close <title>" chevron (MineJobFace
 * onCollapse) and its meta row and step row. The title no longer expands it (the face links to /jobs/:id, owner
 * 2026-10-31); the face's "More options" button does (posterFaceAction: POSTER_CONTROLS_LABEL, manage = toggle).
 * Returns false when the face offers no "More options" at all (its one button is the stage's own move, such as
 * "Cancel job" or "Report no-show"): the caller decides whether that is allowed. Never a silent pass: a caller that
 * needs the open card asserts the true.
 */
export async function openPostedCard(page: Page, title: string, timeout = 30_000): Promise<boolean> {
  const card = cardByTitle(page, title);
  const close = card.getByRole("button", { name: `Close ${title}`, exact: true });
  await expect(card, `${title}'s card is not on screen`).toBeVisible({ timeout });
  if (await close.isVisible().catch(() => false)) return true;
  const more = card.getByRole("button", { name: "More options", exact: true }).filter({ visible: true }).first();
  if (!(await more.isVisible().catch(() => false))) return false;
  await more.click();
  await expect(close, `${title}'s card did not open when its "More options" was pressed`).toBeVisible({ timeout });
  return true;
}
