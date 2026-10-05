/**
 * Q447(a) — owner decision 2026-10-04: when the real owner of an email address
 * takes over an account whose email was never verified (a provider sign-in,
 * GoTrue's linking path; Q446 step 4), everything typed into it before
 * verification is deleted, and the real owner fills in their own profile on
 * /complete-profile.
 *
 * Pinned on the definitions the database holds (effectiveDefs) and the
 * migrations' trigger statements:
 *   - zz_wipe_on_provider_takeover fires AFTER UPDATE OF email_confirmed_at on
 *     auth.users and calls wipe_pre_verification_account only for a takeover
 *     (no email identity left, a provider identity present, began as email);
 *   - the wipe clears every owner-listed field, deletes legal_acceptances and
 *     the referral, and records the stored objects for the Storage-API sweep;
 *   - the first-consent pin's only exemption is the wipe's flag, and nothing
 *     else sets that flag;
 *   - the tables and functions are server-only;
 *   - the shared scenario script expects the wipe in case B.
 * Behaviour, red then green: src/test/pglite/preVerificationTakeoverWipe.pglite.mjs
 * (applied 3x: ALL PASS, incl. the scenario script; NEW_MIGRATION=skip: 7 FAILED).
 * The storage half: src/test/edge/preVerificationWipeSweep.test.ts.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const defs = effectiveDefs(MIG_DIR);
const flat = (fn: string) => blankSqlComments(defs.get(fn)?.stmt ?? "").replace(/\s+/g, " ");
const files = () => migrationFiles(MIG_DIR).map((name) => ({ name, sql: blankSqlComments(readFileSync(join(MIG_DIR, name), "utf8")) }));

// The owner's list (2026-10-04) as profile columns, plus the rest of the signup form.
const CLEARED = [
  "full_name", "phone", "date_of_birth", "avatar_url", "location", "zip_code", "bio",
  "license_url", "insurance_url", "license_expires_at", "insurance_expires_at",
  "marketing_consent", "terms_version_accepted", "terms_accepted_at", "accepted_terms_at",
  "skills", "availability", "transportation", "hear_about_us", "experience_level", "tools_equipment",
  "emergency_contact_name", "emergency_contact_phone", "extra_comments",
];

describe("Q447: a pre-verification takeover deletes what was typed before verification", () => {
  it("the takeover trigger is attached AFTER UPDATE OF email_confirmed_at on auth.users", () => {
    expect(files().length).toBeGreaterThan(400);
    expect(defs.size).toBeGreaterThan(100);
    let state: string | null = null;
    for (const f of files()) {
      for (const m of f.sql.matchAll(/(create\s+trigger\s+zz_wipe_on_provider_takeover\s+([^;]*?)\s+on\s+auth\.users([^;]*))|(drop\s+trigger\s+(?:if\s+exists\s+)?zz_wipe_on_provider_takeover\s+on\s+auth\.users)/gi)) {
        state = m[1] ? `${m[2]} ${m[3]}`.replace(/\s+/g, " ").toLowerCase() : null;
      }
    }
    expect(state).toMatch(/^after update of email_confirmed_at\b.*for each row execute function public\.wipe_on_provider_takeover/);
  });

  it("only a takeover triggers it: no email identity left, a provider identity, began as email", () => {
    const t = flat("wipe_on_provider_takeover");
    expect(t).toContain("IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN RETURN NULL; END IF;");
    expect(t).toContain("IF EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = NEW.id AND i.provider = 'email') THEN RETURN NULL; END IF;");
    expect(t).toContain("IF v_first_provider IS NULL THEN RETURN NULL; END IF;");
    expect(t).toContain("IF coalesce(NEW.raw_app_meta_data->>'provider', '') <> 'email' AND NOT (NEW.created_at < v_first_provider - interval '5 seconds') THEN RETURN NULL; END IF;");
    expect(t).toMatch(/BEGIN PERFORM public\.wipe_pre_verification_account\(NEW\.id\); EXCEPTION WHEN OTHERS THEN INSERT INTO public\.pre_verification_wipes \(user_id, error\)/);
  });

  it.each(CLEARED)("the wipe clears profiles.%s", (col) => {
    expect(flat("wipe_pre_verification_account")).toMatch(new RegExp(`\\b${col}\\s*=\\s*(?:NULL|''|false)(?!\\w)`));
  });

  it("the wipe deletes the legal acceptances and the referral, and records the stored objects", () => {
    const w = flat("wipe_pre_verification_account");
    expect(w).toContain("DELETE FROM public.legal_acceptances WHERE user_id = p_user_id;");
    expect(w).toContain("DELETE FROM public.referrals WHERE referred_id = p_user_id;");
    expect(w).toContain("WHERE o.bucket_id IN ('avatars', 'user-documents') AND o.name LIKE p_user_id::text || '/%';");
    expect(w).toContain("INSERT INTO public.pre_verification_wipes (user_id, objects)");
  });

  it("the first-consent pin's one exemption is the wipe's flag, set by the wipe alone", () => {
    expect(flat("preserve_first_consent")).toContain("IF current_setting('app.pre_verification_wipe', true) = '1' THEN RETURN NEW; END IF;");
    const setters = [...defs].filter(([, d]) => /set_config\(\s*'app\.pre_verification_wipe'\s*,\s*'1'/.test(blankSqlComments(d.stmt))).map(([n]) => n);
    expect(setters).toEqual(["wipe_pre_verification_account"]);
  });

  it("the wipe record, the wipe and the object lookup are server-only", () => {
    const sql = files().map((f) => f.sql).join("\n");
    expect(sql).toMatch(/REVOKE ALL ON public\.pre_verification_wipes FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.wipe_pre_verification_account\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.pre_verification_wipe_objects\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).not.toMatch(/GRANT[^;]*(?:wipe_pre_verification_account|pre_verification_wipe_objects|pre_verification_wipes)[^;]*\b(authenticated|anon)\b/i);
  });

  it("the shared identity-linking scenario expects the wipe in case B", () => {
    const scen = blankSqlComments(readFileSync(join(ROOT, "scripts/sql/identity-linking-scenarios.sql"), "utf8"));
    expect(scen).toContain("'signup data deleted at the takeover (Q447)'");
    expect(scen).not.toContain("'signup data kept through the confirm'");
  });
});

// @mutate supabase/migrations/20261004194257_pre_verification_takeover_wipe.sql |   DELETE FROM public.legal_acceptances WHERE user_id = p_user_id;\n |
// @mutate supabase/migrations/20261004194257_pre_verification_takeover_wipe.sql |   DELETE FROM public.referrals WHERE referred_id = p_user_id;\n |
// @mutate supabase/migrations/20261004194257_pre_verification_takeover_wipe.sql |          phone                   = NULL,\n |
// @mutate supabase/migrations/20261004194257_pre_verification_takeover_wipe.sql |   IF EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = NEW.id AND i.provider = 'email') THEN | IF false THEN
// @mutate supabase/migrations/20261004194257_pre_verification_takeover_wipe.sql |   AFTER UPDATE OF email_confirmed_at ON auth.users | AFTER UPDATE OF email ON auth.users
