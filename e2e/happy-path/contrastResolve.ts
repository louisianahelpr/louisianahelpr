/**
 * Resolve the colour-contrast checks that axe REFUSES to decide.
 *
 * ------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ------------------------------------------------------------------
 * The a11y gate (.github/workflows/a11y-axe.yml → visual-audit-sweep.spec.ts)
 * read `axe.violations` and nothing else. axe reports a `color-contrast`
 * result as INCOMPLETE — not a violation — whenever it cannot resolve what
 * colour is actually behind the text. Its stated reasons are `bgGradient`
 * (an ancestor paints a gradient), `bgImage`, `bgOverlap` (another element
 * covers part of the text) and friends.
 *
 * This app's page canvas IS a gradient. So on every screen that matters, every
 * colour-contrast result landed in `incomplete`, the gate looked only at
 * `violations`, and the check reported green having never run. Measured on the
 * built bundle at 375x812:
 *
 *     /   →  0 violations, 25 incomplete colour-contrast nodes
 *
 * A gate that returns green when it did not run is worse than no gate: it
 * converts "nobody has checked this" into "this has been checked and is fine".
 *
 * ------------------------------------------------------------------
 * WHY WE RESOLVE RATHER THAN JUST FAILING ON `incomplete`
 * ------------------------------------------------------------------
 * Failing the gate on any `incomplete` colour-contrast node would make it red
 * on literally every screen, forever, for a reason nobody can act on — which
 * ends the same way every unactionable gate ends: muted. And the alternative,
 * making the background resolvable FOR axe, would mean deleting the gradient
 * canvas from the design to satisfy a test. Neither is acceptable.
 *
 * So we answer the question axe declined to: what is actually painted behind
 * this text? Two independent methods, and a failure requires BOTH to agree.
 *
 *  1. COMPOSITED ANCESTOR WALK. Each ancestor's background layers are
 *     composited in paint order, and a gradient contributes ALL of its colour
 *     stops, scored at the worst one. Same model axe uses; the only thing we
 *     add is refusing to give up on a gradient.
 *
 *  2. PIXEL SAMPLING. The element's own text line boxes are read out of a
 *     full-page screenshot decoded inside the page, glyph-coloured buckets
 *     excluded, and the remaining surface scored.
 *
 * The reported ratio is the HIGHER of the two. Anything neither can decide
 * comes back UNRESOLVED, with the reason, and the caller fails the gate on it.
 * The one outcome this file exists to make impossible is a check that quietly
 * skips and reports success.
 *
 * ------------------------------------------------------------------
 * WHY BOTH, AND WHY THE HIGHER NUMBER
 * ------------------------------------------------------------------
 * Each method alone was tried, and each alone produced failures the other
 * disproves on sight.
 *
 * PIXELS OVER-REPORT, and they also go BLIND. Both matter.
 *
 * They go blind on dense text: a bold 15px/600 button label fills its own line
 * box so completely that no surface pixel survives the glyph filter, and the
 * sampler then returns the glyph colour, i.e. 1:1. That is not a measurement,
 * and taking the higher of the two numbers turns it into silent agreement with
 * whatever the walk said — 14 "Post a Job" buttons came back "4.33:1 via both"
 * with the pixel column at 1.11. Hence the second stage in sampledBackdrops:
 * when the line boxes are degenerate, sample the element's own border box.
 *
 * They over-report because a text line box contains more than the text's own
 * background:
 *   - the profile avatar's "SC" initials came back 2.58:1. They are near-black
 *     on a pale tan face; what the sampler found was the OLIVE RING around the
 *     face, which falls inside the line box because the box spans the whole
 *     24px circle. It measured a colour the glyphs never touch.
 *   - a segmented control's idle "History" tab came back 1.44:1. It is dark
 *     text on a near-white pill. The winning "background" bucket was the
 *     ANTIALIASED EDGE of the glyphs, which at 11px out-counted the surface.
 *
 * THE WALK OVER-REPORTS TOO, in the other direction:
 *   - scoring a gradient at its worst stop is a lower bound, not the colour
 *     under the text, so every `btn-grad-primary` CTA in dark mode came back
 *     4.33:1 where the painted pixels measure 4.84:1;
 *   - it cannot tell that a text layer is deliberately invisible — the legal
 *     tabs render a hidden bold twin to reserve width — and reported those at
 *     1:1.
 *
 * None of that is tuning; it is what each method structurally cannot see. So
 * the gate fires only when both agree, which biases it toward false NEGATIVES
 * on purpose. A gate that fires on either one is red on most screens for
 * reasons nobody can act on, and a gate like that gets muted — which is the
 * exact failure this whole change exists to undo. Both numbers are kept on
 * every row so a reviewer can see when the two disagree and by how much.
 *
 * The residual blind spot is `bgOverlap`: neither method sees another element
 * covering the text, which is also axe's own blind spot. The node's axe reason
 * rides along on the row so a suspicious run can be triaged for it.
 */

