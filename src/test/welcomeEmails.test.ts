/**
 * Welcome emails (owner 11-14, "Yes do that"): the database shape, the hand-over from the old drip, and the copy,
 * read from the NEWEST definitions.
 *
 * Behaviour is proven in src/test/pglite/welcomeEmails.pglite.mjs (the migration applied 3x): 50 PASS;
 * NEW_MIGRATION=skip fails; 4 planted defects each caught (2026-11-14). The sender is run in
 * src/test/edge/welcome-emails.test.ts. This file pins what those cannot see together: no switch (owner rule: ship on
 * for everyone), the Q2299 consent rule unchanged, the grants, the cron, the old drip no longer sending day 1 and
 * day 3, and the copy in both languages.
 *
 * @mutate supabase/migrations/20261114234041_welcome_emails.sql | np.email_promotions IS FALSE OR | np.email_promotions IS NOT TRUE OR
 * @mutate supabase/migrations/20261114234041_welcome_emails.sql |        AND p.marketing_consent IS TRUE |        AND true
 * @mutate supabase/migrations/20261114234041_welcome_emails.sql |        AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id) |        AND true
 * @mutate supabase/migrations/20261114234041_welcome_emails.sql | REVOKE ALL ON FUNCTION public.claim_welcome_emails(integer, integer) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.claim_welcome_emails(integer, integer) FROM PUBLIC;
 * @mutate supabase/migrations/20261114234041_welcome_emails.sql | REVOKE ALL ON TABLE public.welcome_email_sends FROM PUBLIC, anon, authenticated; | REVOKE ALL ON TABLE public.welcome_email_sends FROM PUBLIC;
 * @mutate supabase/migrations/20261114234041_welcome_emails.sql |     ON CONFLICT ON CONSTRAINT welcome_email_sends_pkey DO NOTHING |     ON CONFLICT ON CONSTRAINT welcome_email_sends_pkey DO UPDATE SET claimed_at = now()
 * @mutate supabase/migrations/20261114234041_welcome_emails.sql | '/functions/v1/welcome-emails', | '/functions/v1/welcome-emails-x',
 * @mutate supabase/migrations/20261114234041_welcome_emails.sql |   email_step smallint NOT NULL CHECK (email_step IN (1, 3)), |   email_step smallint NOT NULL,
 * @mutate supabase/functions/_shared/welcomeEmail.ts |       subject: "New near you on Louisiana Helpr", |       subject: "New Near You on Louisiana Helpr!",
 * @mutate supabase/functions/_shared/welcomeEmail.ts |       button: "Ver lo que hay cerca", |       button: "See what's near you",
 * @mutate supabase/functions/_shared/email-templates/welcome.tsx |           unsubscribeLabel={WELCOME_UNSUBSCRIBE[lang]} |           unsubscribeLabel={undefined}
 * @mutate supabase/config.toml |   [functions.welcome-emails]\n    verify_jwt = false |
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import {
  WELCOME_COPY,
  WELCOME_REASON,
  WELCOME_UNSUBSCRIBE,
  welcomeGreeting,
  welcomeLang,
  welcomePriceLabel,
  welcomeTemplateName,
} from "../../supabase/functions/_shared/welcomeEmail";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort()
  .map((f) => ({ f, sql: blankSqlComments(readFileSync(join(MIG, f), "utf8")) }));
const all = files.map(({ sql }) => sql).join("\n");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

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

describe("welcome emails: the claim", () => {
  it("has no switch (owner rule: ship on for everyone; owner 'Yes do that' 11-14)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(all).not.toMatch(/feature_switches[^;]*'welcome_emails'/i);
    expect(newestBody("claim_welcome_emails")).not.toMatch(/feature_enabled_for_user/);
  });

  it("uses the Q2299 consent rule unchanged: the sign-up box, and only an explicit Promotions-off stops it", () => {
    const b = newestBody("claim_welcome_emails");
    expect(b).toMatch(/p\.marketing_consent IS TRUE/);
    expect(b).toMatch(/np\.email_promotions IS FALSE OR np\.email_enabled IS FALSE/);
    for (const rule of [
      /p\.email_verified IS TRUE/,
      /p\.is_seed IS NOT TRUE/,
      /public\.test_accounts t WHERE t\.user_id = p\.user_id/,
      /public\.suppressed_emails s WHERE lower\(s\.email\) = lower\(p\.email\)/,
      /NOT public\.is_fixture_email\(p\.email\)/,
      /lower\(u\.email\) = lower\(p\.email\)/,
      /p\.last_drip_at < now\(\) - interval '20 hours'/,
      /come_back_email_sends c\s+WHERE c\.user_id = p\.user_id AND c\.claimed_at >= now\(\) - interval '20 hours'/,
    ]) expect(b).toMatch(rule);
  });

  it("claims before mailing, never twice, never an old drip day again", () => {
    const b = newestBody("claim_welcome_emails");
    expect(b).toMatch(/ON CONFLICT ON CONSTRAINT welcome_email_sends_pkey DO NOTHING/);
    expect(b).toMatch(/p_step = 1[\s\S]*?coalesce\(p\.drip_step, 0\) < 1\)/);
    expect(b).toMatch(/p_step = 3[\s\S]*?coalesce\(p\.drip_step, 0\) < 2\)/);
    expect(all).toMatch(/email_step smallint NOT NULL CHECK \(email_step IN \(1, 3\)\)/);
  });

  it("is service_role only, and the cron calls the function twice a day", () => {
    expect(all).toMatch(/REVOKE ALL ON TABLE public\.welcome_email_sends FROM PUBLIC, anon, authenticated;/);
    expect(all).toMatch(/REVOKE ALL ON FUNCTION public\.claim_welcome_emails\(integer, integer\) FROM PUBLIC, anon, authenticated;/);
    expect(all).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_welcome_emails\(integer, integer\) TO service_role;/);
    expect(all).toMatch(/cron\.schedule\('welcome-emails', '17 15,21 \* \* \*'/);
    expect(all).toMatch(/'\/functions\/v1\/welcome-emails',/);
    expect(read("supabase/config.toml")).toMatch(/\[functions\.welcome-emails\]\n\s+verify_jwt = false/);
  });
});

describe("welcome emails: the old drip hands day 1 and day 3 over", () => {
  it("engagement-automations' daily loop sends only the day 7 email", () => {
    const src = blankComments(read("supabase/functions/engagement-automations/index.ts"));
    expect(src).toContain("if ((user.drip_step ?? 0) < 3 && daysSinceSignup >= 7) targetStep = 3");
    expect(src).not.toMatch(/targetStep = 1\b/);
    expect(src).not.toMatch(/targetStep = 2\b/);
  });
});

describe("welcome emails: the copy", () => {
  const langs = ["en", "es"] as const;
  const steps = [1, 3] as const;
  it("both languages have both steps, every field filled, no exclamation marks, Helpr never helper", () => {
    let n = 0;
    for (const lang of langs) {
      for (const step of steps) {
        const c = WELCOME_COPY[lang][step];
        const words = [c.subject, c.preheader, c.heading, ...c.intro, c.jobsHeading, c.itemsHeading, c.nothingNear, c.button, c.closing];
        for (const w of words) {
          n++;
          expect(w.trim().length, `${lang} ${step}`).toBeGreaterThan(0);
          expect(w).not.toContain("!");
          expect(w).not.toMatch(/\bhelper\b/i);
        }
      }
    }
    expect(n).toBe(40);
  });

  it("subjects are sentence case and Spanish is really Spanish", () => {
    expect(WELCOME_COPY.en[3].subject).toBe("New near you on Louisiana Helpr");
    expect(WELCOME_COPY.en[1].subject).toBe("Welcome to Louisiana Helpr. Here's what's near you.");
    for (const step of steps) {
      expect(WELCOME_COPY.es[step].jobsHeading).toBe("Trabajos cerca de ti");
      expect(WELCOME_COPY.es[step].subject).not.toBe(WELCOME_COPY.en[step].subject);
    }
    expect(WELCOME_COPY.es[3].button).toBe("Ver lo que hay cerca");
    expect(WELCOME_REASON.es).not.toBe(WELCOME_REASON.en);
    expect(WELCOME_UNSUBSCRIBE.es).toBe("Cancelar la suscripción a estos correos");
  });

  it("greeting, language, price and template names", () => {
    expect(welcomeGreeting("Pat Smith", "en")).toBe("Hi Pat,");
    expect(welcomeGreeting(null, "en")).toBe("Hi there,");
    expect(welcomeGreeting("Ana Ruiz", "es")).toBe("Hola Ana,");
    expect(welcomeGreeting("  ", "es")).toBe("Hola,");
    expect(welcomeLang("es")).toBe("es");
    expect(welcomeLang("en")).toBe("en");
    expect(welcomeLang(null)).toBe("en");
    expect(welcomePriceLabel(4000, "en")).toBe("$40");
    expect(welcomePriceLabel(1250, "en")).toBe("$12.50");
    expect(welcomePriceLabel(0, "en")).toBe("Free");
    expect(welcomePriceLabel(0, "es")).toBe("Gratis");
    expect([welcomeTemplateName(1), welcomeTemplateName(3)]).toEqual(["welcome_day_1", "welcome_day_3"]);
  });

  it("the template carries the one-click unsubscribe in the email's language", () => {
    const t = blankComments(read("supabase/functions/_shared/email-templates/welcome.tsx"));
    expect(t).toContain("unsubscribeUrl={unsubscribeUrl}");
    expect(t).toContain("reasonLine={WELCOME_REASON[lang]}");
    expect(t).toContain("unsubscribeLabel={WELCOME_UNSUBSCRIBE[lang]}");
    expect(t).toContain("lang={lang}");
  });
});
