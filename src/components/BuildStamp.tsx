/**
 * BuildStamp — renders the git commit SHA and build date baked in at build
 * time via Vite's `define`. Visible on the login screen so anyone can
 * instantly confirm which build is running without needing DevTools.
 */

const formatBuiltAt = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
};

const BuildStamp = () => (
  <p
    className="text-center font-sans select-none"
    style={{
      fontSize: "0.65rem",
      letterSpacing: "0.08em",
      color: "hsl(var(--olivewood) / 0.80)",
      lineHeight: 1.4,
    }}
  >
    build {__APP_COMMIT__} · {formatBuiltAt(__APP_BUILT_AT__)}
  </p>
);

export default BuildStamp;