import type { Page } from "@playwright/test";
import type AxeBuilder from "@axe-core/playwright";

/**
 * axe's result shape, derived from the builder this repo actually depends on.
 * `axe-core` is only a TRANSITIVE dependency here, so importing its types
 * directly would work until the day @axe-core/playwright hoists differently.
 */
type AxeResults = Awaited<ReturnType<InstanceType<typeof AxeBuilder>["analyze"]>>;

export interface ContrastNode {
  /** CSS selector axe reported for the node. */
  selector: string;
  /** axe's own `expectedContrastRatio`, e.g. 4.5 — null when it did not say. */
  need: number | null;
  /** axe's reason for declining, e.g. "bgGradient". */
  axeReason: string | null;
}

export interface ResolvedContrast extends ContrastNode {
  resolved: boolean;
  /** "both" when the two methods agreed to a number, else the one available. */
  method?: string;
  /** The reported ratio: the HIGHER of the two, so a fail needs both to fail. */
  ratio?: number;
  /** Each method's own number, kept so a disagreement is visible in the report. */
  walkRatio?: number | null;
  pixelRatio?: number | null;
  /** The threshold actually applied (4.5, or 3 for large text). */
  threshold?: number;
  fg?: string;
  bg?: string;
  fontPx?: number;
  weight?: number;
  text?: string;
  /** Populated only when `resolved` is false. */
  reason?: string;
  /**
   * The element was gone by the time we looked. Distinct from undecidable —
   * see `contrastVanished`.
   */
  vanished?: boolean;
}

/**
 * Pull the colour-contrast nodes out of an axe run's `incomplete` bucket.
 * Exported separately so a caller can report the raw count even if resolution
 * later throws.
 */
export function incompleteContrastNodes(results: AxeResults): ContrastNode[] {
  const out: ContrastNode[] = [];
  for (const v of results.incomplete) {
    if (v.id !== "color-contrast") continue;
    for (const n of v.nodes) {
      const check = [...(n.any ?? []), ...(n.all ?? []), ...(n.none ?? [])].find(
        (c) => c.id === "color-contrast",
      );
      const data = (check?.data ?? {}) as Record<string, unknown>;
      out.push({
        selector: n.target.map(String).join(" "),
        need: parseFloat(String(data.expectedContrastRatio ?? "")) || null,
        axeReason: data.messageKey ? String(data.messageKey) : null,
      });
    }
  }
  return out;
}

/**
 * The whole measurement, as one function serialized into the page. It has to
 * be self-contained — `page.evaluate` ships the source, not the closure — so
 * the colour maths is inlined rather than imported.
 */
