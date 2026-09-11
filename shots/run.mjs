// Cold-cache, throttled load capture: screenshots + layout-shift + boot timeline.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const ORIGIN = process.env.ORIGIN || "http://localhost:4211";
const OUT = process.env.OUT || "/Users/lexilombas/.lh-shift-ws/shots";
const CAPTURE_MS = Number(process.env.CAPTURE_MS || 15000);
const STEP_MS = 250;
const session = JSON.parse(fs.readFileSync(path.join(OUT, "session.json"), "utf8"));
const routesArg = process.env.ROUTES;
const routes = routesArg
  ? routesArg.split(",").map((r) => {
      const [p, a] = r.split("@");
      return { path: p, authed: a === "authed" };
    })
  : [
      { path: "/", authed: false },
      { path: "/browse", authed: false },
      { path: "/login", authed: false },
      { path: "/dashboard", authed: true },
      { path: "/browse", authed: true },
      { path: "/my-jobs", authed: true },
      { path: "/profile", authed: true },
    ];

const initScript = `
(() => {
  const t0 = performance.timeOrigin;
  const now = () => Math.round(performance.now());
  const w = window;
  w.__log = [];
  const log = (kind, detail) => w.__log.push({ t: now(), kind, detail });
  const desc = (n) => {
    if (!n) return "?";
    if (n.nodeType === 3) n = n.parentElement;
    if (!n || !n.tagName) return "?";
    const cls = (typeof n.className === "string" ? n.className : "").split(/\\s+/).filter(Boolean).slice(0,4).join(".");
    const id = n.id ? "#" + n.id : "";
    const txt = (n.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40);
    return n.tagName.toLowerCase() + id + (cls ? "." + cls : "") + (txt ? " \\"" + txt + "\\"" : "");
  };
  // layout-shift
  try {
    w.__ls = [];
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        w.__ls.push({
          t: Math.round(e.startTime),
          value: e.value,
          hadRecentInput: e.hadRecentInput,
          sources: (e.sources || []).map((s) => ({
            node: desc(s.node),
            prev: s.previousRect && [s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height],
            cur: s.currentRect && [s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height],
          })),
        });
      }
    });
    po.observe({ type: "layout-shift", buffered: true });
  } catch (e) { log("ls-error", String(e)); }
  // paint timings
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) log("paint", { name: e.name, t: Math.round(e.startTime) }); }).observe({ type: "paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) log("lcp", { t: Math.round(e.startTime), size: e.size, el: desc(e.element) }); }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
  // html attribute / class / style mutations
  const startMO = () => {
    const html = document.documentElement;
    let prevClass = html.className, prevTheme = html.getAttribute("data-theme"), prevStyle = html.getAttribute("style");
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.target === html) {
          if (m.attributeName === "class" && html.className !== prevClass) { log("html.class", { from: prevClass, to: html.className }); prevClass = html.className; }
          if (m.attributeName === "data-theme" && html.getAttribute("data-theme") !== prevTheme) { log("html.data-theme", { from: prevTheme, to: html.getAttribute("data-theme") }); prevTheme = html.getAttribute("data-theme"); }
          if (m.attributeName === "style" && html.getAttribute("style") !== prevStyle) { log("html.style", { from: prevStyle, to: html.getAttribute("style") }); prevStyle = html.getAttribute("style"); }
        }
        if (m.target === document.body && m.attributeName === "class") log("body.class", document.body.className);
      }
    }).observe(html, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    const root = document.getElementById("root");
    if (root) {
      const mo = new MutationObserver(() => {
        if (!document.getElementById("boot-loader")) { log("boot-loader-removed", null); mo.disconnect(); }
      });
      mo.observe(root, { childList: true, subtree: false });
    }
    // nav arrival + avatar + skeletons
    const seen = new Set();
    new MutationObserver(() => {
      const checks = [
        ["mobile-nav", () => document.querySelector('nav[aria-label*="rimary" i], nav[aria-label*="ain" i], [data-testid="mobile-nav"], .mobile-nav, nav.fixed')],
        ["avatar-img", () => document.querySelector('img[alt*="avatar" i], [class*="avatar" i] img')],
        ["skeleton", () => document.querySelector('[class*="skeleton" i], [class*="animate-pulse"]')],
        ["hero-h1", () => document.querySelector("h1")],
        ["strike-banner", () => document.querySelector('[data-testid="strike-banner"]')],
        ["offline-banner", () => document.querySelector('[data-testid="offline-banner"]')],
        ["route-fallback", () => document.querySelector('[data-testid="route-suspense-fallback"], [aria-busy="true"]')],
      ];
      for (const [k, f] of checks) {
        const el = f();
        const key = k + ":" + (el ? "in" : "out");
        if (!seen.has(key) && (el || seen.has(k + ":in"))) {
          seen.add(key);
          if (el || seen.has(k + ":in")) log("dom." + k, el ? desc(el) : "gone");
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.documentElement) startMO(); else document.addEventListener("DOMContentLoaded", startMO);
  // fonts
  const fontLog = () => {
    try {
      document.fonts.addEventListener("loadingdone", (e) => log("fonts.loadingdone", (e.fontfaces||[]).map(f => f.family + " " + f.weight + " " + f.style)));
      document.fonts.addEventListener("loadingerror", (e) => log("fonts.loadingerror", (e.fontfaces||[]).map(f => f.family)));
      document.fonts.ready.then(() => log("fonts.ready", { bodoni: document.fonts.check("900 40px 'Bodoni Moda'"), montserrat: document.fonts.check("500 16px Montserrat") }));
    } catch (e) { log("fonts-error", String(e)); }
  };
  if (document.fonts) fontLog(); else document.addEventListener("DOMContentLoaded", fontLog);
  // text scale polling
  let lastScale = null;
  const poll = setInterval(() => {
    const s = document.documentElement.style.getPropertyValue("--user-text-scale");
    if (s !== lastScale) { log("--user-text-scale", s || "(unset)"); lastScale = s; }
    if (performance.now() > 20000) clearInterval(poll);
  }, 50);
  w.addEventListener("DOMContentLoaded", () => log("DOMContentLoaded", null));
  w.addEventListener("load", () => log("load", null));
})();
`;

