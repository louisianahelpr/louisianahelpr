/**
 * Q2299 (owner, 2026-10-21, issue #3498): the sign-up email box ALONE is
 * enough for the welcome emails and the come-back ("follow-up") emails.
 * Promotions turned off in Settings still stops them, and so does every
 * unsubscribe and suppression.
 *
 * The design (migration 20261021135832): notification_preferences.
 * email_promotions is three-valued. NULL = never chosen (the new default; a
 * one-time backfill turns a false that was never written after insert into
 * NULL), true = turned on, false = turned off by the member or an unsubscribe
 * link. The come-back claim and engagement-automations skip only an explicit
 * false. send-marketing-blast and the 'promotion' notification email keep
 * the reach they had (they need an explicit true): the owner's words cover the
 * welcome and follow-up emails only.
 *
 * Behaviour is proven in src/test/pglite/promotionsNotChosen.pglite.mjs (the
 * real switch and come-back migrations, then both new ones 3x): 32 PASS;
 * NEW_MIGRATION=skip 16 FAIL; 10 of 11 planted defects caught (2026-10-21).
 * The senders are run in src/test/edge/engagement-automations.test.ts and
 * src/test/edge/resubscribeKeepsConsentOff.test.ts; the Settings switch in
 * src/test/promotionsEmailSwitch.test.tsx. This file pins the rule in every
 * place that reads the column, so a new commercial sender has to pick a side.
 *
 * @mutate supabase/migrations/20261021135832_promotions_not_chosen_until_set.sql | ALTER COLUMN email_promotions SET DEFAULT NULL; | ALTER COLUMN email_promotions SET DEFAULT false;
 * @mutate supabase/migrations/20261021135832_promotions_not_chosen_until_set.sql |    AND updated_at = created_at; |    AND true;
 * @mutate supabase/migrations/20261021135832_promotions_not_chosen_until_set.sql | np.email_promotions IS FALSE OR | np.email_promotions IS NOT TRUE OR
 * @mutate supabase/functions/engagement-automations/index.ts |         .filter((p) => p.email_promotions === false \|\| p.email_enabled === false) |         .filter((p) => p.email_promotions !== true \|\| p.email_enabled === false)
 * @mutate supabase/functions/send-marketing-blast/index.ts |           .filter((p) => p.email_promotions !== true \|\| p.email_enabled === false) |           .filter((p) => p.email_promotions === false \|\| p.email_enabled === false)
 * @mutate supabase/functions/email-unsubscribe/index.ts | saved.email_promotions === true ? true : null) | true)
 * @mutate src/lib/promotionsEmail.ts |   return marketingConsent === true; |   return false;
 * @mutate src/components/notificationPreferences/constants.tsx | email_promotions: null, email_system_alerts: true, | email_promotions: false, email_system_alerts: true,
 * @mutate supabase/functions/_shared/email-templates/comeBack.tsx |         Founder, Louisiana Helpr |         The Louisiana Helpr team
 * @mutate supabase/functions/_shared/comeBackEmail.ts | export const FOUNDER_NAME = "Lexi"; | export const FOUNDER_NAME = "The founder";
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { promotionsEmailOn } from "@/lib/promotionsEmail";
import { defaultPrefs } from "@/components/notificationPreferences/constants";
import { FOUNDER_NAME } from "../../supabase/functions/_shared/comeBackEmail";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase", "migrations");
const migrations = readdirSync(MIG)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort()
  .map((f) => ({ f, sql: blankSqlComments(readFileSync(join(MIG, f), "utf8")) }));
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** Newest CREATE [OR REPLACE] FUNCTION public.<name> body, any dollar tag. */
function newestBody(name: string): string {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  const hits = migrations.filter(({ sql }) => new RegExp(head.source, "i").test(sql));
  expect(hits.length, `no migration defines public.${name}`).toBeGreaterThan(0);
  const { sql } = hits[hits.length - 1];
  const at = [...sql.matchAll(head)].pop()!.index!;
  const tag = /AS\s+(\$\w*\$)/i.exec(sql.slice(at))![1];
  const open = sql.indexOf(tag, at);
  return sql.slice(at, sql.indexOf(tag, open + tag.length) + tag.length);
}

/**
 * Every edge-function file whose CODE (comments blanked) names email_promotions,
 * and the rule it applies. EXACT both ways: a new reader fails until it is
 * listed here with its rule, and a listed file that stops reading the column
 * fails too.
 */
const READERS: Record<string, { rule: string; pin: RegExp }> = {
  "supabase/functions/engagement-automations/index.ts": {
    rule: "welcome drip + win-back: only an explicit false (or the Email master off) stops them",
    pin: /\.filter\(\(p\) => p\.email_promotions === false \|\| p\.email_enabled === false\)/,
  },
  "supabase/functions/send-marketing-blast/index.ts": {
    rule: "marketing blast: unchanged reach, needs an explicit true",
    pin: /\.filter\(\(p\) => p\.email_promotions !== true \|\| p\.email_enabled === false\)/,
  },
  "supabase/functions/send-notification-email/index.ts": {
    rule: "the 'promotion' notification email: unchanged, a falsy column (NULL included) skips",
    pin: /promotion:\s*\{\s*prefCol:\s*'email_promotions'[\s\S]*!\(prefs as any\)\[prefColumn\]/,
  },
  "supabase/functions/email-unsubscribe/index.ts": {
    rule: "unsubscribe writes false; resubscribe restores exactly true or the never-chosen NULL",
    pin: /saved\.email_promotions !== false\)[\s\S]*saved\.email_promotions === true \? true : null\)/,
  },
  "supabase/functions/_shared/unsubscribe.ts": {
    rule: "names the commercial consent columns",
    pin: /preferences:\s*'email_promotions'/,
  },
};

