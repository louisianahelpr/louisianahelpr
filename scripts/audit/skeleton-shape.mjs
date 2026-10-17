/**
 * SKELETON VS LOADED PAGE: is the route placeholder the page's shape? (Q201)
 *
 * Owner, 2026-09-23: "most of the skeletons are not even the page shape". A
 * route skeleton is what App.tsx's routeEl() paints while the page's own lazy
 * chunk downloads. This module holds that chunk, measures the TITLE and the
 * FIRST BLOCK of the skeleton frame, releases the chunk, waits for the loaded
 * page, measures the same two boxes again and compares them. Within TOL_PX on
 * top/left (and width for the block), the skeleton is the page's shape.
 *
 * Found by what it IS, never by a list of files:
 *   - routes with a named skeleton come from src/App.tsx (routeSkeletonRoutes):
 *     every `<Route path=… routeEl(<…<Page />…>, <XSkeleton …/>)` whose fallback
 *     is a `skeletonOnDemand` component, with the page's chunk name read from
 *     its `lazyWithPreload(() => import("./pages/…/<Name>"))` (rolldown names a
 *     lazy chunk `<Name>-<hash>.js`);
 *   - the title is the loaded page's first visible <h1>; on the skeleton, the
 *     text with the same words, else its own <h1>, else its title bone (the
 *     topmost placeholder LINE 8-48px tall);
 *   - the first block is the topmost visible box (a placeholder, or an element
 *     with its own background, border or shadow) at least 40px tall and half
 *     the column wide, not the full-bleed page ground, and, when the loaded
 *     page has a visible title, below that frame's title and not holding it.
 *
 * Used by e2e/prod-audit/skeleton-shape.spec.ts (prod-audit leg 3), on this
 * commit's preview build against prod data.
 */

/** How far (px) a skeleton box may sit from the loaded box. Q201's own number. */
export const TOL_PX = 4;

/**
 * App.tsx -> [{ path, page, chunk, skeleton }] for every route whose Suspense
 * fallback is a named route skeleton. `stripped` is App.tsx with comment lines
 * dropped (scripts/perf/bootReach.mjs stripComments).
 */
