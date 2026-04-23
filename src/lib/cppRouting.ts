/**
 * Custom Product Page (CPP) routing.
 *
 * App Store Connect lets us create up to 70 alternate listings per app, each
 * with its own URL containing a `?ppid=...` query string. When someone taps
 * a CPP install link, iOS preserves that query string and hands it to the
 * app on first launch (via Universal Links / the install referrer).
 *
 * We use it to deep-link straight to the right onboarding screen so the
 * "Poster" funnel and the "Helper" funnel never have to share a generic
 * landing page.
 *
 * Variants:
 *   - poster  →  /post-job  (homeowners booking work)
 *   - helper  →  /signup?intent=helper  (workers signing up)
 *
 * Add new variants here when we launch parish-specific or seasonal CPPs.
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { track, AhaEvent } from "@/lib/analytics";
import { recordPpoAttribution } from "@/lib/ppoAttribution";

export type CppVariant = "poster" | "helper";

const STORAGE_KEY = "helpr_cpp_variant";

/**
 * Map App Store Connect Product Page IDs (`ppid`) to in-app variants.
 * The IDs come from App Store Connect after we publish each CPP — fill them
 * in once they're issued. Until then we also accept a friendly `cpp=` param
 * so marketing links work before the App Store IDs are live.
 *
 * Example final link:
 *   https://apps.apple.com/us/app/helpr/id6754470134?ppid=POSTER_ID_FROM_ASC
 */
const PPID_TO_VARIANT: Record<string, CppVariant> = {
  // POSTER_PPID_PLACEHOLDER: "poster",
  // HELPER_PPID_PLACEHOLDER: "helper",
};

const VARIANT_ROUTES: Record<CppVariant, string> = {
  poster: "/post-job",
  helper: "/signup?intent=helper",
};

function readVariantFromQuery(search: string): CppVariant | null {
  const params = new URLSearchParams(search);
  const cpp = params.get("cpp");
  if (cpp === "poster" || cpp === "helper") return cpp;
  const ppid = params.get("ppid");
  if (ppid && PPID_TO_VARIANT[ppid]) return PPID_TO_VARIANT[ppid];
  return null;
}

/**
 * Call once at app startup. If the launch URL identifies a CPP variant,
 * we record it for analytics and route the user to the matching screen.
 *
 * Safe to call on web too — the same `?cpp=` query works for paid social
 * ads pointing at louisianahelpr.com.
 */
export function useCppVariantRouter() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Always check for PPO attribution first — a user can land on a PPO
    // treatment of either funnel, and we want both signals.
    recordPpoAttribution(location.search);

    const variant = readVariantFromQuery(location.search);
    if (!variant) return;

    try {
      sessionStorage.setItem(STORAGE_KEY, variant);
    } catch {
      // private mode / disabled storage — best-effort only
    }

    track(AhaEvent.AppOpenedFromDeepLink, {
      source: "cpp",
      variant,
    });

    // Only redirect from the bare landing route — never yank a user out of
    // a deep link they followed (e.g. a job share URL).
    if (location.pathname === "/" || location.pathname === "") {
      navigate(VARIANT_ROUTES[variant], { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Last-seen CPP variant for this session (used to tag downstream events). */
export function getActiveCppVariant(): CppVariant | null {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    return v === "poster" || v === "helper" ? v : null;
  } catch {
    return null;
  }
}