function measureInPage(input: {
  items: ContrastNode[];
  hasScreenshot: boolean;
}): ResolvedContrast[] {
  const { items, hasScreenshot } = input;

  interface RGBA { r: number; g: number; b: number; a: number }

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const cx = canvas.getContext("2d", { willReadFrequently: true })!;

  /**
   * Normalise ANY CSS colour string through the canvas 2d context, which
   * hands back "#rrggbb" or "rgba(...)" whatever the input notation was.
   * Hand-parsing was the alternative and it silently mis-reads `color(srgb …)`
   * and `oklch()`, both of which appear in modern computed styles.
   */
  function parseColor(str: string | null | undefined): RGBA | null {
    if (!str) return null;
    const s = String(str).trim();
    if (!s || s === "none" || s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    cx.fillStyle = "#000000";
    cx.fillStyle = s;
    const norm = String(cx.fillStyle);
    if (norm.startsWith("#")) {
      return {
        r: parseInt(norm.slice(1, 3), 16),
        g: parseInt(norm.slice(3, 5), 16),
        b: parseInt(norm.slice(5, 7), 16),
        a: 1,
      };
    }
    const m = /rgba?\(([^)]+)\)/.exec(norm);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  function over(src: RGBA, dst: RGBA): RGBA {
    const a = src.a;
    return {
      r: src.r * a + dst.r * (1 - a),
      g: src.g * a + dst.g * (1 - a),
      b: src.b * a + dst.b * (1 - a),
      a: 1,
    };
  }

  function luminance(c: RGBA): number {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  function contrast(a: RGBA, b: RGBA): number {
    const l1 = luminance(a);
    const l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function hex(c: RGBA): string {
    return (
      "#" +
      [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")
    );
  }

  // ---------------------------------------------------------------- pixels
  //
  // TWO images, and which one an element must be read from is not a detail.
  //
  // A full-page screenshot places every element at its DOCUMENT position, so
  // a normal-flow element is at `rect + scroll`. A `position: fixed` element
  // is not: it is painted relative to the VIEWPORT, so on a scrolled document
  // `rect + scroll` points somewhere else entirely. This app's desktop rail
  // and bottom nav are both fixed, and reading them off the full-page image
  // sampled the dark page canvas instead of the button — which came back as
  // "pixels 1.35" against a walk of 4.33 and quietly demoted 34 nodes on
  // desktop-dark to the ancestor walk alone, the one method that over-reports
  // on exactly those gradient buttons.
  //
  // So fixed-positioned elements are read from the viewport screenshot at raw
  // rect coordinates, and everything else from the full-page one.
  interface Shot { data: ImageData; scale: number }
  function decode(name: string, cssWidth: number): Shot | null {
    try {
      const img = (window as unknown as Record<string, HTMLImageElement | undefined>)[name];
      if (!img || !img.complete || !img.naturalWidth) return null;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      return { data: g.getImageData(0, 0, c.width, c.height), scale: c.width / Math.max(1, cssWidth) };
    } catch {
      return null;
    }
  }
  const shotFull = hasScreenshot
    ? decode("__contrastShotFull", document.documentElement.scrollWidth)
    : null;
  const shotView = hasScreenshot ? decode("__contrastShotView", window.innerWidth) : null;

  function isFixed(el: Element): boolean {
    let n: Element | null = el;
    while (n) {
      if (getComputedStyle(n).position === "fixed") return true;
      n = n.parentElement;
    }
    return false;
  }

  /**
   * One of the two methods — see the header for why it is never trusted alone.
   *
   * Samples the element's own text line boxes (NOT its bounding box, which
   * contains descendants: the landing `h1` wraps an `<em>` in burnt sienna, and
   * scoring the h1's near-black against its own child's orange invented a
   * 2.06:1 failure) and excludes buckets within 1.2:1 of the computed text
   * colour, which are the glyphs.
   *
   * Both filters are necessary and neither is sufficient — a line box can still
   * contain a neighbouring decoration this cannot tell from a surface, which is
   * exactly why the caller takes the higher of this and the ancestor walk.
   *
   * The one case deliberately preserved: if NOTHING survives the glyph filter,
   * the box really is one flat colour, so it is returned and the ratio comes
   * out at 1:1 rather than the finding disappearing.
   */
  function ownTextRects(el: Element): DOMRect[] {
    const rects: DOMRect[] = [];
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      if (!(node.textContent ?? "").trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of Array.from(range.getClientRects())) {
        if (r.width >= 1 && r.height >= 1) rects.push(r);
      }
    }
    return rects;
  }

  function sampleRects(rects: DOMRect[], fg: RGBA, shot: Shot | null, offX: number, offY: number): RGBA[] | null {
    if (!shot || !rects.length) return null;
    const counts = new Map<number, number>();
    let total = 0;
    for (const r of rects) {
      // CLAMP, do not skip. Dropping any rect that pokes a pixel past the
      // image edge silently discarded the whole border-box stage for buttons
      // near the viewport edge, which is how 14 "Post a Job" CTAs kept coming
      // back with a pixel column of 1.11 even after that stage was added. A
      // partially visible rect still measures the surface fine.
      const x0 = Math.max(0, Math.round((r.left + offX) * shot.scale));
      const y0 = Math.max(0, Math.round((r.top + offY) * shot.scale));
      const x1 = Math.min(shot.data.width, Math.round((r.right + offX) * shot.scale));
      const y1 = Math.min(shot.data.height, Math.round((r.bottom + offY) * shot.scale));
      if (x1 - x0 < 1 || y1 - y0 < 1) continue;
      const stepX = Math.max(1, Math.floor((x1 - x0) / 160));
      const stepY = Math.max(1, Math.floor((y1 - y0) / 160));
      for (let y = y0; y < y1; y += stepY) {
        for (let x = x0; x < x1; x += stepX) {
          const i = (y * shot.data.width + x) * 4;
          const d = shot.data.data;
          const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
          counts.set(key, (counts.get(key) ?? 0) + 1);
          total++;
        }
      }
    }
    if (total < 16) return null;
    const toRGBA = (k: number): RGBA => ({
      r: (k >> 16) & 255,
      g: (k >> 8) & 255,
      b: k & 255,
      a: 1,
    });
    const sorted = [...counts.entries()]
      .map(([k, n]) => ({ color: toRGBA(k), n }))
      .sort((a, b) => b.n - a.n);

    const surface = sorted.filter((b) => contrast(b.color, fg) >= 1.2);
    const surfaceFraction = surface.reduce((acc, b) => acc + b.n, 0) / total;
    if (!surface.length || surfaceFraction < 0.05) {
      // Nothing here but the text colour. Either the text really is invisible
      // against its own background, or the glyphs simply fill this region and
      // the surface is just outside it. The caller distinguishes the two by
      // trying a wider region before believing this.
      return [sorted[0].color];
    }

    const primary = surface[0].color;
    const out = [primary];
    for (const b of surface.slice(1)) {
      if (b.n / total < 0.05) break;
      if (contrast(b.color, primary) < 1.5) out.push(b.color);
    }
    return out;
  }

  /**
   * Two stages, because one region is not enough.
   *
   * Stage 1 is the text's own line boxes, which is the right region almost
   * always. Stage 2 exists for DENSE text — a bold button label at 15px/600
   * fills its line box so completely that no surface pixel survives the glyph
   * filter, and stage 1 then returns the glyph colour and reads as 1:1. That
   * is not a measurement, and it is not harmless: it silently demoted every
   * `btn-grad-primary` CTA to the ancestor walk alone, which scores a gradient
   * at its worst stop, and 14 "Post a Job" buttons were reported at 4.33:1
   * with the pixel column sitting at 1.11 — a number that means "I could not
   * see the background", dressed up as agreement.
   *
   * So when stage 1 is degenerate, sample the element's own BORDER BOX
   * instead, which for a button is the whole pill and mostly surface. It is
   * clipped to the element itself, never a parent, so it cannot wander onto a
   * neighbouring element's paint — and if THAT is degenerate too, the text
   * really is the colour of its own box and 1:1 is the honest answer.
   */
  function sampledBackdrops(el: Element, fg: RGBA): RGBA[] | null {
    const fixed = isFixed(el);
    const shot = fixed ? shotView : shotFull;
    if (!shot) return null;
    const offX = fixed ? 0 : window.scrollX;
    const offY = fixed ? 0 : window.scrollY;
    const tight = sampleRects(ownTextRects(el), fg, shot, offX, offY);
    const degenerate = (out: RGBA[] | null) =>
      !!out && out.length === 1 && contrast(out[0], fg) < 1.2;
    if (tight && !degenerate(tight)) return tight;
    const wider = sampleRects([el.getBoundingClientRect()], fg, shot, offX, offY);
    return wider && !degenerate(wider) ? wider : (tight ?? wider);
  }

  // ------------------------------------------------------------- ancestors
  /**
   * Every colour stop in a computed `background-image`. Computed gradients
   * always serialize their stops as rgb()/rgba(), so a token scan is enough.
   * Returns "unknown" for url() images, which we cannot reason about.
   */
  function gradientStops(bgImage: string): RGBA[] | "unknown" | null {
    if (!bgImage || bgImage === "none") return null;
    if (!/gradient\(/i.test(bgImage)) return "unknown";
    const out: RGBA[] = [];
    const rx = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b)/gi;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(bgImage))) {
      const c = parseColor(m[1]);
      if (c) out.push(c);
    }
    return out.length ? out : "unknown";
  }

  function ancestorBackdrops(el: Element): { colors?: RGBA[]; reason?: string } {
    const layers: RGBA[][] = []; // top-most first
    let node: Element | null = el;
    while (node) {
      const cs = getComputedStyle(node);
      const stops = gradientStops(cs.backgroundImage);
      if (stops === "unknown") {
        return {
          reason: `background-image on <${node.tagName.toLowerCase()}> is not a gradient we can read (${cs.backgroundImage.slice(0, 60)})`,
        };
      }
      if (stops) layers.push(stops);
      const bc = parseColor(cs.backgroundColor);
      if (bc && bc.a > 0) {
        layers.push([bc]);
        if (bc.a >= 1) break;
      }
      node = node.parentElement;
    }
    let base = parseColor(getComputedStyle(document.documentElement).backgroundColor);
    if (!base || base.a < 1) base = { r: 255, g: 255, b: 255, a: 1 };
    let candidates: RGBA[] = [base];
    for (let i = layers.length - 1; i >= 0; i--) {
      const next: RGBA[] = [];
      for (const dst of candidates) for (const src of layers[i]) next.push(over(src, dst));
      candidates = next.length > 40 ? next.slice(0, 40) : next;
    }
    return { colors: candidates };
  }

  // ------------------------------------------------------------------ main
  const out: ResolvedContrast[] = [];
  for (const item of items) {
    // axe's target is supposed to identify ONE element, and when it hands back
    // a bare utility class like `.py-3` it does not. Resolving that with
    // querySelector silently measures whichever element happens to come first
    // in the document, which is a wrong number wearing the costume of a right
    // one. An ambiguous target is undecidable, and undecidable fails loudly.
    let matches: NodeListOf<Element> | null = null;
    try {
      matches = document.querySelectorAll(item.selector);
    } catch {
      /* axe target that querySelectorAll cannot parse */
    }
    if (!matches || matches.length === 0) {
      // Literal, not a module const: page.evaluate serializes only this
      // function, so anything from the enclosing scope is undefined in the page.
      out.push({
        ...item,
        resolved: false,
        vanished: true,
        reason: "element no longer in the DOM at resolve time",
      });
      continue;
    }
    if (matches.length > 1) {
      out.push({
        ...item,
        resolved: false,
        reason:
          `axe's target selector matches ${matches.length} elements, so which one it measured ` +
          "is unknowable — any ratio computed from it would be for whichever came first",
      });
      continue;
    }
    const el: Element = matches[0];
    const cs = getComputedStyle(el);
    const fgRaw = parseColor(cs.color);
    if (!fgRaw) {
      out.push({ ...item, resolved: false, reason: `unparseable color: ${cs.color}` });
      continue;
    }

    // BOTH methods, and a failure needs BOTH to agree — see the header.
    const walked = ancestorBackdrops(el);
    const sampled = sampledBackdrops(el, fgRaw);

    const score = (backdrops: RGBA[] | null) => {
      if (!backdrops || !backdrops.length) return null;
      let worst: { ratio: number; fg: RGBA; bg: RGBA } | null = null;
      for (const bg of backdrops) {
        const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;
        const r = contrast(fg, bg);
        if (!worst || r < worst.ratio) worst = { ratio: r, fg, bg };
      }
      return worst;
    };

    const byWalk = score(walked.colors ?? null);
    const byPixels = score(sampled);
    if (!byWalk && !byPixels) {
      out.push({
        ...item,
        resolved: false,
        reason: walked.reason ?? "no backdrop could be determined by either method",
      });
      continue;
    }

    // The reported ratio is the HIGHER of the two, so a failure requires the
    // ancestor walk AND the pixel sample to agree. That is deliberate, and it
    // deliberately biases toward false NEGATIVES.
    //
    // The two methods have opposite failure modes, and each one alone produced
    // failures the other disproves:
    //   - Pixels over-report. A text line box contains more than the text's own
    //     background: the avatar's olive ring read as the backdrop for its pale
    //     "SC" initials (2.58:1, disproved by the screenshot), and at 11px the
    //     glyphs' own antialiased edge out-counted the surface on a segmented
    //     control's idle tab (1.44:1, also disproved).
    //   - The walk over-reports too, in the other direction. It scores a
    //     gradient at its WORST stop, which is a strict lower bound rather than
    //     the colour under the text — so every `btn-grad-primary` CTA in dark
    //     mode came back 4.33:1 while the painted pixels measure 4.84:1. It
    //     also cannot see that a text layer is deliberately invisible (the
    //     legal tabs render a hidden bold twin to reserve width), and reported
    //     those at 1:1.
    // Neither list is a tuning problem; they are what each method structurally
    // cannot see. A gate that fires on either one cries wolf on most screens
    // and gets muted, which is the exact failure this whole change exists to
    // undo. Both numbers are kept on the row so a reviewer can see when they
    // disagree and by how much.
    const chosen = !byWalk ? byPixels! : !byPixels ? byWalk : byWalk.ratio >= byPixels.ratio ? byWalk : byPixels;
    const method = !byWalk ? "pixels" : !byPixels ? "ancestors" : "both";

    const px = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    // WCAG "large text": 18pt (24px), or 14pt (18.66px) when bold.
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const threshold = item.need ?? (large ? 3 : 4.5);

    const round = (n: number) => Math.round(n * 100) / 100;
    out.push({
      ...item,
      resolved: true,
      method,
      ratio: round(chosen.ratio),
      walkRatio: byWalk ? round(byWalk.ratio) : null,
      pixelRatio: byPixels ? round(byPixels.ratio) : null,
      threshold,
      fg: hex(chosen.fg),
      bg: hex(chosen.bg),
      fontPx: px,
      weight,
      text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48),
    });
  }
  return out;
}

