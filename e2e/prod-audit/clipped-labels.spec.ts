/**
 * CLIPPED CONTROL LABELS, ON SCREEN (Q119, the on-screen half of Q108/Q116).
 *
 * src/test/truncatedActionLabel.test.ts finds, in source, every control whose
 * label can be cut off (truncate / text-ellipsis / line-clamp) without its full
 * text in a `title` or `aria-label`. It cannot say whether the label IS cut
 * off; this does, on the rendered app against prod.
 *
 * For every route in the audit catalog (spacingScreens(): the guest routes as a
 * guest, the signed-in routes as poster-e2e), at 320, 375 and 1440: every
 * visible element carrying a clip class inside a control (a, button, or role
 * button/link/tab/menuitem) is measured. It is CLIPPED when scrollWidth >
 * clientWidth + 1 (line-clamp: scrollHeight > clientHeight + 1). A clipped
 * label passes only when its full text is reachable (title or aria-label on it
 * or on its control). Every clipped label is printed as `CLIP ...` with
 * whether it has its full text, so the run is the measurement.
 *
 * Shown able to fail: the mutation drops the title the Q116 fix gave the
 * Messages list's job title, which clips at 375 (measured 241 > 231).
 *
 * OVERFLOWING LABELS (lead's look, 2026-10-13): a label with no clip class can
 * still run PAST its control. On /payment-success, held, at 375 the "Post
 * Another" secondary button (whitespace-nowrap, one of two forced grid
 * columns) drew its text through its own right edge. The second test measures
 * every visible control on every audited route at 320 and 375, plus that
 * held screen for the poster's newest funded job: a control whose
 * scrollWidth > clientWidth + 1 is a defect. Shown able to fail: the mutation
 * puts the forced two columns back (measured on the lead's look).

 *
 * HEADER CONTROLS OUT OF THEIR CARD (design slice 2, 2026-10-18): at 320 the
 * Jobs & Posts title row (emblem, search, filters, bell, Messages, you) was
 * wider than its title card, so the card's `overflow-hidden` cut the avatar
 * off at the right edge. Nothing overflowed the PAGE, so every fit check
 * passed. The same first sweep now also measures every visible control inside
 * a header region (header, nav, role banner/navigation, PageScaffold's
 * `data-title-card`) against the viewport and against every ancestor that
 * clips it (overflow hidden/clip). A control inside a scroller is reachable by
 * scrolling and is not measured on that axis. The sweep runs behind the write
 * firewall and asserts the firewall saw the backend. Shown able to fail: the
 * mutation takes the wrap off DashboardTitleBar's row (the pre-fix 95417816d
 * row), and the avatar is clipped at 320.
 */
import { test, expect, type Browser } from "../prodTest";
import { getSession, selectAs, writeFirewall, POSTER_ID, SUPABASE_URL, isConsentAcceptance, type Session } from "./harness";
import { isReadRpcPath, isStorageSignPath } from "../readRpc";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";
import { spacingScreens, type SpacingScreen } from "./shellSpacing";

// @mutate src/components/messages/ConversationRow.tsx | title={c.jobTitle} | data-q119-mutant={c.jobTitle}
// @mutate src/pages/post-job/PaymentSuccess.tsx | grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] | grid grid-cols-2 gap-2.5
// @mutate src/components/dashboard/DashboardTitleBar.tsx | "flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 sm:gap-x-2" | "flex items-center justify-end gap-x-1.5 gap-y-1 sm:gap-x-2"

const WIDTHS = [320, 375, 1440] as const;
const SCREENS = spacingScreens();

let poster: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

interface ClipRow {
  text: string;
  control: string;
  sw: number;
  cw: number;
  sh: number;
  ch: number;
  full: boolean;
}

