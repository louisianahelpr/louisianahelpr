// Returns the canonical app base URL, never sourced from request headers.
// APP_URL env var can override for staging environments; falls back to the
// production domain.
//
// Never pass req.headers.get("origin") to Stripe redirect URLs — the Origin
// header is attacker-controlled, enabling open-redirect phishing attacks where
// a legitimate Stripe checkout URL bounces the user to an arbitrary domain.
export function getAppUrl(): string {
  return Deno.env.get("APP_URL") ?? "https://www.louisianahelpr.com";
}
