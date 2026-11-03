import { lazy, type ComponentType } from "react";
import { report } from "@/lib/errorLogger";

/**
 * React.lazy for an OPTIONAL piece of a page: a one-time prompt or an ask that
 * is often not even due (Q2544). When its chunk fails to load, the failure is
 * reported once as a warning and the piece draws nothing, instead of throwing
 * into the page's error boundary and replacing the whole route with
 * "Something went sideways" (2026-10-31 23:30Z, /jobs, SmsPhonePrompt-<hash>.js).
 *
 * Use it only for parts the page works without. A page's own content, or
 * anything the member asked to open, keeps plain lazy() and the boundaries'
 * stale-chunk recovery.
 */
export function optionalLazy<T extends ComponentType<any>>(load: () => Promise<{ default: T }>, source: string) {
  const Nothing = (() => null) as unknown as T;
  return lazy(() =>
    load().catch((err: unknown) => {
      report(err, { severity: "warning", tags: { source, kind: "optional-chunk-failed" } });
      return { default: Nothing };
    }),
  );
}
