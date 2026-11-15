// Q2788: identity_check_on_for_everyone() answers a signed-out visitor (anon) one boolean, whether identity_check is
// open to everyone, and nothing else. Run: node src/test/pglite/identityCheckOnForEveryone.pglite.mjs (ALL PASS);
// NEW_MIGRATION=skip ... is RED (the function does not exist). The migration is applied 3 times (replay-safe).
import { readFileSync } from "node:fs"; import os from "node:os";
const { PGlite } = await import(`${os.homedir()}/.lh-pglite/node_modules/@electric-sql/pglite/dist/index.js`);
const db = new PGlite(); let f = 0; const ck = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${d}`); if (!ok) f++; };
const tryq = async (sql) => { try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { error: String(e.message) }; } };
await db.exec(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text NOT NULL DEFAULT 'off' CHECK (audience IN ('off','testers','everyone')), description text NOT NULL);
ALTER TABLE public.feature_switches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feature_switches FROM PUBLIC, anon, authenticated;
INSERT INTO public.feature_switches VALUES ('identity_check','everyone','ID checks'), ('secret_rollout','testers','private');`);
const m = readFileSync(process.cwd() + "/supabase/migrations/20261115181414_identity_check_on_for_everyone.sql", "utf8");
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(m);

const asAnon = async (sql) => { await db.exec("SET ROLE anon"); const r = await tryq(sql); await db.exec("RESET ROLE"); return r; };
let r = await asAnon("SELECT public.identity_check_on_for_everyone() AS on");
ck("anon reads it: on while identity_check is set to everyone", r.rows?.[0]?.on === true, r.error ?? "");
ck("anon still cannot read the switches table itself", !!(await asAnon("SELECT * FROM public.feature_switches")).error);

await db.exec("UPDATE public.feature_switches SET audience='testers' WHERE key='identity_check'");
r = await asAnon("SELECT public.identity_check_on_for_everyone() AS on");
ck("testers only: off for a guest", r.rows?.[0]?.on === false, r.error ?? "");
await db.exec("UPDATE public.feature_switches SET audience='off' WHERE key='identity_check'");
r = await asAnon("SELECT public.identity_check_on_for_everyone() AS on");
ck("off: off", r.rows?.[0]?.on === false, r.error ?? "");
await db.exec("DELETE FROM public.feature_switches WHERE key='identity_check'");
r = await asAnon("SELECT public.identity_check_on_for_everyone() AS on");
ck("no row: off (never null)", r.rows?.[0]?.on === false, r.error ?? "");

// Only this one fact: no arguments, a boolean, and a switch at 'everyone' under another key does not turn it on.
await db.exec("UPDATE public.feature_switches SET audience='everyone' WHERE key='secret_rollout'");
r = await asAnon("SELECT public.identity_check_on_for_everyone() AS on");
ck("another key at everyone does not answer true", r.rows?.[0]?.on === false, r.error ?? "");
const sig = await tryq(`SELECT pg_get_function_arguments(p.oid) AS args, format_type(p.prorettype, NULL) AS ret, p.prosecdef AS definer,
  array_to_string(p.proconfig, ',') AS cfg, p.provolatile AS vol
  FROM pg_proc p WHERE p.proname = 'identity_check_on_for_everyone'`);
const s = sig.rows?.[0] ?? {};
ck("signature: no arguments, returns boolean", s.args === "" && s.ret === "boolean", JSON.stringify(s));
ck("SECURITY DEFINER with a pinned search_path, STABLE", s.definer === true && /search_path=public/.test(s.cfg ?? "") && s.vol === "s", JSON.stringify(s));
const acl = await tryq(`SELECT has_function_privilege('anon', 'public.identity_check_on_for_everyone()', 'EXECUTE') AS anon_x,
  has_function_privilege('authenticated', 'public.identity_check_on_for_everyone()', 'EXECUTE') AS auth_x,
  (SELECT proacl::text FROM pg_proc WHERE proname = 'identity_check_on_for_everyone') AS acl`);
const a = acl.rows?.[0] ?? {};
ck("granted to anon and authenticated", a.anon_x === true && a.auth_x === true, a.acl ?? acl.error ?? "");
ck("PUBLIC holds no grant (no '=X/' entry)", typeof a.acl === "string" && !/(^|[{,])=X\//.test(a.acl), a.acl ?? "");

console.log(f ? `${f} FAILED` : "ALL PASS"); process.exit(f ? 1 : 0);
