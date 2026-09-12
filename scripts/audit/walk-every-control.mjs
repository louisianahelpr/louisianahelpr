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
import { chromium } from "@playwright/test";
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
          // THE DEFECT IS A CARD HUGGING ITS PARENT'S EDGE, not a card sitting
          // inside a padded panel. The owner's description is "two boundaries
          // 1px apart"; PageScaffold's documented two-card shell insets its job
          // cards by 17px and is deliberate. Counting both made every dashboard
          // report 4-6 "nested cards" that were working as designed, which
          // buries the real ones. Only a gap of 6px or less counts.
          let nested = 0;
          const nestedDetail = [];
          document.querySelectorAll("*").forEach((el) => {
            if (!isCard(el)) return;
            let p = el.parentElement;
            while (p && p !== document.body) {
              if (isCard(p)) {
                const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
                // IT MUST HUG ON BOTH OPPOSITE EDGES. A minimum over all four
                // gaps calls any small control sitting near one edge a nested
                // card — on /my-posts it flagged the "Lafayette" location chips,
                // tinted 6%-opacity pills four pixels from the card's left
                // edge, eight per screen. A card drawn inside a card spans its
                // parent: it hugs left AND right, or top AND bottom. That is
                // the shape the owner keeps pointing at, "two boundaries 1px
                // apart", and nothing else.
                const gapX = Math.max(Math.abs(r.left - pr.left), Math.abs(r.right - pr.right));
                const gapY = Math.max(Math.abs(r.top - pr.top), Math.abs(r.bottom - pr.bottom));
                const gap = Math.min(gapX, gapY);
                if (gap <= 6) {
                  nested++;
                  nestedDetail.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 28)} inside ${p.tagName.toLowerCase()}.${String(p.className).slice(0, 28)} @${Math.round(gap)}px`);
                }
                break;
              }
              p = p.parentElement;
            }
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
            nestedDetail: nestedDetail.slice(0, 4),
            htmlClass: de.className,
            frame: frame ? Math.round(frame.getBoundingClientRect().right) : null,
            rootPadRight: getComputedStyle(document.getElementById("root")).paddingRight,
            text: (document.body.innerText || "").trim().slice(0, 200).replace(/\s+/g, " "),
          };
        });

        if (rec.layout.hOverflow > 0) rec.findings.push(`H-OVERFLOW ${rec.layout.hOverflow}px: ${rec.layout.overflowing.join(", ")}`);
        if (rec.layout.nestedCards > 0) rec.findings.push(`NESTED CARDS x${rec.layout.nestedCards}: ${rec.layout.nestedDetail.join(" ;; ")}`);
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
            // RESOLVE, AND IF IT IS GONE, PUT THE PAGE BACK AND LOOK AGAIN.
            // The labels were captured on load; by the time the walk reaches
            // the later ones an earlier click may have changed the screen —
            // opening a message thread hides the bottom dock, so "Home",
            // "Posts", "Jobs" and the rest simply no longer exist. Playwright
            // then times out with a call log that says only "waiting for
            // locator", and the harness reported the entire bottom nav as
            // unclickable on /messages while elementFromPoint over every one of
            // those buttons returned the button itself.
            const resolve = async () => {
              for (const c of candidates) {
                if (await c.count().catch(() => 0)) return c;
              }
              return null;
            };
            let target = await resolve();
            if (!target) {
              await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
              await page.waitForTimeout(1500);
              target = await resolve();
            }
            if (!target) { rec.controls.push({ label, result: "not present on a freshly loaded page" }); continue; }

            // `sr-only` controls are clipped to a pixel ON PURPOSE — they exist
            // for a screen reader, and a pointer is never meant to reach them.
            // "Expand Job Details" on /my-posts is one. Reporting them as
            // unclickable is reporting the accessibility layer as a defect.
            const srOnly = await target
              .evaluate((el) => el.closest(".sr-only") !== null || el.classList.contains("sr-only"))
              .catch(() => false);
            if (srOnly) { rec.controls.push({ label, result: "screen-reader only (pointer not expected)" }); continue; }

            // ALREADY SELECTED IS NOT DEAD. A tab that is the current tab, or a
            // nav item for the route you are on, is SUPPOSED to do nothing when
            // pressed. Without this the walk reports "Home" dead on /dashboard,
            // "Posts" dead on /my-posts, "Messages" dead on /messages and
            // "Terms" dead on the legal tab — four confident findings per run,
            // none of them real, all of them crowding out the ones that are.
            const active = await target
              .evaluate((el) => {
                const on = (a) => el.getAttribute(a) === "true" || el.closest(`[${a}="true"]`) !== null;
                return on("aria-selected") || on("aria-current") || on("aria-pressed") ||
                  el.getAttribute("aria-current") === "page" ||
                  el.dataset.state === "active" || el.closest('[data-state="active"]') !== null;
              })
              .catch(() => false);
            if (active) { rec.controls.push({ label, result: "already the active tab/route (no-op expected)" }); continue; }

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
              // TOGGLE AND FIELD STATE. Without this a control that flips a
              // switch looks dead: "Copy Mon to all" on the availability tab
              // turned the last day on — verified by hand, aria-checked false
              // to true — and the harness reported DEAD CONTROL because the
              // page's text length, input count and control names were all
              // unchanged. Half this app's controls are toggles; a fingerprint
              // that cannot see them cannot audit them.
              state: [...document.querySelectorAll('[role="switch"], [aria-checked], [aria-expanded], [aria-selected], [aria-pressed], input, select, textarea')]
                .map((e) => [
                  e.getAttribute("aria-checked"), e.getAttribute("aria-expanded"),
                  e.getAttribute("aria-selected"), e.getAttribute("aria-pressed"),
                  e.type === "checkbox" || e.type === "radio" ? String(e.checked) : (e.value ?? ""),
                ].join("/"))
                .join(","),
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
              // Bring it into view first, and give the click a realistic
              // budget. A 3s blind click reported the whole bottom nav on
              // /messages as unclickable while `elementFromPoint` over every
              // one of those buttons returned the button itself — the list
              // beside them was still settling, so Playwright's stability check
              // kept timing out. A harness that calls a working control broken
              // costs more than one that is slightly slower.
              await target.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
              await target.click({ timeout: 8000 });
              await page.waitForTimeout(700);
            } catch (e) {
              why = String(e.message).replace(/\s+/g, " ").slice(0, 400);
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
              after.state !== before.state ? "changed a toggle/field" :
              Math.abs(after.body - before.body) > 12 ? `content changed (${after.body - before.body > 0 ? "+" : ""}${after.body - before.body})` :
              "NOTHING HAPPENED";

            // A control whose WHOLE PURPOSE is text entry must focus the field
            // it reveals on a phone — otherwise the user taps search, gets a
            // box, and has to tap again before the keyboard appears.
            //
            // Scoped to search-shaped controls on purpose. "Edit profile" and
            // "Add a profile photo" also reveal inputs, and neither should
            // steal focus: a multi-field form that grabs the keyboard on open
            // hides itself behind it, and focusing a file picker achieves
            // nothing. Flagging those was the same over-reach that had this
            // harness calling working things broken.
            const isSearchish = /search|find|filter/i.test(label);
            if (isSearchish && after.inputs > before.inputs && width <= 420 && after.focused !== "INPUT" && after.focused !== "TEXTAREA") {
              rec.findings.push(`REVEALED A FIELD BUT DID NOT FOCUS IT: "${label}" (activeElement=${after.focused})`);
            }
            const newErrs = consoleErrors.slice(errsBefore);
            rec.controls.push({ label, result: changed, errors: newErrs.slice(0, 2) });
            if (changed === "NOTHING HAPPENED") rec.findings.push(`DEAD CONTROL: "${label}"`);
            if (newErrs.length) rec.findings.push(`CONSOLE ERROR after "${label}": ${newErrs[0]}`);

            if (after.url !== before.url) {
              await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
              await page.waitForTimeout(1400);
            } else if (after.controls !== before.controls || after.inputs !== before.inputs || after.state !== before.state) {
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
