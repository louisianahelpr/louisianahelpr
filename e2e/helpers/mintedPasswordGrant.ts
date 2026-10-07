import type { Page, Route } from "@playwright/test";
import { test } from "../prodTest";
import { mintAdminSession, resolveServiceKey } from "../../scripts/lib/adminSession.mjs";

/**
 * THE LOGIN FORM, DRIVEN FOR REAL; ITS PASSWORD GRANT ANSWERED WITH A MINTED
 * SESSION (docs/OPEN.md Q1420, the last step before the Q1314 CAPTCHA cutover).
 *
 * Once Supabase Auth CAPTCHA is on, GoTrue refuses a password grant that has no
 * Turnstile token, and a CI build has none (no VITE_TURNSTILE_ENABLED; its
 * 127.0.0.1 origin is not a widget hostname). So the specs that sign in through
 * the form keep driving everything the user does (typing, validation, the
 * pending state, offline copy, the app's handling of the answer and where it
 * lands) and only the grant's ANSWER comes from here: a real session for the
 * same account, minted with the service role by scripts/lib/adminSession.mjs
 * (never a password; guard src/test/noAnonPasswordGrants.test.ts).
 *
 * No real password is read or typed: the form gets FORM_PASSWORD.
 */
export const FORM_PASSWORD = "not-a-real-password-minted-session";

/** Can a session for `email` be minted here (the account's address + the service-role key)? */
export function mintedSignInAvailable(email: string | undefined): boolean {
  return Boolean(email) && Boolean(resolveServiceKey());
}

export type MintedGrant = { answered: number; dropped: number };

/**
 * Answer the page's password grants for `email` with a minted session.
 *   delayMs:   hold each answer this long (a slow network's grant; a routed
 *              answer skips the throttled wire).
 *   dropFirst: lose the FIRST answer after the server would have signed in
 *              (abort 'internetdisconnected'), as the dropped-response step
 *              needs; later presses are answered.
 * A grant for any other address is answered 400 invalid_grant, as GoTrue would.
 */
export async function answerPasswordGrantWithMintedSession(
  page: Page,
  email: string,
  { delayMs = 0, dropFirst = false }: { delayMs?: number; dropFirst?: boolean } = {},
): Promise<MintedGrant> {
  const serviceKey = resolveServiceKey();
  if (!serviceKey) throw new Error("answerPasswordGrantWithMintedSession: no service-role key (SUPABASE_SERVICE_ROLE_KEY)");
  const stats: MintedGrant = { answered: 0, dropped: 0 };
  // Matched by URL parts, not a literal grant URL: this intercepts the grant,
  // it never sends one (src/test/noAnonPasswordGrants.test.ts).
  const isPasswordGrant = (u: URL) => u.pathname.endsWith("/auth/v1/token") && u.searchParams.get("grant_type") === "password";
  await page.route(isPasswordGrant, async (route: Route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    const origin = req.headerValue ? await req.headerValue("origin") : null;
    const cors = { "access-control-allow-origin": origin ?? "*", "access-control-allow-credentials": "true" };
    let body: { email?: string };
    try {
      body = req.postDataJSON() ?? {};
    } catch {
      // Not JSON: no address to match, so it is answered as GoTrue answers a
      // wrong one (400 below), which fails the spec visibly.
      body = {};
    }
    if (String(body.email ?? "").trim().toLowerCase() !== email.trim().toLowerCase()) {
      return route.fulfill({
        status: 400,
        headers: cors,
        contentType: "application/json",
        body: JSON.stringify({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }),
      });
    }
    const session = await mintAdminSession({ email, serviceKey });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    if (dropFirst && stats.answered + stats.dropped === 0) {
      stats.dropped++;
      test.info().annotations.push({ type: "network-drop", description: "password grant: minted session LOST on the wire" });
      return route.abort("internetdisconnected");
    }
    stats.answered++;
    return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(session) });
  });
  return stats;
}
