/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"; lead 11-11): the sign-up confirm email, password reset, codes and
 * email-change email follow the recipient's language. A brand-new sign-up has no saved language, so:
 *   1. the sign-up form sends the visitor's language (the English/Español switch, else the browser's) as user
 *      metadata `lang`;
 *   2. handle_new_user copies it into profiles.language (PGlite proof: src/test/pglite/profileLanguageFromSignup.pglite.mjs);
 *   3. auth-email-hook reads the metadata, then profiles.language for an older account, and English otherwise;
 *   4. each account template takes `lang` and writes its words from authEmailWords.ts.
 * Source-level (the templates import npm: modules vitest cannot load), plus the real words and language pick.
 *
 * @mutate src/pages/auth/Signup.tsx | data: { full_name: fullName, lang: getLang() }, | data: { full_name: fullName },
 * @mutate supabase/migrations/20261111221745_profile_language_from_signup.sql | CASE WHEN NEW.raw_user_meta_data->>'lang' = 'es' THEN 'es' ELSE 'en' END | 'en'
 * @mutate supabase/functions/auth-email-hook/index.ts |   const metaLang = user?.user_metadata?.lang | const metaLang = undefined
 * @mutate supabase/functions/auth-email-hook/index.ts |       else if (langRow) lang = authEmailLang(langRow.language) |       else void langRow
 * @mutate supabase/functions/auth-email-hook/index.ts |   if (emailType !== 'signup' && user?.id) { |   if (metaLang !== 'es' && metaLang !== 'en' && user?.id) {
 * @mutate supabase/functions/auth-email-hook/index.ts |       subject: authEmailSubject(emailType, lang), |       subject: authEmailSubject(emailType, 'en'),
 * @mutate supabase/functions/auth-email-hook/index.ts |   const templateProps = {\n    lang, |   const templateProps = {
 * @mutate supabase/functions/_shared/email-templates/authEmailWords.ts |   if (metaLang === 'es' \|\| metaLang === 'en') return metaLang | if (metaLang === 'en') return metaLang
 * @mutate supabase/functions/_shared/email-templates/authEmailWords.ts |   return (lang === 'es' ? words.es : words.en) as T['en'] |   return words.en as T['en']
 * @mutate supabase/functions/_shared/email-templates/signup.tsx |   const w = wordsFor(SIGNUP_WORDS, lang) |   const w = wordsFor(SIGNUP_WORDS, 'en')
 * @mutate supabase/functions/_shared/email-templates/recovery.tsx | <Text className="e-text" style={text}>{w.body}</Text> | <Text className="e-text" style={text}>We got a request to reset your password.</Text>
 * @mutate supabase/functions/_shared/email-templates/components.tsx |   <Html lang={lang === 'es' ? 'es' : 'en'} dir="ltr"> |   <Html lang="en" dir="ltr">
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "../helpers/blankNonCode";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs";
import {
  AUTH_EMAIL_SUBJECTS,
  EMAIL_CHANGE_WORDS,
  MAGIC_LINK_WORDS,
  REAUTH_WORDS,
  RECOVERY_WORDS,
  SIGNUP_WORDS,
  authEmailLang,
  authEmailSubject,
  wordsFor,
} from "../../../supabase/functions/_shared/email-templates/authEmailWords";

const ROOT = resolve(__dirname, "..", "..", "..");
const read = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));
const TPL = "supabase/functions/_shared/email-templates/";

/** Template file -> its words block and the component's name. */
const TEMPLATES: Array<[string, string, Record<string, Record<string, string>>]> = [
  ["signup.tsx", "SIGNUP_WORDS", SIGNUP_WORDS],
  ["recovery.tsx", "RECOVERY_WORDS", RECOVERY_WORDS],
  ["magic-link.tsx", "MAGIC_LINK_WORDS", MAGIC_LINK_WORDS],
  ["reauthentication.tsx", "REAUTH_WORDS", REAUTH_WORDS],
  ["email-change.tsx", "EMAIL_CHANGE_WORDS", EMAIL_CHANGE_WORDS],
];

describe("the account emails follow the sign-up language (F260q)", () => {
  it("the language pick: metadata first, then the saved profile language, else English", () => {
    expect(authEmailLang("es")).toBe("es");
    expect(authEmailLang("en", "es")).toBe("en");
    expect(authEmailLang(undefined, "es")).toBe("es");
    for (const junk of [undefined, null, "ES", "fr", 7, {}]) expect(authEmailLang(junk), String(junk)).toBe("en");
    expect(authEmailLang(undefined, "fr")).toBe("en");
    expect(wordsFor(SIGNUP_WORDS, "es")).toBe(SIGNUP_WORDS.es);
    expect(wordsFor(SIGNUP_WORDS, "xx")).toBe(SIGNUP_WORDS.en);
  });

  it("every Spanish block says every English line, in Spanish, with brand names kept", () => {
    let lines = 0;
    for (const [file, , words] of TEMPLATES) {
      expect(Object.keys(words.es).sort(), file).toEqual(Object.keys(words.en).sort());
      for (const k of Object.keys(words.en)) {
        lines++;
        const en = words.en[k];
        const es = words.es[k];
        expect(es.trim().length, `${file} ${k}`).toBeGreaterThan(0);
        // "to" -> "a" is the one line short enough to read alike; every other line must differ.
        if (en.length > 3) expect(es, `${file} ${k} still English`).not.toBe(en);
        if (en.includes("Louisiana Helpr")) expect(es, `${file} ${k} lost the brand name`).toContain("Louisiana Helpr");
      }
    }
    expect(lines).toBeGreaterThan(25);
    // Subjects: every type with a Spanish template has a Spanish subject; invite (no account yet) stays English.
    for (const type of ["signup", "magiclink", "recovery", "email_change", "email_change_current", "email_change_new", "reauthentication"]) {
      expect(authEmailSubject(type, "es"), type).not.toBe(AUTH_EMAIL_SUBJECTS.en[type]);
    }
    expect(authEmailSubject("invite", "es")).toBe(AUTH_EMAIL_SUBJECTS.en.invite);
    expect(authEmailSubject("recovery", "es")).toContain("Louisiana Helpr");
  });

  it("each template writes its words for the recipient's language and marks the email's language", () => {
    for (const [file, block] of TEMPLATES) {
      const src = read(TPL + file);
      expect(src, file).toContain(`const w = wordsFor(${block}, lang)`);
      expect(src, file).toContain("<BaseLayout lang={lang} preheader={w.preheader}>");
      expect(src, file).toMatch(/\{w\.heading\}/);
      expect(src, `${file} still has a literal heading`).not.toMatch(/style=\{h1\}>[A-Z][^{<]+</);
    }
    expect(read(TPL + "recovery.tsx")).toContain('<Text className="e-text" style={text}>{w.body}</Text>');
    expect(read(TPL + "components.tsx")).toContain(`<Html lang={lang === 'es' ? 'es' : 'en'} dir="ltr">`);
  });

  it("auth-email-hook: sign-up reads the metadata; the rest read profiles.language first, and passes the language to subject and template", () => {
    const hook = read("supabase/functions/auth-email-hook/index.ts");
    expect(hook).toContain("const metaLang = user?.user_metadata?.lang");
    expect(hook).toContain("let lang: EmailLang = authEmailLang(metaLang)");
    expect(hook).toMatch(/\.from\('profiles'\)\.select\('language'\)\.eq\('user_id', user\.id\)\.maybeSingle\(\)/);
    // The saved language wins for every email but the sign-up one (a member may switch after signing up).
    expect(hook).toContain("if (emailType !== 'signup' && user?.id) {");
    expect(hook).toContain("else if (langRow) lang = authEmailLang(langRow.language)");
    expect(hook).toMatch(/const templateProps = \{\s*lang,/);
    expect(hook).toContain("subject: authEmailSubject(emailType, lang),");
  });

  it("the sign-up form sends the visitor's language, and the newest handle_new_user saves it", () => {
    const signup = read("src/pages/auth/Signup.tsx");
    expect(signup).toContain("data: { full_name: fullName, lang: getLang() },");
    const def = effectiveDefs(join(ROOT, "supabase/migrations")).get("handle_new_user");
    expect(def, "handle_new_user").toBeTruthy();
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/INSERT INTO public\.profiles \(user_id, full_name, email, language\)/);
    expect(body).toContain("CASE WHEN NEW.raw_user_meta_data->>'lang' = 'es' THEN 'es' ELSE 'en' END");
  });
});
