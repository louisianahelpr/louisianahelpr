/**
 * Universal-link safe deep-link helper.
 *
 * In native, this opens an in-app route via React Router.
 * On web, it's a regular window.location change.
 *
 * Usage:
 *   const open = useDeepLink();
 *   open("/post-job?prefill=cleaning");
 */
import { useNavigate } from "react-router-dom";
import { track, AhaEvent } from "@/lib/analytics";

export function useDeepLink() {
  const navigate = useNavigate();

  return (to: string, opts?: { source?: string; analyticsProps?: Record<string, any> }) => {
    if (opts?.source) {
      track(AhaEvent.AppOpenedFromDeepLink, { source: opts.source, to, ...opts.analyticsProps });
    }
    navigate(to);
  };
}

/**
 * Build a referral share URL. The /signup route already reads ?ref=...
 * on mount, so any device that opens the link gets the referral attached.
 */
export function buildReferralUrl(code: string): string {
  return `https://louisianahelpr.com/signup?ref=${encodeURIComponent(code)}`;
}
