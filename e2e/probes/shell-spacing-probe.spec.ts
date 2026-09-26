import { test, expect, type Page } from "../prodTest";
import { readShellSpacing } from "../prod-audit/shellSpacing";

/**
 * Q411: the shell-spacing probe must not swallow the gap it measures.
 *
 * `readShellSpacing` (e2e/prod-audit/shellSpacing.ts) finds the page title's
 * ROW by climbing up from the <h1>, then measures chrome→row and row→content.
 * It used to climb through any ancestor up to 64px tall. The Profile landing's
 * title has no back-button slot, so its row is the bare 25px <h1> and
 * PageHeader's `py-[var(--shell-gap)]` wrapper is only 49px: the probe climbed
 * into it and reported the 12px gaps as 0/0 — at every phone width, in every
 * vacuity run that touched a shell-spacing target (main's 36157861068 too),
 * while the page itself was correct.
 *
 * These pages are the three shapes, built with setContent (no app, no backend):
 *   - a bare-title row inside a 12px-padded wrapper (the Profile landing),
 *   - the same with a 44px back-button slot (every other PageHeader page),
 *   - a bare title padded 20px, which must READ 20: the fix may not blind the
 *     probe to real drift.
 * Runs on every PR and push in e2e-real-backend.yml's anon-surface leg.
 *
 * Shown able to fail: with the old height-only rule the first case reads 0/0.
 * @mutate e2e/prod-audit/shellSpacing.ts | && !padsY(row.parentElement)) row = row.parentElement;\n    block = row;\n    titleKind | ) row = row.parentElement;\n    block = row;\n    titleKind
 */

const H1 = `<h1 style="margin:0;font-size:20px;line-height:25px">Smoke Customer</h1>`;
const BACK_SLOT = `<span style="display:block;width:44px;height:44px;flex:none"></span>`;

function page(opts: { pad: number; backSlot: boolean }) {
  return `<!doctype html><html><head><style>body{margin:0}</style></head><body>
    <div id="header" style="padding:${opts.pad}px 20px">
      <div style="display:flex;align-items:center;gap:12px">${opts.backSlot ? BACK_SLOT : ""}<div style="min-width:0">${H1}</div></div>
    </div>
    <div id="hero" style="margin:0 20px;height:120px;background:#ddd;border-radius:12px">Baton Rouge, LA</div>
    <div style="margin:12px 20px 0;height:300px;background:#eee">Settings</div>
  </body></html>`;
}

async function measure(p: Page, html: string) {
  await p.setViewportSize({ width: 375, height: 812 });
  await p.setContent(html);
  return p.evaluate(readShellSpacing);
}

test.describe("shell-spacing probe (Q411)", () => {
  test("a bare title row (no back slot) in a padded header reads its real 12/12", async ({ page: p }) => {
    const r = await measure(p, page({ pad: 12, backSlot: false }));
    expect(r.title).toBe("Smoke Customer");
    expect(r.titleKind).toBe("row");
    expect([r.headerToTitle, r.titleToContent], "chrome→title / title→content, px").toEqual([12, 12]);
  });

  test("a title row with a 44px back slot reads 12/12 (unchanged shape)", async ({ page: p }) => {
    const r = await measure(p, page({ pad: 12, backSlot: true }));
    expect([r.headerToTitle, r.titleToContent]).toEqual([12, 12]);
  });

  test("real drift still moves the number: a 20px pad reads 20/20", async ({ page: p }) => {
    const r = await measure(p, page({ pad: 20, backSlot: false }));
    expect([r.headerToTitle, r.titleToContent]).toEqual([20, 20]);
  });
});
