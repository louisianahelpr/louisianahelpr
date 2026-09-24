/**
 * Q62 expiry monitor: things that die silently on a date.
 *
 * Three parts, all pure except the readers:
 *   - evaluate(): one reading -> a status. The ONLY statuses are
 *       OK          expiry read, more than warnDays away
 *       DUE         expiry read, within warnDays          -> fails the run
 *       EXPIRED     expiry read, already past             -> fails the run
 *       NO_EXPIRY   the vendor issues it without an expiry date (stated, not measured)
 *       UNREADABLE  nothing could be read HERE (no secret, no network, no API, an
 *                   intercepting proxy, a manual item with no date recorded)
 *     UNREADABLE is never folded into OK: it is printed as its own line, counted
 *     in the summary, and fails the run when the inventory says CI can read it.
 *   - referencedNames()/referencedHosts(): what the repo actually depends on,
 *     derived from the tree, so the inventory can be proved exact two-way.
 *   - readers: one per read.method in scripts/audit/expiry-inventory.json.
 */
import { execFileSync } from "node:child_process";
import { X509Certificate, createPrivateKey, sign as cryptoSign } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";

export const DAY_MS = 86400000;
export const FAILING = new Set(["DUE", "EXPIRED"]);

/** @returns {{status:string, daysLeft:number|null}} */
export function classify(expiresAt, now, warnDays) {
  const t = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(String(expiresAt));
  if (!Number.isFinite(t)) return { status: "UNREADABLE", daysLeft: null };
  const daysLeft = Math.floor((t - now.getTime()) / DAY_MS);
  if (t <= now.getTime()) return { status: "EXPIRED", daysLeft };
  return { status: daysLeft <= warnDays ? "DUE" : "OK", daysLeft };
}

/**
 * reading: {expiresAt?:string|null, noExpiry?:boolean, detail:string, source?:string}
 * @returns {{id,label,status,expiresAt,daysLeft,detail,source,ciReadable}}
 */
export function evaluate(item, reading, now, warnDays) {
  const base = { id: item.id, label: item.label, ciReadable: !!item.ciReadable, source: reading?.source ?? item.sourceOfTruth };
  if (!reading) return { ...base, status: "UNREADABLE", expiresAt: null, daysLeft: null, detail: "no reader ran" };
  if (reading.noExpiry) return { ...base, status: "NO_EXPIRY", expiresAt: null, daysLeft: null, detail: reading.detail };
  if (!reading.expiresAt) return { ...base, status: "UNREADABLE", expiresAt: null, daysLeft: null, detail: reading.detail || "unreadable here" };
  const c = classify(reading.expiresAt, now, warnDays);
  const expiresAt = c.status === "UNREADABLE" ? null : new Date(reading.expiresAt).toISOString();
  return { ...base, ...c, expiresAt, detail: c.status === "UNREADABLE" ? `unparseable date ${JSON.stringify(reading.expiresAt)}` : reading.detail };
}

/**
 * Exit policy. DUE/EXPIRED always fail. With `ci`, an item the inventory marks
 * ciReadable that came back UNREADABLE fails too — the monitor went blind
 * where it promised to see.
 */
