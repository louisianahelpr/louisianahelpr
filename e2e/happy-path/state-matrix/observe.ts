/**
 * observe — turn a rendered state into a STRUCTURED RECORD a person or a model
 * can critique.
 *
 * WHY THIS IS NOT A CHECKER
 * -------------------------
 * The existing gates assert predicates: `scrollWidth <= clientWidth`, axe
 * clean, tap targets >= 44px. Every one of the owner's twenty findings PASSES
 * all three:
 *
 *   two different greens on one tracker rail   — both AA, no overflow
 *   a close (X) laid on top of a price          — both elements >= 44px
 *   a badge 6px out of alignment with its sibling — no rule mentions 6px
 *   a 40px empty band                           — an empty div is valid HTML
 *   missing section eyebrows                    — axe does not require them
 *   a "Report" button on a finished job         — a button is a button
 *
 * None of those is a checkable rule, and writing one for each would produce a
 * gate that fires on every deliberate design choice. What they have in common
 * is that a person looking at the image sees them instantly.
 *
 * So this module does not judge. It EXTRACTS the facts a judge needs and could
 * not otherwise get from a PNG: the exact colour values in play and how many
 * distinct ones there are in the same hue family; the left/right edges of
 * sibling elements so a 6px misalignment is a number rather than a squint; the
 * vertical gaps with nothing in them; the overlapping boxes; the section
 * headings that exist and the ones that do not; the literal action labels
 * present in a state so "does this action make sense here" can be asked.
 *
 * The screenshot is the evidence. This is the caption that makes the evidence
 * legible. Together they go to `scripts/state-review.mjs`, whose prompt asks
 * "what is WRONG with this image", never "does this pass".
 */

import type { Page } from "@playwright/test";

export interface ColorUse {
  css: string;
  /** Parsed HSL for hue-family grouping. */
  h: number;
  s: number;
  l: number;
  a: number;
  /** Where it was used: background / text / border. */
  role: string;
  /** A short sample of the element it painted, for the reviewer's orientation. */
  on: string;
  count: number;
}

export interface EdgeCluster {
  /** "left" | "right" | "top" */
  axis: string;
  /** The distinct coordinates found, sorted. */
  values: number[];
  /** Max spread within the cluster, in px. Zero means perfectly aligned. */
  spread: number;
  samples: string[];
}

export interface EmptyBand {
  top: number;
  height: number;
  above: string;
  below: string;
}

export interface Overlap {
  a: string;
  b: string;
  /** Intersection area in px^2. */
  area: number;
}

export interface StateObservation {
  /** Bounding box of the region judged. */
  region: { x: number; y: number; width: number; height: number } | null;
  /** Every colour actually painted inside the region, deduped and counted. */
  colors: ColorUse[];
  /**
   * Colours grouped into hue families. The "two greens on one rail" defect is
   * exactly a family with more than one member that a reader reads as one
   * colour, so this is surfaced explicitly rather than left to be spotted.
   */
  hueFamilies: { family: string; members: string[] }[];
  /** Sibling edges that ALMOST line up. A spread of 1..12px is the tell. */
  nearMissAlignments: EdgeCluster[];
  /** Vertical runs inside the region with no painted content. */
  emptyBands: EmptyBand[];
  /** Interactive or text boxes whose rectangles intersect. */
  overlaps: Overlap[];
  /**
   * Direct siblings under one parent painted in DIFFERENT hue families.
   *
   * This is the shape of the tracker-rail defect and `hueFamilies` alone misses
   * it: the passed-step dots are `--success-ink` (h142, a true green) and the
   * current-step dot is `--bark` (h71, an olive). They land in two different
   * families, so a within-family multiplicity check reports nothing — while a
   * reader sees four dots in a row, three of them green and one of them a
   * different green, and has to work out whether that means anything.
   *
   * Siblings under one parent are the unit because that is what a reader
   * compares: a row of step dots, a row of action chips, a stack of status
   * pills. Two families in one such row is the question worth asking.
   */
  siblingColorSplits: {
    parent: string;
    families: string[];
    members: string[];
  }[];
  /** Headings, eyebrows and labelled group starts found, in document order. */
  sections: { tag: string; text: string; fontSize: number; y: number }[];
  /** Every visible control label in the region, in document order. */
  actions: { label: string; disabled: boolean; width: number; height: number }[];
  /** Every visible text run, in document order, for copy-contradiction checks. */
  copy: string[];
  /** Console errors seen while this state rendered. */
  consoleErrors: string[];
  /** True when the region was too large to inspect whole and was capped. */
  nodeCapHit?: boolean;
}

