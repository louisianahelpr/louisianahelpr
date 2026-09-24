/**
 * MEASURE EVERY LOADING STATE — jump (size) and shape, on the real backend.
 *
 * Owner, 2026-09-19: "you also need to check loading states thoroughly bc a lot
 * of them jump and are not consistent with their info."
 *
 * Two defects, measured separately:
 *
 *   JUMP   the placeholder is a different SIZE from the content that replaces
 *          it. Measured two ways that must agree: (a) the delta in px between
 *          the swapping region's box while loading and the same region's box
 *          once loaded, and (b) cumulative layout shift accumulated across the
 *          transition itself (a PerformanceObserver installed before the app
 *          boots, zeroed at the moment the placeholder is first seen).
 *
 *   SHAPE   the placeholder is a different SHAPE from that content. Measured
 *          as a structural descriptor of the same region in both frames —
 *          child count, avatar/media count, control count, text-leaf count,
 *          row count — plus a screenshot of BOTH frames for a human to look
 *          at. The measurement says the number; the screenshot says what is
 *          wrong. Neither substitutes for the other.
 *
 * NO MOCK MODE (owner, said twice). Every response is a real prod response
 * from the shared test accounts; the only intervention is a DELAY, so the
 * loading frame exists long enough to be captured. Delaying a real response is
 * not mocking it — the bytes that arrive are the bytes prod sent.
 *
 * Placeholders are found by what they ARE, never by a list of files:
 *   - `<Skeleton>`      → its class carries `animate-[shimmer_2s_infinite]`
 *   - hand-rolled bones → `animate-pulse`
 *   - spinners          → `animate-spin`
 *   - declared ones     → data-testid / class containing "skeleton"
 * so a placeholder nobody told this script about is still measured.
 *
 *   BASE=http://127.0.0.1:4173 node scripts/audit/measure-loading-states.mjs
 *   ROUTES=/home,/profile?tab=earnings   … narrow
 *   PERSONAS=customer                          … narrow
 *   DATA_DELAY=3000 CHUNK_DELAY=900            … tune the capture window
 *   OUT=docs/audit/loading-states                … where the JSON + PNGs land
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveRouteSet } from "./press-every-control.mjs";
import { mintAccounts, prodSelect } from "./pressProdSafety.mjs";
import { RequestMeter } from "../../e2e/requestMeter.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");

const BASE = process.env.BASE ?? "http://127.0.0.1:4173";
const OUT = resolve(REPO, process.env.OUT ?? "docs/audit/loading-states");
const DATA_DELAY = Number(process.env.DATA_DELAY ?? 1200);
const CHUNK_DELAY = Number(process.env.CHUNK_DELAY ?? 400);
const VIEWPORT = { width: 375, height: 812 };

/** Every placeholder, by what it is. */
export const PLACEHOLDER_SEL = [
  '[class*="shimmer"]',
  '[class*="animate-pulse"]',
  '[class*="animate-spin"]',
  '[class*="skeleton" i]',
  '[data-testid*="skeleton" i]',
  '[data-testid*="fallback" i]',
].join(",");

// ---------------------------------------------------------------------------
// In-page probes
// ---------------------------------------------------------------------------

/**
 * Installed before the app boots. Records every layout shift with a timestamp
 * so the run can attribute shift to the placeholder→content transition rather
 * than to the whole page load.
 */
const CLS_INIT = () => {
  window.__lsShifts = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) {
          window.__lsShifts.push({ t: e.startTime, v: e.value });
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch { /* layout-shift unsupported: the run reports cls:null, never a fake 0 */ }
};

/**
 * ONE probe, used for BOTH frames.
 *
 * It used to be two near-identical functions (PROBE and REMEASURE) because
 * `page.evaluate` serialises a function, not a closure — and the descriptor
 * inside them had already drifted apart by one field. That is precisely the
 * defect this whole run is about: a second hand-written copy of a shape beside
 * the first one drifts the moment anyone touches either. So there is one
 * function, and it takes `path` — absent, it FINDS the region the placeholders
 * occupy; present, it re-measures that same region after the content lands.
 */
