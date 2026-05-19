// Shared CORS headers and response helpers for edge functions.
//
// Two header sets are exported to match the two variants used across the
// codebase:
//
//   corsHeaders       — the standard short set used by internal/cron functions
//                       (authorization, x-client-info, apikey, content-type)
//   corsHeadersFull   — the extended set that also allows the four
//                       x-supabase-client-* headers sent by the JS client SDK
//
// Usage — OPTIONS preflight:
//   if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
//
// Usage — JSON response:
//   return jsonResponse({ ok: true }, 200, corsHeaders);
//   return errorResponse("Not found", 404, corsHeaders);

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export const corsHeadersFull: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Return a JSON response with CORS headers merged in. */
export function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** Return a JSON error response: { error: message }. */
export function errorResponse(
  message: string,
  status: number,
  headers: Record<string, string>,
): Response {
  return jsonResponse({ error: message }, status, headers);
}
