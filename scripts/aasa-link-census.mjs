#!/usr/bin/env node
/**
 * AASA coverage census — which prod links actually open the app?
 *
 * WHY THIS EXISTS
 * ---------------
 * A universal link that is not claimed by the AASA `paths` list does not
 * error. It opens Safari. The user sees a working web page, the app is never
 * involved, and nothing anywhere records that the deep link missed. So the
 * path list rots silently: routes get added, notifications start pointing at
 * them, and the AASA never learns. The only way to know the list is right is
 * to compare it against the links the platform actually sends.
 *
 * On 2026-08-31 that comparison found the AASA covered 217 of 1611 non-null
 * prod notification links (13.5%). 1394 opened Safari; 858 of those were
 * non-admin, i.e. real user destinations. The single largest miss was
 * /dashboard?quickApply= at 485 rows — 30% of every notification ever sent.
 * Nothing was broken, nothing was logged, and no test could have caught it,
 * because "opens the wrong app" is invisible to both the client and the server.
 *
 * WHAT IT DOES
 * ------------
 * Reads every `notifications.link` row from prod (read-only, service-role),
 * normalises UUIDs out of the paths, groups by link shape, and replays each
 * shape through the same matcher Apple uses (ordered, first-match-wins, `*`
 * matches any characters including `/`, `?` matches one, `NOT ` excludes).
 *
 * HOW TO READ THE OUTPUT
 * ----------------------
 *   matched   -> opens the app. Good.
 *   excluded  -> a NOT rule caught it. Deliberate (admin, api, auth).
 *   unmatched -> OPENS SAFARI. Every row here is a deep link that misses.
 *
 * An `unmatched` row is not automatically a bug — /reset-password and
 * /account-pending are unmatched ON PURPOSE (their session arrives in the URL
 * fragment, which src/lib/deepLinkRoute.ts drops, so claiming them would
 * strand the user). But every unmatched shape must be a decision someone
 * made, not a shape nobody noticed.
 *
 * NOTE ON QUERY STRINGS: Apple matches on PATH ONLY. `/dashboard` covers
 * `/dashboard?quickApply=<id>` and every other param variant. That is why the
 * claim list is far shorter than the list of distinct link shapes below.
 *
 * USAGE
 *   node scripts/aasa-link-census.mjs [path-to-aasa]
 * Requires VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env (prod).
 * Read-only: it issues a single paginated SELECT and writes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
// The Supabase CLI is linked to STAGING; .env is PROD. Print which one we read
// so a census is never mistaken for the wrong project's traffic.
console.log("project:", SUPABASE_URL.replace(/^https:\/\/([a-z0-9]+)\..*/, "$1"));

const rows = [];
for (let offset = 0; ; offset += 1000) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/notifications?select=link&order=created_at.asc&limit=1000&offset=${offset}`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
  );
  if (!res.ok) {
    console.error("HTTP", res.status, await res.text());
    process.exit(1);
  }
  const batch = await res.json();
  rows.push(...batch);
  if (batch.length < 1000) break;
}
console.log("notification rows:", rows.length);

const aasaPath = process.argv[2] || path.join(ROOT, "public/.well-known/apple-app-site-association");
const aasa = JSON.parse(fs.readFileSync(aasaPath, "utf8"));
const paths = aasa.applinks.details[0].paths;

// Apple's pattern semantics: `*` = any run of characters (including `/`),
// `?` = exactly one character. Everything else is literal.
const toRegExp = (pattern) =>
  new RegExp(
    "^" +
      pattern
        .split("")
        .map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
        .join("") +
      "$"
  );

/** Ordered, first-match-wins — the same evaluation Apple performs. */
function classify(pathname) {
  for (const entry of paths) {
    const isNot = entry.startsWith("NOT ");
    if (toRegExp(isNot ? entry.slice(4) : entry).test(pathname)) {
      return isNot ? "excluded" : "matched";
    }
  }
  return "unmatched";
}

const shapes = new Map();
let nullLinks = 0;
for (const { link } of rows) {
  if (!link) {
    nullLinks += 1;
    continue;
  }
  const [pathname, query] = link.split("?");
  const firstKey = query ? query.split("&")[0].split("=")[0] : null;
  const normalised = pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/<id>")
    .replace(/\/\d+(?=\/|$)/g, "/<n>");
  const key = normalised + (firstKey ? `?${firstKey}=` : "");
  const entry = shapes.get(key) || { count: 0, sample: pathname };
  entry.count += 1;
  shapes.set(key, entry);
}

let matched = 0;
let excluded = 0;
let unmatched = 0;
console.log("\ncount  status     link shape");
for (const [key, entry] of [...shapes].sort((a, b) => b[1].count - a[1].count)) {
  const status = classify(entry.sample);
  if (status === "matched") matched += entry.count;
  else if (status === "excluded") excluded += entry.count;
  else unmatched += entry.count;
  console.log(String(entry.count).padStart(5), status.padEnd(10), key);
}

const nonNull = rows.length - nullLinks;
console.log(`\nnull link: ${nullLinks}`);
console.log(`matched (opens the app): ${matched}  (${((matched / nonNull) * 100).toFixed(1)}%)`);
console.log(`excluded (deliberate):   ${excluded}`);
console.log(`unmatched (opens Safari): ${unmatched}  (${((unmatched / nonNull) * 100).toFixed(1)}%)`);
