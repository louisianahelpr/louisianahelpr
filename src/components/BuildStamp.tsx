/**
 * BuildStamp — renders the git commit SHA and build date baked in at build
 * time via Vite's `define`. Useful for confirming which build is running
 * without DevTools, but the raw commit hash is debugging noise to a real
 * user — so it is hidden in production and only rendered in dev/preview
 * (non-PROD) builds.
 */
import { formatShortDate } from "@/lib/format";

const BuildStamp = () => {
  // Hide the raw build hash from real users on the auth screen; it is only
  // meaningful for debugging, so keep it to dev/preview builds.
  if (import.meta.env.PROD) return null;

  return (
    <p
      className="text-center font-sans select-none"
      style={{
        fontSize: "0.65rem",
        letterSpacing: "0.08em",
        color: "hsl(var(--olivewood) / 0.80)",
        lineHeight: 1.4,
      }}
    >
      build {__APP_COMMIT__} · {formatShortDate(__APP_BUILT_AT__)}
    </p>
  );
};

export default BuildStamp;