const browser = await chromium.launch();
for (const r of routes) {
  const tag = `${r.authed ? "authed" : "guest"}${r.path.replace(/\//g, "_") || "_root"}`;
  const dir = path.join(OUT, tag);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  if (r.authed) {
    await context.addInitScript(
      ({ key, value }) => {
        try { localStorage.setItem(key, value); } catch {}
      },
      { key: session.key, value: session.value },
    );
  }
  await context.addInitScript(initScript);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  // Chrome DevTools "Slow 3G": 400ms RTT, 400kbps down/up
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const shots = [];
  const start = Date.now();
  const nav = page.goto(ORIGIN + r.path, { waitUntil: "commit", timeout: 60000 }).catch((e) => console.error("goto", tag, e.message));
  let i = 0;
  while (Date.now() - start < CAPTURE_MS) {
    const target = start + i * STEP_MS;
    const wait = target - Date.now();
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    const t = Date.now() - start;
    try {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 60 });
      const file = path.join(dir, `${String(t).padStart(5, "0")}.jpg`);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      shots.push({ t, file });
    } catch (e) {
      shots.push({ t, err: e.message });
    }
    i++;
  }
  await nav;
  const data = await page
    .evaluate(() => ({
      ls: window.__ls,
      log: window.__log,
      htmlClass: document.documentElement.className,
      theme: document.documentElement.getAttribute("data-theme"),
      scale: document.documentElement.style.getPropertyValue("--user-text-scale"),
      url: location.href,
      scrollW: document.documentElement.scrollWidth,
      nav: performance.getEntriesByType("navigation").map((n) => ({ dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), resp: Math.round(n.responseEnd) })),
      resources: performance.getEntriesByType("resource").map((e) => ({ n: e.name.replace(/^https?:\/\/[^/]+/, ""), s: Math.round(e.startTime), e: Math.round(e.responseEnd), size: e.transferSize })),
    }))
    .catch((e) => ({ error: e.message }));
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ route: r, shots, ...data }, null, 1));
  const cls = (data.ls || []).filter((e) => !e.hadRecentInput).reduce((a, b) => a + b.value, 0);
  console.log(`\n=== ${tag}  url=${data.url}  CLS=${cls.toFixed(4)}  html.class="${data.htmlClass}" theme=${data.theme} scale=${data.scale || "(unset)"}`);
  for (const l of data.log || []) console.log(`  ${String(l.t).padStart(6)}ms  ${l.kind}  ${JSON.stringify(l.detail)}`);
  for (const e of data.ls || []) {
    console.log(`  LS ${String(e.t).padStart(6)}ms  value=${e.value.toFixed(4)}${e.hadRecentInput ? " (input)" : ""}`);
    for (const s of e.sources) console.log(`       ${s.node}  ${JSON.stringify(s.prev)} -> ${JSON.stringify(s.cur)}`);
  }
  await context.close();
}
await browser.close();