/**
 * Decide every `color-contrast` result axe left in `incomplete`.
 *
 * Takes the full-page screenshot itself (one per call) so the caller does not
 * have to thread a buffer around. Returns every node, resolved or not — the
 * caller decides how loudly to fail, but MUST fail on both buckets: a node
 * nothing could decide is not a node that passed.
 */
export async function resolveIncompleteContrast(
  page: Page,
  results: AxeResults,
): Promise<ResolvedContrast[]> {
  const items = incompleteContrastNodes(results);
  if (!items.length) return [];

  // TWO screenshots: full-page for normal-flow elements, viewport for
  // `position: fixed` ones, which a full-page capture places at their viewport
  // position rather than `rect + scroll`. See measureInPage for what reading
  // the wrong one did to 34 nodes on desktop-dark.
  //
  // A screenshot failure is not fatal — those nodes then have the ancestor
  // walk alone, which is conservative rather than wrong, and the row says
  // `via ancestors` so the weaker basis is visible in the report.
  const shots = await Promise.all([
    page.screenshot({ fullPage: true, timeout: 15_000 }).then((b) => b.toString("base64")).catch(() => null),
    page.screenshot({ fullPage: false, timeout: 15_000 }).then((b) => b.toString("base64")).catch(() => null),
  ]);

  if (shots[0] || shots[1]) {
    // Decode BEFORE the measurement runs. measureInPage is synchronous (it has
    // to be, to stay one serializable function), so an Image still decoding
    // would silently read as "no screenshot".
    await page.evaluate(async ([full, view]) => {
      const load = async (b64: string | null) => {
        if (!b64) return undefined;
        const img = new Image();
        img.src = "data:image/png;base64," + b64;
        await img.decode().catch(() => undefined);
        return img;
      };
      const w = window as unknown as Record<string, HTMLImageElement | undefined>;
      w.__contrastShotFull = await load(full);
      w.__contrastShotView = await load(view);
    }, shots);
  }

  return page.evaluate(measureInPage, { items, hasScreenshot: shots[0] !== null || shots[1] !== null });
}

