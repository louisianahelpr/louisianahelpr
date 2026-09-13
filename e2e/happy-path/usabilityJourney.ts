/**
 * Shared instrumentation for the usability scorecard (see
 * usability-scorecard.spec.ts). One `Journey` per scripted user goal —
 * records every tap/click, every text input, every distinct screen, and
 * whether the next control a first-time user needs was visible without
 * scrolling and had a clear accessible name.
 *
 * Deliberately dumb: this does NOT try to auto-detect UI actions by patching
 * Playwright globally. Each step is an explicit call (`j.click(locator,
 * label)`, `j.type(locator, text, label)`, `j.goto(url)`) so the numbers in
 * the scorecard map 1:1 onto lines a person can read and re-verify.
 */
import type { Page, Locator } from "@playwright/test";
import { findErrorScreen, detectStuckOrBlank } from "../errorScreens";

export interface StepGuidance {
  label: string;
  guided: boolean;
  reason: string;
}

export interface GoalResult {
  goal: string;
  clicks: number;
  textInputs: number;
  screens: string[];
  timeMs: number;
  guidance: StepGuidance[];
  guidedSteps: number;
  totalSteps: number;
  errorScreens: string[];
}

/** Heuristic: control is visible without scrolling and has a clear name. */
async function isGuided(page: Page, locator: Locator): Promise<StepGuidance> {
  const name = (await locator.evaluate((el) => (el as HTMLElement).innerText || el.getAttribute("aria-label") || "").catch(() => "")) || "";
  const box = await locator.boundingBox().catch(() => null);
  const viewport = page.viewportSize();
  if (!box || !viewport) {
    return { label: name.trim().slice(0, 60) || "(unnamed control)", guided: false, reason: "control not measurable" };
  }
  const inView = box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width;
  const named = name.trim().length > 1;
  const guided = inView && named;
  const reason = !inView ? "requires scrolling to see" : !named ? "no clear label" : "visible + labelled";
  return { label: name.trim().slice(0, 60) || "(unnamed control)", guided, reason };
}

export class Journey {
  private clicks = 0;
  private textInputs = 0;
  private screens = new Set<string>();
  private guidance: StepGuidance[] = [];
  private errorScreens: string[] = [];
  private start = Date.now();

  constructor(private page: Page, public readonly goal: string) {
    this.recordScreen();
  }

  private recordScreen() {
    try {
      this.screens.add(new URL(this.page.url()).pathname);
    } catch {
      /* about:blank before first goto */
    }
  }

  /** Run the shared error-screen + stuck/blank checks against the current page. */
  private async checkHealth() {
    const text = await this.page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    const found = findErrorScreen(text);
    if (found) this.errorScreens.push(`${this.goal}: ${found.name} — "${found.excerpt}"`);
    const stuck = await this.page.evaluate(detectStuckOrBlank).catch(() => null);
    if (stuck) this.errorScreens.push(`${this.goal}: ${stuck}`);
  }

  async goto(url: string) {
    await this.page.goto(url);
    await this.page.waitForLoadState("networkidle").catch(() => {});
    this.recordScreen();
    await this.checkHealth();
  }

  /** Record the guidance heuristic for the next control WITHOUT clicking it. */
  async note(locator: Locator) {
    this.guidance.push(await isGuided(this.page, locator));
  }

  async click(locator: Locator, label?: string) {
    const g = await isGuided(this.page, locator);
    if (label) g.label = label;
    this.guidance.push(g);
    await locator.click();
    this.clicks++;
    this.recordScreen();
    await this.checkHealth();
  }

  async type(locator: Locator, text: string, label?: string) {
    const g = await isGuided(this.page, locator);
    if (label) g.label = label;
    this.guidance.push(g);
    await locator.fill(text);
    this.textInputs++;
    await this.checkHealth();
  }

  finish(): GoalResult {
    const guidedSteps = this.guidance.filter((g) => g.guided).length;
    return {
      goal: this.goal,
      clicks: this.clicks,
      textInputs: this.textInputs,
      screens: [...this.screens],
      timeMs: Date.now() - this.start,
      guidance: this.guidance,
      guidedSteps,
      totalSteps: this.guidance.length,
      errorScreens: this.errorScreens,
    };
  }
}