describe("Q2299: the sign-up box alone is enough for the welcome and come-back emails", () => {
  it("email_promotions is three-valued: nullable, default NULL, and the backfill NULLs only a false never written since insert", () => {
    expect(migrations.length).toBeGreaterThan(500);
    const alters = migrations.filter(({ sql }) => /ALTER\s+COLUMN\s+email_promotions\b/i.test(sql));
    expect(alters.length).toBeGreaterThan(0);
    const { f, sql } = alters[alters.length - 1];
    expect(f).toBe("20261021135832_promotions_not_chosen_until_set.sql");
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.notification_preferences\s+ALTER\s+COLUMN\s+email_promotions\s+DROP\s+NOT\s+NULL\s*;/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.notification_preferences\s+ALTER\s+COLUMN\s+email_promotions\s+SET\s+DEFAULT\s+NULL\s*;/i);
    expect(sql).toMatch(
      /UPDATE\s+public\.notification_preferences\s+SET\s+email_promotions\s*=\s*NULL\s+WHERE\s+email_promotions\s+IS\s+FALSE\s+AND\s+updated_at\s*=\s*created_at\s*;/i,
    );
    // Nothing later puts a NOT NULL or a false default back.
    const later = migrations.slice(migrations.findIndex((m) => m.f === f) + 1).map((m) => m.sql).join("\n");
    expect(later).not.toMatch(/ALTER\s+COLUMN\s+email_promotions\s+(SET\s+NOT\s+NULL|SET\s+DEFAULT\s+(false|true))/i);
  });

  it("the come-back claim skips only an explicit Promotions-off (and still needs the box)", () => {
    const b = newestBody("claim_come_back_emails");
    expect(b).toMatch(/np\.email_promotions\s+IS\s+FALSE\s+OR\s+np\.email_enabled\s+IS\s+FALSE/i);
    expect(b).not.toMatch(/email_promotions\s+IS\s+NOT\s+TRUE/i);
    expect(b).toMatch(/p\.marketing_consent\s+IS\s+TRUE/i);
    expect(b).toMatch(/NOT\s+EXISTS\s*\(SELECT\s+1\s+FROM\s+public\.suppressed_emails/i);
  });

  it("every edge function that reads email_promotions is listed with its rule (exact both ways)", () => {
    const readers = (readdirSync(join(ROOT, "supabase/functions"), { recursive: true }) as string[])
      .map((f) => `supabase/functions/${f.split("\\").join("/")}`)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("/node_modules/"))
      .filter((f) => /email_promotions/.test(code(f)));
    expect(readers.length).toBeGreaterThan(3);
    expect(readers.sort()).toEqual(Object.keys(READERS).sort());
    for (const [file, { rule, pin }] of Object.entries(READERS)) {
      expect(code(file), `${file}: ${rule}`).toMatch(pin);
    }
  });

  it("the welcome drip and win-back never read NULL as an opt-out", () => {
    const src = code("supabase/functions/engagement-automations/index.ts");
    expect(src).not.toMatch(/email_promotions\s*!==\s*true/);
    expect(src).not.toMatch(/!\s*p\.email_promotions\b/);
  });

  it("the Settings switch shows what the senders do while Promotions was never chosen", () => {
    // [stored, sign-up box] -> shown
    expect(promotionsEmailOn(null, true)).toBe(true);
    expect(promotionsEmailOn(undefined, true)).toBe(true);
    expect(promotionsEmailOn(null, false)).toBe(false);
    expect(promotionsEmailOn(false, true)).toBe(false);
    expect(promotionsEmailOn(true, false)).toBe(true);
    // A member with no row yet writes the column default, never an opt-out.
    expect(defaultPrefs.email_promotions).toBeNull();
  });

  it("the come-back emails are signed \"Lexi, Founder, Louisiana Helpr\"", () => {
    expect(FOUNDER_NAME).toBe("Lexi");
    const tpl = code("supabase/functions/_shared/email-templates/comeBack.tsx");
    expect(tpl).toMatch(/\{copy\.closing\}\s*<br \/>\s*\{FOUNDER_NAME\}\s*<br \/>\s*Founder, Louisiana Helpr\s*<\/Text>/);
  });

  it("the come-back switch goes on for everyone by an audited, replay-safe migration", () => {
    const on = migrations.find((m) => m.f === "20261021135921_come_back_emails_on_for_everyone.sql");
    expect(on).toBeDefined();
    expect(on!.sql).toMatch(
      /UPDATE\s+public\.feature_switches\s+SET\s+audience\s*=\s*'everyone'[\s\S]*WHERE\s+key\s*=\s*'come_back_emails'[\s\S]*NOT\s+EXISTS\s*\([\s\S]*admin_audit_log[\s\S]*target_id\s*=\s*'come_back_emails'\)\s*;/i,
    );
    // It runs after the switch is created and after the consent rule.
    const order = migrations.map((m) => m.f);
    expect(order.indexOf("20261021113827_come_back_emails.sql")).toBeLessThan(order.indexOf(on!.f));
    expect(order.indexOf("20261021135832_promotions_not_chosen_until_set.sql")).toBeLessThan(order.indexOf(on!.f));
  });
});
