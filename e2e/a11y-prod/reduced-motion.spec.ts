// THE REDUCED-MOTION PASS (docs/OPEN.md Q254).
//
// Until this file no test in the repo had ever loaded a screen with the OS
// "Reduce Motion" preference on. The app's answer to that preference is ONE
// shared rule, src/index.css "GLOBAL REDUCE-MOTION CATCH-ALL" (every element
// and pseudo-element: animation/transition duration 0.01ms, one iteration,
// instant scroll), on top of per-component `motion-safe:` classes and a few
// hand-written @media blocks. 94 `animate-spin` / `animate-pulse` sites in 60
// files carry no `motion-safe:` prefix (counted 2026-09-25) and rely on that
// catch-all alone — and nothing pinned it. This pass proves it holds on every
// route, on the real backend, in Chromium AND WebKit (it lives in
// e2e/a11y-prod/, so both of that directory's projects collect it and
// .github/workflows/a11y-webkit-prod.yml runs it).
//
// WHAT EACH SCREEN MUST SHOW, with `reducedMotion: "reduce"` emulated:
//   1. no running CSS animation or transition that loops forever or lasts
//      longer than MAX_MS (spinner, pulse, shimmer, bounce, fade);
//   2. no element whose computed transform/opacity keeps changing across
//      three samples 300ms apart — the Web Animations API / requestAnimationFrame
//      motion (framer-motion) that document.getAnimations() cannot fully see;
//   3. a CANARY — elements carrying `animate-spin`, `animate-pulse`, an
//      infinite ::after loop and an inline infinite animation + transition, injected
//      into the page — computes to ~0 duration and one iteration. This is what
//      makes the pass able to fail on a route that happens not to be showing a
//      spinner at the instant it is measured: it tests the RULE, on every
//      route's real stylesheet, not just whatever the screen rendered.
//
// SHOWN ABLE TO FAIL, every run: the control test below loads the landing page
// WITHOUT the preference and requires the same probe to see the hero chevron's
// infinite bounce (as an animation AND as a mover) and every canary looping. A
// probe that has gone blind reds there. Proven red by hand on 2026-09-25 by
// deleting the catch-all and rebuilding (the canary reds on every route) — see
// the Q254 line in docs/OPEN.md. The rule itself is also pinned in source by
// src/test/reducedMotionCatchAll.test.ts, whose @mutate is registered.
// @mutate src/index.css |     animation-duration: 0.01ms !important;\n    animation-iteration-count: 1 !important;\n    transition-duration: 0.01ms !important;\n    scroll-behavior: auto !important; |     animation-duration: 2s !important;\n    animation-iteration-count: 1 !important;\n    transition-duration: 0.01ms !important;\n    scroll-behavior: auto !important;
//
// Read-only against prod: the poster account is signed in and looked at.
// Motion is not role-dependent (every account sees every feature — CLAUDE.md
// "Never role-based"), so one account covers the signed-in catalog.

import { test, expect, type Browser, type BrowserContext, type Page } from "../prodTest";
import { ANON_SCREENS, AUTHED_SCREENS, type ScreenSpec } from "../happy-path/auditRoutes";
import { inScope } from "../happy-path/sweepCore";
import { ANON, AUTH_STORAGE_KEY, SUPABASE_URL, getSession, sessionAvailable, type Session } from "../journeys/fixtures";

/** A finite animation shorter than this is "~0" (the catch-all sets 0.01ms). */
const MAX_MS = 20;

const VIEWPORTS = [
  { tag: "375", width: 375, height: 812 },
  { tag: "1440", width: 1440, height: 900 },
] as const;

const FIXTURE_ID = /10000000-0000-4000-8000-/;

type MotionReport = {
  animations: string[];
  movers: string[];
  canary: string[];
};

async function motionContext(
  browser: Browser,
  session: Session | null,
  viewport: { width: number; height: number },
  reducedMotion: "reduce" | "no-preference",
): Promise<BrowserContext> {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport, reducedMotion });
  await ctx.addInitScript(
    ({ key, val }) => {
      try {
        if (val && !window.sessionStorage.getItem("__rm_seeded")) {
          window.localStorage.setItem(key, val);
          window.sessionStorage.setItem("__rm_seeded", "1");
        }
      } catch {
        /* storage blocked: the screen renders signed out; the landing URL in the report says so */
      }
    },
    { key: AUTH_STORAGE_KEY, val: session ? JSON.stringify(session) : "" },
  );
  return ctx;
}

