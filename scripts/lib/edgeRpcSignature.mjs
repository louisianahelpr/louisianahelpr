/**
 * Q1418 (b): an edge function's `.rpc("name", { a, b })` must match a LIVE
 * overload of public.name by ARGUMENT NAMES, not only by function name.
 * PostgREST resolves an RPC by its parameter names: if db-deploy failed while
 * functions-deploy shipped, a new create-payment sending p_retired_session to
 * the old 3-argument redeem_gift_card answered PGRST202 on every gift tap, and
 * the name-only check (scripts/check-edge-rpcs-live.mjs) said OK.
 *
 * Pure helpers, so src/test/edgeRpcSignature.test.ts can run them on fixtures.
 */

/** Index of the brace that closes the `{` at `open`, skipping strings and comments. */
function closeBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (i++; i < src.length && src[i] !== q; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) return -1; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 1; if (i <= 0) return -1; continue; }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** The top-level keys of an object literal's text (without its braces); null if it spreads. */
export function objectKeys(body) {
  const keys = [];
  let depth = 0;
  let start = 0;
  const parts = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (i++; i < body.length && body[i] !== q; i++) if (body[i] === "\\") i++;
      continue;
    }
    // A comment may hold commas and apostrophes ("isn't"): skip it whole.
    if (c === "/" && body[i + 1] === "/") { const nl = body.indexOf("\n", i); i = nl < 0 ? body.length : nl; continue; }
    if (c === "/" && body[i + 1] === "*") { const end = body.indexOf("*/", i + 2); i = end < 0 ? body.length : end + 1; continue; }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  for (const raw of parts) {
    const p = raw.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!p) continue;
    if (p.startsWith("...")) return null;
    const m = /^["']?([A-Za-z_$][\w$]*)["']?\s*(?::|$)/.exec(p);
    if (!m) return null;
    keys.push(m[1]);
  }
  return keys;
}

/** Every `.rpc("name", ...)` call in `src`: {name, keys} (keys null = not a literal, unchecked; [] = no args). */
export function rpcCalls(src) {
  const out = [];
  for (const m of src.matchAll(/\.rpc\(\s*["'`]([a-z_][a-z_0-9]*)["'`]\s*(\)|,)/g)) {
    if (m[2] === ")") { out.push({ name: m[1], keys: [] }); continue; }
    const after = m.index + m[0].length;
    const rest = src.slice(after);
    const lead = /^\s*/.exec(rest)[0].length;
    if (rest[lead] !== "{") { out.push({ name: m[1], keys: null }); continue; }
    const open = after + lead;
    const close = closeBrace(src, open);
    out.push({ name: m[1], keys: close < 0 ? null : objectKeys(src.slice(open + 1, close)) });
  }
  return out;
}

/**
 * Whether a call with `keys` resolves to one of `overloads`
 * ([{ args: string[] (input names, in order), ndefaults: number }]):
 * every key is a parameter, and every parameter without a default is given.
 */
export function callMatches(keys, overloads) {
  return overloads.some(({ args, ndefaults }) => {
    const required = args.slice(0, Math.max(0, args.length - (ndefaults ?? 0)));
    return keys.every((k) => args.includes(k)) && required.every((a) => keys.includes(a));
  });
}

/** Calls (with literal keys) that match no live overload: [{name, keys, files}]. */
export function signatureMismatches(callsByFile, catalog) {
  const bad = new Map();
  for (const [file, calls] of callsByFile) {
    for (const c of calls) {
      if (c.keys === null) continue;
      const overloads = catalog.get(c.name);
      if (!overloads || overloads.length === 0) continue; // a missing NAME is the name check's to report
      if (callMatches(c.keys, overloads)) continue;
      const key = `${c.name}(${[...c.keys].sort().join(", ")})`;
      const hit = bad.get(key) ?? { name: c.name, keys: c.keys, files: [] };
      hit.files.push(file);
      bad.set(key, hit);
    }
  }
  return [...bad.values()];
}
