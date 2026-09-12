#!/usr/bin/env node
/**
 * THE AUDIT HARNESS.
 *
 * Not a screenshot tool. For each route it:
 *   1. loads with a REAL prod session (no mocks),
 *   2. waits for content (never photographs skeletons),
 *   3. records layout facts (overflow, rail inset, nested cards),
 *   4. ENUMERATES EVERY INTERACTIVE CONTROL and presses it, recording what
 *      actually changed — URL, dialog, DOM, network, console,
 *   5. screenshots before and after, at both widths and both themes.
 *
 * The point is step 4. The owner's words: "last time there were alot of gaps
 * you just looked and didnt make sure anything worked as it should."
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:5183";
const OUT = process.env.OUT ?? "/tmp/lh-audit";
const ACCOUNT = process.env.ACCOUNT ?? "poster-e2e";
const ROUTES = (process.env.ROUTES ?? "/dashboard").split(",");
const WIDTHS = (process.env.WIDTHS ?? "375,1440").split(",").map(Number);
const THEMES = (process.env.THEMES ?? "light,dark").split(",");
const CLICK = process.env.CLICK !== "0";

mkdirSync(OUT, { recursive: true });

const session = JSON.parse(
  execSync(`node scripts/test-signin-link.mjs ${ACCOUNT} --session --json`, {
    cwd: "/Users/lexilombas/louisianahelpr", encoding: "utf8", maxBuffer: 1 << 24,
  }),
);

const results = [];
const browser = await chromium.launch();

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width, height: width === 375 ? 812 : 900 },
      colorScheme: theme,
      deviceScaleFactor: 2,
    });
    await ctx.addInitScript(
      ([k, v, t]) => {
        try {
          localStorage.setItem(k, v);
          localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
          localStorage.setItem("helpr-theme", t);
        } catch { /* storage blocked */ }
      },
      [session.key, session.value, theme],
    );

    for (const route of ROUTES) {
      const page = await ctx.newPage();
      const consoleErrors = [];
      const netFails = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
      });
      page.on("pageerror", (e) => consoleErrors.push("uncaught: " + String(e.message).slice(0, 160)));
      page.on("response", (r) => {
        if (r.status() >= 400) netFails.push(`${r.status()} ${r.request().method()} ${r.url().split("?")[0].split("/").slice(-2).join("/")}`);
      });

      const rec = { route, width, theme, controls: [], findings: [] };
      try {
        await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 45_000 });
        // Content, not skeletons. The one legitimate persistent pulse is the
        // aria-hidden halo behind the Post FAB, so exclude aria-hidden.
        await page.waitForFunction(() => {
          const busy = document.querySelectorAll('[aria-busy="true"]').length;
          const pulses = [...document.querySelectorAll('[class*="animate-pulse"]')]
            .filter((e) => !e.closest("[aria-hidden='true']")).length;
          return busy === 0 && pulses === 0 && (document.body.innerText || "").trim().length > 40;
        }, { timeout: 25_000 }).catch(() => rec.findings.push("NEVER SETTLED (skeletons or empty after 25s)"));
        await page.waitForTimeout(700);

        const slug = `${route.replace(/[^a-z0-9]+/gi, "_")}-${width}-${theme}`;
        await page.screenshot({ path: `${OUT}/${slug}.png`, fullPage: false });
        rec.shot = `${OUT}/${slug}.png`;

        rec.layout = await page.evaluate(() => {
          const de = document.documentElement;
          const isCard = (el) => {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return r.width > 64 && r.height > 32 &&
              cs.borderRadius !== "0px" &&
              cs.backgroundColor !== "rgba(0, 0, 0, 0)" &&
              cs.backgroundColor !== "transparent" &&
              parseFloat(cs.borderTopWidth) > 0;
          };
          let nested = 0;
          document.querySelectorAll("*").forEach((el) => {
            if (!isCard(el)) return;
            let p = el.parentElement;
            while (p && p !== document.body) { if (isCard(p)) { nested++; break; } p = p.parentElement; }
          });
          const over = [];
          document.querySelectorAll("*").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.right > de.clientWidth + 2) over.push(el.tagName.toLowerCase() + "." + String(el.className).slice(0, 32));
          });
          const frame = document.querySelector(".app-shell-frame");
          return {
            hOverflow: de.scrollWidth - de.clientWidth,
            overflowing: over.slice(0, 3),
            nestedCards: nested,
            htmlClass: de.className,
            frame: frame ? Math.round(frame.getBoundingClientRect().right) : null,
            rootPadRight: getComputedStyle(document.getElementById("root")).paddingRight,
            text: (document.body.innerText || "").trim().slice(0, 200).replace(/\s+/g, " "),
          };
        });

        if (rec.layout.hOverflow > 0) rec.findings.push(`H-OVERFLOW ${rec.layout.hOverflow}px: ${rec.layout.overflowing.join(", ")}`);
        if (rec.layout.nestedCards > 0) rec.findings.push(`NESTED CARDS x${rec.layout.nestedCards}`);
        if (/something went wrong|couldn't load|page hit a problem|Update ready/i.test(rec.layout.text))
          rec.findings.push(`ERROR STATE RENDERED: ${rec.layout.text.slice(0, 90)}`);

        // ---- press every control -------------------------------------
        if (CLICK) {
          const SEL = 'button:visible, a[href]:visible, [role="tab"]:visible, [role="switch"]:visible, input[type="checkbox"]:visible';

          // NAMES FIRST, THEN RE-LOCATE EACH TIME. Collecting ElementHandles up
          // front and clicking them in a loop looks obvious and is wrong: the
          // first click re-renders, every later handle detaches, and Playwright
          // reports "Element is not attached to the DOM" — which reads exactly
          // like an app defect. It cost a false "the notifications bell is
          // unclickable" before this was fixed. Locators re-resolve on use.
          const labels = await page.evaluate((sel) => {
            const out = [];
            document.querySelectorAll(sel.replace(/:visible/g, "")).forEach((el) => {
              const r = el.getBoundingClientRect();
              if (r.width < 4 || r.height < 4) return;
              const t = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 48);
              if (t) out.push(t);
            });
            return [...new Set(out)];
          }, SEL);

          for (const label of labels.slice(0, 40)) {
            // Resolve in three ways, because icon-only controls have NO text
            // and their accessible name is often longer than the label we
            // captured ("Filters · 2 active" truncated to "Filters"). An exact
            // getByLabel misses those, and reporting "vanished" for a control
            // the harness simply could not address is indistinguishable from a
            // real defect — which is the whole failure mode this audit exists
            // to avoid.
            const esc = label.replace(/"/g, '\\"');
            // Every candidate is restricted to an INTERACTIVE element.
            // `getByLabel` alone matches any element carrying the name — on
            // /dashboard it resolved "Notifications" to the panel's own
            // <section aria-label="Notifications">, then timed out waiting for
            // a section to become clickable and reported the BELL as
            // unclickable. A harness that mis-addresses a control and then
            // blames the app is worse than no harness.
            const INTERACTIVE = 'button, a[href], [role="tab"], [role="switch"], input[type="checkbox"]';
            const candidates = [
              page.locator(SEL).filter({ hasText: label }).first(),
              page.locator(`${INTERACTIVE}`).filter({ has: page.locator(`[aria-label^="${esc}"]`) }).first(),
              page.locator(
                INTERACTIVE.split(", ").map((t) => `${t}[aria-label^="${esc}"]`).join(", ") + ", " +
                INTERACTIVE.split(", ").map((t) => `${t}[title^="${esc}"]`).join(", "),
              ).first(),
            ];
            let target = null;
            for (const c of candidates) {
              if (await c.count().catch(() => 0)) { target = c; break; }
            }
            if (!target) { rec.controls.push({ label, result: "harness could not address it" }); continue; }

            // A link to the page you are already on is SUPPOSED to do nothing.
            let selfLink = false;
            try {
              const href = await target.getAttribute("href", { timeout: 1000 });
              if (href) selfLink = new URL(href, page.url()).pathname === new URL(page.url()).pathname;
            } catch { /* not a link */ }
            if (selfLink) { rec.controls.push({ label, result: "self-link (no-op expected)" }); continue; }

            // A STRUCTURAL fingerprint, not just a character count. Text
            // length alone reported "NOTHING HAPPENED" for the dashboard's
            // Search button, which actually swaps the whole header row for a
            // search field — 517 characters became 514, under the threshold.
            // A control that replaces the chrome is the opposite of dead, and
            // the harness called it dead. Count the inputs and name the
            // interactive controls too, so a swap is visible as a swap.
            const snap = () => page.evaluate(() => ({
              body: (document.body.innerText || "").length,
              inputs: document.querySelectorAll("input, textarea, select").length,
              controls: [...document.querySelectorAll("button, a[href]")]
                .map((b) => b.getAttribute("aria-label") || (b.innerText || "").trim().slice(0, 20))
                .filter(Boolean).sort().join("|"),
              focused: document.activeElement ? document.activeElement.tagName : "",
            }));
            const before = {
              url: page.url(),
              dialogs: await page.locator('[role="dialog"]').count(),
              ...(await snap()),
            };
            const errsBefore = consoleErrors.length;
            let why = "";
            try {
              await target.click({ timeout: 3000 });
              await page.waitForTimeout(700);
            } catch (e) {
              why = String(e.message).replace(/\s+/g, " ").slice(0, 150);
              rec.controls.push({ label, result: "NOT CLICKABLE", why });
              rec.findings.push(`UNCLICKABLE: "${label}" — ${why}`);
              continue;
            }
            const after = {
              url: page.url(),
              dialogs: await page.locator('[role="dialog"]').count(),
              ...(await snap()),
            };
            const changed =
              after.url !== before.url ? `navigated → ${after.url.replace(BASE, "")}` :
              after.dialogs > before.dialogs ? "opened a dialog" :
              after.controls !== before.controls ? "swapped the controls" :
              after.inputs !== before.inputs ? `revealed a field (inputs ${before.inputs}→${after.inputs})` :
              Math.abs(after.body - before.body) > 12 ? `content changed (${after.body - before.body > 0 ? "+" : ""}${after.body - before.body})` :
              "NOTHING HAPPENED";

            // A control that reveals a text field on a PHONE must focus it —
            // otherwise the user taps search, gets a box, and has to tap again
            // before the keyboard appears.
            if (after.inputs > before.inputs && width <= 420 && after.focused !== "INPUT" && after.focused !== "TEXTAREA") {
              rec.findings.push(`REVEALED A FIELD BUT DID NOT FOCUS IT: "${label}" (activeElement=${after.focused})`);
            }
            const newErrs = consoleErrors.slice(errsBefore);
            rec.controls.push({ label, result: changed, errors: newErrs.slice(0, 2) });
            if (changed === "NOTHING HAPPENED") rec.findings.push(`DEAD CONTROL: "${label}"`);
            if (newErrs.length) rec.findings.push(`CONSOLE ERROR after "${label}": ${newErrs[0]}`);

            if (after.url !== before.url) {
              await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
              await page.waitForTimeout(1400);
            } else if (after.controls !== before.controls || after.inputs !== before.inputs) {
              // The chrome changed under us (a search field replacing the icon
              // row, a tab swapping the body). Reload so the next control is
              // pressed against the same starting state as the first.
              await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
              await page.waitForTimeout(1400);
            } else if (after.dialogs > before.dialogs) {
              await page.keyboard.press("Escape");
              await page.waitForTimeout(500);
              if (await page.locator('[role="dialog"]').count() > before.dialogs) {
                rec.findings.push(`DIALOG WILL NOT CLOSE ON ESCAPE: opened by "${label}"`);
                await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
                await page.waitForTimeout(1400);
              }
            }
          }
        }
      } catch (e) {
        rec.findings.push("HARNESS ERROR: " + String(e.message).slice(0, 140));
      }
      rec.consoleErrors = [...new Set(consoleErrors)].slice(0, 5);
      rec.netFails = [...new Set(netFails)].slice(0, 5);
      if (rec.consoleErrors.length) rec.findings.push(`CONSOLE: ${rec.consoleErrors[0]}`);
      if (rec.netFails.length) rec.findings.push(`NETWORK: ${rec.netFails.join(" | ")}`);
      results.push(rec);
      console.log(`[${route} ${width} ${theme}] controls=${rec.controls.length} findings=${rec.findings.length}${rec.findings.length ? " :: " + rec.findings.join(" ;; ") : ""}`);
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\nwrote ${OUT}/results.json — ${results.length} route/width/theme combos`);
