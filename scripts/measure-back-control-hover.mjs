#!/usr/bin/env node
/**
 * LOOK AT THE HOVER — the measurement no source read can make.
 *
 * `src/test/backControlSameness.test.ts` is a SOURCE check: it knows what
 * classes a control declares, and nothing about what they resolve to. jsdom
 * has no cascade, so a rendered assertion in vitest would read empty strings
 * and pass vacuously. This script is the other half: real Chromium, the BUILT
 * stylesheet (`dist/assets/*.css` after `npm run build` — never the dev
 * server, whose declarations the minifier has not yet collapsed), and
 * `getComputedStyle` read twice, at rest and while hovered.
 *
 * TWO PASSES, because neither alone is proof:
 *
 *   app   Drives the real app served from `dist/` and hovers the back control
 *         on real routes. Proves the COMPONENT renders what source says.
 *   css   Renders every exit control's own class string, taken verbatim from
 *         the inventory, against the same built stylesheet. Proves the
 *         CASCADE resolves — that `.ctl-exit` really does beat
 *         `buttonVariants`' `rounded-ds-md`, which is the one thing a class
 *         list cannot tell you.
 *
 * Usage: node scripts/measure-back-control-hover.mjs [--out <dir>]
 */
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inventory, buttonVariantClasses, stripComments, openingTag } from "./back-control-inventory.mjs";

const VARIANTS = buttonVariantClasses();
/** `buttonVariants`' base string — read from button.tsx, never restated. */
const BASE_CLS = (() => {
  const src = readFileSync("src/components/ui/button.tsx", "utf8");
  const m = /cva\(\s*"((?:[^"\\]|\\.)*)"/.exec(src);
  return m ? m[1] : "";
})();

const OUT =
  process.argv[process.argv.indexOf("--out") + 1] &&
  process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : "test-results/back-control-hover";
const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173";

const SHOTS = join(OUT, "hovered");
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const cssFile = readdirSync("dist/assets").find((f) => f.endsWith(".css"));
if (!cssFile) throw new Error("no dist/assets/*.css — run `npm run build` first");
const CSS = readFileSync(join("dist/assets", cssFile), "utf8");

/** The five computed properties the owner's three complaints live in. */
const PROPS = ["background-color", "border-radius", "transform", "box-shadow", "opacity", "scale"];

const readStyle = (el) => {
  const s = getComputedStyle(el);
  // The GLYPH's transform as well as the control's. dialog.tsx moved its X,
  // not its button — `group-hover:-translate-y-0.5` on the <svg> — so a
  // measurement that read only the button reported the single most-rendered
  // dismiss in the app as motionless while it visibly rose under the cursor.
  const glyph = el.querySelector("svg");
  return {
    "glyph-transform": glyph ? getComputedStyle(glyph).transform : "n/a",
    "background-color": s.backgroundColor,
    "border-radius": s.borderRadius,
    transform: s.transform,
    "box-shadow": s.boxShadow,
    opacity: s.opacity,
    scale: s.scale,
  };
};

const inv = inventory("src");
const exits = inv.controls.filter((c) => c.kind === "icon" && c.what !== "<BackButton>");

const results = { app: [], css: [] };

const browser = await chromium.launch();

// ── PASS 1: the real app ────────────────────────────────────────────────────
// Routes reachable without a session that render a real exit control.
const ROUTES = [
  { path: "/legal", sel: 'button[aria-label="Go back"]', name: "Legal — PageHeader BackButton" },
  { path: "/help", sel: 'button[aria-label="Go back"]', name: "HelpCenter — PageHeader BackButton" },
  { path: "/support", sel: 'button[aria-label="Go back"]', name: "Support — PageHeader BackButton" },
];

