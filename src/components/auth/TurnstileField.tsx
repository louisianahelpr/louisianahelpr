import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { loadTurnstile, turnstileSiteKey, type TurnstileApi } from "@/lib/turnstile";

/**
 * Cloudflare Turnstile, Managed mode, `interaction-only`: invisible for most
 * people, a checkbox only when Cloudflare wants one (Q1314).
 *
 * The form around it never waits on it to render. On submit the caller asks
 * `getToken()`: a token if there is one, else it waits briefly (longer while a
 * visible challenge is up), and resolves `null` rather than hanging. A null
 * token still goes to Supabase — while captcha is off server-side that is
 * simply a sign-in; once it is on, GoTrue refuses with a captcha error, which
 * the caller words via `isCaptchaError`. Tokens are single-use: the caller
 * calls `reset()` after every attempt.
 */
export interface TurnstileHandle {
  getToken: () => Promise<string | null>;
  reset: () => void;
}

type Status = "off" | "loading" | "ready" | "interactive" | "error";

/** How long a submit waits for an invisible challenge to finish. */
const SILENT_WAIT_MS = 8_000;
/** How long it waits once Cloudflare has shown a checkbox to press. */
const INTERACTIVE_WAIT_MS = 45_000;

function currentTheme(): "light" | "dark" | "auto" {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "dark" || t === "light" ? t : "auto";
}

export const TurnstileField = forwardRef<TurnstileHandle, { action: string; className?: string }>(
  function TurnstileField({ action, className }, ref) {
    const siteKey = turnstileSiteKey();
    const hostRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<TurnstileApi | null>(null);
    const widgetRef = useRef<string | undefined>(undefined);
    const tokenRef = useRef<string | null>(null);
    const statusRef = useRef<Status>(siteKey ? "loading" : "off");
    const waitersRef = useRef<Array<() => void>>([]);
    const [status, setStatusState] = useState<Status>(statusRef.current);
    const [attempt, setAttempt] = useState(0);

    const setStatus = useCallback((s: Status) => {
      statusRef.current = s;
      setStatusState(s);
      waitersRef.current.splice(0).forEach((wake) => wake());
    }, []);

    useEffect(() => {
      if (!siteKey) return;
      let cancelled = false;
      setStatus("loading");
      loadTurnstile()
        .then((api) => {
          if (cancelled || !hostRef.current) return;
          apiRef.current = api;
          widgetRef.current = api.render(hostRef.current, {
            sitekey: siteKey,
            action,
            appearance: "interaction-only",
            size: "flexible",
            theme: currentTheme(),
            callback: (token) => {
              tokenRef.current = token;
              setStatus("ready");
            },
            "error-callback": () => {
              tokenRef.current = null;
              setStatus("error");
              // Handled: tells Turnstile not to throw the error to the console.
              return true;
            },
            "expired-callback": () => {
              tokenRef.current = null;
              api.reset(widgetRef.current);
            },
            "timeout-callback": () => {
              tokenRef.current = null;
              api.reset(widgetRef.current);
            },
            "before-interactive-callback": () => setStatus("interactive"),
            "after-interactive-callback": () => {
              if (statusRef.current === "interactive") setStatus("loading");
            },
          });
        })
        .catch(() => {
          // The script never arrived (blocked, offline, CSP). Not silent: the
          // retry line below renders, and submit carries on without a token.
          if (!cancelled) setStatus("error");
        });
      return () => {
        cancelled = true;
        if (apiRef.current && widgetRef.current) apiRef.current.remove(widgetRef.current);
        widgetRef.current = undefined;
        tokenRef.current = null;
      };
    }, [siteKey, action, attempt, setStatus]);

    useImperativeHandle(
      ref,
      () => ({
        getToken: async () => {
          const deadline = (s: Status) => (s === "interactive" ? INTERACTIVE_WAIT_MS : SILENT_WAIT_MS);
          const started = Date.now();
          for (;;) {
            if (tokenRef.current) return tokenRef.current;
            const s = statusRef.current;
            if (s === "off" || s === "error") return null;
            const left = deadline(s) - (Date.now() - started);
            if (left <= 0) return null;
            await new Promise<void>((wake) => {
              const t = window.setTimeout(wake, left);
              waitersRef.current.push(() => {
                window.clearTimeout(t);
                wake();
              });
            });
          }
        },
        reset: () => {
          tokenRef.current = null;
          if (apiRef.current && widgetRef.current) {
            setStatus("loading");
            apiRef.current.reset(widgetRef.current);
          }
        },
      }),
      [setStatus],
    );

    if (!siteKey) return null;
    // Nothing to see while the check runs invisibly: collapse to zero height
    // and cancel the parent's space-y margin, so the form's rhythm is the same
    // as without it. The iframe still runs inside the collapsed box.
    const visible = status === "interactive" || status === "error";
    return (
      <div
        className={visible ? className : "!mt-0 h-0 overflow-hidden"}
        data-testid="turnstile"
        data-status={status}
      >
        <div ref={hostRef} />
        {status === "error" && (
          <p role="status" className="flex flex-wrap items-center gap-x-2 text-ds-12 text-muted-foreground">
            <span>The security check didn't load.</span>
            <button
              type="button"
              onClick={() => {
                if (apiRef.current && widgetRef.current) apiRef.current.remove(widgetRef.current);
                widgetRef.current = undefined;
                setAttempt((n) => n + 1);
              }}
              className="inline-flex min-h-[44px] items-center gap-1 font-semibold hover:underline"
              style={{ color: "hsl(var(--bark))" }}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </button>
          </p>
        )}
      </div>
    );
  },
);
