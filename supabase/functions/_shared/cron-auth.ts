/**
 * Validates that the request comes from an authorized cron caller.
 * Returns a Response with 401 if unauthorized, or null if authorized.
 */
export function verifyCronSecret(req: Request): Response | null {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret) {
    console.error('CRON_SECRET not configured');
    return new Response('Server misconfiguration', { status: 500 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  return null; // authorized
}
