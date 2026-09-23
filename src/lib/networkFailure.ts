/**
 * Did this request fail on the WIRE, rather than being refused by the server?
 *
 * The difference decides two things (Q267, Q270):
 *   · what a person is told: a dropped connection gets connection copy, never
 *     the transport's own words ("TypeError: Failed to fetch", "Load failed");
 *   · whether the write may have LANDED. A refusal means it did not. A
 *     transport failure means we cannot know: the request may have reached the
 *     server and only the response was lost, so a retry must be idempotent.
 *
 * Shapes, each a real string, not a guess at one:
 *   · postgrest-js turns a rejected fetch into `{ code: "", message: String(err) }`,
 *     i.e. "TypeError: Failed to fetch" (Chromium), "TypeError: Load failed"
 *     (WebKit, the surface this app ships on), "TypeError: NetworkError when
 *     attempting to fetch resource." (Firefox);
 *   · functions-js throws/returns FunctionsFetchError ("Failed to send a request
 *     to the Edge Function") and FunctionsRelayError ("Relay Error invoking the
 *     Edge Function") for a request whose outcome it never heard;
 *   · WKWebView's NSURLError prose for offline / timeout / dropped connection.
 * The same families userFacingError.ts and authErrors.ts already recognise.
 */
const TRANSPORT_PATTERNS: RegExp[] = [
  /Failed to fetch/i,
  /\bLoad failed\b/i,
  /NetworkError/i,
  /Network request failed/i,
  /The (network connection was lost|request timed out|Internet connection appears to be offline)/i,
  /Failed to send a request to the Edge Function/i,
  /Relay Error invoking the Edge Function/i,
];

export function isNetworkFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  if (name === "FunctionsFetchError" || name === "FunctionsRelayError") return true;
  const msg = typeof message === "string" ? message : "";
  return TRANSPORT_PATTERNS.some((re) => re.test(msg));
}

/** The one sentence for a dropped connection (same line as authErrors.ts). */
export const CONNECTION_TROUBLE_COPY = "Connection trouble. Check your signal and try again.";