/** Load, let the screen settle, then measure motion. */
async function measureMotion(page: Page, url: string, extraSetup?: (page: Page) => Promise<void>): Promise<MotionReport> {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  if (extraSetup) await extraSetup(page);
  // Entrance animations are the thing being judged, so there is no "wait for
  // animations to finish" here: under Reduce Motion there should be none to
  // wait for. 2.5s from navigation start covers the lazy route chunk and the
  // first data fetch.
  await page.waitForFunction(() => performance.now() > 2500, undefined, { timeout: 10_000 }).catch(() => undefined);

  return page.evaluate(async (maxMs) => {
    const describe = (el: Element | null | undefined, pseudo?: string | null) => {
      if (!el) return "?";
      // getAttribute, not className: an <svg>'s className is an SVGAnimatedString.
      const cls = (el.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 8)
        .join(".");
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls ? `.${cls}` : ""}${pseudo ?? ""}`;
    };
    const nameOf = (a: Animation) =>
      (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? (a.id || a.constructor.name);

    // 1. Running animations that loop or last.
    const animations = document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .filter((a) => {
        const t = a.effect?.getComputedTiming();
        if (!t) return false;
        const dur = Number(t.duration);
        return t.iterations === Infinity || (Number.isFinite(dur) && dur > maxMs);
      })
      .map((a) => {
        const eff = a.effect as KeyframeEffect | null;
        const t = eff?.getComputedTiming();
        return `${nameOf(a)} ${t?.duration}ms x${t?.iterations} on ${describe(eff?.target, eff?.pseudoElement)}`;
      });

    // 2. Anything still moving: transform/opacity changing on EVERY sample.
    // A one-off state change (a button enabling) changes once; motion changes
    // continuously, so an element must differ A→B AND B→C to count.
    const sample = () => {
      const m = new Map<Element, string>();
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const s = getComputedStyle(el);
        m.set(el, `${s.transform}|${s.opacity}`);
      }
      return m;
    };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const a = sample();
    await wait(300);
    const b = sample();
    await wait(300);
    const c = sample();
    const movers: string[] = [];
    for (const [el, vb] of b) {
      const va = a.get(el);
      const vc = c.get(el);
      if (va !== undefined && vc !== undefined && va !== vb && vb !== vc) movers.push(`${describe(el)} ${va} → ${vb} → ${vc}`);
    }

    // 3. The canary: the shared rule must reach arbitrary markup on this
    // route's real stylesheet.
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:-9999px;top:0;width:40px;height:40px;";
    const probes: Array<[string, HTMLElement]> = [];
    const add = (label: string, build: (el: HTMLElement) => void) => {
      const el = document.createElement("div");
      el.style.cssText = "width:10px;height:10px;";
      build(el);
      host.appendChild(el);
      probes.push([label, el]);
    };
    add("animate-spin", (el) => (el.className = "animate-spin"));
    add("animate-pulse", (el) => (el.className = "animate-pulse"));
    // A pseudo-element loop (the skeleton shimmer is one) from an injected
    // rule, so the canary does not depend on Tailwind having compiled a class.
    const sheet = document.createElement("style");
    sheet.textContent = ".__rm-canary-after::after{content:'';display:block;width:4px;height:4px;animation:spin 2s linear infinite}";
    document.head.appendChild(sheet);
    add("::after loop", (el) => (el.className = "__rm-canary-after"));
    add("inline infinite animation", (el) => (el.style.animation = "spin 1s linear infinite"));
    add("inline transition", (el) => (el.style.transition = "opacity 400ms ease"));
    document.body.appendChild(host);
    const toMs = (v: string) => Math.max(...v.split(",").map((x) => (x.trim().endsWith("ms") ? parseFloat(x) : parseFloat(x) * 1000)));
    const canary: string[] = [];
    for (const [label, el] of probes) {
      if (label === "inline transition") {
        const d = getComputedStyle(el).transitionDuration;
        if (toMs(d) > maxMs) canary.push(`${label}: transition-duration ${d}`);
        continue;
      }
      const pseudo = label === "::after loop" ? "::after" : null;
      const s = getComputedStyle(el, pseudo);
      // A class that compiled to nothing would read clean for the wrong reason.
      if (s.animationName === "none") {
        canary.push(`${label}: no animation at all — the canary itself is broken`);
        continue;
      }
      if (toMs(s.animationDuration) > maxMs || s.animationIterationCount === "infinite") {
        canary.push(`${label}: animation ${s.animationName} ${s.animationDuration} x${s.animationIterationCount}`);
      }
    }
    sheet.remove();
    host.remove();

    return { animations, movers, canary };
  }, MAX_MS);
}

function authedScreens(poster: Session, realJobId: string | null): ScreenSpec[] {
  const out: ScreenSpec[] = [];
  for (const s of AUTHED_SCREENS) {
    if (s.seededOnly || s.name === "complete-profile-incomplete") continue;
    if (s.name === "job-detail-1") {
      if (realJobId) out.push({ name: "job-detail", url: `/jobs/${realJobId}` });
      continue;
    }
    if (s.name === "user-profile" || s.name === "user-profile-customer") {
      if (s.name === "user-profile-customer") out.push({ name: "user-profile-self", url: `/user/${poster.user.id}` });
      continue;
    }
    if (FIXTURE_ID.test(s.url) && !/dead/.test(s.url)) continue;
    out.push(s);
  }
  return out;
}

function expectStill(report: MotionReport, where: string) {
  expect(report.canary, `${where}: the shared reduced-motion rule did not reach the canary`).toEqual([]);
  expect(report.animations, `${where}: CSS animations/transitions still running under Reduce Motion`).toEqual([]);
  expect(report.movers, `${where}: elements still moving (transform/opacity) under Reduce Motion`).toEqual([]);
}

test.describe("Reduce Motion: nothing moves (Q254)", () => {
  test("control: without the preference the probe sees the landing chevron bounce", async ({ browser }) => {
    const ctx = await motionContext(browser, null, VIEWPORTS[0], "no-preference");
    const page = await ctx.newPage();
    try {
      const report = await measureMotion(page, "/");
      expect(
        report.animations.some((a) => a.startsWith("bounce ")),
        `the probe saw no bounce on / with motion allowed — it is blind, so every "clean" below means nothing. Saw: ${JSON.stringify(report.animations)}`,
      ).toBe(true);
      expect(
        report.movers.some((m) => m.includes("animate-bounce")),
        `the movement sampler saw nothing move on / with motion allowed — it is blind. Saw: ${JSON.stringify(report.movers)}`,
      ).toBe(true);
      expect(
        report.canary.filter((c) => c.endsWith("xinfinite")).length,
        `with motion allowed every looping canary must loop. Saw: ${JSON.stringify(report.canary)}`,
      ).toBe(4);
    } finally {
      await ctx.close();
    }
  });

  for (const v of VIEWPORTS) {
    for (const screen of inScope(ANON_SCREENS)) {
      test(`${screen.name} (anon/${v.tag})`, async ({ browser }) => {
        const ctx = await motionContext(browser, null, v, "reduce");
        const page = await ctx.newPage();
        try {
          const report = await measureMotion(page, screen.url, screen.extraSetup);
          await test.info().attach("motion.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
          expectStill(report, `${screen.url} at ${v.tag}`);
        } finally {
          await ctx.close();
        }
      });
    }
  }

  let poster: Session | null = null;
  let realJobId: string | null = null;
  const signedInScreens = inScope(AUTHED_SCREENS.filter((s) => !s.seededOnly && s.name !== "complete-profile-incomplete"));

  test.beforeAll(async ({ request }) => {
    if (!signedInScreens.length || !sessionAvailable("poster")) return;
    poster = await getSession(request, "poster");
    const jobs = await request.get(`${SUPABASE_URL}/rest/v1/open_jobs_browse?select=id&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    if (jobs.ok()) realJobId = ((await jobs.json()) as { id: string }[])[0]?.id ?? null;
  });

  for (const v of VIEWPORTS) {
    for (const spec of signedInScreens) {
      test(`${spec.name} (signed-in/${v.tag})`, async ({ browser }) => {
        test.skip(!poster, "no poster session (PLAYWRIGHT_POSTER_EMAIL/_PASSWORD or a local .env) — the signed-in surface was NOT checked for motion");
        const screen = authedScreens(poster!, realJobId).find(
          (s) =>
            s.name === spec.name ||
            (spec.name === "job-detail-1" && s.name === "job-detail") ||
            (spec.name === "user-profile-customer" && s.name === "user-profile-self"),
        );
        test.skip(!screen, `${spec.name}: keyed to a fixture id that does not exist on prod`);
        const ctx = await motionContext(browser, poster, v, "reduce");
        const page = await ctx.newPage();
        try {
          const report = await measureMotion(page, screen!.url, screen!.extraSetup);
          await test.info().attach("motion.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
          expectStill(report, `${screen!.url} (signed in) at ${v.tag}`);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});
