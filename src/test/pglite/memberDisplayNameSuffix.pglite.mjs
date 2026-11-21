#!/usr/bin/env node
/**
 * PGlite proof for the suffix-aware member_display_name (Jobs audit 11-21, G9; migration 20261121233442_member_display_name_skips_suffixes.sql).
 *
 *   node src/test/pglite/memberDisplayNameSuffix.pglite.mjs
 *   LH_PROOF_REVERT=1 node src/test/pglite/memberDisplayNameSuffix.pglite.mjs   # must FAIL
 *
 * The migration is applied 3x (replay-safety) over the previous definition (the newest CREATE before
 * it, read from the migrations), then:
 *  1. the audit's names: "John Smith Jr." -> "John S.", "Tremaine Broussard II" -> "Tremaine B.",
 *     "Mary Ann Landry Sr" -> "Mary L.", "Jean-Baptiste Émile Arceneaux-Thibodeaux III" -> "Jean-Baptiste A.",
 *     "Jean-Baptiste (Seed 16)" -> "Jean-Baptiste"; and the edges (a suffix with a comma, "John Jr", a
 *     name that is only brackets, brackets mid-name);
 *  2. parity with BOTH client copies, imported (not copied): formatName (src/lib/utils.ts) and the edge
 *     functions' memberDisplayName, for those cases and 800 generated names mixing suffixes, brackets,
 *     every whitespace kind, accents and hyphens;
 *  3. idempotence: sql(sql(x)) === sql(x) and formatName(sql(x)) === formatName(x);
 *  4. every name with no suffix word and no bracket gives exactly what the PREVIOUS definition gave, and
 *     EVERY name keeps the previous output's first word and shows at most one more letter (never more of
 *     a name than before: lh-authz-rls review of the first draft, where "(Jane) Landry" became "Landry");
 *  5. grants: no EXECUTE for PUBLIC or anon; authenticated and service_role keep it.
 * Red: LH_PROOF_REVERT=1 skips the migration (the previous definition stays) and the proof fails.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import { formatName } from "../../lib/utils.ts"; // Node >= 23 strips the types; the real function, not a copy
import { memberDisplayName } from "../../../supabase/functions/_shared/memberDisplayName.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261121233442_member_display_name_skips_suffixes.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");

/** The newest CREATE FUNCTION statement for `name` in a migration before this one (any dollar-quote tag). */
function previous(name) {
  let last = null;
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql") && x < THIS).sort()) {
    const sql = readFileSync(DIR + f, "utf8");
    for (const m of sql.matchAll(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?"?${name}"?\\s*\\(`, "gi"))) {
      const rest = sql.slice(m.index);
      const open = /\bAS\s+(\$\w*\$)/i.exec(rest);
      if (!open) continue;
      const end = rest.indexOf(open[1], open.index + open[0].length);
      last = `${rest.slice(0, end + open[1].length)};`;
    }
  }
  if (!last) throw new Error(`no migration before ${THIS} defines ${name}`);
  return last;
}

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
};

const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
await db.exec(previous("member_display_name"));
const NONE = "\u0000none";
const sqlName = async (x) => (await db.query("SELECT public.member_display_name($1, NULL) AS d", [x])).rows[0].d;

// The previous rule's answers, before the migration (for check 4).
let seed = 20261121;
const rnd = (k) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % k);
const WS = [" ", "  ", "\t", "\n", "\u00a0", "\u2003", "\u3000", "\ufeff", "\u0085", "\u200b"];
const PARTS = ["Lexi", "Bea", "O'Neil", "Jean-Pierre", "é", "Ñúñez", "李", "محمد", "X", "de", "La", "Thibodeaux", "Ịch",
  "Jr", "Jr.", "jr.,", "Sr", "SR.", "II", "iii", "IV", "V", "V.", "Vi", "Junior", "(Seed 16)", "(he/him)", "(", ")", "Iv,"];
const generated = [];
for (let i = 0; i < 800; i++) {
  let s = rnd(4) === 0 ? WS[rnd(WS.length)] : "";
  const words = rnd(6);
  for (let w = 0; w < words; w++) s += (w ? WS[rnd(WS.length)] : "") + PARTS[rnd(PARTS.length)];
  if (rnd(4) === 0) s += WS[rnd(WS.length)];
  generated.push(s);
}
const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?,?$/i;
const untouched = (x) => !/[()]/.test(x) && !x.trim().split(/\s+/).slice(1).some((w) => SUFFIX.test(w));
const before = new Map();
const oldAll = new Map();
for (const x of [...generated, "(Jane) Landry", "( ) Landry", "(Mary Ann) Landry Broussard"]) {
  const was = await sqlName(x);
  oldAll.set(x, was);
  if (untouched(x)) before.set(x, was);
}

let replayErr = null;
if (!process.env.LH_PROOF_REVERT) {
  try {
    for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  } catch (e) {
    replayErr = e;
  }
}
check("the migration applies 3x (replay-safe)", replayErr === null, replayErr?.message);

// 1. The audit's names and the edges.
const FIXED = [
  ["John Smith Jr.", "John S."], ["Tremaine Broussard II", "Tremaine B."], ["Mary Ann Landry Sr", "Mary L."],
  ["Jean-Baptiste Émile Arceneaux-Thibodeaux III", "Jean-Baptiste A."], ["Jean-Baptiste (Seed 16)", "Jean-Baptiste"],
  ["John Smith, Jr.", "John S."], ["John Smith IV", "John S."], ["John Smith V", "John S."], ["John Jr", "John J."],
  ["John Smith Jr. III", "John S."], ["Ann (Annie) Doucet", "Ann D."],
  // The first word is never changed (lh-authz-rls review): a leading bracket stays, it never lets the surname lead.
  ["(Seed 3)", "(Seed 3."], ["  ( )  ", "( )."], ["(Jane) Landry", "(Jane) L."], ["( ) Landry", "( L."],
  ["(Mary Ann) Landry Broussard", "(Mary B."], ["Ann (Seed 3) (he/him)", "Ann"],
  ["Ann Vi", "Ann V."], ["Ann Junior", "Ann J."], ["Lexi Lombas", "Lexi L."], ["Madonna", "Madonna"], ["", null], [null, null],
  ["John S.", "John S."], ["Mary V.", "Mary V."], ["Bea\u00a0Thibodeaux\tJr", "Bea T."], ["Ann (unclosed Doucet", "Ann D."],
];
const fmt = (x) => {
  const f = formatName(x, NONE);
  return f === NONE ? null : f;
};
const edge = (x) => {
  const f = memberDisplayName(x, NONE);
  return f === NONE ? null : f;
};
for (const [x, want] of FIXED) {
  const got = await sqlName(x);
  check(`member_display_name(${JSON.stringify(x)}) = ${JSON.stringify(want)} = formatName = memberDisplayName`,
    got === want && fmt(x) === want && edge(x) === want, { got, formatName: fmt(x), memberDisplayName: edge(x) });
}

// 2 + 3. Parity and idempotence over the generated names.
const mismatches = [];
const notIdempotent = [];
for (const x of generated) {
  const got = await sqlName(x);
  if (got !== fmt(x) || got !== edge(x)) mismatches.push({ x, got, formatName: fmt(x), memberDisplayName: edge(x) });
  if (formatName(got) !== formatName(x)) notIdempotent.push({ x, got });
  if (got !== null && (await sqlName(got)) !== got) notIdempotent.push({ x, got, twice: await sqlName(got) });
}
check(`800 generated names: member_display_name === formatName === memberDisplayName`, mismatches.length === 0, mismatches.slice(0, 3));
check("idempotent: sql(sql(x)) === sql(x), formatName(sql(x)) === formatName(x)", notIdempotent.length === 0, notIdempotent.slice(0, 3));
check(`the generated names exercise both kinds (${generated.length - before.size} with a suffix or bracket, ${before.size} without)`,
  before.size > 100 && generated.length - before.size > 100);

// 4. No suffix, no bracket: exactly the previous answer.
const changed = [];
for (const [x, was] of before) {
  const now = await sqlName(x);
  if (now !== was) changed.push({ x, was, now });
}
check(`${before.size} names with no suffix word and no bracket: unchanged from the previous definition`, changed.length === 0, changed.slice(0, 3));

// Never more of a name than before: the same first word, and nothing after it but one letter and a dot.
const showsMore = [];
for (const [x, was] of oldAll) {
  const now = await sqlName(x);
  const first = (v) => (v ?? "").split(" ")[0];
  const okShape = now === null ? was === null : first(now) === first(was) && (now === first(was) || /^\S+ \S\.$/u.test(now));
  if (!okShape) showsMore.push({ x, was, now });
}
check(`${oldAll.size} names: the same first word as before and at most one letter after it`, showsMore.length === 0, showsMore.slice(0, 3));

// 5. Grants.
const acl = (await db.query(`SELECT
    has_function_privilege('anon', 'public.member_display_name(text,text)', 'EXECUTE') AS anon,
    has_function_privilege('authenticated', 'public.member_display_name(text,text)', 'EXECUTE') AS auth,
    has_function_privilege('service_role', 'public.member_display_name(text,text)', 'EXECUTE') AS svc,
    (SELECT proacl::text FROM pg_proc WHERE oid = 'public.member_display_name(text,text)'::regprocedure) AS acl`)).rows[0];
check("grants: anon and PUBLIC have no EXECUTE; authenticated and service_role do", !acl.anon && acl.auth && acl.svc && !/(^|[{,])=X/.test(acl.acl), acl);

await db.close();
if (failed) {
  console.log(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("\nall checks passed");
