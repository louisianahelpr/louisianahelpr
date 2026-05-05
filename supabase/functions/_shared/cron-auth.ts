/**
 * Validates that the request comes from an authorized cron caller.
 * Returns a Response with 401 if unauthorized, 500 if no secret is
 * configured, or null if authorized.
 *
 * Accepts the Bearer against any of three env vars (in priority order):
 *   - CRON_SECRET — dedicated shared secret
 *   - SECRET_KEY — new sb_secret_* (set as Supabase function secret)
 *   - SUPABASE_SERVICE_ROLE_KEY — auto-injected legacy JWT (works until
 *     "Disable JWT-based API keys" is clicked in Studio)
 *
 * This matches the inline pattern most other cron-invoked functions in
 * this repo use. It's intentionally lenient during the JWT key migration:
 * cron commands currently send vault.service_role_key (= sb_secret_*),
 * which matches SECRET_KEY env var. Post-Disable-Legacy, only SECRET_KEY
 * works (SUPABASE_SERVICE_ROLE_KEY auto-inject stops returning a valid value).
 */
export function verifyCronSecret(req: Request): Response | null {
  const accepted = [
    Deno.env.get('CRON_SECRET'),
    Deno.env.get('SECRET_KEY'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  ].filter((s): s is string => !!s && s.length > 0);

  if (accepted.length === 0) {
    console.error('No auth secret configured (set CRON_SECRET, SECRET_KEY, or SUPABASE_SERVICE_ROLE_KEY)');
    return new Response('Server misconfiguration', { status: 500 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !accepted.some((k) => authHeader === `Bearer ${k}`)) {
    return new Response('Unauthorized', { status: 401 });
  }

  return null; // authorized
}