/**
 * Region resolver, evaluated in the page. Returns a selector-free handle by
 * tagging the winning element with `data-state-region`.
 *
 * `mode`:
 *  - "card"   the outermost `.liquid-glass` card containing `anchorText`
 *  - "dialog" the last open Radix overlay (portals append, so last = topmost)
 *  - "main"   the app root
 */
export async function tagRegion(
  page: Page,
  mode: "card" | "dialog" | "main",
  anchorText: string,
): Promise<boolean> {
  return page.evaluate(
    ({ mode, anchorText }) => {
      document.querySelectorAll("[data-state-region]").forEach((n) => n.removeAttribute("data-state-region"));
      let el: HTMLElement | null;
      if (mode === "dialog") {
        const all = [
          ...document.querySelectorAll(
            '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
          ),
        ] as HTMLElement[];
        el = all[all.length - 1] ?? null;
      } else if (mode === "card") {
        const needle = anchorText.slice(0, 24).toLowerCase();
        const cards = [...document.querySelectorAll("div.liquid-glass")] as HTMLElement[];
        // Outermost match wins: cards nest (a photo strip is itself glassy).
        const hits = cards.filter((c) => (c.textContent ?? "").toLowerCase().includes(needle));
        el = hits.find((c) => !hits.some((o) => o !== c && o.contains(c))) ?? hits[0] ?? null;
      } else {
        el = document.querySelector("#root") as HTMLElement | null;
      }
      if (!el) return false;
      el.setAttribute("data-state-region", "1");
      return true;
    },
    { mode, anchorText },
  );
}

/**
 * Extract the observation record from whatever `tagRegion` tagged.
 *
 * Every threshold in here is a REPORTING threshold, not a pass/fail one:
 *  - 1..12px edge spread is reported as a near-miss because a 0px spread is
 *    intentional alignment and a 40px spread is intentional indentation; the
 *    band in between is where "6px out" lives.
 *  - a >= 24px vertical run with nothing painted in it is reported because that
 *    is roughly one line of body copy — small enough to be a real gap, large
 *    enough not to be normal leading.
 *  - hue families are 30-degree buckets, which is about how wide "green" is to
 *    a reader.
 */
