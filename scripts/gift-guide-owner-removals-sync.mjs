#!/usr/bin/env node
/**
 * Owner removals by tap (11-20): reads ~/.lh-shots/gg-owner-removals-1120/<guide>.json ({keys, note}, maybe under
 * `data`) and writes scripts/gift-guide-owner-removals-1120.json, the list gift-guide-picks.mjs applies on every run
 * so a regenerate never brings a tapped item back. Entries only ever get added here (a guide file that shrinks keeps
 * its earlier keys). Run by hand after the owner taps more; the generator itself never reads the home folder.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = process.argv[2] ?? join(homedir(), ".lh-shots/gg-owner-removals-1120");
const out = new URL("./gift-guide-owner-removals-1120.json", import.meta.url);
/** Guides that no longer exist (owner 11-20: "remove the color guides"). */
const SKIP = new Set(["gifts-by-color"]);
const keyOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const names = new Map();
const walk = (v) => {
  if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === "object") { if (typeof v.name === "string") names.set(keyOf(v.name), v.name); Object.values(v).forEach(walk); }
};
if (existsSync(join(dir, "_page-data.json"))) walk(JSON.parse(readFileSync(join(dir, "_page-data.json"), "utf8")));
const spec = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : { removals: {} };
let added = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && !x.startsWith("_")).sort()) {
  const guide = f.replace(/\.json$/, "");
  if (SKIP.has(guide)) continue;
  const raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const keys = (raw.data ?? raw).keys ?? [];
  if (!keys.length) continue;
  const have = (spec.removals[guide] ??= []);
  for (const key of keys) if (!have.some((r) => r.key === key)) { have.push({ key, name: names.get(key) ?? key }); added += 1; }
}
for (const g of SKIP) delete spec.removals[g];
spec.removals = Object.fromEntries(Object.entries(spec.removals).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(out, `${JSON.stringify(spec, null, 1)}\n`);
console.log(`owner removals: ${added} added; ${Object.entries(spec.removals).map(([g, r]) => `${g} ${r.length}`).join(", ")}`);
