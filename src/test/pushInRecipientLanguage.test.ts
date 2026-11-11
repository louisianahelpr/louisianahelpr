/**
 * F260q (owner 11-11 "Spanish everything"): a push to a member who picked Spanish (profiles.language = 'es') carries
 * the Spanish title and body on the device, from the same shape list the app uses (_shared/noticeEs.ts). Holds:
 * the pure chooser (pushLanguage.ts), and the sender reading profiles.language for the recipient and handing the
 * translated text to BOTH device paths (APNs and Web Push), after the admin fallback (ops alerts keep English).
 *
 * @mutate supabase/functions/send-push-notification/pushLanguage.ts |   if (language !== 'es') return { title, body } |   if (language !== 'en') return { title, body }
 * @mutate supabase/functions/send-push-notification/index.ts | sendApnsOne(apnsHost, jwt, bundleId, t.token, devicePayload) | sendApnsOne(apnsHost, jwt, bundleId, t.token, payload)
 * @mutate supabase/functions/send-push-notification/index.ts | { title: devicePayload.title, message: devicePayload.body, | { title: payload.title, message: payload.body,
 * @mutate supabase/functions/send-push-notification/index.ts |     .eq('user_id', payload.user_id)\n    .maybeSingle()\n  if (langErr) |     .eq('user_id', 'x')\n    .maybeSingle()\n  if (langErr)
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { pushTextInLanguage } from "../../supabase/functions/send-push-notification/pushLanguage";
import { NOTICE_SHAPES } from "../../supabase/functions/_shared/noticeEs";

const ROOT = resolve(__dirname, "..", "..");
const SENDER = blankComments(readFileSync(join(ROOT, "supabase/functions/send-push-notification/index.ts"), "utf8"));

describe("push text follows the recipient's language (F260q)", () => {
  it("Spanish readers get the Spanish shape; English and unknown stay as written", () => {
    expect(NOTICE_SHAPES.length).toBeGreaterThan(100);
    expect(pushTextInLanguage("es", "New application", 'Your payout for "Mow lawn" has been released to your account.')).toEqual({
      title: "Nueva postulación",
      body: 'Su pago por "Mow lawn" se liberó a su cuenta.',
    });
    expect(pushTextInLanguage("en", "New application", "x")).toEqual({ title: "New application", body: "x" });
    expect(pushTextInLanguage(null, "New application", "x")).toEqual({ title: "New application", body: "x" });
    expect(pushTextInLanguage("es", "A shape nobody wrote", "Free text")).toEqual({ title: "A shape nobody wrote", body: "Free text" });
  });

  it("the sender reads the recipient's profiles.language and sends the translated text on both device paths", () => {
    expect(SENDER).toMatch(/\.from\('profiles'\)\s*\.select\('language'\)\s*\.eq\('user_id', payload\.user_id\)\s*\.maybeSingle\(\)/);
    expect(SENDER).toMatch(/pushTextInLanguage\(langErr \? null : langRow\?\.language, payload\.title, payload\.body\)/);
    expect(SENDER).toMatch(/sendApnsOne\(apnsHost, jwt, bundleId, t\.token, devicePayload\)/);
    expect(SENDER).toMatch(/\{ title: devicePayload\.title, message: devicePayload\.body,/);
    // The language read sits after the admin no-device fallback, so ops alerts and their severity stay English.
    expect(SENDER.indexOf(".select('language')")).toBeGreaterThan(SENDER.indexOf("no_registered_devices"));
  });
});
