/**
 * The argument NAMES an edge function passes to each `.rpc("<name>", { ... })`
 * call, and whether a live overload would accept them (Q1418 (b)).
 *
 * PostgREST resolves an RPC by name AND by the named arguments in the body: a
 * call whose keys match no overload answers PGRST202 exactly as a missing
 * function does. Matching names alone let a deploy where functions-deploy
 * shipped and db-deploy failed pass check-edge-rpcs-live (create-payment sends
 * p_retired_session; the old 3-argument redeem_gift_card would refuse every
 * gift tap).
 */

/** Index just past the string / template / comment opening at `i`, or -1. */
function skipNonCode(src, i) {
  const c = src[i];
  if (c === '"' || c === "'" || c === "`") {
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === "\\") { j += 2; continue; }
      if (c === "`" && src[j] === "$" && src[j + 1] === "{") {
        const close = matchClose(src, j + 1);
        if (close < 0) return src.length;
        j = close + 1;
        continue;
      }
      if (src[j] === c) return j + 1;
      j++;
    }
    return src.length;
  }
  if (c === "/" && src[i + 1] === "/") {
    const nl = src.indexOf("\n", i);
    return nl < 0 ? src.length : nl;
  }
  if (c === "/" && src[i + 1] === "*") {
    const end = src.indexOf("*/", i + 2);
    return end < 0 ? src.length : end + 2;
  }
  return -1;
}

/** Index of the bracket closing the one at `open`, or -1. */
function matchClose(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const skip = skipNonCode(src, i);
    if (skip >= 0) { i = skip - 1; continue; }
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Top-level comma-separated entries of the object literal at `open` ('{'). */
function objectEntries(src, open, close) {
  const out = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const skip = skipNonCode(src, i);
    if (skip >= 0) { i = skip - 1; continue; }
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(src.slice(start, i));
      start = i + 1;
    }
  }
  out.push(src.slice(start, close));
  return out
    .map((e) => e.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim())
    .filter(Boolean);
}

/**
 * Every `.rpc("<name>"...)` call in `src`: `keys` is the list of argument
 * names, [] for a call with no arguments, or null when the source does not say
 * (a variable, a spread, a computed key).
 */
export function extractRpcCalls(src) {
  const calls = [];
  const re = /\.rpc\(\s*["'`]([a-z_][a-z_0-9]*)["'`]/g;
  for (const m of src.matchAll(re)) {
    const name = m[1];
    let i = m.index + m[0].length;
    while (/\s/.test(src[i] ?? "")) i++;
    if (src[i] === ")") { calls.push({ name, keys: [] }); continue; }
    if (src[i] !== ",") { calls.push({ name, keys: null }); continue; }
    i++;
    // Comments and whitespace between the comma and the argument.
    for (;;) {
      while (/\s/.test(src[i] ?? "")) i++;
      if (src[i] === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) { i = skipNonCode(src, i); continue; }
      break;
    }
    if (src[i] === ")") { calls.push({ name, keys: [] }); continue; }
    if (src[i] !== "{") { calls.push({ name, keys: null }); continue; }
    const close = matchClose(src, i);
    if (close < 0) { calls.push({ name, keys: null }); continue; }
    let keys = [];
    for (const entry of objectEntries(src, i, close)) {
      const km = entry.match(/^(?:["']([A-Za-z_$][\w$]*)["']|([A-Za-z_$][\w$]*))\s*(?::|$)/);
      if (!km || entry.startsWith("...")) { keys = null; break; }
      keys.push(km[1] ?? km[2]);
    }
    calls.push({ name, keys });
  }
  return calls;
}

/**
 * Whether some overload accepts a named call with exactly these keys, as
 * PostgREST resolves it: every key is an input argument name, and every input
 * argument without a default is among the keys. A lone unnamed json/jsonb
 * argument takes the whole body. Each overload: { args: string[] (input
 * argument names in order, "" when unnamed), required: number (how many
 * leading arguments have no default), types: string[] }.
 */
export function overloadAccepts(keys, overloads) {
  return overloads.some((o) => {
    if (o.args.length === 1 && o.args[0] === "" && /^jsonb?$/.test(o.types?.[0] ?? "")) return true;
    const names = new Set(o.args);
    if (!keys.every((k) => names.has(k))) return false;
    const given = new Set(keys);
    return o.args.slice(0, o.required).every((a) => given.has(a));
  });
}
