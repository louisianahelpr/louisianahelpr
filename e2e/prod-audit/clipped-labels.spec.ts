/**
 * CLIPPED CONTROL LABELS, ON SCREEN (Q119, the on-screen half of Q108/Q116).
 *
 * src/test/truncatedActionLabel.test.ts finds, in source, every control whose
 * label can be cut off (truncate / text-ellipsis / line-clamp) without its full
 * text in a `title` or `aria-label`. It cannot say whether the label IS cut
 * off; this does, on the rendered app against prod.
 *
 * For every route in the audit catalog (spacingScreens(): the guest routes as a
 * guest, the signed-in routes as poster-e2e), at 320, 375 and 1440: every
 * visible element carrying a clip class inside a control (a, button, or role
 * button/link/tab/menuitem) is measured. It is CLIPPED when scrollWidth >
 * clientWidth + 1 (line-clamp: scrollHeight > clientHeight + 1). A clipped
 * label passes only when its full text is reachable (title or aria-label on it
 * or on its control). Every clipped label is printed as `CLIP ...` with
 * whether it has its full text, so the run is the measurement.
 *
 * Shown able to fail: the mutation drops the title the Q116 fix gave the
 * Messages list's job title, which clips at 375 (measured 241 > 231).
 */
import { test, expect, type Browser } from "../prodTest";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";
import { spacingScreens, type SpacingScreen } from "./shellSpacing";

// @mutate src/components/messages/ConversationRow.tsx | title={c.jobTitle} | data-q119-mutant={c.jobTitle}

const WIDTHS = [320, 375, 1440] as const;
const SCREENS = spacingScreens();

let poster: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

interface ClipRow {
  text: string;
  control: string;
  sw: number;
  cw: number;
  sh: number;
  ch: number;
  full: boolean;
}

/** Self-contained (page.evaluate serialises it). */
function readClippedLabels(): ClipRow[] {
  const CLIP = /(^|\s)(truncate|text-ellipsis|line-clamp-\S+)(\s|$)/;
  const CONTROL = 'a,button,[role="button"],[role="link"],[role="tab"],[role="menuitem"]';
  const out: ClipRow[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    const cls = typeof el.className === "string" ? el.className : "";
    if (!CLIP.test(cls)) continue;
    const control = el.closest<HTMLElement>(CONTROL);
    if (!control) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || cs.display === "none") continue;
    const clamp = /line-clamp/.test(cls);
    const clipped = clamp ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
    if (!clipped) continue;
    const full = !!(el.getAttribute("title") || el.getAttribute("aria-label") || control.getAttribute("title") || control.getAttribute("aria-label"));
    out.push({
      text: (el.textContent || "").trim().slice(0, 80),
      control: control.tagName.toLowerCase() + (control.getAttribute("role") ? `[role=${control.getAttribute("role")}]` : ""),
      sw: el.scrollWidth,
      cw: el.clientWidth,
      sh: el.scrollHeight,
      ch: el.clientHeight,
      full,
    });
  }
  return out;
}

async function ctxFor(browser: Browser, auth: SpacingScreen["auth"], vw: number, baseURL?: string) {
  const desktop = vw >= 900;
  const ctx = await browser.newContext({
    baseURL,
    viewport: { width: vw, height: desktop ? 900 : 812 },
    hasTouch: !desktop,
    serviceWorkers: "block",
    ...(desktop ? {} : { userAgent: test.info().project.use.userAgent }),
  });
  if (auth === "poster") {
    await ctx.addInitScript(
      ({ key, val }) => {
        try {
          localStorage.setItem(key, val);
          localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
        } catch {
          /* signed out: the route lands on /login and is measured as that */
        }
      },
      { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster) },
    );
  }
  return ctx;
}

test("clipped labels: every route's clipped control label keeps its full text at 320/375/1440", async ({ browser }, info) => {
  test.setTimeout(60 * 60_000);
  expect(SCREENS.length, "spacingScreens() came back short").toBeGreaterThan(40);
  const wrong: string[] = [];
  let routes = 0;
  for (const auth of ["guest", "poster"] as const) {
    for (const vw of WIDTHS) {
      const ctx = await ctxFor(browser, auth, vw, info.project.use.baseURL);
      const page = await ctx.newPage();
      for (const s of SCREENS.filter((x) => x.auth === auth)) {
        await page.goto(s.url, { waitUntil: "domcontentloaded" });
        await page
          .waitForFunction(() => [...document.querySelectorAll("h1")].some((h) => (h.textContent || "").trim()), undefined, { timeout: 30_000 })
          .catch(() => {});
        await page.waitForTimeout(1500);
        routes++;
        for (const c of await page.evaluate(readClippedLabels)) {
          const line = `${s.name}@${vw} <${c.control}> "${c.text}" sw${c.sw}/cw${c.cw} sh${c.sh}/ch${c.ch} full=${c.full}`;
          console.log(`CLIP ${line}`);
          if (!c.full) wrong.push(line);
        }
      }
      await ctx.close();
    }
  }
  expect(routes).toBe(SCREENS.length * WIDTHS.length);
  expect(wrong, `clipped control labels with no full text:\n${wrong.join("\n")}`).toEqual([]);
});
