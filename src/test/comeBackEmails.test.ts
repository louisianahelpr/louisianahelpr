/**
 * Come-back emails (owner said yes, 2026-10-21): the switch, the database
 * shape and the copy, read from the NEWEST definitions.
 *
 * Behaviour is proven in src/test/pglite/comeBackEmails.pglite.mjs (the real
 * switch migration, then this one applied 3x): 63 PASS; NEW_MIGRATION=skip
 * 44 FAIL; 29 planted defects each caught (2026-10-21). The sender is run in
 * src/test/edge/come-back-emails.test.ts. This file pins what those cannot
 * see together: the switch is created OFF and read for every member inside
 * the claim, the grants, at most two emails, the cron, and the copy rules.
 *
 * @mutate supabase/migrations/20261021113827_come_back_emails.sql | VALUES ('come_back_emails', 'off', | VALUES ('come_back_emails', 'testers',
 * @mutate supabase/migrations/20261021135832_promotions_not_chosen_until_set.sql |        AND public.feature_enabled_for_user('come_back_emails', p.user_id) |        AND true
 * @mutate supabase/migrations/20261021113827_come_back_emails.sql | REVOKE ALL ON FUNCTION public.claim_come_back_emails(integer, integer) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.claim_come_back_emails(integer, integer) FROM PUBLIC;
 * @mutate supabase/migrations/20261021135832_promotions_not_chosen_until_set.sql | REVOKE ALL ON FUNCTION public.claim_come_back_emails(integer, integer) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.claim_come_back_emails(integer, integer) FROM PUBLIC;
 * @mutate supabase/migrations/20261021135832_promotions_not_chosen_until_set.sql | np.email_promotions IS FALSE OR | np.email_promotions IS NOT TRUE OR
 * @mutate supabase/migrations/20261021113827_come_back_emails.sql | REVOKE ALL ON TABLE public.come_back_email_sends FROM PUBLIC, anon, authenticated; | REVOKE ALL ON TABLE public.come_back_email_sends FROM PUBLIC;
 * @mutate supabase/migrations/20261021113827_come_back_emails.sql |   email_step smallint NOT NULL CHECK (email_step IN (1, 2)), |   email_step smallint NOT NULL,
 * @mutate supabase/migrations/20261021135832_promotions_not_chosen_until_set.sql |        AND p.marketing_consent IS TRUE |        AND true
 * @mutate supabase/migrations/20261021135832_promotions_not_chosen_until_set.sql |        AND NOT EXISTS (SELECT 1 FROM public.suppressed_emails s WHERE lower(s.email) = lower(p.email)) |        AND true
 * @mutate supabase/migrations/20261021135832_promotions_not_chosen_until_set.sql |        AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id) |        AND true
 * @mutate supabase/migrations/20261021135832_promotions_not_chosen_until_set.sql |        AND p.is_seed IS NOT TRUE |        AND true
 * @mutate supabase/migrations/20261021135832_promotions_not_chosen_until_set.sql |        AND lower(u.email) = lower(p.email) |        AND true
 * @mutate supabase/migrations/20261021135832_promotions_not_chosen_until_set.sql |     ON CONFLICT ON CONSTRAINT come_back_email_sends_pkey DO NOTHING |     ON CONFLICT ON CONSTRAINT come_back_email_sends_pkey DO UPDATE SET claimed_at = now()
 * @mutate supabase/migrations/20261021113827_come_back_emails.sql | '/functions/v1/come-back-emails', | '/functions/v1/come-back-emails-x',
 * @mutate supabase/migrations/20261021113827_come_back_emails.sql | VALUES ('come-back-emails', interval '20 hours', | VALUES ('come-back-emails', interval '16 hours',
 * @mutate supabase/migrations/20261021135832_promotions_not_chosen_until_set.sql | c.email_step = 1 AND c.queued_at <= now() | c.email_step = 1 AND c.claimed_at <= now()
 * @mutate supabase/functions/_shared/comeBackEmail.ts |     subject: "One last note from Louisiana Helpr", |     subject: "One Last Note From Louisiana Helpr",
 * @mutate supabase/functions/_shared/comeBackEmail.ts | Thank you for that." | Thank you for that!"
 * @mutate supabase/functions/_shared/comeBackEmail.ts | This is my last note, I promise." | I'll be in touch."
 * @mutate supabase/functions/_shared/comeBackEmail.ts | "Browse jobs near you, see your take-home, then apply." | "Browse jobs near you and apply."
 * @mutate supabase/functions/_shared/comeBackEmail.ts | ["Need a hand?", | ["Need a helper?",
 * @mutate supabase/functions/_shared/email-templates/comeBack.tsx | footer={<MarketingFooter unsubscribeUrl={unsubscribeUrl} reasonLine={COME_BACK_REASON} />} | footer={null}
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { FEATURE_SWITCH_KEYS, SERVER_ONLY_FEATURE_SWITCH_KEYS } from "@/config/featureSwitches";
import {
  COME_BACK_COPY,
  COME_BACK_SWITCH,
  comeBackGreeting,
  comeBackTemplateName,
} from "../../supabase/functions/_shared/comeBackEmail";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort()
  .map((f) => ({ f, sql: blankSqlComments(readFileSync(join(MIG, f), "utf8")) }));
const all = files.map(({ sql }) => sql).join("\n");

/** Newest CREATE [OR REPLACE] FUNCTION public.<name> body, any dollar tag. */
function newestBody(name: string): string {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  const hits = files.filter(({ sql }) => new RegExp(head.source, "i").test(sql));
  expect(hits.length, `no migration defines public.${name}`).toBeGreaterThan(0);
  const { sql } = hits[hits.length - 1];
  const at = [...sql.matchAll(head)].pop()!.index!;
  const tag = /AS\s+(\$\w*\$)/i.exec(sql.slice(at))![1];
  const open = sql.indexOf(tag, at);
  return sql.slice(at, sql.indexOf(tag, open + tag.length) + tag.length);
}

