import { ArrowUpRight, RefreshCw } from "lucide-react";
import { detectStoreUrl } from "@/lib/storeUrl";

/**
 * ForceUpdate — full-screen blocker shown when the installed native
 * binary is older than `MIN_SUPPORTED_BUILD` (see `useVersionCheck`).
 *
 * Renders OUTSIDE the React Router tree so a stuck old binary can't
 * navigate around it. The only escape is the App Store / Play Store
 * update flow.
 *
 * Web / dev never see this — `useVersionCheck` short-circuits when
 * `isNativePlatform` is false.
 */

interface Props {
  /** Optional override for the store URL — primarily for tests. */
  storeUrl?: string;
}

export const ForceUpdate = ({ storeUrl }: Props) => {
  const url = storeUrl ?? detectStoreUrl();

  const handleUpdate = () => {
    // The webview-internal `window.open` would just navigate the
    // webview itself, leaving the user inside the old binary. Use
    // `location.href`; on iOS / Android this triggers the OS deep-link
    // handler that opens the App Store / Play Store app.
    window.location.href = url;
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="force-update-title"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center px-6 py-10"
      style={{
        background: "hsl(var(--premium-page, 40 30% 96%))",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 2.5rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2.5rem)",
      }}
    >
      <div className="max-w-md w-full text-center space-y-5">
        <div
          className="w-16 h-16 rounded-full mx-auto flex items-center justify-center"
          style={{
            background: "hsl(var(--bark) / 0.12)",
            color: "hsl(var(--bark))",
            border: "0.5px solid hsl(var(--bark) / 0.22)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255,255,255,0.55), 0 6px 18px -6px hsl(var(--olivewood) / 0.20)",
          }}
        >
          <RefreshCw className="h-7 w-7" strokeWidth={1.75} />
        </div>
        <div className="space-y-1.5">
          <span
            className="font-serif italic uppercase block"
            style={{
              fontSize: "0.62rem",
              color: "hsl(var(--burnt-sienna))",
              letterSpacing: "0.18em",
            }}
          >
            Time for an update
          </span>
          <h1
            id="force-update-title"
            className="font-display italic font-bold leading-tight"
            style={{
              fontSize: "clamp(1.45rem, 3vw + 0.4rem, 1.85rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            Update Helpr to keep going.
          </h1>
          <p
            className="font-serif italic leading-relaxed max-w-sm mx-auto"
            style={{
              fontSize: "0.92rem",
              color: "hsl(var(--olivewood) / 0.8)",
            }}
          >
            We've shipped a few important changes — getting the latest version
            takes about thirty seconds and unlocks the features behind this
            screen.
          </p>
        </div>
        <button
          type="button"
          onClick={handleUpdate}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-full font-sans font-semibold active:scale-[0.98] transition-transform"
          style={{
            background: "hsl(var(--bark))",
            color: "hsl(var(--parchment))",
            border: "1px solid hsl(70 22% 24%)",
            fontSize: "0.95rem",
            letterSpacing: "0.01em",
            boxShadow:
              "inset 0 1px 0 0 rgba(255,255,255,0.12), 0 1px 2px hsl(var(--bark) / 0.18), 0 8px 18px -8px hsl(var(--bark) / 0.4)",
          }}
        >
          Open the store
          <ArrowUpRight className="h-4 w-4" strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
};

export default ForceUpdate;
