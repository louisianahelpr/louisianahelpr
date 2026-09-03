import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFreshBundle } from "./assertFreshBundle";

/**
 * THE POPUP FOOTER, MEASURED — because two consecutive footer bugs shipped past
 * a fully green suite, and in both cases the class the tests asserted WAS the
 * bug.
 *
 *   1. `min-w-0` + `shrink-0` on the dismiss. A contradiction where shrink-0
 *      wins, so "Keep Account" could not shrink and rendered as "Keep Accoun"
 *      with the commit overlapping it. Thirteen dialogs shipped that way.
 *   2. The fix for (1) set both actions to `flex-1 min-w-0` and called it equal
 *      width. `flex-1` is `flex: 1 1 0%`, and under border-box a ZERO basis
 *      floors at padding+border — so `px-0` vs `px-6` made the commit exactly
 *      48px wider at every viewport while both declared identical flex. The
 *      clipping moved from the dismiss to the commit.
 *
 * Every existing assertion is on source text. Source text cannot see either of
 * those. So this one renders the real classes against the REAL SHIPPED CSS and
 * reads geometry back.
 *
 * THE THIRD BUG, which only this file could have caught: the repaired classes
 * were still inert. `index.css` carries a global HIG tap-target floor —
 *
 *     button:not([role=checkbox]):not([role=radio]):not([role=switch]),
 *     [role=button], … { min-width: 44px; min-height: 44px }
 *
 * — whose specificity is (0,3,1) against `.min-w-max`'s (0,1,0). So
 * `min-width` computed to 44px, the row never wrapped, and long labels clipped
 * exactly as before. Measured, not deduced: `minWidth: "44px"` came back from
 * getComputedStyle. The class list looked completely correct. Hence `!min-w-max`
 * — and note the tap target survives anyway, because max-content on a button
 * with 32-48px of horizontal padding is always well over 44px.
 *
 * WHAT THE FOOTER IS SUPPOSED TO DO — one rule, keyed on content, not on a
 * breakpoint: side by side in equal halves when both labels fit in half the
 * card, stacked full-width when either does not, commit on top when stacked.
 * That is a two-action UIAlertController.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Read the real class strings out of the source, so this cannot drift from it. */
function footerClasses() {
  const src = readFileSync(join(REPO, "src/components/ui/popupFooter.ts"), "utf8");
  const grab = (name: string) => {
    const m = new RegExp(`${name}\\s*=\\s*([\\s\\S]*?);`).exec(src);
    if (!m) throw new Error(`${name} not found — popupFooter.ts has been restructured`);
    return (m[1].match(/"([^"]*)"/g) ?? []).map((s) => s.slice(1, -1)).join("");
  };
  return {
    row: grab("POPUP_FOOTER_ROW"),
    secondary: grab("POPUP_SECONDARY_CLS"),
    commit: grab("POPUP_COMMIT_CLS"),
  };
}

/** The Button base + default size, likewise read rather than restated. */
function buttonBase() {
  const src = readFileSync(join(REPO, "src/components/ui/button.tsx"), "utf8");
  const base = /"(squircle inline-flex[^"]*)"/.exec(src)?.[1];
  const size = /default:\s*"([^"]*h-14[^"]*)"/.exec(src)?.[1];
  if (!base || !size) throw new Error("button.tsx base/size classes not found");
  return `${base} ${size}`;
}

/**
 * The labels, DERIVED FROM THE CALL SITES rather than hand-listed.
 *
 * A list that is both the test's input and its definition of correctness cannot
 * fail for a missing member — the defect this audit hit nine separate times. So
 * the labels are extracted from the components that actually render them.
 */
