// Sweep harness: headed Chromium on :4203 with an injected seeded session.
import { chromium } from "playwright";
import fs from "node:fs";

export const BASE = "http://localhost:4203";
export const SHOTS = "/Users/lexilombas/.lh-sweep/helper/shots";
export const VP = { phone: { width: 375, height: 812 }, desktop: { width: 1440, height: 900 } };

export function loadSession(who) {
  return JSON.parse(fs.readFileSync(`${SHOTS}/${who}-session.json`, "utf8"));
}

export async function launch({ who, viewport = VP.phone, theme = "light", headless = false, geo = "grant" }) {
  const sess = who ? loadSession(who) : null;
  const browser = await chromium.launch({ headless });
  const ctxOpts = {
    viewport,
    colorScheme: theme,
    deviceScaleFactor: 1,
    isMobile: viewport.width < 500,
    hasTouch: viewport.width < 500,
  };
  if (geo === "grant") {
    ctxOpts.geolocation = { latitude: 30.4515, longitude: -91.1871 }; // Baton Rouge
    ctxOpts.permissions = ["geolocation"];
  }
  const context = await browser.newContext(ctxOpts);
  const errors = [];
  await context.addInitScript(({ key, value, theme, uid }) => {
    if (key) localStorage.setItem(key, value);
    localStorage.setItem("helpr-theme", theme);
    if (uid && !localStorage.getItem("sweep-keep-tour")) localStorage.setItem(`helpr_onboarding_${uid}`, JSON.stringify({ completed: true, currentStep: 9, completedSteps: [] }));
  }, { key: sess?.key, value: sess?.value, theme, uid: sess ? JSON.parse(sess.value).user.id : null });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[console] ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${String(e).slice(0, 300)}`));
  page.on("response", (r) => { if (r.status() >= 400 && !/posthog|sentry|ingest/.test(r.url())) errors.push(`[http ${r.status()}] ${r.url().slice(0, 200)}`); });
  return { browser, context, page, errors };
}

// Measurement gate from the brief.
export async function measure(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const out = { hOverflow: de.scrollWidth > de.clientWidth, sw: de.scrollWidth, cw: de.clientWidth, wide: [], clipped: [], badText: [] };
    const vw = de.clientWidth;
    const all = Array.from(document.querySelectorAll("body *"));
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 1 && r.width > 2 && cs.position !== "fixed" && !el.closest("[data-sweep-ignore]")) {
        const inScroller = (() => { let p = el.parentElement; while (p) { const pc = getComputedStyle(p); if (/(auto|scroll)/.test(pc.overflowX)) return true; p = p.parentElement; } return false; })();
        if (!inScroller) out.wide.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`);
      }
      // clipped labels: scrollWidth > clientWidth on text-bearing leaf elements with overflow hidden
      if (el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 2 && /hidden|clip/.test(cs.overflowX + cs.overflow) && cs.textOverflow !== "ellipsis") {
        out.clipped.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 40)}" sw=${el.scrollWidth} cw=${el.clientWidth}`);
      }
      if (el.children.length === 0) {
        const t = el.textContent;
        if (/\bNaN\b|\bundefined\b|\[object Object\]|\bnull\b/.test(t)) out.badText.push(t.trim().slice(0, 80));
      }
    }
    out.wide = out.wide.slice(0, 8); out.clipped = out.clipped.slice(0, 8); out.badText = out.badText.slice(0, 8);
    return out;
  });
}

export async function shoot(page, name, { full = false } = {}) {
  const p = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: p, fullPage: full });
  return p;
}

export async function goto(page, path, { wait = 1500 } = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(wait);
}

export function report(name, m, errors) {
  const flags = [];
  if (m.hOverflow) flags.push(`H-OVERFLOW sw=${m.sw} cw=${m.cw}`);
  if (m.wide.length) flags.push(`WIDE: ${m.wide.join(" | ")}`);
  if (m.clipped.length) flags.push(`CLIPPED: ${m.clipped.join(" | ")}`);
  if (m.badText.length) flags.push(`BADTEXT: ${m.badText.join(" | ")}`);
  const errs = errors.splice(0).filter((e) => !/favicon|manifest|429|_vercel|Failed to load resource|avatars\/placeholder/.test(e));
  if (errs.length) flags.push(`ERRS: ${[...new Set(errs)].slice(0, 4).join(" | ")}`);
  console.log(`${flags.length ? "!!" : "ok"} ${name}${flags.length ? "\n    " + flags.join("\n    ") : ""}`);
}