describe("come-back emails: the switch", () => {
  it("is created OFF by a migration, is in the registry, and has no screen", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(all).toMatch(
      /INSERT\s+INTO\s+public\.feature_switches\s*\(key,\s*audience,\s*description\)\s*VALUES\s*\('come_back_emails',\s*'off',/i,
    );
    expect(COME_BACK_SWITCH).toBe("come_back_emails");
    expect(FEATURE_SWITCH_KEYS).toContain(COME_BACK_SWITCH);
    expect(SERVER_ONLY_FEATURE_SWITCH_KEYS).toContain(COME_BACK_SWITCH);
  });

  it("is decided for EACH member inside the claim (off = nobody), not once per run by the sender", () => {
    const b = newestBody("claim_come_back_emails");
    expect(b).toMatch(/AND\s+public\.feature_enabled_for_user\('come_back_emails',\s*p\.user_id\)/i);
    // The sender never asks the switch itself: one decision, in one place.
    const fn = blankComments(readFileSync(join(ROOT, "supabase/functions/come-back-emails/index.ts"), "utf8"));
    expect(fn).not.toMatch(/featureEnabledForUser|feature_enabled_for/);
    expect(fn).toMatch(/supabase\.rpc\("claim_come_back_emails"/);
  });
});

describe("come-back emails: database layer", () => {
  it("the send table is service_role only, at most one row per member per step, steps 1 and 2 only", () => {
    expect(all).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.come_back_email_sends/i);
    expect(all).toMatch(/ALTER\s+TABLE\s+public\.come_back_email_sends\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(all).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.come_back_email_sends\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i);
    expect(all).not.toMatch(/CREATE\s+POLICY\s+[^;]*\s+ON\s+public\.come_back_email_sends\b/i);
    expect(all).not.toMatch(/GRANT\s+[^;]*ON\s+(?:TABLE\s+)?public\.come_back_email_sends\s+TO\s+[^;]*\b(?:anon|authenticated|PUBLIC)\b/i);
    const table = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.come_back_email_sends\s*\(([\s\S]*?)\n\);/i.exec(all)![1];
    expect(table).toMatch(/email_step\s+smallint\s+NOT\s+NULL\s+CHECK\s*\(email_step\s+IN\s*\(1,\s*2\)\)/i);
    expect(table).toMatch(/PRIMARY\s+KEY\s*\(user_id,\s*email_step\)/i);
    expect(table).toMatch(/REFERENCES\s+auth\.users\s*\(id\)\s+ON\s+DELETE\s+CASCADE/i);
  });

  it("the claim is service_role only, SECURITY DEFINER with an empty search_path", () => {
    // Every migration that (re)defines the claim restates the REVOKE by role
    // name, so no single file's copy can be the one that leaves it open.
    const definers = files.filter(({ sql }) => /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.claim_come_back_emails\s*\(/i.test(sql));
    expect(definers.length).toBeGreaterThan(1);
    for (const { f, sql } of definers) {
      expect(sql, f).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.claim_come_back_emails\(integer,\s*integer\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i);
    }
    expect(all).not.toMatch(/GRANT\s+[^;]*ON\s+FUNCTION\s+public\.claim_come_back_emails\([^)]*\)\s+TO\s+[^;]*\b(?:anon|authenticated|PUBLIC)\b/i);
    expect(newestBody("claim_come_back_emails")).toMatch(/SECURITY\s+DEFINER[\s\S]*SET\s+search_path\s*=\s*''/i);
  });

  it("the claim writes the send row in the SAME statement that returns the member, and returns only what it wrote", () => {
    const b = newestBody("claim_come_back_emails");
    expect(b).toMatch(/INSERT\s+INTO\s+public\.come_back_email_sends\s+AS\s+c\s*\(user_id,\s*email_step\)/i);
    expect(b).toMatch(/ON\s+CONFLICT\s+ON\s+CONSTRAINT\s+come_back_email_sends_pkey\s+DO\s+NOTHING/i);
    expect(b).toMatch(/JOIN\s+claimed\s+ON\s+claimed\.user_id\s*=\s*due\.uid/i);
    expect(b).toMatch(/least\(coalesce\(p_limit,\s*20\),\s*100\)/i);
  });

  it("the claim honours consent and every exclusion", () => {
    const b = newestBody("claim_come_back_emails");
    for (const cond of [
      /p\.email_verified\s+IS\s+TRUE/i,
      /p\.marketing_consent\s+IS\s+TRUE/i,
      // Q2299 (owner 2026-10-21): only an EXPLICIT Promotions-off stops it;
      // NULL is never chosen and the sign-up box decides.
      /np\.email_promotions\s+IS\s+FALSE\s+OR\s+np\.email_enabled\s+IS\s+FALSE/i,
      /p\.is_seed\s+IS\s+NOT\s+TRUE/i,
      /p\.anonymized_at\s+IS\s+NULL/i,
      /p\.ban_status\s*=\s*'active'/i,
      /u\.deleted_at\s+IS\s+NULL/i,
      /u\.email_confirmed_at\s+IS\s+NOT\s+NULL/i,
      /lower\(u\.email\)\s*=\s*lower\(p\.email\)/i,
      /NOT\s+EXISTS\s*\(SELECT\s+1\s+FROM\s+public\.test_accounts\s+t/i,
      /NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.user_bans\s+b/i,
      /NOT\s+EXISTS\s*\(SELECT\s+1\s+FROM\s+public\.suppressed_emails\s+s\s+WHERE\s+lower\(s\.email\)\s*=\s*lower\(p\.email\)\)/i,
      /NOT\s+public\.is_fixture_email\(p\.email\)/i,
      /p\.last_drip_at\s+IS\s+NULL\s+OR\s+p\.last_drip_at\s*<\s*now\(\)\s*-\s*interval\s+'20 hours'/i,
    ]) {
      expect(b).toMatch(cond);
    }
  });

  it("'never came back' reads every sign of use from 24 hours after sign-up on", () => {
    const b = newestBody("claim_come_back_emails");
    expect(b).toMatch(/u\.last_sign_in_at\s*>=\s*p\.created_at\s*\+\s*interval\s+'24 hours'/i);
    expect(b).toMatch(/FROM\s+auth\.sessions\s+se[\s\S]*?greatest\(se\.created_at,\s*se\.updated_at,\s*se\.refreshed_at\s+AT\s+TIME\s+ZONE\s+'UTC'\)\s*>=\s*p\.created_at\s*\+\s*interval\s+'24 hours'/i);
    expect(b).toMatch(/FROM\s+public\.login_history\s+lh[\s\S]*?lh\.created_at\s*>=\s*p\.created_at\s*\+\s*interval\s+'24 hours'/i);
    expect(b).toMatch(/FROM\s+public\.analytics_events\s+ae[\s\S]*?ae\.created_at\s*>=\s*p\.created_at\s*\+\s*interval\s+'24 hours'/i);
  });

  it("step 1 is days 3-10, step 2 is days 10-17 and needs step 1 at least 5 days earlier", () => {
    const b = newestBody("claim_come_back_emails");
    expect(b).toMatch(/p_step\s*=\s*1\s+AND\s+p\.created_at\s*<=\s*now\(\)\s*-\s*interval\s+'3 days'\s+AND\s+p\.created_at\s*>\s*now\(\)\s*-\s*interval\s+'10 days'/i);
    expect(b).toMatch(/p_step\s*=\s*2\s+AND\s+p\.created_at\s*<=\s*now\(\)\s*-\s*interval\s+'10 days'\s+AND\s+p\.created_at\s*>\s*now\(\)\s*-\s*interval\s+'17 days'/i);
    // Step 1 must have been QUEUED (not merely claimed) 5+ days earlier.
    expect(b).toMatch(/c\.email_step\s*=\s*1\s+AND\s+c\.queued_at\s*<=\s*now\(\)\s*-\s*interval\s+'5 days'/i);
    expect(b).toMatch(/RAISE\s+EXCEPTION\s+'invalid_step'/i);
  });

  it("the cron job calls the edge function that exists, twice a day, with a liveness expectation", () => {
    expect(all).toMatch(/cron\.schedule\('come-back-emails',\s*'41 15,21 \* \* \*'/i);
    expect(all).toMatch(/\/functions\/v1\/come-back-emails'/);
    expect(all).toMatch(/cron_work_expectations[\s\S]*'come-back-emails'/i);
    // The overnight gap 21:41 -> 15:41 is 18 hours: a shorter liveness gap
    // pages "dead" every morning (lh-silent-failure review, 2026-10-21).
    const gap = /VALUES\s*\('come-back-emails',\s*interval\s*'(\d+) hours'/i.exec(all);
    expect(gap, "come-back-emails has a liveness gap").not.toBeNull();
    expect(Number(gap![1])).toBeGreaterThan(18);
    expect(existsSync(join(ROOT, "supabase/functions/come-back-emails/index.ts"))).toBe(true);
    expect(readFileSync(join(ROOT, "supabase/config.toml"), "utf8")).toMatch(/\[functions\.come-back-emails\]\s+verify_jwt\s*=\s*false/);
  });
});

describe("come-back emails: the words (founder voice, plain, sentence case)", () => {
  const steps = [1, 2] as const;
  const allText = (s: 1 | 2) => {
    const c = COME_BACK_COPY[s];
    return [c.subject, c.preheader, ...c.intro, ...c.bullets.flat(), c.button, c.closing];
  };

  it("there are exactly two emails, with their own template names", () => {
    expect(Object.keys(COME_BACK_COPY).sort()).toEqual(["1", "2"]);
    expect(steps.map(comeBackTemplateName)).toEqual(["come_back_1", "come_back_2"]);
  });

  it("subjects and the button are sentence case: only the first word and the name Louisiana Helpr are capitalised", () => {
    for (const s of steps) {
      for (const line of [COME_BACK_COPY[s].subject, COME_BACK_COPY[s].button]) {
        const words = line.replace(/Louisiana Helpr/g, "").split(/\s+/).filter(Boolean).slice(1);
        expect(words.filter((w) => /^[A-Z]/.test(w) && w !== "I"), line).toEqual([]);
      }
    }
  });

  it("no exclamation marks, no 'helper', no gig/platform jargon", () => {
    for (const s of steps) {
      for (const line of allText(s)) {
        expect(line, line).not.toMatch(/!/);
        expect(line, line).not.toMatch(/\bhelpers?\b/i);
        expect(line, line).not.toMatch(/\b(gig|platform|users?|escrow)\b/i);
      }
    }
  });

  it("the product lines are the landing page's own, word for word", () => {
    const landing = readFileSync(join(ROOT, "src/components/landing/HowItWorksSection.tsx"), "utf8");
    const lines = COME_BACK_COPY[1].bullets.map(([, rest]) => rest);
    expect(lines.length).toBeGreaterThan(0);
    for (const rest of lines) {
      for (const sentence of rest.split(/(?<=\.)\s+/)) expect(landing, sentence).toContain(sentence);
    }
  });

  it("both invite a reply, and the second says it is the last", () => {
    expect(COME_BACK_COPY[1].intro.join(" ")).toMatch(/reply/i);
    expect(COME_BACK_COPY[2].intro.join(" ")).toMatch(/reply/i);
    expect(COME_BACK_COPY[2].intro.join(" ")).toMatch(/last note/i);
    expect(COME_BACK_COPY[2].preheader).toMatch(/last one/i);
  });

  it("greets by first name, and never by a blank", () => {
    expect(comeBackGreeting("Pat Smith")).toBe("Hi Pat,");
    expect(comeBackGreeting("  ")).toBe("Hi there,");
    expect(comeBackGreeting(null)).toBe("Hi there,");
  });

  it("the template carries the signed unsubscribe footer (commercial mail)", () => {
    const tpl = blankComments(readFileSync(join(ROOT, "supabase/functions/_shared/email-templates/comeBack.tsx"), "utf8"));
    expect(tpl).toMatch(/footer=\{<MarketingFooter unsubscribeUrl=\{unsubscribeUrl\} reasonLine=\{COME_BACK_REASON\} \/>\}/);
    expect(tpl).toMatch(/unsubscribeUrl: string/);
  });
});
