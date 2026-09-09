/**
 * Prove the distance filter's fallback chain for lh-design-holes.
 *
 * The premise: the signed-in test helper has NO geodata
 * (profiles.latitude/longitude are both NULL) but DOES carry the signup ZIP
 * 70808 → East Baton Rouge. Geolocation is left DENIED, which is what a real
 * user who taps "Don't Allow" produces.
 *
 * Before the fallback existed that combination meant `status: "error"`, the
 * radius silently kept every job, and the sr-only heading said the distance
 * filter had not been applied. After it, the ZIP resolves to a parish centroid
 * and the radius actually runs — flagged approximate, because a centroid is
 * parish-scale and must never be quoted as a fix.
 */
// `@playwright/test` re-exports chromium and is the listed dependency;
// bare `playwright` is only transitive, which knip flags as unlisted.
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:8080";
const OUT = process.env.OUT ?? "/tmp/claude-501/-Users-lexilombas-louisianahelpr/e0241cf9-a362-473b-a66a-f80d4cd37af9/scratchpad/shots";
const TAG = process.env.TAG ?? "nearby";
mkdirSync(OUT, { recursive: true });

const session = JSON.parse(
  execSync("node scripts/test-signin-link.mjs helper --session --json", { encoding: "utf8" }),
);

for (const vp of [
  { name: "375", width: 375, height: 812 },
  { name: "1440", width: 1440, height: 900 },
]) {
  for (const theme of ["light", "dark"]) {
    const browser = await chromium.launch();
    // No grantPermissions call: geolocation stays DENIED, so
    // getCurrentPosition fails with PERMISSION_DENIED exactly as it does for a
    // user who declines the OS prompt.
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: theme,
      deviceScaleFactor: 2,
    });
    await ctx.addInitScript(
      ([k, v, t]) => {
        localStorage.setItem(k, v);
        localStorage.setItem(
          "helpr_onboarding",
          JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }),
        );
        localStorage.setItem("theme", t);
        // The soft "why we want location" pre-prompt is session-gated on this
        // key; seeding it lets the run reach the real permission outcome
        // instead of parking on the rationale dialog.
        try {
          sessionStorage.setItem("__helpr_rationale_confirmed", JSON.stringify(["location"]));
        } catch { /* private mode */ }
      },
      [session.key, session.value, theme],
    );
    const page = await ctx.newPage();
    const label = `${TAG}-${vp.name}-${theme}`;
    try {
      await page.goto(`${BASE}/dashboard?loc=nearby:${process.env.RADIUS ?? "5"}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6000);
      const heading = await page
        .locator("h1, h2")
        .allInnerTexts()
        .then((a) => a.map((s) => s.trim()).filter(Boolean).join(" | "))
        .catch(() => "");
      await page.screenshot({ path: `${OUT}/${label}.png` });
      console.log(`${label}: heading=${JSON.stringify(heading).slice(0, 200)}`);
    } catch (e) {
      console.log(`${label}: ERROR ${e.message.slice(0, 120)}`);
    }
    await browser.close();
  }
}
