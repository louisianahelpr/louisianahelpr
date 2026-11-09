#!/usr/bin/env node
/**
 * Message gallery, part 2: every in-app notice wording (each notice row is also the push title/body, and decides
 * the SMS kind), pulled from the LIVE function bodies.
 *
 *   node scripts/test-lab/extract-notice-strings.mjs <declutter_notify.json> <insert_notifications.json> <edge-root> <out.json>
 *
 * Inputs are two read-only execute_sql exports (regexp_matches over pg_get_functiondef):
 *   - every declutter_notify(...) call: type, title literal, message expression
 *   - every INSERT INTO notifications (...) VALUES/SELECT ...: column list + values text
 * plus a scan of supabase/functions for notices written from edge functions (title:/message: literals).
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [dnPath, insPath, edgeRoot, outPath] = process.argv.slice(2);
const unwrap = (p) => {
  const raw = readFileSync(p, "utf8");
  const outer = JSON.parse(raw).result;
  const inner = outer.slice(outer.indexOf("["), outer.lastIndexOf("]") + 1);
  return JSON.parse(inner)[0].json_agg ?? [];
};

/** Split a SQL argument list at top-level commas (ignores commas in quotes and parens). */
function splitTop(s) {
  const out = [];
  let depth = 0, q = false, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === "'" && s[i + 1] === "'") { cur += "'"; i++; } else if (c === "'") q = false; continue; }
    if (c === "'") { q = true; cur += c; continue; }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const lit = (e) => {
  const m = /^'((?:[^']|'')*)'$/.exec((e ?? "").trim());
  return m ? m[1].replace(/''/g, "'") : null;
};
/** A readable form of a SQL text expression: literals kept, format() placeholders shown as {…}. */
function readable(e) {
  if (!e) return "";
  const l = lit(e);
  if (l !== null) return l;
  const f = /^format\(\s*'((?:[^']|'')*)'/i.exec(e.trim());
  if (f) return f[1].replace(/''/g, "'").replace(/%[sIL]/g, "{…}");
  // 'a' || x || 'b'
  if (e.includes("||") && splitConcat(e).every((p) => lit(p) !== null || /^[a-z_.()]+$/i.test(p))) return splitConcat(e).map((p) => lit(p) ?? "{…}").join("");
  // CASE / left(format(...)) / coalesce: every wording branch, joined. A variable alone stays {name}.
  const branches = [...e.matchAll(/'((?:[^']|''){12,})'/g)].map((m) => m[1].replace(/''/g, "'").replace(/%[sIL]/g, "{…}"));
  if (branches.length) return branches.join("  ‖  ");
  return `{${e.trim().slice(0, 80)}}`;
}
function splitConcat(e) {
  const parts = [];
  let q = false, depth = 0, cur = "";
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (q) { cur += c; if (c === "'" && e[i + 1] === "'") { cur += "'"; i++; } else if (c === "'") q = false; continue; }
    if (c === "'") { q = true; cur += c; continue; }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "|" && e[i + 1] === "|" && depth === 0) { parts.push(cur.trim()); cur = ""; i++; continue; }
    cur += c;
  }
  parts.push(cur.trim());
  return parts;
}

const rows = [];
for (const r of unwrap(dnPath)) {
  const args = splitTop(r.m);
  rows.push({ source: "sql", fn: r.f, via: "declutter_notify", type: r.ty, title: r.t.replace(/''/g, "'"), message: readable(args[0]), link: readable(args[1] ?? "") });
}
for (const r of unwrap(insPath)) {
  const cols = r.c.split(",").map((c) => c.trim());
  let v = r.v.trim();
  const isValues = /^VALUES/i.test(v);
  v = v.replace(/^(VALUES|SELECT)\s*/i, "");
  let exprs;
  if (isValues) {
    const inner = v.startsWith("(") ? v.slice(1, v.indexOf(")", 0) > 0 ? findClose(v, 0) : v.length) : v;
    exprs = splitTop(inner);
  } else {
    exprs = splitTop(v.split(/\sFROM\s/i)[0]);
  }
  const get = (name) => { const i = cols.indexOf(name); return i >= 0 ? exprs[i] : undefined; };
  rows.push({ source: "sql", fn: r.f, via: isValues ? "INSERT VALUES" : "INSERT SELECT", type: readable(get("type")), title: readable(get("title")), message: readable(get("message")), link: readable(get("link") ?? "") });
}
function findClose(s, open) {
  let depth = 0, q = false;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === "'" && s[i + 1] === "'") i++; else if (c === "'") q = false; continue; }
    if (c === "'") { q = true; continue; }
    if (c === "(") depth++;
    if (c === ")") { depth--; if (depth === 0) return i; }
  }
  return s.length;
}

// Edge functions: an object literal with title: '...' and message: '...' (or `...`) near a notifications write.
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  if (statSync(p).isDirectory()) return n === "node_modules" || n === "email-templates" ? [] : walk(p);
  return /\.(ts|tsx)$/.test(n) && !/test/i.test(n) ? [p] : [];
});
for (const file of walk(edgeRoot)) {
  const src = readFileSync(file, "utf8");
  if (!/notifications|create-notification|notifyUser|insertNotice|notify\(/.test(src)) continue;
  const re = /title:\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,\s*(?:body|message):\s*(['"`])((?:\\.|(?!\3).)*)\3/g;
  let m;
  while ((m = re.exec(src))) {
    rows.push({ source: "edge", fn: relative(edgeRoot, file), via: "edge literal", type: "", title: m[2].replace(/\$\{[^}]+\}/g, "{…}"), message: m[4].replace(/\$\{[^}]+\}/g, "{…}"), link: "" });
  }
}

// One row per distinct (type, title, message).
const seen = new Set();
const out = rows.filter((r) => r.title && !r.title.startsWith("{")).filter((r) => {
  const k = `${r.type}|${r.title}|${r.message}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
}).sort((a, b) => (a.type || "zz").localeCompare(b.type || "zz") || a.title.localeCompare(b.title));
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`${rows.length} raw, ${out.length} distinct notice wordings -> ${outPath}`);