/** Self-contained (page.evaluate serialises it). */
function readClippedLabels(): ClipRow[] {
  const CLIP = /(^|\s)(truncate|text-ellipsis|line-clamp-\S+)(\s|$)/;
  const CONTROL = 'a,button,[role="button"],[role="link"],[role="tab"],[role="menuitem"]';
  const out: ClipRow[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    const cls = typeof el.className === "string" ? el.className : "";
    if (!CLIP.test(cls)) continue;
    const control = el.closest<HTMLElement>(CONTROL);
    if (!control) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || cs.display === "none") continue;
    const clamp = /line-clamp/.test(cls);
    const clipped = clamp ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
    if (!clipped) continue;
    const full = !!(el.getAttribute("title") || el.getAttribute("aria-label") || control.getAttribute("title") || control.getAttribute("aria-label"));
    out.push({
      text: (el.textContent || "").trim().slice(0, 80),
      control: control.tagName.toLowerCase() + (control.getAttribute("role") ? `[role=${control.getAttribute("role")}]` : ""),
      sw: el.scrollWidth,
      cw: el.clientWidth,
      sh: el.scrollHeight,
      ch: el.clientHeight,
      full,
    });
  }
  return out;
}

/**
 * Self-contained (page.evaluate serialises it): every visible control in a
 * header region that is cut by the viewport or by an ancestor that clips it.
 */
function readHeaderControlsOutOfBounds(): string[] {
  const REGION = 'header,nav,[role="banner"],[role="navigation"],[data-title-card]';
  const CONTROL = 'a,button,[role="button"],[role="link"],[role="tab"],[role="menuitem"]';
  const vw = document.documentElement.clientWidth;
  const out: string[] = [];
  const seen = new Set<Element>();
  for (const region of Array.from(document.querySelectorAll<HTMLElement>(REGION))) {
    for (const el of Array.from(region.querySelectorAll<HTMLElement>(CONTROL))) {
      if (seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      let hidden = false;
      let scrollX = false;
      let scrollY = false;
      for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
        const c = getComputedStyle(n);
        if (c.display === "none" || c.visibility === "hidden" || c.opacity === "0" || c.clip === "rect(0px, 0px, 0px, 0px)" || /inset\(50%\)/.test(c.clipPath)) hidden = true;
        if (n !== el && /(auto|scroll)/.test(c.overflowX) && n.scrollWidth > n.clientWidth + 1) scrollX = true;
        if (n !== el && /(auto|scroll)/.test(c.overflowY) && n.scrollHeight > n.clientHeight + 1) scrollY = true;
      }
      if (hidden) continue;
      const name = `${el.tagName.toLowerCase()}[${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}]`;
      const box = `x${Math.round(r.left)}-${Math.round(r.right)} y${Math.round(r.top)}-${Math.round(r.bottom)}`;
      if (!scrollX && (r.left < -1 || r.right > vw + 1)) out.push(`${name} ${box} outside the ${vw}px viewport`);
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const c = getComputedStyle(n);
        const a = n.getBoundingClientRect();
        const cutX = !scrollX && /(hidden|clip)/.test(c.overflowX) && (r.left < a.left - 1 || r.right > a.right + 1);
        const cutY = !scrollY && /(hidden|clip)/.test(c.overflowY) && (r.top < a.top - 1 || r.bottom > a.bottom + 1);
        if (cutX || cutY) {
          const cls = String(n.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(".");
          out.push(`${name} ${box} clipped by ${n.tagName.toLowerCase()}.${cls} x${Math.round(a.left)}-${Math.round(a.right)} y${Math.round(a.top)}-${Math.round(a.bottom)}`);
          break;
        }
      }
    }
  }
  return out;
}

async function ctxFor(browser: Browser, auth: SpacingScreen["auth"], vw: number, baseURL?: string) {
  const desktop = vw >= 900;
  const ctx = await browser.newContext({
    baseURL,
    viewport: { width: vw, height: desktop ? 900 : 812 },
    hasTouch: !desktop,
    serviceWorkers: "block",
    ...(desktop ? {} : { userAgent: test.info().project.use.userAgent }),
  });
  if (auth === "poster") {
    await ctx.addInitScript(
      ({ key, val }) => {
        try {
          localStorage.setItem(key, val);
          localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
        } catch {
          /* signed out: the route lands on /login and is measured as that */
        }
      },
      { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster) },
    );
  }
  return ctx;
}