const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
for (const r of ROUTES) {
  try {
    await page.goto(BASE + r.path, { waitUntil: "networkidle", timeout: 20000 });
    const el = page.locator(r.sel).first();
    await el.waitFor({ state: "visible", timeout: 10000 });
    const rest = await el.evaluate(readStyle);
    await el.hover();
    await page.waitForTimeout(250);
    const hover = await el.evaluate(readStyle);
    const shot = join(OUT, `app-${r.path.replace(/\W+/g, "") || "root"}-hover.png`);
    await page.screenshot({ path: shot });
    results.app.push({ ...r, rest, hover, screenshot: shot });
  } catch (e) {
    results.app.push({ ...r, error: String(e).slice(0, 200) });
  }
}
await page.close();

// ── PASS 2: every exit control's own class string, real built CSS ───────────
// Rendered on the app's real page ground so the composited tint is honest.
const harness = await browser.newPage({ viewport: { width: 900, height: 1400 } });
await harness.setContent(
  `<style>${CSS}</style><body class="bg-premium-page"><div id="r" style="padding:24px;display:flex;flex-wrap:wrap;gap:24px"></div></body>`,
);
await harness.evaluate((items) => {
  const root = document.getElementById("r");
  for (const it of items) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:6px;width:150px";
    const b = document.createElement("button");
    b.type = "button";
    b.className = it.cls;
    b.setAttribute("data-id", it.id);
    b.innerHTML =
      `<svg class="${it.glyphCls}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
    const cap = document.createElement("div");
    cap.style.cssText = "font:10px/1.3 system-ui;text-align:center;opacity:.65";
    cap.textContent = it.id;
    wrap.append(b, cap);
    root.append(wrap);
  }
}, exits.map((c) => ({ id: idOf(c), cls: classOf(c), glyphCls: glyphClassOf(c) })));

function idOf(c) {
  return `${c.file.split("/").pop()}:${c.line}`;
}

/**
 * The classes on the control's own glyph. Required, not decorative: the
 * movement dialog.tsx shipped lived on the <svg>, so a harness that rendered
 * a bare icon could not reproduce the defect it is here to catch.
 */
function glyphClassOf(c) {
  const src = stripComments(readFileSync(c.file, "utf8"));
  const lines = src.split("\n");
  const offset = lines.slice(0, c.line - 1).join("\n").length + (c.line > 1 ? 1 : 0);
  const start = src.indexOf("<", offset);
  const tag = openingTag(src, start);
  const body = src.slice(start + tag.length, start + tag.length + 2500);
  const icon = /<(?:ArrowLeft|ChevronLeft|X)\b[\s\S]{0,400}?className=(?:"([^"]*)"|\{`((?:[^`\\]|\\.)*)`\}|\{([^}]*)\})/.exec(body);
  // The ternary/expression form (`className={a ? "x" : "y"}`) needs its
  // quotes and operators stripped; a string or template does NOT — stripping
  // `:` there turns `group-hover:-translate-y-0.5` into two dead tokens, and
  // the harness then reproduced dialog.tsx's lifting glyph as motionless.
  const raw = icon?.[1] ?? icon?.[2] ?? icon?.[3] ?? "";
  const isExpr = icon?.[3] !== undefined;
  return (isExpr ? raw.replace(/["']/g, " ").replace(/[?:]/g, " ") : raw)
    .replace(/\$\{[^}]*\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The control's class string as the browser will see it: its own classes plus
 * whatever `buttonVariants` contributes when it is written as a `<Button>`.
 * Restating either here would make this a check of its own constant.
 */
function classOf(c) {
  // Use the scanner's own tag extractor, not a line window: dialog.tsx puts
  // ~26 lines of comment between `<DialogPrimitive.Close` and its className,
  // and a window that stopped short read NO classes and reported the app's
  // most-rendered dismiss as a 0px-radius control with no hover. Comments are
  // stripped first so a class quoted in prose cannot be picked up either.
  const src = stripComments(readFileSync(c.file, "utf8"));
  const lines = src.split("\n");
  const offset = lines.slice(0, c.line - 1).join("\n").length + (c.line > 1 ? 1 : 0);
  const start = src.indexOf("<", offset);
  const tag = openingTag(src, start);
  const cls = /className=(?:"([^"]*)"|\{`((?:[^`\\]|\\.)*)`\})/.exec(tag);
  const own = (cls?.[1] ?? cls?.[2] ?? "").replace(/\$\{[^}]*\}/g, " ");
  const variantCls = c.variant ? (VARIANTS.get(c.variant) ?? "") : "";
  const base = c.what === "<Button>" ? BASE_CLS : "";
  return stripPlacement(`${base} ${variantCls} ${own}`).replace(/\s+/g, " ").trim();
}

/**
 * Drop the classes that PLACE a control, keeping the ones that PAINT it.
 *
 * Every one of these buttons is positioned against a parent it does not have
 * here, so left in place they stack on top of each other and Playwright's
 * hover hits whichever one is on top — the grid measures one control 26 times.
 * Nothing removed can affect background-color, border-radius, box-shadow or a
 * hover transform, which are the only properties read back.
 */
function stripPlacement(cls) {
  return cls
    .split(/\s+/)
    .filter(
      (t) =>
        !/^-?(?:absolute|fixed|sticky|inset-|top-|right-|bottom-|left-|z-|m[trblxy]?-|translate-[xy]-|after:)/.test(t),
    )
    .join(" ");
}

for (const c of exits) {
  const id = idOf(c);
  const el = harness.locator(`[data-id="${id}"]`).first();
  const rest = await el.evaluate(readStyle);
  await el.hover();
  await harness.waitForTimeout(200);
  const hover = await el.evaluate(readStyle);
  // One screenshot per control, taken WHILE HOVERED. The rest-state grid
  // below cannot show this defect: most of these controls paint nothing at
  // rest, so the shape only exists during hover — which is the whole report.
  const shot = join(SHOTS, `${id.replace(/[^\w.]/g, "_")}.png`);
  await el.locator("xpath=..").screenshot({ path: shot });
  results.css.push({ id, file: `${c.file}:${c.line}`, label: c.label, cls: classOf(c), rest, hover, screenshot: shot });
  await harness.mouse.move(0, 0);
}
const gridShot = join(OUT, "all-exit-controls-rest.png");
await harness.screenshot({ path: gridShot, fullPage: true });
results.grid = gridShot;
await harness.close();
await browser.close();

writeFileSync(join(OUT, "hover.json"), JSON.stringify(results, null, 2));

// ── Report ──────────────────────────────────────────────────────────────────
const SQUARE = (r) => !/^(?:\d+px|9999px|50%)$/.test(r.split(" ")[0]) || parseFloat(r) < 20;
console.log(`\nAPP PASS (${BASE})`);
for (const a of results.app)
  console.log(
    a.error
      ? `  ✗ ${a.name}: ${a.error}`
      : `  ${a.name}\n    rest  radius=${a.rest["border-radius"]} bg=${a.rest["background-color"]} transform=${a.rest.transform}\n    hover radius=${a.hover["border-radius"]} bg=${a.hover["background-color"]} transform=${a.hover.transform}\n    ${a.screenshot}`,
  );

console.log(`\nCSS PASS — ${results.css.length} exit controls against dist/assets/${cssFile}`);
const radii = new Set(results.css.map((r) => r.hover["border-radius"]));
const moved = results.css.filter(
  (r) => r.rest.transform !== r.hover.transform || r.rest["glyph-transform"] !== r.hover["glyph-transform"],
);
const flat = results.css.filter((r) => r.rest["background-color"] === r.hover["background-color"]);
for (const r of results.css)
  console.log(
    `  ${r.id.padEnd(34)} radius=${r.hover["border-radius"].padEnd(8)} ${r.rest["background-color"]} -> ${r.hover["background-color"]}${r.rest.transform !== r.hover.transform ? "  MOVES" : ""}${r.rest["glyph-transform"] !== r.hover["glyph-transform"] ? "  GLYPH MOVES" : ""}`,
  );
console.log(`\n  distinct hover radii: ${[...radii].join(" | ")}`);
console.log(`  controls that move on hover: ${moved.length}`);
console.log(`  controls whose background does not change on hover: ${flat.length}`);
if (flat.length) console.log("   " + flat.map((r) => r.id).join(", "));
console.log(`\n  grid screenshot: ${gridShot}`);
