#!/usr/bin/env node
/**
 * PGlite proof for 20261102063312_promotions_undo_record_cleared (Q2159).
 *
 *   node src/test/pglite/promotionsUndoRecordCleared.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/promotionsUndoRecordCleared.pglite.mjs   # RED: main before this change
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/promotionsUndoRecordCleared.pglite.mjs
 *
 * The bug: an unsubscribe link's undo record (profiles.promotions_before_unsubscribe)
 * survived a later change in Settings, so a member who turned consent back on
 * and then off again could have it re-granted by an old email's Resubscribe.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * The schema is prod's shape (read 2026-11-02) for the columns in play:
 * profiles with promotions_before_unsubscribe, notification_preferences
 * (email_promotions three-valued, user_id UNIQUE), prod's
 * is_server_context(), own-row RLS, and the column UPDATE grant clients hold
 * on profiles (the locked column is not in it). Supabase's default EXECUTE
 * grant to anon and authenticated on every new function is emulated (ALTER
 * DEFAULT PRIVILEGES), so the REVOKEs are what keeps the RPCs server-only.
 * A client request is SET ROLE authenticated with the JWT sub/role settings
 * PostgREST sets; the edge function is SET ROLE service_role.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const THIS = process.env.MIGRATION_PATH
  ? readFileSync(process.env.MIGRATION_PATH, "utf8")
  : readFileSync(new URL("../../../supabase/migrations/20261102063312_promotions_undo_record_cleared.sql", import.meta.url).pathname, "utf8");
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (ok) passes++;
  else failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
-- prod's definition (20260915051905 lineage)
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $f$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') $f$;
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY, full_name text, marketing_consent boolean NOT NULL DEFAULT false,
  promotions_before_unsubscribe jsonb, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile_select ON public.profiles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY own_profile_update ON public.profiles FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, marketing_consent) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
CREATE TABLE public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL,
  email_promotions boolean, email_messages boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_prefs ON public.notification_preferences FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
  AS $$ BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END; $$;
CREATE TRIGGER update_notification_preferences_updated_at BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
`);

for (let i = 0; i < 3; i++) {
  if (skip) break;
  let err = null;
  try { await db.exec(THIS); } catch (e) { err = e.message; }
  check(`the migration applies (run ${i + 1} of 3)`, !err, err ?? "");
}

// ── helpers ───────────────────────────────────────────────────────────────
let n = 0;
async function member({ consent, promo }) {
  n++;
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  await db.query(`INSERT INTO public.profiles (user_id, full_name, marketing_consent) VALUES ($1, 'Pat', $2)`, [id, consent]);
  if (promo !== "none") {
    await db.query(`INSERT INTO public.notification_preferences (user_id, email_promotions) VALUES ($1, $2)`, [id, promo]);
  }
  return id;
}
async function as(role, uid, sql, params = []) {
  await db.exec(`SET ROLE ${role}`);
  if (role === "authenticated") {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false)`, [uid]);
  } else if (role === "service_role") {
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'service_role', false)`);
  } else {
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false)`);
  }
  try {
    return { rows: (await db.query(sql, params)).rows, error: null };
  } catch (e) {
    return { rows: [], error: e.message, code: e.code };
  } finally {
    await db.exec(`RESET ROLE`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false)`);
  }
}
const state = async (id) => {
  const p = (await db.query(`SELECT marketing_consent, promotions_before_unsubscribe AS rec FROM public.profiles WHERE user_id = $1`, [id])).rows[0];
  const np = (await db.query(`SELECT email_promotions FROM public.notification_preferences WHERE user_id = $1`, [id])).rows[0];
  return { consent: p.marketing_consent, promo: np ? np.email_promotions : "none", rec: p.rec };
};
const S = (o) => JSON.stringify(o);
/** jsonb stores keys sorted; compare records key by key. */
const R = (o) => (o == null ? String(o) : JSON.stringify({ marketing_consent: o.marketing_consent, email_promotions: o.email_promotions }));
const unsub = (id) => as("service_role", null, `SELECT public.promotions_unsubscribe($1) AS r`, [id]);
const resub = (id) => as("service_role", null, `SELECT public.promotions_resubscribe($1) AS r`, [id]);
// main's opt-out (the edge function before this change): record, then both
// off, as separate service-role statements.
const legacyUnsub = async (id) => {
  const s = await state(id);
  await as("service_role", null, `UPDATE public.profiles SET promotions_before_unsubscribe = $2 WHERE user_id = $1 AND promotions_before_unsubscribe IS NULL`,
    [id, JSON.stringify({ marketing_consent: s.consent, email_promotions: s.promo === "none" ? true : s.promo })]);
  await as("service_role", null, `UPDATE public.profiles SET marketing_consent = false WHERE user_id = $1`, [id]);
  await as("service_role", null, `INSERT INTO public.notification_preferences (user_id, email_promotions) VALUES ($1, false)
                                  ON CONFLICT (user_id) DO UPDATE SET email_promotions = false`, [id]);
};
const optOut = (id) => (skip ? legacyUnsub(id) : unsub(id));
const settingsConsent = (id, v) => as("authenticated", id, `UPDATE public.profiles SET marketing_consent = $2 WHERE user_id = $1`, [id, v]);
// NotificationPreferences.tsx writes the whole row (upsert of every column).
const settingsPromo = (id, v, messages = false) => as("authenticated", id,
  `INSERT INTO public.notification_preferences (user_id, email_promotions, email_messages) VALUES ($1, $2, $3)
   ON CONFLICT (user_id) DO UPDATE SET email_promotions = EXCLUDED.email_promotions, email_messages = EXCLUDED.email_messages`, [id, v, messages]);

