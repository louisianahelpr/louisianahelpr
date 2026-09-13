#!/usr/bin/env node
/**
 * Diff two a11y sweep reports by rendering engine: what does WebKit report
 * that Chromium does not?
 *
 * WHY
 * ---
 * The app ships in WKWebView; every per-commit axe run is Chromium. A
 * violation that only WebKit produces (a focus ring WebKit does not paint, a
 * -apple-system text-scale quirk, a contrast difference from font rendering)
 * is structurally invisible to the whole rest of CI. This script is the one
 * place that asks the question directly, from two reports produced by the
 * same spec (e2e/a11y-prod/a11y-prod.spec.ts) on the two projects.
 *
 * USAGE
 *   node scripts/audit/a11y-engine-diff.mjs <chromium-report.json> <webkit-report.json>
 *       [--known scripts/audit/a11y-webkit-known.json] [--out webkit-only.json] [--json]
 *
 * EXIT
 *   0  no WebKit-only finding beyond the known list, and no stale known entry
 *   1  fresh WebKit-only findings, or a known entry that no longer reproduces
 *      (the list is only allowed to shrink — delete fixed entries)
 *   2  a report is missing or unreadable, or the two reports do not cover the
 *      same screens (a diff over different screen sets proves nothing)
 *
 * A "finding" is one of: an axe violation (screen|rule|first target), a
 * composited contrast failure (screen|text), a screen that rendered an error
 * boundary, a screen that failed to render, a layout overflow, a button
 * geometry mismatch. Each is keyed so the same defect on both engines cancels.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const wantJson = args.includes("--json");
const knownPath = opt("--known") ?? "scripts/audit/a11y-webkit-known.json";
const outPath = opt("--out");

if (files.length !== 2) {
  console.error("usage: a11y-engine-diff.mjs <chromium-report.json> <webkit-report.json> [--known file] [--out file] [--json]");
  process.exit(2);
}

function load(path) {
  if (!existsSync(path)) {
    console.error(`a11y-engine-diff: missing report ${path}`);
    process.exit(2);
  }
  const r = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(r.screens)) {
    console.error(`a11y-engine-diff: ${path} has no screens[]`);
    process.exit(2);
  }
  return r;
}

/** Every finding on one screen row, keyed so identical defects cancel across engines. */
export function findingsOf(screen) {
  const s = `${screen.name}|${screen.variant ?? "?"}`;
  const out = [];
  if (screen.status !== "ok") out.push({ key: `${s}|render`, kind: "render", detail: screen.error ?? screen.status, screen: screen.name, screenshot: screen.screenshot });
  if (screen.wrongScreen) out.push({ key: `${s}|wrong-screen`, kind: "wrong-screen", detail: screen.wrongScreen, screen: screen.name, screenshot: screen.screenshot });
  for (const v of screen.topViolations ?? []) {
    out.push({ key: `${s}|axe:${v.id}|${v.targets?.[0] ?? ""}`, kind: "axe", detail: `${v.id} (${v.impact}, ${v.nodes} node(s)) ${v.targets?.[0] ?? ""} ${v.detail?.[0] ?? ""}`.trim(), screen: screen.name, screenshot: screen.screenshot });
  }
  for (const c of screen.contrastFailures ?? []) {
    out.push({ key: `${s}|contrast|${(c.text ?? "").slice(0, 40)}`, kind: "contrast", detail: `${(c.text ?? "").slice(0, 40)} ${c.ratio ?? "?"}:1 ${c.selector ?? ""}`.trim(), screen: screen.name, screenshot: screen.screenshot });
  }
  for (const c of screen.contrastUnresolved ?? []) {
    out.push({ key: `${s}|contrast-undecided|${(c.text ?? "").slice(0, 40)}`, kind: "contrast-undecided", detail: (c.text ?? "").slice(0, 40), screen: screen.name, screenshot: screen.screenshot });
  }
  const l = screen.layout;
  if ((l?.overflowPx ?? 0) > 0) {
    out.push({ key: `${s}|overflow`, kind: "overflow", detail: `${l.overflowPx}px horizontal overflow; offenders: ${(l.overflowOffenders ?? []).slice(0, 3).join(", ")}`, screen: screen.name, screenshot: screen.screenshot });
  }
  for (const m of screen.buttonGeometry?.siblingMismatch ?? []) out.push({ key: `${s}|geometry|${m}`, kind: "geometry", detail: m, screen: screen.name, screenshot: screen.screenshot });
  for (const m of screen.buttonGeometry?.requestedNotRendered ?? []) out.push({ key: `${s}|size-class|${m}`, kind: "size-class", detail: m, screen: screen.name, screenshot: screen.screenshot });
  for (const d of screen.newTabDestinations ?? []) if (d.problem) out.push({ key: `${s}|new-tab|${d.href}`, kind: "new-tab", detail: `${d.href}: ${d.problem}`, screen: screen.name, screenshot: screen.screenshot });
  return out;
}

