/**
 * CSP inline-script helpers (Q13, 2026-09-23).
 *
 * WHY: script-src used to carry 'unsafe-inline'. On 2026-09-23 that is what
 * turned a stored `javascript:` href into code execution in an admin session.
 * The sink was fixed (3c81624d0, dd4713c00); this removes the amplifier. With
 * no 'unsafe-inline', an inline script runs only if its exact bytes hash to a
 * 'sha256-…' source listed in the policy, and inline event handlers
 * (onload="…") and javascript: URLs do not run at all.
 *
 * Shared by scripts/check-csp-inline-scripts.mjs (post-build, dist/**.html)
 * and src/test/cspScriptSrc.test.ts (source HTML + vercel.json, no build).
 * Dependency-free on purpose: it runs inside `npm run build` on Vercel.
 */
import { createHash } from "node:crypto";

// Types the HTML spec executes (classic JS MIME types + module), plus the two
// inline JSON types that CSP still governs as scripts (importmap and
// speculationrules are checked against script-src). Anything else — notably
// application/ld+json — is a data block: never executed, not subject to
// script-src, so it needs no hash.
const JS_MIME = new Set([
  "",
  "module",
  "importmap",
  "speculationrules",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

function attr(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? "";
}

/**
 * Walk the HTML once, skipping comments, and yield every <script> element.
 * A regex tokenizer, not a parser: good enough for HTML we author and Vite
 * emits, and it errs toward REPORTING (a false positive fails the build
 * loudly; it never hides a script).
 */
export function scriptElements(html) {
  const out = [];
  const re = /<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("<!--")) continue;
    const attrs = m[1] ?? "";
    const body = m[2] ?? "";
    const type = (attr(attrs, "type") ?? "").trim().toLowerCase();
    const src = attr(attrs, "src");
    out.push({ attrs: attrs.trim(), body, type, src, executable: JS_MIME.has(type) });
  }
  return out;
}

/** Inline scripts the browser would execute — the ones script-src governs. */
export function inlineExecutableScripts(html) {
  return scriptElements(html).filter((s) => s.executable && s.src === null && s.body.length > 0);
}

export function sha256Source(body) {
  return `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;
}

/** Tags carrying an inline event-handler attribute (onload=, onclick=, …). */
export function inlineHandlers(html) {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  const found = [];
  for (const tag of stripped.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const h = /\s(on[a-z]+)\s*=/i.exec(tag[0]);
    if (h) found.push(`${h[1]} in ${tag[0].slice(0, 120)}`);
  }
  return found;
}

/** href/src/action/formaction attributes that are javascript: URLs. */
export function javascriptUrls(html) {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  return [...stripped.matchAll(/\s(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/gi)].map((m) => m[0].trim());
}

/** Tokens of the effective script-src (falls back to default-src, per spec). */
export function scriptSrcTokens(policy) {
  const directives = new Map();
  for (const part of policy.split(";")) {
    const [name, ...tokens] = part.trim().split(/\s+/);
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), tokens);
  }
  return directives.get("script-src") ?? directives.get("default-src") ?? [];
}

export const FORBIDDEN_SCRIPT_SRC = ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'strict-dynamic'"];

/**
 * Every problem that would make `html` either run injected script under
 * `policy` or break under it. Empty array = clean.
 */
export function checkHtmlAgainstPolicy(html, policy, label) {
  const problems = [];
  const tokens = scriptSrcTokens(policy);
  for (const bad of FORBIDDEN_SCRIPT_SRC) {
    if (tokens.includes(bad)) problems.push(`${label}: script-src contains ${bad}`);
  }
  for (const s of inlineExecutableScripts(html)) {
    const h = sha256Source(s.body);
    if (!tokens.includes(h)) {
      problems.push(
        `${label}: inline <script${s.attrs ? " " + s.attrs : ""}> starting ${JSON.stringify(s.body.trim().slice(0, 60))} ` +
          `has hash ${h}, which script-src does not list — it will be BLOCKED. Add the hash to the policy.`,
      );
    }
  }
  for (const h of inlineHandlers(html)) problems.push(`${label}: inline event handler ${h} — blocked without 'unsafe-inline'`);
  for (const u of javascriptUrls(html)) problems.push(`${label}: javascript: URL (${u}) — blocked without 'unsafe-inline'`);
  return problems;
}

/** The CSP a <meta http-equiv> in `html` declares, or null. */
export function metaCsp(html) {
  const tag = /<meta\s+[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i.exec(html.replace(/<!--[\s\S]*?-->/g, ""));
  if (!tag) return null;
  return attr(tag[0].replace(/^<meta/i, ""), "content");
}

/** The CSP header vercel.json applies to every path (source "/(.*)"). */
export function vercelCsp(vercelJson) {
  for (const block of vercelJson.headers ?? []) {
    if (block.source !== "/(.*)") continue;
    const h = (block.headers ?? []).find((x) => x.key.toLowerCase() === "content-security-policy");
    if (h) return h.value;
  }
  return null;
}