// ── 1. The bug: Settings on, then off, then an old email's Resubscribe ────
{
  const id = await member({ consent: true, promo: true });
  await optOut(id);
  check("set-up: the link's opt-out records what it turned off", R((await state(id)).rec) === R({ marketing_consent: true, email_promotions: true }), S(await state(id)));
  let r = await settingsConsent(id, true);
  check("set-up: the member turns consent back on in Settings", !r.error, r.error ?? "");
  check("[fix] a Settings change to consent clears the undo record", (await state(id)).rec === null, S(await state(id)));
  r = await settingsConsent(id, false);
  check("set-up: and off again", !r.error, r.error ?? "");
  const before = await state(id);
  r = await resub(id);
  const after = await state(id);
  check("[fix] the old email's Resubscribe does not re-grant consent withdrawn in Settings", after.consent === false && after.promo === false,
    `${S(before)} -> ${S(after)} ${r.error ?? S(r.rows)}`);
  check("[fix] it reports nothing to undo", r.rows[0]?.r === "nothing_to_undo", r.error ?? S(r.rows));
}

// ── 2. Which changes clear the record, and which do not ───────────────────
{
  const id = await member({ consent: true, promo: true });
  await optOut(id);
  await settingsPromo(id, true);
  check("[fix] a Settings change to Promotions clears the record (the locked column, cleared through the trigger)", (await state(id)).rec === null, S(await state(id)));
}
{
  const id = await member({ consent: true, promo: true });
  await optOut(id);
  const r = await settingsPromo(id, false, true); // another switch pressed; Promotions rewritten unchanged
  check("[keep] a Settings write that leaves Promotions as it was keeps the record", !r.error && (await state(id)).rec !== null, r.error ?? S(await state(id)));
}
{
  const id = await member({ consent: true, promo: true });
  await optOut(id);
  await as("authenticated", id, `UPDATE public.profiles SET full_name = 'Pat B' WHERE user_id = $1`, [id]);
  check("[keep] a profile write that leaves consent alone keeps the record", (await state(id)).rec !== null, S(await state(id)));
  await as("service_role", null, `UPDATE public.profiles SET marketing_consent = true WHERE user_id = $1`, [id]);
  check("[fix] a server write of consent (complete-signup) clears the record too", (await state(id)).rec === null, S(await state(id)));
}
{
  const id = await member({ consent: true, promo: true });
  const r = await as("authenticated", id, `UPDATE public.profiles SET promotions_before_unsubscribe = '{"marketing_consent":true,"email_promotions":true}' WHERE user_id = $1`, [id]);
  check("[keep] a client cannot write the record itself", !!r.error, r.error ?? "accepted");
}

