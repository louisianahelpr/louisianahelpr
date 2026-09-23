/**
 * The axe rule-set tag list every axe scan in this repo runs against.
 *
 * Q181 (docs/OPEN.md, overlaps Q71): extended 2026-09-23 from
 * wcag2a/2aa/21a/21aa to ALSO cover `wcag22aa` (WCAG 2.2 AA — the current
 * version, added 2023; the App Store/ADA direction is moving to it, not
 * staying on 2.1) and `best-practice` (axe's non-WCAG heuristics: empty
 * headings, empty table cells, redundant alt text — real defects axe can see
 * that no WCAG success criterion happens to name).
 *
 * ONE constant, imported everywhere an axe scan runs — the prod route sweep
 * (sweepCore.ts, via e2e/a11y-prod/a11y-prod.spec.ts +
 * .github/workflows/a11y-webkit-prod.yml) and the per-journey spot checks
 * (fixtures.ts checkA11y) — so the two cannot drift into two different rule
 * sets. Before this file they were two separately hardcoded four-tag arrays,
 * and neither had grown the WCAG 2.2 additions.
 *
 * Guarded by src/test/axeGateCoversWcag22aa.test.ts.
 */
export const AXE_TAGS: string[] = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
