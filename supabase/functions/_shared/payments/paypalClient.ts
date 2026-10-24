/**
 * The ONE place that speaks HTTP to PayPal's REST API (PayPal Plan A, phase 1).
 *
 * - SANDBOX ONLY for now. `PAYPAL_LIVE_ALLOWED` is false: a client built with
 *   env "live" throws before any request (owner 2026-10-23: sandbox only, never
 *   live keys). Turning live on is a reviewed one-line change, pinned by
 *   src/test/paypalClient.test.ts.
 * - Every write (POST/PATCH) MUST carry an idempotency key, sent as
 *   PayPal-Request-Id. PayPal answers a replay with the original object
 *   (sandbox, 2026-10-23: same key on order create gave 201 then 200 with the
 *   same order id). A write without a key throws before any request.
 * - The client secret is only ever put in the Authorization header of the
 *   token call. It is never logged and never part of an error message.
 * - Plain fetch, no SDK; injectable fetch so tests run without a network.
 */
import { ProviderApiError, type ProviderEnv } from "./types.ts";
import { caughtMessage } from "../caughtMessage.ts";

/** Phase 1: live PayPal is refused outright. */
export const PAYPAL_LIVE_ALLOWED = false;

const PAYPAL_BASE_URL: Record<ProviderEnv, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

const REQUEST_TIMEOUT_MS = 20_000;
/** Refresh the token this long before PayPal says it expires. */
const TOKEN_SKEW_MS = 120_000;

export interface PayPalClientConfig {
  env: ProviderEnv;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface PayPalRequestOptions {
  body?: unknown;
  /**
   * A JSON body sent byte for byte (no re-serialising). verify-webhook-signature
   * needs the event "posted back exactly as it was received".
   */
  rawJsonBody?: string;
  /** Required for POST and PATCH. Deterministic, derived from our own row. */
  idempotencyKey?: string;
  /** "return=representation" asks PayPal for the full object. */
  prefer?: string;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface HttpResult { status: number; ok: boolean; text: string }

interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: Array<{ issue?: string; description?: string; link?: Array<{ href?: string }> }>;
  links?: Array<{ href?: string }>;
  error?: string;
  error_description?: string;
}

export class PayPalClient {
  readonly env: ProviderEnv;
  readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(cfg: PayPalClientConfig) {
    if (cfg.env !== "sandbox" && cfg.env !== "live") throw new Error(`paypal_env_invalid: ${String(cfg.env)}`);
    if (cfg.env === "live" && !PAYPAL_LIVE_ALLOWED) throw new Error("paypal_live_refused: live PayPal is not enabled in this build");
    if (!cfg.clientId || !cfg.clientSecret) throw new Error("paypal_credentials_missing");
    this.env = cfg.env;
    this.baseUrl = PAYPAL_BASE_URL[cfg.env];
    this.clientId = cfg.clientId;
    this.clientSecret = cfg.clientSecret;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.now = cfg.now ?? Date.now;
  }

  async request<T>(method: Method, path: string, opts: PayPalRequestOptions = {}): Promise<T> {
    if ((method === "POST" || method === "PATCH") && !opts.idempotencyKey) {
      throw new Error(`paypal_idempotency_key_required: ${method} ${path}`);
    }
    if (!path.startsWith("/v")) throw new Error(`paypal_path_invalid: ${path}`);
    let res = await this.send(method, path, opts, await this.accessToken());
    if (res.status === 401) {
      // An expired or revoked token: fetch a new one and retry ONCE with the same idempotency key.
      this.token = null;
      res = await this.send(method, path, opts, await this.accessToken());
    }
    return this.parse<T>(res, method, path);
  }

  private async send(method: Method, path: string, opts: PayPalRequestOptions, token: string): Promise<HttpResult> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (opts.body !== undefined && opts.rawJsonBody !== undefined) throw new Error("paypal_body_ambiguous");
    if (opts.body !== undefined || opts.rawJsonBody !== undefined) headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey) headers["PayPal-Request-Id"] = opts.idempotencyKey;
    if (opts.prefer) headers["Prefer"] = opts.prefer;
    return await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: opts.rawJsonBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    }, `${method} ${path}`);
  }

  private parse<T>(res: HttpResult, method: Method, path: string): T {
    const text = res.text;
    if (res.ok) {
      if (!text) return null as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ProviderApiError(`paypal ${method} ${path}: ${res.status} with a body that is not JSON`, res.status, null, null, null);
      }
    }
    let err: PayPalErrorBody = {};
    try {
      err = text ? (JSON.parse(text) as PayPalErrorBody) : {};
    } catch {
      // Not JSON (a proxy's HTML error page): keep the status, report no issue code.
      err = {};
    }
    const issue = err.details?.[0]?.issue ?? null;
    const desc = err.details?.[0]?.description ?? err.message ?? err.error_description ?? "";
    throw new ProviderApiError(
      `paypal ${method} ${path}: ${res.status} ${err.name ?? err.error ?? ""}${issue ? ` ${issue}` : ""}${desc ? `: ${desc}` : ""}`.trim(),
      res.status,
      err.name ?? err.error ?? null,
      issue,
      err.debug_id ?? null,
      [...(err.details ?? []).flatMap((d) => d.link ?? []), ...(err.links ?? [])]
        .map((l) => l.href)
        .filter((h): h is string => typeof h === "string"),
    );
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt) return this.token.value;
    const basic = btoa(`${this.clientId}:${this.clientSecret}`);
    const res = await this.fetchWithTimeout(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    }, "POST /v1/oauth2/token");
    const text = res.text;
    if (!res.ok) {
      // Never echo the request (it carries the secret); the status and PayPal's error name are enough.
      let name: string | null = null;
      try {
        name = (JSON.parse(text) as PayPalErrorBody).error ?? null;
      } catch {
        // Not JSON: the status alone says what happened.
        name = null;
      }
      throw new ProviderApiError(`paypal token: ${res.status}${name ? ` ${name}` : ""}`, res.status, name, null, null);
    }
    let body: { access_token?: string; expires_in?: number };
    try {
      body = JSON.parse(text) as { access_token?: string; expires_in?: number };
    } catch {
      // Never surface the parser's message: it quotes the body, which may hold a token.
      throw new ProviderApiError("paypal token: 200 with a body that is not JSON", res.status, null, null, null);
    }
    if (!body.access_token || typeof body.expires_in !== "number") {
      throw new ProviderApiError("paypal token: 200 without access_token/expires_in", res.status, null, null, null);
    }
    this.token = { value: body.access_token, expiresAt: this.now() + body.expires_in * 1000 - TOKEN_SKEW_MS };
    return body.access_token;
  }

  /** The whole exchange, body included, inside one timeout: a body that never finishes cannot hang the function. */
  private async fetchWithTimeout(url: string, init: RequestInit, label: string): Promise<HttpResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, { ...init, signal: ctrl.signal });
      return { status: res.status, ok: res.ok, text: await res.text() };
    } catch (e) {
      // Transport failure or timeout: status 0 marks it retryable (same idempotency key).
      const msg = caughtMessage(e);
      throw new ProviderApiError(`paypal ${label}: transport failure: ${msg}`, 0, null, null, null);
    } finally {
      clearTimeout(timer);
    }
  }
}
