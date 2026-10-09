/**
 * Sign-up leads (owner pop-up 2026-10-09, "Save it, follow up once"): the
 * shape of every layer, read from the NEWEST definitions.
 *
 * Behaviour is proven in src/test/pglite/signupLeads.pglite.mjs (migration
 * applied 3x): ALL PASS with it, every check FAILED with NEW_MIGRATION=skip.
 * The edge functions are run in src/test/edge/signup-lead-reminders.test.ts.
 * This file pins what those cannot see together: the grants, the
 * claim-before-send UPDATE, the completion trigger, the schedule, and the
 * client wiring (step 1 captures without awaiting, and says so on screen).
 *
 * @mutate supabase/migrations/20261009173906_signup_leads.sql | REVOKE ALL ON TABLE public.signup_leads FROM PUBLIC, anon, authenticated; | REVOKE ALL ON TABLE public.signup_leads FROM PUBLIC;
 * @mutate supabase/migrations/20261009173906_signup_leads.sql | REVOKE ALL ON FUNCTION public.record_signup_lead(text, text, text) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.record_signup_lead(text, text, text) FROM PUBLIC;
 * @mutate supabase/migrations/20261009173906_signup_leads.sql | AND l.reminder_sent_at IS NULL\n        AND l.unsubscribed_at IS NULL\n        AND NOT public | AND l.unsubscribed_at IS NULL\n        AND NOT public
 * @mutate supabase/migrations/20261009173906_signup_leads.sql |       FOR UPDATE SKIP LOCKED\n | \n
 * @mutate supabase/migrations/20261009173906_signup_leads.sql |         AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.email = l.email)\n        AND NOT EXISTS (SELECT 1 FROM public.profiles | \n        AND NOT EXISTS (SELECT 1 FROM public.profiles
 * @mutate supabase/migrations/20261009173906_signup_leads.sql |         AND NOT public.is_fixture_email(l.email)\n | \n
 * @mutate supabase/migrations/20261009173906_signup_leads.sql |   AFTER INSERT ON auth.users | AFTER UPDATE OF phone ON auth.users
 * @mutate supabase/migrations/20261009173906_signup_leads.sql |   DELETE FROM public.signup_leads\n   WHERE created_at < now() - interval '30 days' |   DELETE FROM public.signup_leads\n   WHERE false
 * @mutate supabase/migrations/20261009173906_signup_leads.sql |     AND (completed_at IS NOT NULL OR (reminder_sent_at IS NULL AND unsubscribed_at IS NULL)); |     ;
 * @mutate supabase/migrations/20261009173906_signup_leads.sql |       AND l.created_at > now() - interval '2 hours'\n | \n
 * @mutate src/pages/auth/Signup.tsx | captureLead(email); // ONE | // ONE
 * @mutate src/lib/signupLead.ts |     capturedLeadRef.current = email;\n | \n
 * @mutate src/lib/signupLead.ts |     void captureSignupLead(email, | captureSignupLead(email,
 * @mutate src/pages/auth/signup/SignupStep1.tsx |         We may email you once if you don't finish signing up.\n | \n
 * @mutate supabase/functions/email-unsubscribe/index.ts |     .from('signup_leads') |     .from('signup_leads_x')
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

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

const FUNCTIONS = [
  "record_signup_lead(text, text, text)",
  "sweep_signup_leads()",
  "claim_signup_lead_reminders(integer)",
  "mark_signup_lead_completed()",
];

describe("signup leads: database layer", () => {
  it("reads a real migration corpus", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(all).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.signup_leads/i);
  });

  it("the table is service_role only: RLS on, no policy, every client role revoked", () => {
    expect(all).toMatch(/ALTER\s+TABLE\s+public\.signup_leads\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(all).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.signup_leads\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i);
    expect(all).not.toMatch(/CREATE\s+POLICY\s+[^;]*\s+ON\s+public\.signup_leads\b/i);
    expect(all).not.toMatch(/GRANT\s+[^;]*ON\s+(?:TABLE\s+)?public\.signup_leads\s+TO\s+[^;]*\b(?:anon|authenticated|PUBLIC)\b/i);
    // No password column, ever.
    const table = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.signup_leads\s*\(([\s\S]*?)\n\);/i.exec(all)![1];
    expect(table).not.toMatch(/password/i);
  });

  it("every lead function is closed to PUBLIC, anon and authenticated, and granted to nobody else", () => {
    for (const sig of FUNCTIONS) {
      const esc = sig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(all, sig).toMatch(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${esc}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated\\s*;`, "i"));
      expect(all, sig).not.toMatch(new RegExp(`GRANT\\s+[^;]*ON\\s+FUNCTION\\s+public\\.${esc}\\s+TO\\s+[^;]*\\b(?:anon|authenticated|PUBLIC)\\b`, "i"));
      expect(newestBody(sig.split("(")[0]), sig).toMatch(/SECURITY\s+DEFINER[\s\S]*SET\s+search_path\s*=\s*''/i);
    }
  });

  it("record_signup_lead validates, is idempotent, and completes an address that already has an account", () => {
    const b = newestBody("record_signup_lead");
    expect(b).toMatch(/RAISE\s+EXCEPTION\s+'invalid_email'/i);
    expect(b).toMatch(/length\(v_email\)\s*>\s*254/i);
    expect(b).toMatch(/ON\s+CONFLICT\s*\(email\)\s+DO\s+NOTHING/i);
    expect(b).toMatch(/EXISTS\s*\(SELECT\s+1\s+FROM\s+auth\.users/i);
    // A corrected typo is dropped only while fresh and untouched.
    expect(b).toMatch(/DELETE\s+FROM\s+public\.signup_leads\s+l\s+WHERE\s+l\.email\s*=\s*v_replaces\s+AND\s+l\.created_at\s*>\s*now\(\)\s*-\s*interval\s+'2 hours'\s+AND\s+l\.reminder_sent_at\s+IS\s+NULL\s+AND\s+l\.completed_at\s+IS\s+NULL\s+AND\s+l\.unsubscribed_at\s+IS\s+NULL/i);
  });

  it("the claim stamps reminder_sent_at in the SAME UPDATE that returns the leads, skipping locked rows", () => {
    const b = newestBody("claim_signup_lead_reminders");
    expect(b).toMatch(/RETURN\s+QUERY\s+UPDATE\s+public\.signup_leads\s+t\s+SET\s+reminder_sent_at\s*=\s*now\(\)/i);
    expect(b).toMatch(/FOR\s+UPDATE\s+SKIP\s+LOCKED/i);
    expect(b).toMatch(/RETURNING\s+t\.id,\s*t\.email/i);
    for (const cond of [
      /l\.created_at\s*<=\s*now\(\)\s*-\s*interval\s+'24 hours'/i,
      /l\.completed_at\s+IS\s+NULL/i,
      /l\.reminder_sent_at\s+IS\s+NULL/i,
      /l\.unsubscribed_at\s+IS\s+NULL/i,
      /NOT\s+public\.is_fixture_email\(l\.email\)/i,
      /NOT\s+EXISTS\s*\(SELECT\s+1\s+FROM\s+auth\.users\s+u\s+WHERE\s+u\.email\s*=\s*l\.email\)/i,
      /NOT\s+EXISTS\s*\(SELECT\s+1\s+FROM\s+public\.profiles/i,
      /NOT\s+EXISTS\s*\(SELECT\s+1\s+FROM\s+public\.suppressed_emails/i,
      /least\(coalesce\(p_limit,\s*50\),\s*200\)/i,
    ]) {
      expect(b).toMatch(cond);
    }
  });

  it("an auth user insert completes the lead and can never block account creation", () => {
    expect(all).toMatch(/CREATE\s+TRIGGER\s+zz_mark_signup_lead_completed\s+AFTER\s+INSERT\s+ON\s+auth\.users\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+public\.mark_signup_lead_completed\(\)/i);
    const b = newestBody("mark_signup_lead_completed");
    expect(b).toMatch(/SET\s+completed_at\s*=\s*now\(\)/i);
    expect(b).toMatch(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN\s+RAISE\s+WARNING/i);
  });

  it("the sweep backstops completion and deletes untouched leads older than 30 days, keeping the never-twice record", () => {
    const b = newestBody("sweep_signup_leads");
    expect(b).toMatch(/EXISTS\s*\(SELECT\s+1\s+FROM\s+auth\.users/i);
    expect(b).toMatch(
      /DELETE\s+FROM\s+public\.signup_leads\s+WHERE\s+created_at\s*<\s*now\(\)\s*-\s*interval\s+'30 days'\s+AND\s+\(completed_at\s+IS\s+NOT\s+NULL\s+OR\s+\(reminder_sent_at\s+IS\s+NULL\s+AND\s+unsubscribed_at\s+IS\s+NULL\)\)/i,
    );
  });

  it("the cron job calls the edge function that exists, with a liveness expectation", () => {
    expect(all).toMatch(/cron\.schedule\('signup-lead-reminders',\s*'23 14-23 \* \* \*'/i);
    expect(all).toMatch(/\/functions\/v1\/signup-lead-reminders/);
    expect(all).toMatch(/cron_work_expectations[\s\S]*'signup-lead-reminders'/i);
    expect(existsSync(join(ROOT, "supabase/functions/signup-lead-reminders/index.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "supabase/functions/record-signup-lead/index.ts"))).toBe(true);
  });
});

describe("signup leads: client and unsubscribe layers", () => {
  const signup = blankComments(readFileSync(join(ROOT, "src/pages/auth/Signup.tsx"), "utf8"));
  const step1 = blankComments(readFileSync(join(ROOT, "src/pages/auth/signup/SignupStep1.tsx"), "utf8"));
  const lib = blankComments(readFileSync(join(ROOT, "src/lib/signupLead.ts"), "utf8"));
  const unsub = blankComments(readFileSync(join(ROOT, "supabase/functions/email-unsubscribe/index.ts"), "utf8"));

  it("step 1 captures the email after validation, without awaiting it (never blocks sign-up)", () => {
    const cont = signup.indexOf("onContinue={async () => {");
    expect(cont).toBeGreaterThan(-1);
    const block = signup.slice(cont, signup.indexOf("setStep(2);", cont));
    expect(block).toMatch(/await validateAccountStep\(\)/);
    expect(block).toMatch(/\n\s*captureLead\(email\);/);
    expect(block).not.toMatch(/await\s+captureLead/);
    expect(block.indexOf("validateAccountStep")).toBeLessThan(block.indexOf("captureLead"));
    expect(signup).toMatch(/const captureLead = useSignupLeadCapture\(\);/);
    // The hook fires without awaiting and remembers the last address (typo fix replaces it).
    const hook = lib.slice(lib.indexOf("export function useSignupLeadCapture"));
    expect(hook).toMatch(/\n\s*void captureSignupLead\(email,[^\n]*capturedLeadRef\.current\);/);
    expect(hook).toMatch(/capturedLeadRef\.current = email;/);
  });

  it("step 1 tells the visitor before it happens", () => {
    expect(step1).toContain("We may email you once if you don't finish signing up.");
  });

  it("the one-click unsubscribe also stamps the lead, and a failed write is not reported as success", () => {
    expect(unsub).toMatch(/\.from\('signup_leads'\)\s*\.update\(\{\s*unsubscribed_at:/);
    expect(unsub).toMatch(/if \(leadError && leadError\.code !== '42P01' && leadError\.code !== 'PGRST205'\) \{[\s\S]*?if \(!profile\) \{[\s\S]*?500/);
  });
});