const MEASURE = ([sel, probes]) => {
  const TRANSIENT = /skeleton|fallback|loading|placeholder|spinner|pulse|shimmer/i;

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.01;
  };

  /**
   * A path that still resolves AFTER the placeholder is gone. Anchoring on the
   * nearest data-testid put `/home` on `dashboard-route-skeleton`, which
   * exists only while loading: every re-measure found nothing and the delta
   * came back `undefined`. A measurement that cannot fail is not a
   * measurement, so a transient NAME is never an anchor.
   */
  const cssPath = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && parts.length < 16) {
      let seg = cur.tagName.toLowerCase();
      const tid = cur.getAttribute && cur.getAttribute("data-testid");
      if (tid && !TRANSIENT.test(tid)) { parts.unshift(`${seg}[data-testid="${CSS.escape(tid)}"]`); break; }
      if (cur.id && !TRANSIENT.test(cur.id)) { parts.unshift(`${seg}#${CSS.escape(cur.id)}`); break; }
      const parent = cur.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      }
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  };

  /** Structural fingerprint of a subtree — what SHAPE is here. */
  const describe = (root) => {
    if (!root) return null;
    const all = [...root.querySelectorAll("*")].filter(visible);
    const r = root.getBoundingClientRect();
    // Rows are the region's OWN children — the boxes that swap — found by
    // descending only through sole-child wrappers. Picking instead the densest
    // same-height group ANYWHERE in the subtree (the first version) latched
    // onto a different sub-container in each frame: `/home` reported
    // rowH 104→44 by comparing four feed bones against two chips inside a
    // card. Comparing a box to a different box is not a delta.
    let list = root;
    while (list && [...list.children].filter(visible).length === 1) {
      list = [...list.children].filter(visible)[0];
    }
    const kids = list ? [...list.children].filter(visible) : [];
    const hs = kids.map((k) => Math.round(k.getBoundingClientRect().height)).sort((a, b) => a - b);
    const rows = kids.length;
    const rowH = hs.length ? hs[Math.floor(hs.length / 2)] : null;
    return {
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      scrollH: root.scrollHeight,
      elements: all.length,
      textLeaves: all.filter((e) => e.children.length === 0 && (e.textContent ?? "").trim().length > 0).length,
      media: all.filter((e) =>
        e.tagName === "IMG" ||
        /avatar/i.test(String(e.className?.baseVal ?? e.className ?? "")) ||
        (/rounded-full/.test(String(e.className)) && e.getBoundingClientRect().width >= 28)).length,
      controls: all.filter((e) => e.tagName === "BUTTON" || e.tagName === "A" || e.getAttribute("role") === "button").length,
      rows,
      rowH,
      placeholders: all.filter((e) => e.matches(sel)).length,
      text: (root.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
    };
  };

  /**
   * Everything that exists in BOTH frames, by a path that does not change.
   *
   * CLS cannot see this defect. `layout-shift` reports elements that MOVE
   * between frames; a skeleton→content swap UNMOUNTS the bones and MOUNTS new
   * nodes, so the browser sees nothing move and reports ~0 on a surface that
   * visibly lurches. These landmarks are the honest instrument: the y of
   * everything that survives the swap, taken again afterwards. The largest
   * displacement is how far the page moved under the reader.
   */
  const landmarks = () => {
    const out = {};
    for (const el of document.querySelectorAll('[data-testid], nav, main, header, footer, h1, h2, [role="navigation"]')) {
      if (!visible(el)) continue;
      const tid = el.getAttribute("data-testid");
      if (tid && TRANSIENT.test(tid)) continue;
      const key = tid ? `testid:${tid}` : cssPath(el);
      if (!key || out[key]) continue;
      const rr = el.getBoundingClientRect();
      out[key] = { y: +rr.y.toFixed(1), h: +rr.height.toFixed(1) };
    }
    return out;
  };

  /**
   * The row a placeholder stands in for: climb from the bone to the widest
   * ancestor that is still narrower than its container — the CARD, not the
   * bar inside it and not the list around it.
   */
  const rowOf = (el, maxW) => {
    let cur = el;
    while (cur.parentElement && cur.parentElement !== document.body) {
      const pw = cur.parentElement.getBoundingClientRect().width;
      if (pw > maxW * 1.02) break;
      cur = cur.parentElement;
    }
    return cur;
  };

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };

  const nodes = [...document.querySelectorAll(sel)].filter(visible);
  const base = {
    found: nodes.length,
    docH: document.documentElement.scrollHeight,
    landmarks: landmarks(),
    shifts: window.__lsShifts ? window.__lsShifts.slice() : null,
  };

  /**
   * Re-measure pass, anchored on SCREEN POSITION rather than a DOM path.
   *
   * A structural path (`div > div:nth-of-type(2) > div`) does not survive the
   * swap: React replaces the skeleton subtree with a differently-shaped one and
   * the path then resolves to some unrelated element. `/home` reported
   * Δh = -726px that way — a 800px scaffold measured against a 74px strip it
   * had never stood in for. Comparing a box to a different box is not a delta.
   *
   * The same point on screen IS the same place to the reader, so each probe
   * carries the centre of the bone it measured and asks what occupies that
   * point now, then climbs to the row that owns it.
   */
  if (probes) {
    return {
      ...base,
      clusters: probes.map((pr) => {
        const el = document.elementFromPoint(pr.px, pr.py);
        if (!el) return { found: false, note: "nothing at the probe point once loaded" };
        const row = rowOf(el, pr.containerW);
        const container = row.parentElement ?? row;
        const kids = [...container.children].filter(visible);
        const hs = kids.map((k) => Math.round(k.getBoundingClientRect().height)).sort((a, b) => a - b);
        return {
          found: true,
          rowRect: rectOf(row),
          containerRect: rectOf(container),
          rows: kids.length,
          rowH: hs.length ? hs[Math.floor(hs.length / 2)] : null,
          ...describe(container),
        };
      }),
    };
  }

  if (!nodes.length) return base;

  // ---- cluster ------------------------------------------------------------
  // One surface usually holds SEVERAL independent placeholders: on /home
  // the title bar's three button bones and the feed's four card bones. Taking
  // their lowest common ancestor treats those as one region, which is how an
  // earlier version came to measure the title card against the feed panel.
  // They are separate groups to the eye, so they are separate measurements
  // here: placeholders are grouped by vertical proximity, and each group gets
  // its own row, container, box and row count.
  const CLUSTER_GAP = 40;
  const boxes = nodes
    .map((n) => ({ n, r: n.getBoundingClientRect() }))
    .sort((a, b) => a.r.top - b.r.top);
  const groups = [];
  for (const b of boxes) {
    const g = groups[groups.length - 1];
    if (g && b.r.top - g.bottom <= CLUSTER_GAP) {
      g.items.push(b.n);
      g.bottom = Math.max(g.bottom, b.r.bottom);
    } else {
      groups.push({ items: [b.n], top: b.r.top, bottom: b.r.bottom });
    }
  }

  const clusters = groups.map((g) => {
    // The widest bone in the group fixes the scale the row is measured against.
    const widest = g.items.reduce((m, n) =>
      n.getBoundingClientRect().width > m.getBoundingClientRect().width ? n : m, g.items[0]);
    const containerW = (widest.parentElement ?? document.body).getBoundingClientRect().width;
    const row = rowOf(widest, containerW);
    const container = row.parentElement ?? row;
    const kids = [...container.children].filter(visible);
    const hs = kids.map((k) => Math.round(k.getBoundingClientRect().height)).sort((a, b) => a - b);
    const rr = row.getBoundingClientRect();
    return {
      path: cssPath(container),
      placeholderCount: g.items.length,
      probe: {
        px: +(rr.left + rr.width / 2).toFixed(1),
        py: +(rr.top + Math.min(rr.height / 2, 20)).toFixed(1),
        containerW: +containerW.toFixed(1),
      },
      rowRect: rectOf(row),
      containerRect: rectOf(container),
      rows: kids.length,
      rowH: hs.length ? hs[Math.floor(hs.length / 2)] : null,
      ...describe(container),
    };
  });

  return { ...base, clusters };
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const DATA_RX = /\/(rest|rpc|functions|auth)\/v1\//;
const CHUNK_RX = /\/assets\/.*\.(js|css)(\?|$)/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measureOne(context, { url, persona }) {
  const page = await context.newPage();
  const result = { url, persona, base: BASE };
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });

  // In-flight REAL data requests. The "loaded" frame is only loaded once prod
  // has answered; waiting on the placeholder count alone captured /home
  // while its four feed bones were still up and called them the loaded state,
  // which would have scored a jumping surface as clean.
  let inflight = 0;
  let lastSettled = Date.now();
  page.on("request", (r) => { if (DATA_RX.test(r.url())) { inflight++; } });
  const done = (r) => { if (DATA_RX.test(r.url())) { inflight = Math.max(0, inflight - 1); lastSettled = Date.now(); } };
  page.on("requestfinished", done);
  page.on("requestfailed", done);

  // Delay REAL responses so the loading frame is capturable. Nothing is
  // fabricated: the handler awaits and then continues the request untouched.
  await page.route("**/*", async (route) => {
    const u = route.request().url();
    if (DATA_RX.test(u)) await sleep(DATA_DELAY);
    else if (CHUNK_RX.test(u)) await sleep(CHUNK_DELAY);
    await route.continue().catch(() => {});
  });

  const slug = `${persona}${url.replace(/[^\w]+/g, "_")}`.slice(0, 90);
  try {
    await page.goto(BASE + url, { waitUntil: "commit", timeout: 60_000 });

    // --- loading frame ---------------------------------------------------
    let loading = null;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const p = await page.evaluate(MEASURE, [PLACEHOLDER_SEL, null]).catch(() => null);
      if (p && p.found > 0) {
        // let the placeholder settle one frame before measuring it
        await page.waitForTimeout(180);
        loading = await page.evaluate(MEASURE, [PLACEHOLDER_SEL, null]).catch(() => null);
        if (loading && loading.found > 0) break;
      }
      await page.waitForTimeout(90);
    }

    if (!loading || !loading.found) {
      result.status = "no-placeholder";
      result.note = "no loading placeholder rendered within 25s at this delay";
      await page.close();
      return result;
    }

    mkdirSync(OUT, { recursive: true });
    const loadingPng = resolve(OUT, `${slug}.loading.png`);
    await page.screenshot({ path: loadingPng, fullPage: false });
    result.loadingPng = loadingPng;
    result.loading = loading;
    result.shiftsAtLoading = (loading.shifts ?? []).reduce((a, s) => a + s.v, 0);

    // --- wait for content ------------------------------------------------
    // The content has landed when prod has ANSWERED (no data request in flight
    // for a beat) and the placeholder count has then stopped changing. Either
    // signal alone is wrong: network-idle alone fires before React paints, and
    // placeholder-count alone froze /home mid-load with its four feed
    // bones still up and scored that as the loaded frame. A decorative
    // `animate-pulse` (a live dot, a nav badge) never disappears, so the count
    // is allowed to settle above zero — what persists is REPORTED, not ignored.
    const gone = Date.now() + 25_000;
    let remaining = [];
    let stableFor = 0;
    let last = -1;
    while (Date.now() < gone) {
      const quiet = inflight === 0 && Date.now() - lastSettled > 1200;
      remaining = await page.evaluate((s) =>
        [...document.querySelectorAll(s)]
          .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; })
          .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)}`),
      PLACEHOLDER_SEL).catch(() => []);
      if (quiet && remaining.length === 0) break;
      stableFor = quiet && remaining.length === last ? stableFor + 200 : 0;
      last = remaining.length;
      if (stableFor >= 1600) break;
      await page.waitForTimeout(200);
    }
    result.placeholdersLeft = remaining.slice(0, 4);
    result.placeholdersLeftCount = remaining.length;
    await page.waitForTimeout(600); // settle

    const loaded = await page.evaluate(MEASURE, [PLACEHOLDER_SEL, (loading.clusters ?? []).map((c) => c.probe)]).catch(() => null);
    const loadedPng = resolve(OUT, `${slug}.loaded.png`);
    await page.screenshot({ path: loadedPng, fullPage: false });
    result.loadedPng = loadedPng;
    result.loaded = loaded;

    const totalShift = (loaded?.shifts ?? []).reduce((a, s) => a + s.v, 0);
    result.clsTotal = +totalShift.toFixed(4);
    result.clsDuringSwap = +(totalShift - result.shiftsAtLoading).toFixed(4);

    // Per cluster: the placeholder's box, the box of whatever landed in the
    // same container, and the delta. `rowH` is the per-card number — a bone
    // 18px taller than the card it stands in for disappears inside a region
    // total and is the whole defect at row level.
    result.clusters = (loading.clusters ?? []).map((a, i) => {
      const b = loaded?.clusters?.[i];
      if (!b || !b.found) {
        return { path: a.path, skeletonBox: a.rowRect, realBox: null, note: "nothing at the probe point once loaded" };
      }
      // SHAPE: the placeholder is honest only if the same number of rows
      // arrives, at the same row height, carrying the same avatar/media count.
      const shapeMatch =
        a.rows === b.rows &&
        a.rowH != null && b.rowH != null && Math.abs(a.rowH - b.rowH) <= 4 &&
        Math.abs((a.media ?? 0) - (b.media ?? 0)) <= 1;
      return {
        path: a.path,
        skeletonBox: a.rowRect,
        realBox: b.rowRect,
        skeletonContainer: a.containerRect,
        realContainer: b.containerRect,
        deltaRowPx: +(b.rowRect.h - a.rowRect.h).toFixed(1),
        deltaContainerPx: +(b.containerRect.h - a.containerRect.h).toFixed(1),
        rows: [a.rows, b.rows],
        rowH: [a.rowH, b.rowH],
        deltaRowH: a.rowH != null && b.rowH != null ? b.rowH - a.rowH : null,
        media: [a.media, b.media],
        controls: [a.controls, b.controls],
        textLeaves: [a.textLeaves, b.textLeaves],
        placeholderCount: a.placeholderCount,
        shapeMatch,
      };
    });
    const withBox = result.clusters.filter((c) => c.realBox);
    result.worstDeltaRowPx = withBox.reduce((m, c) => (Math.abs(c.deltaRowPx) > Math.abs(m) ? c.deltaRowPx : m), 0);
    result.worstDeltaRowH = withBox.reduce((m, c) => (c.deltaRowH != null && Math.abs(c.deltaRowH) > Math.abs(m ?? 0) ? c.deltaRowH : m), null);
    result.worstDeltaRows = withBox.reduce((m, c) => (Math.abs(c.rows[1] - c.rows[0]) > Math.abs(m) ? c.rows[1] - c.rows[0] : m), 0);
    result.shapeMismatches = withBox.filter((c) => !c.shapeMatch).length;
    result.clustersMeasured = withBox.length;

    // How far the page actually moved under the reader — the number CLS
    // cannot produce for a node-replacement swap. Only landmarks present in
    // BOTH frames are compared; one that appears or disappears is not a shift,
    // it is a different page, and is counted separately.
    const before = loading.landmarks ?? {};
    const after = loaded?.landmarks ?? {};
    const moves = [];
    for (const [k, v] of Object.entries(before)) {
      if (!after[k]) continue;
      const dy = +(after[k].y - v.y).toFixed(1);
      if (Math.abs(dy) >= 1) moves.push({ el: k, dy });
    }
    moves.sort((a, b) => Math.abs(b.dy) - Math.abs(a.dy));
    result.maxLandmarkShiftPx = moves.length ? Math.abs(moves[0].dy) : 0;
    result.landmarkMoves = moves.slice(0, 6);
    result.landmarksCompared = Object.keys(before).filter((k) => after[k]).length;
    result.docHDelta = (loaded?.docH ?? 0) - loading.docH;
    result.status = "measured";
    result.consoleErrors = consoleErrors.slice(0, 3);
  } catch (e) {
    result.status = "error";
    result.error = String(e).slice(0, 300);
  }
  await page.close().catch(() => {});
  return result;
}

async function main() {
  const personas = (process.env.PERSONAS ?? "customer,helper,anon").split(",").map((s) => s.trim());
  const { sessions, unavailable } = await mintAccounts(personas.filter((p) => p !== "anon"));
  for (const [p, why] of Object.entries(unavailable)) console.warn(`persona ${p} unavailable: ${why}`);

  // Real ids, resolved from prod — never faked.
  const poster = sessions.customer;
  const helper = sessions.helper;
  let seedJobId = "test";
  if (poster) {
    const rows = await prodSelect(poster, "jobs?select=id&order=created_at.desc&limit=1").catch(() => []);
    if (rows?.[0]?.id) seedJobId = rows[0].id;
  }
  const routeSet = deriveRouteSet({
    seedJobId,
    helperId: helper?.userId ?? "test",
    customerId: poster?.userId ?? "test",
    adminViews: [],
  }).filter((r) => !r.redirect);

  const only = process.env.ROUTES ? process.env.ROUTES.split(",").map((s) => s.trim()) : null;
  const targets = [];
  for (const r of routeSet) {
    if (only && !only.includes(r.url)) continue;
    for (const p of personas) {
      if (!r.personas.includes(p)) continue;
      if (p !== "anon" && !sessions[p]) continue;
      targets.push({ url: r.url, persona: p });
    }
  }

  const browser = await chromium.launch();
  // Q104: count this run's backend requests; scripts/e2e/request-budget.mjs
  // checks them against e2e/request-budgets.json. Flushed on exit too, so a
  // run that dies midway still leaves its load on the record.
  const requestMeter = new RequestMeter("loading-states");
  requestMeter.attachBrowser(browser);
  process.on("exit", () => requestMeter.flush());
  const results = [];
  const byPersona = new Map();
  const contextFor = async (persona) => {
    if (byPersona.has(persona)) return byPersona.get(persona);
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    await ctx.addInitScript(CLS_INIT);
    const s = sessions[persona];
    if (s) {
      await ctx.addInitScript(([k, v]) => {
        try {
          localStorage.setItem(k, v);
          localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
        } catch { /* storage blocked — the run reports signed-out, never a fake pass */ }
      }, [s.key, s.value]);
    }
    byPersona.set(persona, ctx);
    return ctx;
  };

  // Two tabs at a time. One was ~70s per surface and 2.5h for the catalog,
  // which is long enough that nobody reruns it — and a measurement nobody
  // reruns stops being a measurement. Two is the ceiling: each tab holds the
  // delayed responses of the other's route open, and more than two made the
  // delays overlap enough to distort the very timings being measured.
  const CONCURRENCY = Number(process.env.CONCURRENCY ?? 2);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= targets.length) return;
      const t = targets[i];
      const ctx = await contextFor(t.persona);
      const r = await measureOne(ctx, t);
      results.push(r);
      const tag = r.status === "measured"
        ? `cl=${String(r.clustersMeasured ?? 0)}/${String(r.clusters?.length ?? 0)}  worstΔrow=${String(r.worstDeltaRowPx ?? "?").padStart(7)}px  ` +
          `ΔrowH=${String(r.worstDeltaRowH ?? "-").padStart(5)}  Δrows=${String(r.worstDeltaRows ?? "-").padStart(4)}  shapeBad=${r.shapeMismatches}  ` +
          `shift=${String(r.maxLandmarkShiftPx ?? "?").padStart(6)}px`
        : r.status;
      console.log(`${t.persona.padEnd(9)} ${t.url.padEnd(44)} ${tag}`);
    }
  };
  // Contexts are created lazily inside the workers, so seed them serially
  // first: two workers racing to create the same persona context made two.
  for (const p of new Set(targets.map((t) => t.persona))) await contextFor(p);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  for (const ctx of byPersona.values()) await ctx.close();
  requestMeter.flush();
  await browser.close();

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, "measurements.json"), JSON.stringify({ base: BASE, viewport: VIEWPORT, dataDelay: DATA_DELAY, chunkDelay: CHUNK_DELAY, at: new Date().toISOString(), results }, null, 2));
  console.log(`\n${results.length} surfaces · ${results.filter((r) => r.status === "measured").length} measured · ${OUT}/measurements.json`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