test("clipped labels: every route's clipped control label keeps its full text at 320/375/1440", async ({ browser }, info) => {
  test.setTimeout(60 * 60_000);
  expect(SCREENS.length, "spacingScreens() came back short").toBeGreaterThan(40);
  const wrong: string[] = [];
  const header: string[] = [];
  let headerControls = 0;
  // Measuring only: every write is refused at the wire (writeFirewall), and
  // this listener proves it: it sees the backend at all (else the firewall's
  // pattern matched nothing), and no non-read request to it ever completes.
  let backendSeen = 0;
  const writesThrough: string[] = [];
  let routes = 0;
  for (const auth of ["guest", "poster"] as const) {
    for (const vw of WIDTHS) {
      const ctx = await ctxFor(browser, auth, vw, info.project.use.baseURL);
      const blocked = await writeFirewall(ctx);
      ctx.on("request", (req) => {
        if (req.url().startsWith(SUPABASE_URL)) backendSeen++;
      });
      ctx.on("requestfinished", (req) => {
        if (!req.url().startsWith(SUPABASE_URL) || ["GET", "HEAD", "OPTIONS"].includes(req.method())) return;
        const { pathname } = new URL(req.url());
        if (/\/auth\/v1\/(token|user|logout)/.test(pathname) || isReadRpcPath(pathname) || isStorageSignPath(pathname)) return;
        if (isConsentAcceptance(req.method(), pathname, req.postData())) return;
        writesThrough.push(`${req.method()} ${pathname}`);
      });
      const page = await ctx.newPage();
      for (const s of SCREENS.filter((x) => x.auth === auth)) {
        await page.goto(s.url, { waitUntil: "domcontentloaded" });
        await page
          .waitForFunction(() => [...document.querySelectorAll("h1")].some((h) => (h.textContent || "").trim()), undefined, { timeout: 30_000 })
          .catch(() => {});
        await page.waitForTimeout(1500);
        routes++;
        for (const c of await page.evaluate(readClippedLabels)) {
          const line = `${s.name}@${vw} <${c.control}> "${c.text}" sw${c.sw}/cw${c.cw} sh${c.sh}/ch${c.ch} full=${c.full}`;
          console.log(`CLIP ${line}`);
          if (!c.full) wrong.push(line);
        }
        headerControls += await page.evaluate(() => document.querySelectorAll('header a,header button,nav a,nav button,[data-title-card] a,[data-title-card] button').length);
        for (const h of await page.evaluate(readHeaderControlsOutOfBounds)) {
          console.log(`HEADER ${s.name}@${vw} ${h}`);
          header.push(`${s.name}@${vw} ${h}`);
        }
      }
      if (blocked.length) console.log(`FIREWALL ${auth}@${vw} refused ${blocked.length}: ${blocked.map((b) => b.split(" ").slice(0, 2).join(" ")).join(", ")}`);
      await ctx.close();
    }
  }
  expect(routes).toBe(SCREENS.length * WIDTHS.length);
  expect(backendSeen, "the write firewall never saw the backend: its URL pattern matches nothing").toBeGreaterThan(0);
  expect(writesThrough, "a write reached prod through the firewall").toEqual([]);
  expect(headerControls, "header regions came back near empty: the region selector matches nothing").toBeGreaterThan(200);
  expect.soft(header, `header controls cut by the viewport or their card:\n${header.join("\n")}`).toEqual([]);
  expect(wrong, `clipped control labels with no full text:\n${wrong.join("\n")}`).toEqual([]);
});