export function verdict(results, { ci = false } = {}) {
  const due = results.filter((r) => FAILING.has(r.status));
  const unreadable = results.filter((r) => r.status === "UNREADABLE");
  const blind = ci ? unreadable.filter((r) => r.ciReadable) : [];
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const parts = ["EXPIRED", "DUE", "UNREADABLE", "OK", "NO_EXPIRY"].filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`);
  return { fail: due.length > 0 || blind.length > 0, due, unreadable, blind, summary: `${results.length} items: ${parts.join(", ")}` };
}

export function renderReport(results, v, now, warnDays) {
  const lines = [
    `## Expiry monitor (${now.toISOString().slice(0, 16)}Z, warn at ${warnDays} days)`,
    "",
    `**${v.summary}**${v.fail ? " — FAILING" : ""}`,
    "",
    "| item | status | expires | days left | read from | detail |",
    "|---|---|---|---|---|---|",
  ];
  const order = { EXPIRED: 0, DUE: 1, UNREADABLE: 2, OK: 3, NO_EXPIRY: 4 };
  for (const r of [...results].sort((a, b) => order[a.status] - order[b.status] || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9))) {
    const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${cell(r.label)} | ${r.status}${r.status === "UNREADABLE" && r.ciReadable ? " (CI should read this)" : ""} | ${r.expiresAt?.slice(0, 10) ?? "—"} | ${r.daysLeft ?? "—"} | ${cell(r.source)} | ${cell(r.detail)} |`);
  }
  return lines.join("\n") + "\n";
}

// ── what the repo references ────────────────────────────────────────────────

function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

/** YAML/dotenv: drop whole-line comments and trailing ` # ...` comments. */
const stripHashComments = (src) => src.split("\n").map((l) => (/^\s*#/.test(l) ? "" : l.replace(/\s#.*$/, ""))).join("\n");

/**
 * Every secret/env NAME the repo depends on, with where each was seen:
 *   .github/workflows + .github/actions  `secrets.NAME` on non-comment lines
 *   supabase/functions                   Deno.env.get("NAME") / readEnv("NAME")
 *   .env.example                         NAME=... assignments
 * `blank` removes comments from TS sources (src/test/helpers/blankNonCode.ts
 * blankComments, passed in by the test; the CLI passes identity).
 * @returns {Map<string, string[]>}
 */
export function referencedNames(root, blank = (s) => s) {
  const out = new Map();
  const add = (name, where) => {
    if (!out.has(name)) out.set(name, []);
    if (!out.get(name).includes(where)) out.get(name).push(where);
  };
  for (const f of [...walk(join(root, ".github", "workflows"), (p) => /\.ya?ml$/.test(p)), ...walk(join(root, ".github", "actions"), (p) => /\.ya?ml$/.test(p))]) {
    for (const m of stripHashComments(readFileSync(f, "utf8")).matchAll(/secrets\.([A-Z][A-Z0-9_]+)/g)) add(m[1], f.slice(root.length + 1));
  }
  for (const f of walk(join(root, "supabase", "functions"), (p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p))) {
    for (const m of blank(readFileSync(f, "utf8")).matchAll(/(?:Deno\.env\.get|readEnv)\(\s*["']([A-Z][A-Z0-9_]+)["']/g)) add(m[1], f.slice(root.length + 1));
  }
  const envEx = join(root, ".env.example");
  if (existsSync(envEx)) for (const m of stripHashComments(readFileSync(envEx, "utf8")).matchAll(/^([A-Z][A-Z0-9_]+)=/gm)) add(m[1], ".env.example");
  return out;
}

/**
 * Every *.louisianahelpr.com host the SHIPPED surface references (tests and
 * docs excluded: a fixture URL is not a dependency).
 * @returns {Map<string, string[]>}
 */
export function referencedHosts(root) {
  const out = new Map();
  const files = [
    ...walk(join(root, "src"), (p) => /\.(ts|tsx|html|json|css)$/.test(p) && !/\.test\.tsx?$|\/test\//.test(p)),
    ...walk(join(root, "public"), (p) => /\.(html|json|txt|xml|webmanifest)$/.test(p) || /apple-app-site-association$/.test(p)),
    ...walk(join(root, "supabase", "functions"), (p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p)),
    ...walk(join(root, "ios", "App", "App"), (p) => /\.(plist|entitlements)$/.test(p)),
    ...["index.html", "vercel.json", "capacitor.config.ts"].map((f) => join(root, f)).filter(existsSync),
  ];
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(/(?<![a-z0-9.-])((?:[a-z0-9-]+\.)*louisianahelpr\.com)(?![a-z0-9-])/gi)) {
      const host = m[1].toLowerCase();
      if (!out.has(host)) out.set(host, []);
      const rel = f.slice(root.length + 1);
      if (!out.get(host).includes(rel)) out.get(host).push(rel);
    }
  }
  return out;
}

/**
 * Two-way diff of the inventory against the tree. Every list returned must be
 * empty for the inventory to be exact.
 */
export function inventoryDiff(inv, names, hosts, root) {
  const claimed = new Map();
  const dup = [];
  const claim = (n, by) => (claimed.has(n) ? dup.push(`${n} (${claimed.get(n)} and ${by})`) : claimed.set(n, by));
  for (const it of inv.items) for (const n of it.env ?? []) claim(n, it.id);
  for (const n of Object.keys(inv.undated ?? {})) claim(n, "undated");
  const itemHosts = new Set(inv.items.filter((i) => i.read?.method === "tls").map((i) => i.read.host));
  const missingLiteral = inv.items
    .filter((i) => i.literal)
    .filter((i) => !existsSync(join(root, i.literal.file)) || !readFileSync(join(root, i.literal.file), "utf8").includes(i.literal.text))
    .map((i) => `${i.id}: ${i.literal.text} not in ${i.literal.file}`);
  return {
    unclassified: [...names.keys()].filter((n) => !claimed.has(n)).sort(),
    unreferenced: [...claimed.keys()].filter((n) => !names.has(n)).sort(),
    duplicated: dup,
    hostsWithoutTls: [...hosts.keys()].filter((h) => !itemHosts.has(h)).sort(),
    tlsWithoutReference: [...itemHosts].filter((h) => !hosts.has(h)).sort(),
    missingLiteral,
  };
}

// ── readers ─────────────────────────────────────────────────────────────────

const errMsg = (e) => String(e?.message ?? e).split("\n")[0].slice(0, 200);

/** exp claim of a JWT, or null. Never returns the token. */
export function jwtExp(token) {
  const parts = String(token ?? "").trim().replace(/^"|"$/g, "").split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? new Date(payload.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

function dotenvValue(root, file, key) {
  const p = join(root, file);
  if (!existsSync(p)) return null;
  const m = new RegExp(`^${key}=["']?([^"'\\n]*)`, "m").exec(readFileSync(p, "utf8"));
  return m ? m[1] : null;
}

function readJwt(read, env, root) {
  const tried = [];
  const candidates = [];
  if (env[read.env]) candidates.push([env[read.env], `env ${read.env}`]);
  else tried.push(`env ${read.env} not set`);
  if (read.file) {
    const v = dotenvValue(root, read.file, read.env);
    if (v) candidates.push([v, `${read.file} ${read.env}`]);
    else tried.push(`${read.file} has no ${read.env}`);
  }
  const readings = candidates.map(([v, src]) => ({ exp: jwtExp(v), src })).filter((r) => r.exp);
  if (!readings.length) {
    return { expiresAt: null, detail: `unreadable here: ${[...tried, ...candidates.map(([, s]) => `${s} is not a JWT with exp`)].join("; ")}` };
  }
  readings.sort((a, b) => (a.exp < b.exp ? -1 : 1));
  return { expiresAt: readings[0].exp, source: `JWT exp (${readings.map((r) => r.src).join(" + ")})`, detail: readings.map((r) => `${r.src}: ${r.exp.slice(0, 10)}`).join("; ") };
}

/**
 * TLS: the certificate the host actually serves. Verified against Node's
 * BUNDLED public roots only (not NODE_EXTRA_CA_CERTS), so a re-terminating
 * proxy's certificate is reported UNREADABLE rather than mistaken for the
 * site's.
 */
export function readTls(host, { timeoutMs = 15000, connect = tls.connect } = {}) {
  return new Promise((resolve) => {
    const done = (r) => { try { sock.destroy(); } catch { /* already closed */ } resolve(r); };
    const sock = connect({ host, port: 443, servername: host, ca: tls.rootCertificates, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = sock.getPeerCertificate();
      const issuer = cert?.issuer ? [cert.issuer.O, cert.issuer.CN].filter(Boolean).join(" / ") : "unknown issuer";
      if (!sock.authorized) {
        return done({ expiresAt: null, detail: `unreadable here: served certificate not trusted by the public roots (${sock.authorizationError}; issuer ${issuer}) — an intercepting proxy, or a broken chain` });
      }
      if (!cert?.valid_to) return done({ expiresAt: null, detail: "unreadable here: no peer certificate" });
      done({ expiresAt: new Date(cert.valid_to).toISOString(), detail: `issuer ${issuer}; subject ${cert.subject?.CN ?? "?"}` });
    });
    sock.on("timeout", () => done({ expiresAt: null, detail: `unreadable here: TLS handshake timed out after ${timeoutMs} ms` }));
    sock.on("error", (e) => done({ expiresAt: null, detail: `unreadable here: ${errMsg(e)}` }));
  });
}

async function getJson(fetchFn, url, init = {}) {
  const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  return { status: res.status, json, headers: res.headers };
}

export async function readRdap(domain, fetchFn = fetch) {
  try {
    const tld = domain.split(".").pop();
    const boot = await getJson(fetchFn, "https://data.iana.org/rdap/dns.json");
    if (boot.status !== 200) return { expiresAt: null, detail: `unreadable here: IANA RDAP bootstrap answered ${boot.status}` };
    const svc = boot.json?.services?.find(([tlds]) => tlds.includes(tld));
    if (!svc) return { expiresAt: null, detail: `unreadable here: no RDAP service for .${tld}` };
    const base = svc[1][0].replace(/\/?$/, "/");
    const r = await getJson(fetchFn, `${base}domain/${domain}`);
    if (r.status !== 200) return { expiresAt: null, detail: `unreadable here: ${base} answered ${r.status}` };
    const ev = r.json?.events?.find((e) => e.eventAction === "expiration");
    if (!ev?.eventDate) return { expiresAt: null, detail: `unreadable here: RDAP record has no expiration event` };
    return { expiresAt: ev.eventDate, source: `RDAP ${base}`, detail: `registrar ${r.json?.entities?.find((e) => e.roles?.includes("registrar"))?.vcardArray?.[1]?.find((v) => v[0] === "fn")?.[3] ?? "?"}` };
  } catch (e) {
    return { expiresAt: null, detail: `unreadable here: ${errMsg(e)}` };
  }
}

function readP12(read, env) {
  const b64 = env[read.env];
  if (!b64) return { expiresAt: null, detail: `unreadable here: env ${read.env} not set` };
  const attempt = (legacy) =>
    execFileSync("sh", ["-c", `openssl pkcs12 ${legacy ? "-legacy " : ""}-nokeys -clcerts -passin env:LH_P12_PASS | openssl x509 -noout -enddate -subject`], {
      input: Buffer.from(b64, "base64"),
      env: { PATH: process.env.PATH, LH_P12_PASS: env[read.passwordEnv] ?? "" },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  let out = null, err = null;
  for (const legacy of [false, true]) {
    try { out = attempt(legacy); break; } catch (e) { err = e; }
  }
  if (!out) return { expiresAt: null, detail: `unreadable here: openssl could not open the .p12 (${errMsg(err?.stderr || err)})` };
  const end = /notAfter=(.+)/.exec(out)?.[1];
  const subj = /subject=.*?CN\s*=\s*([^,\n]+)/.exec(out)?.[1];
  return end ? { expiresAt: new Date(end).toISOString(), detail: `CN ${subj ?? "?"}` } : { expiresAt: null, detail: "unreadable here: no notAfter in the .p12" };
}

function readPem(read, env) {
  const pem = env[read.env];
  if (!pem) return { expiresAt: null, detail: `unreadable here: env ${read.env} not set (edge secret; not given to CI)` };
  try {
    const c = new X509Certificate(pem.replace(/\\n/g, "\n"));
    return { expiresAt: new Date(c.validTo).toISOString(), detail: c.subject.split("\n").find((l) => l.startsWith("CN=")) ?? "" };
  } catch (e) {
    return { expiresAt: null, detail: `unreadable here: ${errMsg(e)}` };
  }
}

/**
 * ASC key in any shape fastlane's Fastfile accepts: raw .p8/PEM (escaped
 * newlines allowed), base64 of it, or JSON holding one of key_content / key /
 * private_key / p8 / api_key. Set but in none of those shapes -> throws, so the
 * report says "set but unreadable" rather than "not set".
 */
function ascKey(env) {
  const set = [env.ASC_KEY_CONTENT, env.ASC_KEY_BASE64].filter(Boolean);
  for (let raw of set) {
    raw = raw.trim();
    if (raw.startsWith("{")) {
      try {
        const j = JSON.parse(raw);
        raw = ["key_content", "key", "private_key", "p8", "api_key"].map((k) => j[k]).find(Boolean) ?? raw;
      } catch { /* not JSON after all */ }
    }
    const txt = raw.includes("BEGIN") ? raw.replace(/\\n/g, "\n") : Buffer.from(raw, "base64").toString("utf8");
    if (txt.includes("BEGIN")) return txt;
  }
  if (set.length) throw new Error("ASC_KEY_CONTENT / ASC_KEY_BASE64 is set but is not a .p8 (raw, base64 or JSON)");
  return null;
}

export function ascToken(env, now = new Date()) {
  const pem = ascKey(env);
  if (!pem || !env.ASC_KEY_ID || !env.ASC_ISSUER_ID) return null;
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(now.getTime() / 1000);
  const head = enc({ alg: "ES256", kid: env.ASC_KEY_ID, typ: "JWT" });
  const body = enc({ iss: env.ASC_ISSUER_ID, iat, exp: iat + 600, aud: "appstoreconnect-v1" });
  const sig = cryptoSign("sha256", Buffer.from(`${head}.${body}`), { key: createPrivateKey(pem), dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${sig.toString("base64url")}`;
}

async function readAsc(read, env, fetchFn) {
  let token;
  try { token = ascToken(env); } catch (e) { return { expiresAt: null, detail: `unreadable here: ASC key would not load (${errMsg(e)})` }; }
  if (!token) return { expiresAt: null, detail: "unreadable here: ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_CONTENT (or ASC_KEY_BASE64) not all set" };
  const url = read.resource === "profiles"
    ? "https://api.appstoreconnect.apple.com/v1/profiles?filter[profileState]=ACTIVE&limit=200&fields[profiles]=name,profileType,expirationDate"
    : `https://api.appstoreconnect.apple.com/v1/certificates?filter[certificateType]=${read.types.join(",")}&limit=200&fields[certificates]=name,certificateType,expirationDate,displayName`;
  try {
    const r = await getJson(fetchFn, url, { headers: { authorization: `Bearer ${token}` } });
    if (r.status !== 200) return { expiresAt: null, detail: `unreadable here: App Store Connect answered ${r.status}${r.json?.errors?.[0]?.title ? ` (${r.json.errors[0].title})` : ""}` };
    const rows = (r.json?.data ?? []).map((d) => ({ name: d.attributes?.name ?? d.attributes?.displayName ?? d.id, type: d.attributes?.profileType ?? d.attributes?.certificateType, exp: d.attributes?.expirationDate })).filter((x) => x.exp);
    if (!rows.length) return { expiresAt: null, detail: `unreadable here: App Store Connect returned no ${read.resource} with an expirationDate` };
    rows.sort((a, b) => (a.exp < b.exp ? -1 : 1));
    return { expiresAt: rows[0].exp, detail: `${rows.length} ${read.resource}; soonest ${rows[0].type} "${rows[0].name}"; ${rows.slice(1, 4).map((x) => `${x.type} ${String(x.exp).slice(0, 10)}`).join(", ")}` };
  } catch (e) {
    return { expiresAt: null, detail: `unreadable here: ${errMsg(e)}` };
  }
}

async function readVercel(read, env, fetchFn) {
  if (!env[read.env]) return { expiresAt: null, detail: `unreadable here: env ${read.env} not set` };
  try {
    const url = "https://api.vercel.com/v5/user/tokens/current";
    const init = { headers: { authorization: `Bearer ${env[read.env]}` } };
    let r = await getJson(fetchFn, url, init);
    // A team-scoped token is looked up on behalf of its team.
    if (r.status === 404 && read.teamId) r = await getJson(fetchFn, `${url}?teamId=${read.teamId}`, init);
    if (r.status !== 200) return { expiresAt: null, detail: `unreadable here: Vercel answered ${r.status}${r.json?.error?.code ? ` (${r.json.error.code}: ${String(r.json.error.message ?? "").slice(0, 120)})` : ""}` };
    const t = r.json?.token;
    if (t && t.expiresAt == null && "expiresAt" in t) return { noExpiry: true, detail: `Vercel reports no expiresAt for token "${t.name ?? t.id}" (measured)` };
    return t?.expiresAt ? { expiresAt: new Date(t.expiresAt).toISOString(), detail: `token "${t.name ?? t.id}"` } : { expiresAt: null, detail: "unreadable here: unexpected Vercel response shape" };
  } catch (e) {
    return { expiresAt: null, detail: `unreadable here: ${errMsg(e)}` };
  }
}

async function readMeta(read, env, fetchFn) {
  const tok = env[read.env], id = env[read.appIdEnv], sec = env[read.appSecretEnv];
  if (!tok || !id || !sec) return { expiresAt: null, detail: `unreadable here: ${read.env} / ${read.appIdEnv} / ${read.appSecretEnv} not all set (edge secrets; not given to CI)` };
  try {
    const u = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(tok)}&access_token=${encodeURIComponent(`${id}|${sec}`)}`;
    const r = await getJson(fetchFn, u);
    const d = r.json?.data;
    if (r.status !== 200 || !d) return { expiresAt: null, detail: `unreadable here: Graph API answered ${r.status}` };
    if (d.is_valid === false) return { expiresAt: new Date(0).toISOString(), detail: "Graph API says the token is INVALID now" };
    const exps = [d.expires_at, d.data_access_expires_at].filter((x) => typeof x === "number" && x > 0);
    if (!exps.length) return { noExpiry: true, detail: "Graph API: expires_at 0 (never), no data-access expiry (measured)" };
    return { expiresAt: new Date(Math.min(...exps) * 1000).toISOString(), detail: `expires_at ${d.expires_at}, data_access_expires_at ${d.data_access_expires_at}` };
  } catch (e) {
    return { expiresAt: null, detail: `unreadable here: ${errMsg(e)}` };
  }
}

async function readAppleSignin(read, env, fetchFn) {
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_PROJECT_REF) return { expiresAt: null, detail: "unreadable here: SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set" };
  try {
    const r = await getJson(fetchFn, `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/config/auth`, { headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } });
    if (r.status !== 200) return { expiresAt: null, detail: `unreadable here: Management API answered ${r.status}` };
    if (!r.json?.external_apple_enabled) return { noExpiry: true, detail: "Apple provider is disabled in Supabase Auth (measured) — nothing to expire" };
    const exp = jwtExp(r.json.external_apple_secret);
    if (exp) return { expiresAt: exp, detail: "exp of external_apple_secret" };
    // The Management API returns a 64-hex hash here, never the JWT (measured
    // 2026-09-24), so the exp can only come from the date the owner recorded.
    if (read.date) return { expiresAt: read.date, source: "manual", detail: `Apple provider enabled; owner recorded expiry on ${read.recorded ?? "?"} (the API masks the secret)` };
    return { expiresAt: null, detail: `unreadable: Apple provider is enabled but the Management API masks external_apple_secret (${r.json.external_apple_secret ? "a hash, not the JWT" : "empty"}) — record the secret's expiry as read.date in scripts/audit/expiry-inventory.json` };
  } catch (e) {
    return { expiresAt: null, detail: `unreadable here: ${errMsg(e)}` };
  }
}

/** One reading for one item. Never throws. */
export async function readItem(item, { env = process.env, root = process.cwd(), fetchFn = fetch, tlsConnect } = {}) {
  const r = item.read ?? {};
  try {
    switch (r.method) {
      case "tls": return await readTls(r.host, tlsConnect ? { connect: tlsConnect } : {});
      case "rdap": return await readRdap(r.domain, fetchFn);
      case "jwt-exp": return readJwt(r, env, root);
      case "x509-p12": return readP12(r, env);
      case "x509-pem": return readPem(r, env);
      case "asc-api": return await readAsc(r, env, fetchFn);
      case "vercel-token": return await readVercel(r, env, fetchFn);
      case "meta-debug-token": return await readMeta(r, env, fetchFn);
      case "supabase-auth-apple": return await readAppleSignin(r, env, fetchFn);
      case "no-expiry": return { noExpiry: true, source: item.sourceOfTruth, detail: `${r.reason} (vendor documentation, not measured)` };
      case "manual":
        if (r.date === "never") return { noExpiry: true, source: "manual", detail: `owner recorded "never" on ${r.recorded ?? "?"}` };
        if (r.date) return { expiresAt: r.date, source: "manual", detail: `owner recorded on ${r.recorded ?? "?"}` };
        return { expiresAt: null, source: "manual", detail: `unreadable: no API exposes this expiry and no date is recorded in scripts/audit/expiry-inventory.json (check ${item.sourceOfTruth})` };
      default: return { expiresAt: null, detail: `unreadable: unknown read.method ${JSON.stringify(r.method)}` };
    }
  } catch (e) {
    return { expiresAt: null, detail: `unreadable here: reader threw ${errMsg(e)}` };
  }
}

export const INVENTORY = "scripts/audit/expiry-inventory.json";
export const loadInventory = (root) => JSON.parse(readFileSync(join(root, INVENTORY), "utf8"));

export async function runAll(inv, now, opts = {}) {
  const warnDays = opts.warnDays ?? inv.warnDays ?? 30;
  const results = [];
  for (const item of inv.items) results.push(evaluate(item, await readItem(item, opts), now, warnDays));
  return { results, warnDays };
}

// ── scoreboard (docs/SCOREBOARD.md, scripts/scoreboard.mjs) ─────────────────

/** Deterministic at a commit: what the inventory holds and how each is read. */
export function inventoryCounts(inv) {
  const m = (i) => i.read?.method;
  const noDate = inv.items.filter((i) => m(i) === "manual" && !i.read.date).length;
  return {
    items: inv.items.length,
    measured: inv.items.filter((i) => !["manual", "no-expiry"].includes(m(i))).length,
    ciReadable: inv.items.filter((i) => i.ciReadable).length,
    noExpiry: inv.items.filter((i) => m(i) === "no-expiry").length,
    manualDated: inv.items.filter((i) => m(i) === "manual" && i.read.date).length,
    manualNoDate: noDate,
    undated: Object.keys(inv.undated ?? {}).length,
  };
}

const SB_STATUS = { OK: "PASS", DUE: "FAIL", EXPIRED: "FAIL", NO_EXPIRY: "INFO", UNREADABLE: "UNKNOWN" };

/** One LIVE scoreboard row per item. UNREADABLE is UNKNOWN with its reason — never PASS. */
export function scoreboardRows(results, at) {
  return results.map((r) => {
    const row = {
      group: "expiry", signal: r.label, status: SB_STATUS[r.status] ?? "UNKNOWN", pass: null, fail: null, skipped: null,
      total: r.expiresAt ? `${r.expiresAt.slice(0, 10)} (${r.daysLeft}d)` : null, at, source: `${r.source} · scripts/expiry-check.mjs`,
      note: `${r.status}: ${r.detail}`,
    };
    if (row.status === "UNKNOWN") row.note = `UNKNOWN: ${r.detail}${r.ciReadable ? " (expiry-monitor.yml reads it in CI)" : ""}`;
    return row;
  });
}
