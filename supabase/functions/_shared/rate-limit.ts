import { createClient } from "npm:@supabase/supabase-js@2.57.2";

interface RateLimitOptions {
  windowMs: number;  // Time window in ms
  maxRequests: number;  // Max requests per window
  keyPrefix: string;  // Prefix for rate limit key
}

/**
 * Simple IP-based rate limiter using Supabase.
 * Returns { allowed: boolean, remaining: number }
 */
export async function checkRateLimit(
  req: Request,
  options: RateLimitOptions
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  const { windowMs, maxRequests, keyPrefix } = options;

  // Get IP from headers
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const key = `${keyPrefix}:${ip}`;
  const now = Date.now();
  const windowStart = now - windowMs;

  // Use in-memory Map for simplicity (resets on cold start, which is fine for edge functions)
  if (!globalThis.__rateLimitStore) {
    globalThis.__rateLimitStore = new Map<string, number[]>();
  }

  const store = globalThis.__rateLimitStore as Map<string, number[]>;
  const timestamps = (store.get(key) || []).filter((t: number) => t > windowStart);
  
  if (timestamps.length >= maxRequests) {
    const oldestInWindow = timestamps[0];
    const retryAfter = Math.ceil((oldestInWindow + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  timestamps.push(now);
  store.set(key, timestamps);

  return { allowed: true, remaining: maxRequests - timestamps.length };
}

export function rateLimitResponse(retryAfter: number, corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again later." }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
      },
    }
  );
}