export async function observe(page: Page, consoleErrors: string[]): Promise<StateObservation> {
  const data = await page.evaluate(() => {
    const region = document.querySelector("[data-state-region]") as HTMLElement | null;
    if (!region) {
      return null as unknown as Omit<StateObservation, "consoleErrors">;
    }
    const rr = region.getBoundingClientRect();

    // --- colour --------------------------------------------------------
    const parse = (css: string): { h: number; s: number; l: number; a: number } | null => {
      const m = css.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      const [r, g, b] = parts;
      const a = parts.length > 3 ? parts[3] : 1;
      if ([r, g, b].some((n) => !Number.isFinite(n))) return null;
      const rn = r / 255, gn = g / 255, bn = b / 255;
      const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
      const l = (max + min) / 2;
      let h = 0, s = 0;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
        else if (max === gn) h = (bn - rn) / d + 2;
        else h = (rn - gn) / d + 4;
        h *= 60;
      }
      return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100), a };
    };

    const colorMap = new Map<string, { role: string; on: string; count: number }>();
    const noteColor = (css: string, role: string, on: string) => {
      if (!css || css === "rgba(0, 0, 0, 0)" || css === "transparent") return;
      const key = `${role}|${css}`;
      const cur = colorMap.get(key);
      if (cur) cur.count += 1;
      else colorMap.set(key, { role, on: on.slice(0, 40), count: 1 });
    };

    // HARD CAP. The overlap pass is O(n^2) and the colour pass calls
    // getComputedStyle per node; on a `main`-scoped region (#root, a few
    // thousand elements) that is minutes, not seconds, and the sweep's tests
    // simply timed out with no frame written and no explanation. A region worth
    // reviewing is a card or a dialog; when the fallback widens it to the whole
    // app, judging the first 1,500 elements is the right trade against judging
    // none of them.
    const NODE_CAP = 1500;
    const allNodes = [region, ...(Array.from(region.querySelectorAll("*")) as HTMLElement[])];
    const nodeCapHit = allNodes.length > NODE_CAP;
    const nodes = allNodes.slice(0, NODE_CAP);
    for (const n of nodes) {
      const b = n.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      const cs = getComputedStyle(n);
      const label = (n.textContent ?? "").trim().slice(0, 40) || n.tagName.toLowerCase();
      noteColor(cs.backgroundColor, "background", label);
      if ((n.textContent ?? "").trim() && n.children.length === 0) {
        noteColor(cs.color, "text", label);
      }
      if (cs.borderTopWidth !== "0px" || cs.borderLeftWidth !== "0px") {
        noteColor(cs.borderTopColor, "border", label);
      }
      // SVG icon strokes/fills carry the status colour on the tracker rail.
      if (n.tagName.toLowerCase() === "svg" || n.tagName.toLowerCase() === "path") {
        noteColor(cs.fill, "fill", label);
        noteColor(cs.stroke, "stroke", label);
      }
    }

    const colors = [...colorMap.entries()]
      .map(([key, v]) => {
        const css = key.split("|")[1];
        const p = parse(css);
        return p ? { css, ...p, role: v.role, on: v.on, count: v.count } : null;
      })
      .filter((c): c is NonNullable<typeof c> => !!c)
      // Ignore fully transparent and near-neutral greys — they are the page,
      // not a decision. Saturation >= 12 keeps every brand token in.
      .filter((c) => c.a > 0.05 && (c.s >= 12 || c.l < 12 || c.l > 96))
      .sort((a, b) => b.count - a.count);

    const FAMILY = (h: number, s: number, l: number) => {
      if (s < 12) return l < 50 ? "neutral-dark" : "neutral-light";
      const bucket = Math.floor(h / 30) * 30;
      const names: Record<number, string> = {
        0: "red", 30: "orange", 60: "yellow-olive", 90: "green-olive", 120: "green",
        150: "green-teal", 180: "teal", 210: "blue", 240: "indigo", 270: "violet",
        300: "magenta", 330: "pink",
      };
      return names[bucket] ?? `hue-${bucket}`;
    };
    const famMap = new Map<string, Set<string>>();
    for (const c of colors) {
      const f = FAMILY(c.h, c.s, c.l);
      if (!famMap.has(f)) famMap.set(f, new Set());
      famMap.get(f)!.add(`${c.css} (h${c.h} s${c.s} l${c.l} a${c.a}, ${c.role}, on "${c.on}")`);
    }
    const hueFamilies = [...famMap.entries()]
      .map(([family, m]) => ({ family, members: [...m] }))
      .filter((f) => f.members.length > 1)
      .sort((a, b) => b.members.length - a.members.length);

    // --- sibling colour splits ------------------------------------------
    const siblingColorSplits: { parent: string; families: string[]; members: string[] }[] = [];
    for (const parent of nodes) {
      const kids = [...parent.children] as HTMLElement[];
      if (kids.length < 2 || kids.length > 12) continue;
      const seen = new Map<string, string>();
      for (const k of kids) {
        const kb = k.getBoundingClientRect();
        if (kb.width < 6 || kb.height < 6) continue;
        // The painted colour of a step dot / chip may sit on the child itself
        // or on its single wrapper; take the first saturated one found.
        const candidates = [k, ...(Array.from(k.querySelectorAll("*")).slice(0, 4) as HTMLElement[])];
        for (const c of candidates) {
          const bg = getComputedStyle(c).backgroundColor;
          const p = parse(bg);
          if (!p || p.a < 0.5 || p.s < 20 || p.l > 92 || p.l < 8) continue;
          const fam = (() => {
            const bucket = Math.floor(p.h / 30) * 30;
            const names: Record<number, string> = {
              0: "red", 30: "orange", 60: "yellow-olive", 90: "green-olive", 120: "green",
              150: "green-teal", 180: "teal", 210: "blue", 240: "indigo", 270: "violet",
              300: "magenta", 330: "pink",
            };
            return names[bucket] ?? `hue-${bucket}`;
          })();
          if (!seen.has(fam)) {
            seen.set(fam, `${bg} (h${p.h} s${p.s} l${p.l}) on "${(k.textContent ?? k.tagName).trim().slice(0, 24)}"`);
          }
          break;
        }
      }
      if (seen.size > 1) {
        siblingColorSplits.push({
          parent: (parent.textContent ?? parent.tagName).trim().slice(0, 60),
          families: [...seen.keys()],
          members: [...seen.values()],
        });
      }
    }

    // --- alignment near-misses ------------------------------------------
    const boxes = nodes
      .map((n) => ({ n, b: n.getBoundingClientRect() }))
      .filter(({ b }) => b.width >= 8 && b.height >= 8 && b.width < rr.width + 2)
      .map(({ n, b }) => ({
        left: Math.round(b.left * 10) / 10,
        right: Math.round(b.right * 10) / 10,
        top: Math.round(b.top * 10) / 10,
        bottom: Math.round(b.bottom * 10) / 10,
        label: ((n.textContent ?? "").trim().slice(0, 28) || n.tagName.toLowerCase()),
      }));

    const cluster = (axis: "left" | "right") => {
      const vals = [...new Set(boxes.map((b) => b[axis]))].sort((a, b) => a - b);
      const out: { axis: string; values: number[]; spread: number; samples: string[] }[] = [];
      let run: number[] = [];
      for (const v of vals) {
        if (run.length && v - run[run.length - 1] > 12) {
          if (run.length > 1) {
            const spread = run[run.length - 1] - run[0];
            if (spread >= 1)
              out.push({
                axis,
                values: run,
                spread: Math.round(spread * 10) / 10,
                samples: boxes.filter((b) => run.includes(b[axis])).slice(0, 6).map((b) => `${b.label} @${b[axis]}`),
              });
          }
          run = [];
        }
        run.push(v);
      }
      if (run.length > 1) {
        const spread = run[run.length - 1] - run[0];
        if (spread >= 1)
          out.push({
            axis,
            values: run,
            spread: Math.round(spread * 10) / 10,
            samples: boxes.filter((b) => run.includes(b[axis])).slice(0, 6).map((b) => `${b.label} @${b[axis]}`),
          });
      }
      return out;
    };
    const nearMissAlignments = [...cluster("left"), ...cluster("right")]
      .filter((c) => c.spread >= 1 && c.spread <= 12)
      .sort((a, b) => b.values.length - a.values.length)
      .slice(0, 12);

    // --- empty bands ----------------------------------------------------
    // Walk the region top-to-bottom in 4px rows and mark rows that contain any
    // painted text/image/border pixel. A run of >= 24px of unmarked rows that
    // is not at the very top or bottom is a band with nothing in it.
    const painted: { top: number; bottom: number; label: string }[] = [];
    for (const n of nodes) {
      const hasInk =
        (n.children.length === 0 && (n.textContent ?? "").trim().length > 0) ||
        n.tagName === "IMG" ||
        n.tagName === "SVG" ||
        n.tagName === "svg";
      if (!hasInk) continue;
      const b = n.getBoundingClientRect();
      if (b.height < 1) continue;
      painted.push({ top: b.top, bottom: b.bottom, label: (n.textContent ?? n.tagName).trim().slice(0, 24) });
    }
    painted.sort((a, b) => a.top - b.top);
    const emptyBands: { top: number; height: number; above: string; below: string }[] = [];
    let cursor = rr.top;
    let prevLabel = "(top of region)";
    for (const p of painted) {
      if (p.top - cursor >= 24) {
        emptyBands.push({
          top: Math.round(cursor - rr.top),
          height: Math.round(p.top - cursor),
          above: prevLabel,
          below: p.label,
        });
      }
      if (p.bottom > cursor) {
        cursor = p.bottom;
        prevLabel = p.label;
      }
    }
    if (rr.bottom - cursor >= 24) {
      emptyBands.push({
        top: Math.round(cursor - rr.top),
        height: Math.round(rr.bottom - cursor),
        above: prevLabel,
        below: "(bottom of region)",
      });
    }

    // --- overlaps -------------------------------------------------------
    // Screen-reader-only elements are excluded. `JobCardShell` renders a
    // 44x44 `sr-only` toggle that is clipped to a single pixel visually but
    // still reports a full rect, so every expanded card produced two forged
    // "control overlaps the title" findings. A finding that cannot be seen in
    // the screenshot beside it is noise, and noise is what makes a reviewer
    // stop reading.
    const isVisuallyHidden = (n: HTMLElement) => {
      if (n.closest(".sr-only")) return true;
      const cs = getComputedStyle(n);
      return (
        cs.visibility === "hidden" ||
        cs.opacity === "0" ||
        (cs.clipPath !== "none" && cs.clipPath.includes("inset(50%)")) ||
        cs.clip === "rect(0px, 0px, 0px, 0px)"
      );
    };
    const interactive = nodes
      .filter(
        (n) =>
          n.matches("button, a[href], [role=button], input, select, textarea") ||
          (n.children.length === 0 && (n.textContent ?? "").trim().length > 0),
      )
      .filter((n) => !isVisuallyHidden(n))
      .map((n) => ({ n, b: n.getBoundingClientRect() }))
      .filter(({ b }) => b.width >= 6 && b.height >= 6)
      .slice(0, 350); // O(n^2) below — 350 pairs is 61k comparisons, not 4M
    const overlaps: { a: string; b: string; area: number }[] = [];
    for (let i = 0; i < interactive.length && overlaps.length < 20; i++) {
      for (let j = i + 1; j < interactive.length && overlaps.length < 20; j++) {
        const A = interactive[i], B = interactive[j];
        if (A.n.contains(B.n) || B.n.contains(A.n)) continue;
        const x = Math.min(A.b.right, B.b.right) - Math.max(A.b.left, B.b.left);
        const y = Math.min(A.b.bottom, B.b.bottom) - Math.max(A.b.top, B.b.top);
        if (x > 2 && y > 2) {
          overlaps.push({
            a: (A.n.textContent ?? A.n.tagName).trim().slice(0, 28) || A.n.tagName,
            b: (B.n.textContent ?? B.n.tagName).trim().slice(0, 28) || B.n.tagName,
            area: Math.round(x * y),
          });
        }
      }
    }

    // --- sections, actions, copy ---------------------------------------
    const sections = (
      Array.from(
        region.querySelectorAll("h1,h2,h3,h4,h5,h6,[data-eyebrow],legend,[role=heading]"),
      ) as HTMLElement[]
    ).map((n) => ({
      tag: n.tagName.toLowerCase(),
      text: (n.textContent ?? "").trim().slice(0, 60),
      fontSize: parseFloat(getComputedStyle(n).fontSize),
      y: Math.round(n.getBoundingClientRect().top - rr.top),
    }));

    const actions = (Array.from(region.querySelectorAll("button, a[href], [role=button]")) as HTMLElement[])
      .map((n) => {
        const b = n.getBoundingClientRect();
        return {
          label: ((n.textContent ?? "").trim() || n.getAttribute("aria-label") || "").slice(0, 40),
          disabled: n.hasAttribute("disabled") || n.getAttribute("aria-disabled") === "true",
          width: Math.round(b.width),
          height: Math.round(b.height),
        };
      })
      .filter((a) => a.width > 0 && a.height > 0 && a.label);

    const copy: string[] = [];
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const t = (node.textContent ?? "").trim();
      if (t && copy[copy.length - 1] !== t) copy.push(t.slice(0, 120));
    }

    return {
      region: { x: Math.round(rr.x), y: Math.round(rr.y), width: Math.round(rr.width), height: Math.round(rr.height) },
      colors: colors.slice(0, 40),
      hueFamilies,
      nearMissAlignments,
      emptyBands,
      overlaps,
      siblingColorSplits: siblingColorSplits.slice(0, 12),
      sections,
      actions,
      copy: copy.slice(0, 120),
      nodeCapHit,
    };
  });

  if (!data) {
    return {
      region: null,
      colors: [],
      hueFamilies: [],
      nearMissAlignments: [],
      emptyBands: [],
      overlaps: [],
      siblingColorSplits: [],
      sections: [],
      actions: [],
      copy: [],
      consoleErrors,
    };
  }
  return { ...data, consoleErrors };
}
