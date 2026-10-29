import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { loadTurnstile, turnstileSiteKey, type TurnstileApi } from "@/lib/turnstile";

/**
 * Cloudflare Turnstile, Managed mode, `interaction-only`: invisible for most
 * people, a checkbox only when Cloudflare wants one (Q1314).
 *
 * The form around it never waits on it to render, and a submit never waits on
 * a checkbox the server may not need (A3-B1). On submit the caller asks
 * `getToken()`: a token if there is one, else it waits briefly while the
 * invisible check is still running, and resolves `null` the moment Cloudflare
 * shows a box (or fails). A null token still goes to Supabase: while captcha
 * is off server-side (owner-approved 2026-10-15, Q2113) that is simply a
 * sign-in. Only when the server REFUSES for captcha does the caller ask again
 * with `{ waitForCheckbox: true }` (runWithCaptcha, src/hooks/useCaptcha.ts):
 * that wait shows "Tick the box to finish." under the box and gives the person
 * time to tap it. Tokens are single-use: getToken hands each one out once, and
 * the caller calls `reset()` after spending one so the widget mints the next.
 */
export interface TurnstileHandle {
  getToken: (opts?: { waitForCheckbox?: boolean }) => Promise<string | null>;
  reset: () => void;
}

type Status = "off" | "loading" | "ready" | "interactive" | "error";

/** How long a submit waits for an invisible challenge to finish. */
const SILENT_WAIT_MS = 8_000;
/** How long a `waitForCheckbox` ask waits once Cloudflare has shown a checkbox to press. */
const INTERACTIVE_WAIT_MS = 45_000;
/** Below this host width the `flexible` widget (300px minimum) would overflow the card, so it renders `compact`. */
const FLEXIBLE_MIN_PX = 300;

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
    // A `waitForCheckbox` ask is waiting on the visible box: say what to do.
    const [prompting, setPrompting] = useState(false);

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
            size: hostRef.current.clientWidth >= FLEXIBLE_MIN_PX ? "flexible" : "compact",
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
        getToken: async (opts) => {
          const waitForCheckbox = opts?.waitForCheckbox === true;
          const started = Date.now();
          // Once this wait has seen a visible checkbox it keeps the long
          // deadline, even after after-interactive drops the status back to
          // "loading" while Cloudflare verifies the tap.
          let sawInteractive = false;
          try {
            for (;;) {
              // TAKE the token, never just read it (Q1589): two callers can be
              // waiting at once (sign-up's lead capture and its signUp), and a
              // token is single-use, so the second must wait for a fresh one.
              const taken = tokenRef.current;
              if (taken) {
                tokenRef.current = null;
                return taken;
              }
              const s = statusRef.current;
              if (s === "off" || s === "error") return null;
              // A box is up. Unless the server already refused a call for
              // captcha, never hold the submit on it (A3-B1).
              if (s === "interactive" && !waitForCheckbox) return null;
              if (s === "interactive" && !sawInteractive) {
                sawInteractive = true;
                setPrompting(true);
              }
              const left = (sawInteractive ? INTERACTIVE_WAIT_MS : SILENT_WAIT_MS) - (Date.now() - started);
              if (left <= 0) return null;
              await new Promise<void>((wake) => {
                const t = window.setTimeout(wake, left);
                waitersRef.current.push(() => {
                  window.clearTimeout(t);
                  wake();
                });
              });
            }
          } finally {
            if (sawInteractive) setPrompting(false);
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
        {prompting && status === "interactive" && (
          <p role="status" className="mt-1 text-ds-12 text-muted-foreground">
            Tick the box to finish.
          </p>
        )}
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
              className="link-standard font-semibold"
              style={{ color: "hsl(var(--bark))" }}
            >
              <RefreshCw className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
              Retry
            </button>
          </p>
        )}
      </div>
    );
  },
);
