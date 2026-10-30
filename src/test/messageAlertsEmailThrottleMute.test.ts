/**
 * Messages audit E3 (10-30) H1 + M6 + M4, owner 09:12 via the lead: a new chat
 * message reaches the member outside the app (one email, ON for everyone by
 * default, never the words), at most once per conversation per 15 minutes, with
 * a "Show message words" switch, and a muted thread alerts nobody.
 *
 * Read from the NEWEST definition of notify_message_recipient (the only producer
 * of 'message' bell rows) and the Settings screen's own defaults. The behaviour
 * runs in src/test/pglite/messageAlertThrottleMute.pglite.mjs (migration applied
 * 3x; red with NEW_MIGRATION=skip, 14 checks fail on prod's code).
 *
 * @mutate supabase/migrations/20261030141139_message_email_throttle_mute.sql |   IF NEW.job_id IS NOT NULL AND EXISTS (\n    SELECT 1 FROM public.thread_mutes tm | IF NEW.job_id IS NOT NULL AND false AND EXISTS (\n    SELECT 1 FROM public.thread_mutes tm
 * @mutate supabase/migrations/20261030141139_message_email_throttle_mute.sql |        AND n.created_at > now() - interval '15 minutes' |        AND n.created_at > now() - interval '15 seconds'
 * @mutate supabase/migrations/20261030141139_message_email_throttle_mute.sql |     CASE WHEN v_show_preview THEN preview ELSE 'Sent you a message.' END, |     preview,
 * @mutate supabase/migrations/20261030141139_message_email_throttle_mute.sql |  sent you a message on Louisiana Helpr. Open the conversation to read it and reply.', |  sent you a message: ' \|\| preview,
 * @mutate supabase/migrations/20261030141139_message_email_throttle_mute.sql |   IF v_email_on THEN |   IF false THEN
 * @mutate src/components/notificationPreferences/constants.tsx | email_job_updates: true, email_messages: true, | email_job_updates: true, email_messages: false,
 * @mutate src/components/NotificationPreferences.tsx |             <MessagePreviewRow | <div
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const fn = newestFunction("notify_message_recipient");
const body = blankSqlComments(fn.body);
const at = (s: string) => body.indexOf(s);
const bellInsert = at("INSERT INTO public.notifications");

describe("new-message alerts: email, throttle, preview switch, mute (Messages audit H1/M6/M4)", () => {
  it("reads the newest definition, which inserts the bell row", () => {
    expect(fn.file >= "20261030141139").toBe(true);
    expect(body.length).toBeGreaterThan(2500);
    expect(bellInsert).toBeGreaterThan(0);
  });

  it("M4: a muted thread returns before the bell row (so no push) and before the email", () => {
    const mute = at("FROM public.thread_mutes tm");
    expect(mute).toBeGreaterThan(0);
    expect(mute).toBeLessThan(bellInsert);
    const guard = body.slice(body.lastIndexOf("IF ", mute), body.indexOf("END IF;", mute));
    expect(guard).not.toMatch(/\bfalse\b/);
    expect(guard).toMatch(/tm\.user_id = NEW\.receiver_id/);
    expect(guard).toMatch(/tm\.other_user_id = NEW\.sender_id/);
    expect(guard).toMatch(/RETURN NEW;/);
  });

  it("M6: one alert per conversation per 15 minutes, checked under a lock before the bell row", () => {
    const throttle = at("interval '15 minutes'");
    expect(throttle).toBeGreaterThan(0);
    expect(throttle).toBeLessThan(bellInsert);
    expect(at("pg_advisory_xact_lock(")).toBeLessThan(throttle);
    expect(body.slice(throttle - 300, throttle)).toMatch(/n\.link = v_link/);
  });

  it("M6: the bell says only 'Sent you a message.' when the member turned previews off", () => {
    expect(body).toMatch(/CASE WHEN v_show_preview THEN preview ELSE 'Sent you a message\.' END/);
    expect(body).toMatch(/p\.message_preview/);
  });

  it("H1: one email per alert through send-notification-email as type 'message', gated on email_messages, never the words", () => {
    const post = at("/functions/v1/send-notification-email");
    expect(post).toBeGreaterThan(bellInsert);
    expect(body).toMatch(/IF v_email_on THEN/);
    expect(body).toMatch(/p\.email_messages/);
    const emailBody = body.slice(at("body := jsonb_build_object(", ), body.indexOf(");", post + 200));
    expect(emailBody).toMatch(/'type', 'message'/);
    expect(emailBody).not.toMatch(/\bpreview\b|NEW\.content|preview_full/);
  });

  it("H1: the Settings screen shows message email ON by default and offers the preview switch", () => {
    const constants = blankComments(readFileSync("src/components/notificationPreferences/constants.tsx", "utf8"));
    expect(constants).toMatch(/email_messages: true,/);
    expect(constants).toMatch(/message_preview: true,/);
    const screen = blankComments(readFileSync("src/components/NotificationPreferences.tsx", "utf8"));
    expect(screen).toMatch(/<MessagePreviewRow/);
    expect(screen).toMatch(/toggle\("message_preview"\)/);
  });
});