export function diff(chromium, webkit) {
  const cScreens = new Set(chromium.screens.map((x) => `${x.name}|${x.variant ?? "?"}`));
  const wScreens = new Set(webkit.screens.map((x) => `${x.name}|${x.variant ?? "?"}`));
  const onlyIn = (a, b) => [...a].filter((k) => !b.has(k));
  const coverage = { chromiumOnly: onlyIn(cScreens, wScreens), webkitOnly: onlyIn(wScreens, cScreens) };

  const cFind = new Map(chromium.screens.flatMap(findingsOf).map((f) => [f.key, f]));
  const wFind = new Map(webkit.screens.flatMap(findingsOf).map((f) => [f.key, f]));
  const webkitOnly = [...wFind.values()].filter((f) => !cFind.has(f.key));
  const chromiumOnly = [...cFind.values()].filter((f) => !wFind.has(f.key));
  const both = [...wFind.values()].filter((f) => cFind.has(f.key));
  return { coverage, webkitOnly, chromiumOnly, both, counts: { chromium: cFind.size, webkit: wFind.size } };
}

function main() {
  const chromium = load(files[0]);
  const webkit = load(files[1]);
  const known = existsSync(knownPath) ? JSON.parse(readFileSync(knownPath, "utf8")) : [];
  const knownKeys = new Set(known.map((k) => k.key));

  const d = diff(chromium, webkit);
  const fresh = d.webkitOnly.filter((f) => !knownKeys.has(f.key));
  const allowed = d.webkitOnly.filter((f) => knownKeys.has(f.key));
  const seen = new Set(d.webkitOnly.map((f) => f.key));
  const stale = known.filter((k) => !seen.has(k.key));

  if (outPath) writeFileSync(outPath, JSON.stringify({ ...d, fresh, allowed, stale }, null, 2));

  const coverageMismatch = d.coverage.chromiumOnly.length + d.coverage.webkitOnly.length;
  const ok = fresh.length === 0 && stale.length === 0 && coverageMismatch === 0;

  if (wantJson) {
    console.log(JSON.stringify({ ok, fresh, allowed, stale, chromiumOnly: d.chromiumOnly, both: d.both.length, counts: d.counts, coverage: d.coverage }, null, 2));
  } else {
    console.log(`a11y-engine-diff: chromium ${d.counts.chromium} finding(s), webkit ${d.counts.webkit}, shared ${d.both.length}`);
    if (coverageMismatch) {
      console.log(`\nSCREEN SETS DIFFER — the diff below is over the intersection only:`);
      for (const k of d.coverage.chromiumOnly) console.log(`  chromium swept, webkit did not: ${k}`);
      for (const k of d.coverage.webkitOnly) console.log(`  webkit swept, chromium did not: ${k}`);
    }
    console.log(`\nWebKit-only (${d.webkitOnly.length}; ${fresh.length} fresh, ${allowed.length} known):`);
    for (const f of fresh) console.log(`  ✗ ${f.kind.padEnd(18)} ${f.screen.padEnd(32)} ${f.detail}${f.screenshot ? `\n      ${f.screenshot}` : ""}`);
    for (const f of allowed) console.log(`  · ${f.kind.padEnd(18)} ${f.screen.padEnd(32)} ${f.detail} (known)`);
    if (stale.length) {
      console.log(`\nSTALE known entries (fixed? delete them — the list only shrinks):`);
      for (const k of stale) console.log(`  ${k.key}`);
    }
    if (d.chromiumOnly.length) {
      console.log(`\nChromium-only (${d.chromiumOnly.length}) — for the record, not gated here:`);
      for (const f of d.chromiumOnly.slice(0, 20)) console.log(`  · ${f.kind.padEnd(18)} ${f.screen.padEnd(32)} ${f.detail}`);
    }
    console.log(ok ? "\nOK: nothing WebKit reports that Chromium does not." : "\nFAIL: WebKit-only findings above need filing in docs/OPEN.md or fixing.");
  }
  process.exit(ok ? 0 : coverageMismatch && !fresh.length && !stale.length ? 2 : 1);
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) main();
