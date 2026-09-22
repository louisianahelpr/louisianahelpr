/**
 * RAIL OVERLAP PROBE — the owner's class: "in webpage, the messages go behind
 * the right panel. fix this and any other occurances this happens with".
 *
 * Signed in, desktop 1440, right panel OPEN: nothing a user can see or click
 * may extend past `innerWidth - 248px`. The two shared inset rules
 * (`.app-shell-frame { right }`, `#root { padding-right }`) cannot reach a
 * `position: fixed` element, so those are what this measures.
 */
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.PROBE_BASE || "http://127.0.0.1:4173";
const RAIL = 248;
const OUT = process.env.PROBE_OUT || "test-results/rail-probe";
mkdirSync(OUT, { recursive: true });

const ROUTES = (process.env.PROBE_ROUTES || "/messages,/dashboard,/my-jobs,/activity,/profile,/browse,/notifications,/settings").split(",");

const raw = JSON.parse(execSync("node scripts/test-signin-link.mjs poster-e2e --session --json", { encoding: "utf8", maxBuffer: 1 << 24 }));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([k, v]) => {
  try {
    localStorage.setItem(k, v);
    localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
  } catch { /* storage blocked */ }
}, [raw.key, raw.value]);

const page = await ctx.newPage();
const findings = [];
for (const route of ROUTES) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => document.documentElement.className);
  const over = await page.evaluate((rail) => {
    const limit = window.innerWidth - rail;
    const out = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right <= limit + 0.5) continue;
      // only report the OUTERMOST offender per subtree
      if (out.some((o) => o.el.contains(el))) continue;
      out.push({ el, r });
    }
    return out.map(({ el, r }) => ({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === "string" ? el.className : "").slice(0, 120),
      attrs: Array.from(el.attributes).map((a) => a.name).filter((n) => n.startsWith("data-")).join(","),
      pos: getComputedStyle(el).position,
      right: Math.round(r.right),
      left: Math.round(r.left),
      top: Math.round(r.top),
      limit,
    }));
  }, RAIL);
  const railOn = state.includes("side-panel-open") && state.includes("desktop-rail");
  findings.push({ route, html: state, railOn, over });
  const png = `${OUT}/${route.replace(/\W+/g, "_") || "root"}.png`;
  await page.screenshot({ path: png });
  console.log(`\n${route}  rail=${railOn}  offenders=${over.length}  -> ${png}`);
  for (const o of over) console.log(`   ${o.pos} <${o.tag} class="${o.cls}"> right=${o.right} > limit=${o.limit}`);
}
writeFileSync(`${OUT}/findings.json`, JSON.stringify(findings, null, 2));
await browser.close();
const bad = findings.filter((f) => f.railOn && f.over.length);
console.log(`\nROUTES WITH OVERLAP: ${bad.length}`);
process.exit(bad.length ? 1 : 0);
