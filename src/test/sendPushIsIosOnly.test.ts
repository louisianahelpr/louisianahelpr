/*
 * GUARD (docs/OPEN.md Q1126; owner 2026-10-03: "iOS only, remove dead FCM"):
 * there is no Android app, so send-push-notification has no FCM client. A
 * token registered as 'android' is counted and skipped, never sent, and no
 * Google OAuth or FCM endpoint is called from the push path.
 */
// @mutate supabase/functions/send-push-notification/index.ts | result.android = { skipped: 'android_unsupported', tokens: androidTokens.length } | result.android = { sent: androidTokens.length, failed: 0, tokens: androidTokens.length }
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
// Comments blanked: a commented-out line must not satisfy a positive check.
const SRC = blankComments(readFileSync(join(ROOT, "supabase/functions/send-push-notification/index.ts"), "utf8"));
const JWT = blankComments(readFileSync(join(ROOT, "supabase/functions/_shared/jwt.ts"), "utf8"));

describe("send-push-notification is iOS-only (Q1126)", () => {
  it("calls no FCM or Google OAuth endpoint and reads no FCM secret", () => {
    for (const s of ["fcm.googleapis.com", "oauth2.googleapis.com", "firebase.messaging", "FCM_PROJECT_ID", "FCM_SERVICE_ACCOUNT", "signRs256Jwt"]) expect(SRC, s).not.toContain(s);
    expect(JWT).not.toMatch(/export async function signRs256Jwt/);
  });

  it("an android token is counted as skipped, never sent", () => {
    expect(SRC).toContain("result.android = { skipped: 'android_unsupported', tokens: androidTokens.length }");
  });
});
