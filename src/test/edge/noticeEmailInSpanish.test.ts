/**
 * F260q (owner 11-11 "Spanish everything"): the notice email follows the recipient's language (profiles.language).
 * A member who picked Spanish gets the subject and message re-written by the shared notice shapes
 * (_shared/noticeEs.ts), the button in Spanish, and the template's own words (preheader, greeting, footer) in Spanish.
 * An English reader, or a failed language read, gets exactly what the notice said. Real sender source, edge harness.
 *
 * @mutate supabase/functions/send-notification-email/index.ts |     const lang: 'en' \| 'es' = !langErr && langRow?.language === 'es' ? 'es' : 'en' |     const lang: 'en' \| 'es' = 'en'
 * @mutate supabase/functions/send-notification-email/index.ts |       lang === 'es' ? noticeInSpanish(message) : message, |       message,
 * @mutate supabase/functions/send-notification-email/index.ts |       subject,\n      html, |       subject: title,\n      html,
 * @mutate supabase/functions/send-notification-email/index.ts |       lang,\n      userName, |       userName,
 * @mutate supabase/functions/_shared/email-templates/notificationAction.ts |   return lang === "es" ? (ACTION_LABEL_ES[label] ?? label) : label; |   return label;
 * @mutate supabase/functions/_shared/email-templates/notification.tsx |   const w = NOTICE_EMAIL_WORDS[lang] |   const w = NOTICE_EMAIL_WORDS.en
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks, emailRenders } from "./mocks/email";
import { blankComments } from "../helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..", "..");

async function loadSender(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", RESEND_API_KEY: "re_test" });
  return loadEdgeFunction("send-notification-email");
}

type Queued = { subject: string };
type Props = { title: string; message: string; actionLabel: string; lang?: string };

function setup(language: string | undefined) {
  resetSupabaseMock();
  resetSharedMocks();
  resetEmailMocks();
  resetEnv();
  scenario.reads.notification_preferences = { rows: [{ user_id: "real-user-1", email_job_applications: true, email_work_status: true }] };
  scenario.reads.profiles = { rows: [{ email: "real.user@gmail.com", full_name: "Real User", ...(language ? { language } : {}) }] };
  scenario.reads.suppressed_emails = { rows: [] };
  scenario.rpc.notification_crosses_seed_boundary = false;
}

async function send() {
  const fn = await loadSender();
  const res = await fn.fetch(fn.request({
    headers: { Authorization: "Bearer service-key" },
    body: {
      user_id: "real-user-1",
      title: "New application",
      message: 'Your payout for "Mow lawn" has been released to your account.',
      type: "application",
      link: "/jobs?job=1",
    },
  }));
  expect(res.status).toBe(200);
  const queued = (scenario.rpcCalls ?? []).filter((c) => c.name === "enqueue_email").map((c) => (c.args as { payload: Queued }).payload);
  expect(queued).toHaveLength(1);
  const props = (emailRenders.at(-1) as { props: Props }).props;
  return { subject: queued[0].subject, props };
}

describe("the notice email follows the recipient's language (F260q)", () => {
  beforeEach(() => setup(undefined));

  it("a Spanish reader gets the subject, message, button and template words in Spanish", async () => {
    setup("es");
    const { subject, props } = await send();
    expect(subject).toBe("Nueva postulación");
    expect(props.title).toBe("Nueva postulación");
    expect(props.message).toBe('Su pago por "Mow lawn" se liberó a su cuenta.');
    expect(props.actionLabel).toBe("Ver el trabajo");
    expect(props.lang).toBe("es");
  });

  it("an English reader (or no language) gets the notice exactly as written", async () => {
    for (const lang of ["en", undefined]) {
      setup(lang);
      const { subject, props } = await send();
      expect(subject).toBe("New application");
      expect(props.message).toBe('Your payout for "Mow lawn" has been released to your account.');
      expect(props.actionLabel).toBe("See the job");
      expect(props.lang).toBe("en");
    }
  });

  it("the template's own words come from the reader's language", () => {
    const tpl = blankComments(readFileSync(join(ROOT, "supabase/functions/_shared/email-templates/notification.tsx"), "utf8"));
    expect(tpl).toContain("const w = NOTICE_EMAIL_WORDS[lang]");
    for (const k of ["preheader", "hey", "why", "change", "open"]) expect(tpl).toMatch(new RegExp(`\\bw\\.${k}\\b`));
    expect(tpl).toContain("hey: 'Hola'");
    expect(tpl).toContain("Cambiar qué correos recibe");
    expect(tpl.match(/\bw\.[a-z]+/g)?.length ?? 0).toBeGreaterThan(5);
  });
});