/* THE HEADER DETECTOR ITSELF, on a page of known answers (no prod traffic):
   a control past its overflow-hidden card or past the viewport fails; one
   inside a scroller, or fully inside its card, passes. */
test("header-fit detector: a control cut by its card or the viewport fails, a scroller's does not", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 600 } });
  const page = await ctx.newPage();
  await page.setContent(`<style>body{margin:0}button{width:44px;height:44px;flex:none;padding:0;border:0}</style>
  <div data-title-card style="width:300px;overflow:hidden;display:flex;gap:8px">
    <button aria-label="fits"></button><span style="width:200px;flex:none"></span><button aria-label="cut by card"></button>
  </div>
  <header style="display:flex"><span style="width:300px;flex:none"></span><button aria-label="past viewport"></button></header>
  <nav style="width:200px;overflow-x:auto;display:flex"><span style="width:300px;flex:none"></span><button aria-label="scrolls"></button></nav>`);
  const rows = (await page.evaluate(readHeaderControlsOutOfBounds)).join(" | ");
  await ctx.close();
  expect(rows).toContain("cut by card");
  expect(rows).toContain("past viewport");
  expect(rows).not.toContain("[fits]");
  expect(rows, "a control inside a horizontal scroller is reachable by scrolling").not.toContain("scrolls");
});