export function routeSkeletonRoutes(stripped) {
  const skeletons = new Set([...stripped.matchAll(/const (\w+) = skeletonOnDemand\(/g)].map((m) => m[1]));
  const lazy = new Map(
    [...stripped.matchAll(/const (\w+) = lazyWithPreload\(\(\) => import\("([^"]+)"\)\)/g)].map((m) => [m[1], m[2].split("/").pop()]),
  );
  const out = [];
  for (const line of stripped.split("\n")) {
    const route = line.match(/<Route path="([^"]+)" element=\{/);
    if (!route) continue;
    const call = line.match(/routeEl\((.*),\s*<(\w+)[^<>]*\/>\)\}/);
    if (!call || !skeletons.has(call[2])) continue;
    const pages = [...call[1].matchAll(/<(\w+)[\s/>]/g)].map((m) => m[1]).filter((n) => lazy.has(n));
    if (pages.length !== 1) throw new Error(`${route[1]}: expected one lazy page inside routeEl(), found ${pages.join(", ") || "none"}`);
    out.push({ path: route[1], page: pages[0], chunk: lazy.get(pages[0]), skeleton: call[2] });
  }
  return out;
}

/** A request URL is this page's own lazy chunk (`/assets/<chunk>-<hash>.js`). */
export function chunkPattern(chunk) {
  return new RegExp(`/assets/${chunk}-[A-Za-z0-9_-]{6,}\\.js(\\?.*)?$`);
}

/**
 * In the page: the title and first-block boxes of whatever is on screen now.
 * Plain function (no closures) so page.evaluate can ship it.
 */
export const FRAME_BOXES = (placeholderSel) => {
  const vw = innerWidth;
  const root = document.getElementById("root");
  // App chrome is not the page: the dock, the desktop rail, toasts, dialogs.
  // Found by role and by being a small FIXED layer, never by a component
  // list. (A page's own <aside>, like Gift Card's "What is this?" card, is
  // content: it is not excluded.)
  const CHROME = 'nav, footer, [role="navigation"], [role="dialog"], [data-sonner-toaster]';
  const visible = (el) => {
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) <= 0.01) return false;
      // Small fixed layers (the dock, the + button, a toast) are chrome; the
      // screen-high one is AppShell's own frame (`fixed inset-0`), the page.
      if (cs.position === "fixed" && a.getBoundingClientRect().height < innerHeight * 0.6) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight * 1.5;
  };
  const box = (el, kind) => {
    const r = el.getBoundingClientRect();
    return {
      kind,
      x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
    };
  };
  if (!root) return { title: null, block: null };
  const all = [...root.querySelectorAll("*")].filter((el) => !el.closest(CHROME) && visible(el));
  const isPh = (el) => el.matches(placeholderSel);
  let titleEl = all.find((el) => el.tagName === "H1") || null;
  let titleKind = titleEl ? "h1" : null;
  if (!titleEl) {
    // A bone standing in for the title is a LINE: wider than twice its height
    // (a 44px avatar or 16px icon bone is not a title).
    const bones = all.filter((el) => {
      const r = el.getBoundingClientRect();
      return isPh(el) && r.height >= 8 && r.height <= 48 && r.width >= 2 * r.height && !el.querySelector(placeholderSel);
    });
    bones.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    titleEl = bones[0] || null;
    titleKind = titleEl ? "bone" : null;
  }
  // The skeleton may draw the title's real WORDS without an <h1> (the Activity
  // header card does): its text lines, so compareFrames can find the loaded
  // title's text among them.
  const texts = [];
  for (const el of all) {
    if (texts.length >= 20) break;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").replace(/\s+/g, " ").trim();
    if (own.length >= 2 && !el.closest(".sr-only")) texts.push(box(el, "text"));
  }
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const surface = (el) => {
    if (isPh(el)) return true;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const alpha = bg.startsWith("rgba") ? Number(bg.split(",")[3]) : bg === "transparent" ? 0 : 1;
    if (alpha > 0.05 && bg !== bodyBg) return true;
    if (cs.boxShadow && cs.boxShadow !== "none") return true;
    const sides = ["Top", "Right", "Bottom", "Left"].filter((s) => parseFloat(cs[`border${s}Width`]) >= 1);
    return sides.length === 4;
  };
  // Every candidate block, NOT cut by this frame's title: which title the
  // cut uses is only known in compareFrames (the skeleton may draw the
  // title's words where its topmost bone is not the title, and a loaded page
  // whose <h1> is visually hidden has no title at all to cut below).
  const blocks = all.filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.height < 40 || r.width < Math.min(vw, 720) * 0.5 || r.width >= vw - 8) return false;
    return surface(el);
  });
  blocks.sort((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    if (Math.abs(ra.top - rb.top) > 1) return ra.top - rb.top;
    return rb.width * rb.height - ra.width * ra.height;
  });
  return {
    texts,
    title: titleEl ? box(titleEl, titleKind) : null,
    blocks: blocks.slice(0, 12).map((el) => box(el, isPh(el) ? "placeholder" : "surface")),
  };
};

/** a's rect holds b's (both {x,y,w,h}). */
const holds = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;

/**
 * A frame's first block: its topmost candidate that sits below `title` and
 * neither holds it nor is held by it (the header card around the title is
 * not the page's first block). With no title, the topmost candidate.
 * `frame.blocks` is FRAME_BOXES' list; a single `frame.block` is accepted.
 */
export function firstBlock(frame, title) {
  const cands = frame.blocks ?? (frame.block ? [frame.block] : []);
  if (!title) return cands[0] ?? null;
  return cands.find((c) => c.y >= title.y + title.h - 2 && !holds(c, title) && !holds(title, c)) ?? null;
}

/**
 * Compare the two frames. Returns the list of mismatches (empty = the
 * skeleton is the page's shape): a missing box on either side, or a title
 * whose top/left, or a block whose top/left/width, is more than `tol` px off.
 *
 * The title is the LOADED page's: when it has one, the skeleton's title is
 * the skeleton text with the same words (else its own h1 or title bone) and
 * each frame's block is cut below its own title. When the loaded page has
 * no visible title (an sr-only <h1>), neither frame is cut, so a skeleton
 * bone that merely looks like a title cannot hide the skeleton's first block.
 */
export function compareFrames(skel, loaded, tol = TOL_PX) {
  const out = [];
  const near = (a, b) => Math.abs(a - b) <= tol;
  let skelTitle = null;
  if (loaded.title) {
    const sameWords = skel.title?.kind === "h1" ? null : (skel.texts ?? []).find((t) => t.text === loaded.title.text);
    skelTitle = sameWords ?? skel.title ?? null;
    if (!skelTitle) out.push("title: skeleton has none");
    else {
      if (!near(skelTitle.y, loaded.title.y)) out.push(`title y ${skelTitle.y}->${loaded.title.y}`);
      if (!near(skelTitle.x, loaded.title.x)) out.push(`title x ${skelTitle.x}->${loaded.title.x}`);
    }
  }
  const lb = firstBlock(loaded, loaded.title);
  const sb = firstBlock(skel, skelTitle);
  if (!lb) out.push("block: loaded page has none");
  else if (!sb) out.push("block: skeleton has none");
  else {
    if (!near(sb.y, lb.y)) out.push(`block y ${sb.y}->${lb.y}`);
    if (!near(sb.x, lb.x)) out.push(`block x ${sb.x}->${lb.x}`);
    if (!near(sb.w, lb.w)) out.push(`block w ${sb.w}->${lb.w}`);
  }
  return out;
}

