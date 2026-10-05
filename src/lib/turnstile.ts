/**
 * Cloudflare Turnstile — bot protection on the email auth calls (Q1314).
 *
 * Supabase Auth verifies the token server-side once the project's
 * `security_captcha_enabled` is on (provider `turnstile`, secret held in the
 * auth config). Every email-auth call — sign-up, password sign-in, password
 * reset, resend — passes `options.captchaToken`; the class guard is
 * src/test/emailAuthCaptchaToken.test.ts. Social sign-in (Apple/Google
 * id_token / OAuth) needs no token.
 *
 * The site key is PUBLIC (it ships in the page by design). The widget allows
 * louisianahelpr.com, www.louisianahelpr.com and localhost — the last is the
 * Capacitor webview's hostname on iOS and Android.
 */

/** The production widget's public site key (Cloudflare dashboard, Managed mode). */
const DEFAULT_TURNSTILE_SITE_KEY = "0x4AAAAAAFOBRZ7o_J6I6kF8";

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * The site key to render with, or `null` when Turnstile is off.
 *
 * Read at call time (not module load) so a test can `vi.stubEnv` it. An
 * explicitly EMPTY `VITE_TURNSTILE_SITE_KEY` turns the widget off; unset means
 * the production key. Under vitest the default is off, because jsdom never
 * loads external scripts and every auth-page test would otherwise wait on a
 * widget that cannot exist; tests that exercise the widget stub the env.
 */
export function turnstileSiteKey(): string | null {
  const raw = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  if (raw !== undefined) return raw.trim() === "" ? null : raw.trim();
  return import.meta.env.MODE === "test" ? null : DEFAULT_TURNSTILE_SITE_KEY;
}

export interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback": (code?: string) => boolean | void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  "before-interactive-callback": () => void;
  "after-interactive-callback": () => void;
  appearance: "always" | "execute" | "interaction-only";
  size: "normal" | "flexible" | "compact";
  theme: "auto" | "light" | "dark";
  action?: string;
}

export interface TurnstileApi {
  render: (el: HTMLElement, opts: TurnstileRenderOptions) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let pending: Promise<TurnstileApi> | null = null;

/**
 * Load api.js once. A failed load clears the cached promise so the next call
 * (the Retry button) starts a fresh script tag instead of re-awaiting a
 * rejection forever.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (pending) return pending;
  pending = new Promise<TurnstileApi>((resolve, reject) => {
    document.querySelectorAll(`script[data-turnstile]`).forEach((s) => s.remove());
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.dataset.turnstile = "1";
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile script loaded without its API"));
    };
    script.onerror = () => reject(new Error("turnstile script failed to load"));
    document.head.appendChild(script);
  }).catch((err: unknown) => {
    pending = null;
    throw err;
  });
  return pending;
}

/** True for GoTrue's refusal of a missing/invalid/used captcha token. */
export function isCaptchaError(message: string | undefined | null): boolean {
  return /captcha/i.test(message ?? "");
}