// ── 3. The opt-out and the undo, each one call ────────────────────────────
for (const [why, seed, rec, restored] of [
  ["agreed and receiving promotions", { consent: true, promo: true }, { marketing_consent: true, email_promotions: true }, { consent: true, promo: true }],
  ["agreed, no preferences row (read as on)", { consent: true, promo: "none" }, { marketing_consent: true, email_promotions: true }, { consent: true, promo: true }],
  ["agreed, Promotions never chosen (NULL)", { consent: true, promo: null }, { marketing_consent: true, email_promotions: null }, { consent: true, promo: null }],
  ["agreed, Promotions off in Settings", { consent: true, promo: false }, { marketing_consent: true, email_promotions: false }, { consent: true, promo: false }],
  ["never agreed", { consent: false, promo: false }, { marketing_consent: false, email_promotions: false }, { consent: false, promo: false }],
]) {
  const id = await member(seed);
  let r = await unsub(id);
  let s = await state(id);
  check(`[fix] ${why}: the opt-out turns both off and records exactly what was on`,
    !r.error && s.consent === false && s.promo === false && R(s.rec) === R(rec), r.error ?? S(s));
  r = await resub(id);
  s = await state(id);
  check(`[fix] ${why}: the undo restores exactly that and clears the record`,
    !r.error && r.rows[0]?.r === "restored" && s.consent === restored.consent && s.promo === restored.promo && s.rec === null, r.error ?? S(s));
}
{
  const id = await member({ consent: true, promo: true });
  await unsub(id);
  await unsub(id);
  check("[fix] a second opt-out keeps the first record", R((await state(id)).rec) === R({ marketing_consent: true, email_promotions: true }), S(await state(id)));
}
{
  const id = await member({ consent: true, promo: true });
  await unsub(id);
  await settingsPromo(id, true); // promotions back on, consent still off; clears the record
  await unsub(id); // a later link: records only what is on now
  check("[fix] a later opt-out after Promotions came back on records only that", R((await state(id)).rec) === R({ marketing_consent: false, email_promotions: true }), S(await state(id)));
  await resub(id);
  const s = await state(id);
  check("[fix] and its undo never re-grants the consent withdrawn by the first link", s.consent === false && s.promo === true, S(s));
}
{
  // A flag changed under the undo flag (no client can set it): the undo
  // must still see the later choice and write nothing but the clear.
  const id = await member({ consent: true, promo: true });
  await unsub(id);
  await db.exec(`BEGIN; SELECT set_config('app.promotions_undo_write', '1', true);
                 UPDATE public.notification_preferences SET email_promotions = true WHERE user_id = '${id}'; COMMIT;`);
  const r = await resub(id);
  const s = await state(id);
  check("[fix] a flag changed since the opt-out: the undo keeps the later choice and clears the record",
    r.rows[0]?.r === "kept_later_choice" && s.consent === false && s.promo === true && s.rec === null, r.error ?? `${S(r.rows)} ${S(s)}`);
}
{
  const id = await member({ consent: false, promo: false });
  const before = (await db.query(`SELECT p.updated_at a, np.updated_at b FROM public.profiles p JOIN public.notification_preferences np USING (user_id) WHERE user_id = $1`, [id])).rows[0];
  const r = await resub(id);
  const after = (await db.query(`SELECT p.updated_at a, np.updated_at b FROM public.profiles p JOIN public.notification_preferences np USING (user_id) WHERE user_id = $1`, [id])).rows[0];
  check("[fix] a Resubscribe with no opt-out before it writes nothing", r.rows[0]?.r === "nothing_to_undo" && S(before) === S(after), r.error ?? `${S(before)} ${S(after)}`);
}
{
  const ghost = "00000000-0000-0000-0000-00000000ffff";
  const a = await unsub(ghost);
  const b = await resub(ghost);
  check("[fix] an opt-out for a user with no profile raises profile_not_found", a.code === "P0002", a.error ?? "no error");
  check("[fix] an undo for a user with no profile raises profile_not_found", b.code === "P0002", b.error ?? "no error");
}

// ── 4. Server-only ────────────────────────────────────────────────────────
for (const fn of ["promotions_unsubscribe", "promotions_resubscribe"]) {
  const id = await member({ consent: true, promo: true });
  const self = await as("authenticated", id, `SELECT public.${fn}($1)`, [id]);
  const anon = await as("anon", null, `SELECT public.${fn}($1)`, [id]);
  check(`[fix] a signed-in member cannot call ${fn}`, /permission denied/.test(self.error ?? ""), self.error ?? "allowed");
  check(`[fix] anon cannot call ${fn}`, /permission denied/.test(anon.error ?? ""), anon.error ?? "allowed");
}
for (const fn of ["clear_promotions_undo_on_consent_change", "clear_promotions_undo_on_promotions_change"]) {
  const r = (await db.query(`SELECT has_function_privilege('authenticated', 'public.${fn}()', 'EXECUTE') a, has_function_privilege('anon', 'public.${fn}()', 'EXECUTE') b`).catch(() => ({ rows: [{}] }))).rows[0];
  check(`[fix] ${fn} is not executable by anon or authenticated`, r.a === false && r.b === false, S(r));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