/**
 * In the page: a loading placeholder is still on screen in the PAGE. Chrome
 * is skipped exactly as FRAME_BOXES skips it: MobileNav's pulsing ring (an
 * `animate-pulse` inside the dock, on every signed-in screen) kept every
 * signed-in URL "loading" until the 15 s cap (measured 2026-10-17: /home,
 * /profile and its tabs all ran the full 15 s).
 */
const anyPlaceholderOnScreen = (sel) =>
  [...document.querySelectorAll(sel)].some((e) => {
    if (e.closest('nav, footer, [role="navigation"], [role="dialog"], [data-sonner-toaster]')) return false;
    for (let a = e; a && a.nodeType === 1; a = a.parentElement) {
      if (getComputedStyle(a).position === "fixed" && a.getBoundingClientRect().height < innerHeight * 0.6) return false;
    }
    const b = e.getBoundingClientRect();
    return b.width > 8 && b.height > 8 && getComputedStyle(e).visibility !== "hidden";
  });

/**
 * One route: hold its page chunk, measure the skeleton frame, release, wait
 * for the loaded page (no placeholder and nothing changing for `quietMs`, at
 * most `maxMs`), measure again, compare. The hold is a CONTEXT route, so it
 * is in place before the first request.
 * Returns { held, skel, loaded, diff, landedOn, skelPng, loadedPng } or { held, error }.
 *
 * `held` counts the held requests for the chunk. 0 means the chunk name
 * matched nothing this build fetched, so the "skeleton frame" would be the
 * page itself: that is returned as an error, never as a pass.
 */
export async function measureSkeletonShape(ctx, page, fullUrl, chunk, placeholderSel, { quietMs = 1500, maxMs = 15000, shots = false } = {}) {
  const res = { held: 0 };
  let release = () => {};
  const released = new Promise((r) => { release = r; });
  const re = chunkPattern(chunk);
  const hold = async (route) => {
    res.held++;
    await released;
    await route.continue().catch(() => { /* the context closed first; nothing to deliver */ });
  };
  await ctx.route(re, hold);
  try {
    const tGo = Date.now();
    await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: maxMs });
    const t0 = Date.now();
    res.ms = { goto: t0 - tGo };
    while (!res.held && Date.now() - t0 < 10_000) await page.waitForTimeout(100);
    if (!res.held) return { ...res, error: `the ${chunk} chunk was never requested (pattern ${re})` };
    let last = "";
    let stable = Date.now();
    while (Date.now() - stable < 700 && Date.now() - t0 < 12_000) {
      await page.waitForTimeout(100);
      const sig = JSON.stringify(await page.evaluate(FRAME_BOXES, placeholderSel));
      if (sig !== last) { last = sig; stable = Date.now(); }
    }
    res.skel = JSON.parse(last);
    res.ms.skel = Date.now() - t0;
    if (shots) res.skelPng = await page.screenshot();
    release();
    const t1 = Date.now();
    let quiet = Date.now();
    last = "";
    let boxes = null;
    while (Date.now() - t1 < maxMs) {
      await page.waitForTimeout(150);
      const ph = await page.evaluate(anyPlaceholderOnScreen, placeholderSel);
      boxes = await page.evaluate(FRAME_BOXES, placeholderSel);
      const sig = JSON.stringify(boxes);
      if (sig !== last || ph) { last = sig; quiet = Date.now(); }
      else if (Date.now() - quiet >= quietMs) break;
    }
    res.loaded = boxes;
    res.ms.loaded = Date.now() - t1;
    const u = new URL(page.url());
    res.landedOn = u.pathname + u.search;
    if (shots) res.loadedPng = await page.screenshot();
    res.diff = compareFrames(res.skel, res.loaded);
  } catch (e) {
    res.error = String(e).slice(0, 200);
  } finally {
    release();
    await ctx.unroute(re, hold).catch(() => { /* the context is already closed */ });
  }
  return res;
}