/** Nodes that resolved to a ratio below the threshold WCAG requires. */
export function contrastFailures(rows: ResolvedContrast[]): ResolvedContrast[] {
  return rows.filter((r) => r.resolved && (r.ratio ?? 0) < (r.threshold ?? 4.5));
}

/**
 * Nodes that were STILL THERE and that neither method could decide. The gate
 * must fail on these: an undecided check is not a passing check.
 */
export function contrastUnresolved(rows: ResolvedContrast[]): ResolvedContrast[] {
  return rows.filter((r) => !r.resolved && !r.vanished);
}

/**
 * Nodes whose element had disappeared between axe's scan and ours.
 *
 * This is NOT the same as undecidable and must not fail the run. The app has
 * self-dismissing overlays — the seeded job-detail screens raise a toast that
 * clears on a timer — and axe measured one, then it was gone before we could
 * resolve it. There is no screen to fix: the thing being scored no longer
 * exists for anyone.
 *
 * It IS a coverage gap, and an acknowledged one: text that only exists for a
 * few seconds is not contrast-checked by this gate at all. Closing it properly
 * means freezing the overlay for the duration of the scan, which changes what
 * the sweep renders. Reported as an annotation so the gap stays visible rather
 * than becoming a silent omission.
 */
export function contrastVanished(rows: ResolvedContrast[]): ResolvedContrast[] {
  return rows.filter((r) => !r.resolved && r.vanished);
}

/**
 * One line per row, for a test-failure message someone has to act on.
 * The axe reason rides along on resolved rows too: `bgOverlap` means another
 * element covers part of the text, which the ancestor walk cannot see, so it
 * is the one value that should prompt a look at the screenshot before the
 * number is believed.
 */
export function describeContrast(r: ResolvedContrast): string {
  if (!r.resolved) return `${r.selector} — UNRESOLVED (axe said "${r.axeReason ?? "?"}"): ${r.reason}`;
  const split =
    r.walkRatio != null && r.pixelRatio != null && Math.abs(r.walkRatio - r.pixelRatio) >= 0.25
      ? ` [walk ${r.walkRatio} vs pixels ${r.pixelRatio}]`
      : "";
  return (
    `${r.selector} — ${r.ratio}:1, needs ${r.threshold}:1 ` +
    `(${r.fg} on ${r.bg}, ${r.fontPx}px/${r.weight}, via ${r.method}, axe: ${r.axeReason ?? "?"})${split} "${r.text}"`
  );
}