function realLabels() {
  const commits = new Set<string>();
  const dismisses = new Set<string>();
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx") && !/\.test\./.test(e.name)) files.push(p);
    }
  };
  walk(join(REPO, "src"));
  // Brace-aware, because a plain `<XAction[^>]*>` regex FAILS IN THE DIRECTION
  // THAT HIDES BUGS: nearly every call site carries an
  // `onClick={() => setThing(null)}`, and the `>` of the arrow closes the match
  // early. The "label" then comes back as `setShowConfirmDialog(false)}>Cancel`
  // — 35 characters, which of course escapes the card, so the first run of this
  // spec reported 14 defects that do not exist. A test whose first run is all
  // false positives gets its thresholds relaxed until it is quiet.
  const childLabel = (src: string, tag: string): string[] => {
    const out: string[] = [];
    const open = new RegExp(`<(Dialog|Sheet)${tag}Action\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = open.exec(src))) {
      let i = m.index + m[0].length;
      let depth = 0;
      let quote = "";
      for (; i < src.length; i++) {
        const ch = src[i];
        if (quote) {
          if (ch === quote) quote = "";
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") quote = ch;
        else if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (ch === ">" && depth === 0) break;
      }
      if (i >= src.length || src[i - 1] === "/") continue;
      const close = src.indexOf(`</${m[1]}${tag}Action>`, i);
      if (close === -1) continue;
      const inner = src.slice(i + 1, close).trim().replace(/\s+/g, " ");
      // Dynamic children (an expression, a nested icon) are skipped rather than
      // guessed at — there is no static text to measure.
      if (!inner || inner.includes("{") || inner.includes("<")) continue;
      out.push(inner);
    }
    return out;
  };

  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const l of childLabel(src, "Secondary")) dismisses.add(l);
    for (const l of childLabel(src, "Primary")) commits.add(l);
    for (const l of childLabel(src, "Destructive")) commits.add(l);
    for (const m of src.matchAll(/secondaryLabel=\{?"([^"]{1,40})"/g)) dismisses.add(m[1]);
    for (const m of src.matchAll(/primaryLabel=\{?"([^"]{1,40})"/g)) commits.add(m[1]);
  }
  return { commits: [...commits], dismisses: [...dismisses] };
}

// Phones first, then the widths where the row should hold.
const WIDTHS = [320, 375, 393, 430, 768, 1440];

test("popup footers fit at every width, in equal halves or stacked", async ({ page, baseURL }) => {
  await assertFreshBundle(baseURL ?? "");

  const { row, secondary, commit } = footerClasses();
  const base = buttonBase();
  const { commits, dismisses } = realLabels();

  // The derivation must actually find things, or this passes vacuously — the
  // exact failure mode it exists to prevent.
  expect(commits.length, "extracted no commit labels — the call sites changed shape").toBeGreaterThan(8);
  expect(dismisses.length, "extracted no dismiss labels").toBeGreaterThan(3);

  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  // Inject every real pairing into the live page, so the CSS is the shipped CSS.
  await page.evaluate(
    ({ row, secondary, commit, base, commits, dismisses }) => {
      const host = document.createElement("div");
      host.id = "footer-fit-harness";
      host.style.cssText = "position:absolute;top:0;left:0;right:0;z-index:99999;background:#fff";
      host.innerHTML = commits
        .flatMap((c) =>
          dismisses.map(
            (d) =>
              `<div class="fit-card" data-c="${c}" data-d="${d}" style="width:100%;padding:16px;box-sizing:border-box">
                 <div class="${row}">
                   <button class="${base} ${secondary}">${d}</button>
                   <button class="${base} ${commit}">${c}</button>
                 </div></div>`,
          ),
        )
        .join("");
      document.body.appendChild(host);
    },
    { row, secondary, commit, base, commits, dismisses },
  );

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      for (const card of document.querySelectorAll<HTMLElement>(".fit-card")) {
        const line = card.firstElementChild as HTMLElement;
        const [dismiss, commitEl] = [...line.children] as HTMLElement[];
        const lb = line.getBoundingClientRect();
        const db = dismiss.getBoundingClientRect();
        const cb = commitEl.getBoundingClientRect();
        const id = `"${card.dataset.d}" + "${card.dataset.c}"`;

        if (db.left < lb.left - 0.5 || db.right > lb.right + 0.5) out.push(`${id}: dismiss escapes the card`);
        if (cb.left < lb.left - 0.5 || cb.right > lb.right + 0.5) out.push(`${id}: commit escapes the card`);

        const sameLine = Math.abs(db.top - cb.top) < 2;
        if (sameLine && db.right > cb.left + 0.5) out.push(`${id}: the two buttons OVERLAP`);
        // Stacked: commit must be on top (flex-wrap-reverse).
        if (!sameLine && cb.top > db.top + 2) out.push(`${id}: stacked with the commit BELOW the dismiss`);
        // The spill: a label wider than the button drawn around it.
        if (dismiss.scrollWidth > dismiss.clientWidth + 1) out.push(`${id}: dismiss label is clipped`);
        if (commitEl.scrollWidth > commitEl.clientWidth + 1) out.push(`${id}: commit label is clipped`);
      }
      return out;
    });

    expect(problems.slice(0, 12), `popup footer defects at ${width}px`).toEqual([]);

    const hOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hOverflow, `the page scrolls sideways at ${width}px`).toBe(false);
  }

  // The mechanism itself, not just the absence of damage: at a phone width the
  // long labels MUST be stacking, and on a wide screen they must NOT be. If a
  // future change makes every footer stack (or none), the assertions above
  // would still pass while the design was gone.
  const stackedAt = async (width: number) => {
    await page.setViewportSize({ width, height: 900 });
    return page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>(".fit-card")].filter((c) => {
          const [d, x] = [...(c.firstElementChild as HTMLElement).children] as HTMLElement[];
          return Math.abs(d.getBoundingClientRect().top - x.getBoundingClientRect().top) >= 2;
        }).length,
    );
  };
  expect(await stackedAt(320), "no footer stacks at 320 — the wrap is inert again").toBeGreaterThan(0);
  expect(await stackedAt(1440), "footers are stacking on a desktop width").toBe(0);
});