/** Self-contained (page.evaluate serialises it): visible controls whose content runs past their own box. */
function readOverflowingControls(): { text: string; sw: number; cw: number }[] {
  const CONTROL = 'a,button,[role="button"],[role="link"],[role="tab"],[role="menuitem"]';
  const out: { text: string; sw: number; cw: number }[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(CONTROL))) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || cs.display === "none") continue;
    // A scroller (overflow auto/scroll) is meant to be wider inside than out.
    if (/(auto|scroll)/.test(cs.overflowX)) continue;
    // VISUALLY HIDDEN (Tailwind `sr-only`: clip rect(0 0 0 0), 1px box) paints
    // nothing, so nothing of it can run past an edge on screen. Run 38689259675 (2026-10-15)
    // reported 116 of 169 rows from exactly these: App.tsx's "Skip to content"
    // (sw124/cw1, every route), JobCardShell's "Expand Job Details" (cw44 from
    // the button's min touch size, still clipped to nothing) and
    // JobCardMetaRow's "Open <address> in Maps" (cw1). Each turns visible only
    // on focus, which is measured on its own below.
    let hidden = false;
    for (let n: HTMLElement | null = el; n && !hidden; n = n.parentElement) {
      const c = getComputedStyle(n);
      hidden = c.clip === "rect(0px, 0px, 0px, 0px)" || /inset\(50%\)/.test(c.clipPath);
    }
    if (hidden) continue;
    // An icon-only control has no text: name it by its accessible name and
    // classes, or the report reads `"" sw36/cw28` (run 38689259675) and says
    // nothing about WHICH control.
    const named = () => `${el.tagName.toLowerCase()}[${el.getAttribute("aria-label") ?? el.getAttribute("title") ?? ""}].${String(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 6).join(".")}`;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    // AN INVISIBLE HIT AREA IS NOT A LABEL. JobTracking's step dot is a 28px
    // button holding an aria-hidden, empty, unpainted 44x44 span centred on it
    // (the WCAG 2.5.5 target without a 44px drawing), so its scrollWidth is
    // 36: run 38689259675's `"" sw36/cw28` on /posts and /jobs/:id. Measure
    // again with only such overlays taken out of layout; anything that
    // paints (text, an icon, a fill, a border) still counts.
    const ghosts = Array.from(el.querySelectorAll<HTMLElement>('[aria-hidden="true"]')).filter((g) => {
      const c = getComputedStyle(g);
      return (
        !g.childElementCount &&
        !(g.textContent || "").trim() &&
        (c.backgroundColor === "rgba(0, 0, 0, 0)" || c.backgroundColor === "transparent") &&
        c.backgroundImage === "none" &&
        c.boxShadow === "none" &&
        !(parseFloat(c.borderLeftWidth) || parseFloat(c.borderRightWidth) || parseFloat(c.borderTopWidth) || parseFloat(c.borderBottomWidth))
      );
    });
    // THE SAME HIT AREA DRAWN AS A PSEUDO-ELEMENT. The toast's close button
    // (sonner.tsx closeButton) is a 28px glyph box whose 44px target is an
    // `after:-inset-2` ::after with content '' and no paint, so its
    // scrollWidth is 36: prod-audit run 39008504928's
    // `button[Close toast] sw36/cw28` on /posts and /jobs/:id at 320/375 (and,
    // read again, run 38689259675's `"" sw36/cw28` on the same routes). A
    // pseudo-element can't take an inline style, so an attribute plus one
    // injected rule takes only the unpainted, textless ones out of layout.
    const paintsNothing = (c: CSSStyleDeclaration) =>
      (c.backgroundColor === "rgba(0, 0, 0, 0)" || c.backgroundColor === "transparent") &&
      c.backgroundImage === "none" &&
      c.boxShadow === "none" &&
      !(parseFloat(c.borderLeftWidth) || parseFloat(c.borderRightWidth) || parseFloat(c.borderTopWidth) || parseFloat(c.borderBottomWidth));
    if (!document.getElementById("lh-ghost-pseudo")) {
      const st = document.createElement("style");
      st.id = "lh-ghost-pseudo";
      st.textContent = "[data-lh-ghost-before]::before,[data-lh-ghost-after]::after{display:none!important}";
      document.head.appendChild(st);
    }
    const pseudoGhosts: [Element, string][] = [];
    for (const n of [el, ...Array.from(el.querySelectorAll("*"))]) {
      for (const which of ["before", "after"] as const) {
        const c = getComputedStyle(n, `::${which}`);
        if ((c.content === '""' || c.content === "''") && paintsNothing(c)) pseudoGhosts.push([n, `data-lh-ghost-${which}`]);
      }
    }
    const was = ghosts.map((g) => g.style.display);
    for (const g of ghosts) g.style.display = "none";
    for (const [n, attr] of pseudoGhosts) n.setAttribute(attr, "");
    const sw = el.scrollWidth;
    ghosts.forEach((g, i) => (g.style.display = was[i]));
    for (const [n, attr] of pseudoGhosts) n.removeAttribute(attr);
    if (sw > el.clientWidth + 1) out.push({ text: (el.textContent || "").trim().slice(0, 60) || named(), sw, cw: el.clientWidth });
  }
  return out;
}

/**
 * Self-contained: every VISUALLY HIDDEN control measured the way a keyboard
 * user sees it, focused (`focus:not-sr-only`). One that stays hidden when
 * focused is skipped (a screen-reader-only label); one that shows and runs
 * past its own box is a defect like any other. Focus and scroll are restored.
 */
function readFocusedHiddenControls(): { text: string; sw: number; cw: number }[] {
  const CONTROL = 'a,button,[role="button"],[role="link"],[role="tab"],[role="menuitem"]';
  const clipped = (el: HTMLElement) => {
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.clip === "rect(0px, 0px, 0px, 0px)" || /inset\(50%\)/.test(c.clipPath)) return true;
    }
    return false;
  };
  const out: { text: string; sw: number; cw: number }[] = [];
  const x = window.scrollX;
  const y = window.scrollY;
  const before = document.activeElement as HTMLElement | null;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(CONTROL))) {
    if (!clipped(el)) continue;
    el.focus({ preventScroll: true });
    if (document.activeElement === el && !clipped(el)) {
      const r = el.getBoundingClientRect();
      if (r.width >= 1 && r.height >= 1 && el.scrollWidth > el.clientWidth + 1) {
        out.push({ text: `focused: ${(el.textContent || "").trim().slice(0, 52)}`, sw: el.scrollWidth, cw: el.clientWidth });
      }
    }
    el.blur();
  }
  before?.focus?.({ preventScroll: true });
  window.scrollTo(x, y);
  return out;
}

