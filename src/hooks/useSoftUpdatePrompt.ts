import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { detectStoreUrl } from "@/lib/storeUrl";

/**
 * Soft, non-blocking "a new version is available" nudge.
 *
 * Distinct from the hard <ForceUpdate /> gate: this fires only when the
 * installed build is still SUPPORTED but a newer one exists in the stores
 * (driven by platform_settings.latest_build via useVersionCheck). Shows a
 * dismissible toast linking to the App/Play Store.
 *
 * Snooze is keyed by the target build, so dismissing the nudge for build N
 * won't suppress the nudge for build N+1 later. Shown at most once per app
 * session (a ref guard) to avoid re-prompting on every re-render/refocus.
 */
const SNOOZE_KEY = "helpr_soft_update_dismissed_build";

function dismissedBuild(): number {
  try {
    return parseInt(localStorage.getItem(SNOOZE_KEY) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

function snooze(build: number) {
  try {
    localStorage.setItem(SNOOZE_KEY, String(build));
  } catch {
    /* storage blocked — worst case we nudge again next session */
  }
}

export function useSoftUpdatePrompt() {
  const { updateAvailable, latestBuild } = useVersionCheck();
  const shownRef = useRef(false);

  useEffect(() => {
    if (!updateAvailable || latestBuild <= 0 || shownRef.current) return;
    if (dismissedBuild() >= latestBuild) return;
    shownRef.current = true;

    toast("A new version of Helpr is available", {
      description: "Update for the latest features and fixes.",
      duration: Infinity,
      action: {
        label: "Update",
        onClick: () => {
          window.location.href = detectStoreUrl();
        },
      },
      onDismiss: () => snooze(latestBuild),
    });
  }, [updateAvailable, latestBuild]);
}