/* THE DETECTOR ITSELF, on a page of known answers (no prod traffic). A ghost
   hit area (an unpainted empty overlay, as an element or as ::after) is not a
   label; the same overlay painted, and real text past the edge, still are. */
test("overflow detector: ghost hit areas pass, painted overflow and long text fail", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 600 } });
  const page = await ctx.newPage();
  await page.setContent(`<style>
    button{position:relative;width:28px;height:28px;padding:0;margin:40px;border:0;display:flex}
    .hit::after{content:'';position:absolute;inset:-8px}
    .paint::after{content:'';position:absolute;inset:-8px;background:red}
    .span-hit span{position:absolute;inset:-8px}
  </style>
  <button id="a" class="hit" aria-label="ghost after"></button>
  <button id="b" class="span-hit" aria-label="ghost span"><span aria-hidden="true"></span></button>
  <button id="c" class="paint" aria-label="painted after"></button>
  <button id="d" style="width:40px;white-space:nowrap;overflow:visible">A long label</button>`);
  const rows = await page.evaluate(readOverflowingControls);
  await ctx.close();
  const names = rows.map((r) => r.text).join(" | ");
  expect(names, "an unpainted ::after hit area was read as an overflowing label").not.toContain("ghost after");
  expect(names, "an unpainted aria-hidden span hit area was read as an overflowing label").not.toContain("ghost span");
  expect(names, "a PAINTED ::after past the box must still count").toContain("painted after");
  expect(names, "real text past the box must still count").toContain("A long label");
});

test("overflowing labels: no control's label runs past its own box at 320/375 (incl. /payment-success held)", async ({ browser, request }, info) => {
  test.setTimeout(60 * 60_000);
  // The held success screen needs a funded job of the poster's own: read (GET only) its newest.
  const funded = await selectAs<{ id: string }[]>(request, poster,
    `jobs?select=id&customer_id=eq.${POSTER_ID}&payment_status=eq.escrow&order=created_at.desc&limit=1`);
  const extra = funded[0] ? [{ name: "payment-success-held", url: `/payment-success?job_id=${funded[0].id}`, auth: "poster" as const }] : [];
  console.log(`OVERFLOW held /payment-success: ${funded[0] ? `job ${funded[0].id}` : "no funded job of poster-e2e (not measured)"}`);
  const screens = [...SCREENS, ...extra];
  const wrong: string[] = [];
  let measured = 0;
  for (const auth of ["guest", "poster"] as const) {
    for (const vw of [320, 375]) {
      const ctx = await ctxFor(browser, auth, vw, info.project.use.baseURL);
      // Measuring only: no write reaches prod (the held success screen tracks a
      // PaymentMade event on load).
      await writeFirewall(ctx);
      const page = await ctx.newPage();
      for (const s of screens.filter((x) => x.auth === auth)) {
        await page.goto(s.url, { waitUntil: "domcontentloaded" });
        await page
          .waitForFunction(() => [...document.querySelectorAll("h1")].some((h) => (h.textContent || "").trim()), undefined, { timeout: 30_000 })
          .catch(() => {});
        await page.waitForTimeout(1500);
        measured++;
        for (const c of [...(await page.evaluate(readOverflowingControls)), ...(await page.evaluate(readFocusedHiddenControls))]) {
          const line = `${s.name}@${vw} "${c.text}" sw${c.sw}/cw${c.cw}`;
          console.log(`OVERFLOW ${line}`);
          wrong.push(line);
        }
      }
      await ctx.close();
    }
  }
  expect(measured).toBeGreaterThan(80);
  expect(wrong, `controls whose label runs past their own box:\n${wrong.join("\n")}`).toEqual([]);
});
